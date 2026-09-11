// The offline `sinkSchemaHash`: rendering the from-proto sink's DDL from the package's own proto descriptors must
// produce exactly what `schema-dump` read back out of the live ClickHouse Cloud deployment.
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { renderSchemaSql, renderSchemaFromSpkg, convertToType, type SchemaFlavor } from "../src/schema/render.ts";
import { normalizeSql } from "../src/receipt.ts";
import { createCtx } from "../src/util/ctx.ts";
import { runGate } from "../src/gate/run.ts";
import { main } from "../src/cli.ts";
import { REPO_ROOT, fdsFixture, hasBuf, hasSubstreams, pathExists, makeTempRepo, REAL_SPKG } from "./helpers.ts";
import type { FdsJson } from "../src/proto/descriptor.ts";

/** The committed dump of the real cloud deployment: `SHOW CREATE TABLE` for the four tables, normalized. */
const CLOUD_DUMP = join(REPO_ROOT, "runs", "20260910T234439Z-1fr9", "schema.sql");
const CLOUD_HASH = "6d57b7cdba91fde52f33f6430f853fd9414b267b3330a65f7c7c0a3d725f650d";
const CLOUD_DB = "vaultflows";

const bufAvailable = await hasBuf();
const substreamsAvailable = await hasSubstreams();
const realSpkgPresent = await pathExists(REAL_SPKG);

async function capture(fn: () => Promise<number>): Promise<{ code: number; stdout: string }> {
  const write = process.stdout.write.bind(process.stdout);
  let stdout = "";
  process.stdout.write = ((chunk: string | Uint8Array) => { stdout += String(chunk); return true; }) as typeof process.stdout.write;
  try {
    return { code: await fn(), stdout };
  } finally {
    process.stdout.write = write;
  }
}

/** A one-file descriptor set carrying the given messages, shaped like buf's protojson output. */
function fdsWith(messages: unknown[]): FdsJson {
  return { file: [{ name: "t.proto", package: "t.v1", messageType: messages }] };
}
const table = (name: string, fields: unknown[], order: string[] = ["id"]) => ({
  name: "T",
  options: { "[schema.table]": { name, clickhouseTableOptions: { orderByFields: order.map((n) => ({ name: n })), partitionFields: [{ name: "_block_timestamp_", function: "toYYYYMM" }] } } },
  field: fields,
});
const pkField = { name: "id", type: "TYPE_STRING", label: "LABEL_OPTIONAL", options: { "[schema.field]": { primaryKey: true } } };

describe("schema-render", () => {
  it("renders the cloud deployment's DDL byte-for-byte from the contract descriptors", async () => {
    const expected = await readFile(CLOUD_DUMP, "utf8");
    const r = renderSchemaSql(await fdsFixture(), "vaultflows.v1", { database: CLOUD_DB });
    expect(r.sql).toBe(normalizeSql(expected));
    expect(r.hash).toBe(CLOUD_HASH);
    expect(r.tables).toEqual(["vault_flows", "share_value_observations", "vaults", "share_transfers"]);
    expect(r.flavor).toBe("clickhouse-cloud");
  });

  /**
   * The equivalence the Deployment Receipt depends on: `sinkSchemaHash` computed offline from the shipped .spkg is
   * the same number `streamsmith schema-dump` read out of ClickHouse Cloud after the real deploy (A9's run
   * 20260910T234439Z-1fr9). No normalization is applied to one side and not the other — both are normalizeSql().
   */
  it.skipIf(!bufAvailable || !realSpkgPresent)("the real spkg renders the same sinkSchemaHash as the live cloud dump", async () => {
    const ctx = await createCtx({ root: REPO_ROOT, log: () => {} });
    const r = await renderSchemaFromSpkg(ctx, REAL_SPKG, "vaultflows.v1", { database: CLOUD_DB });
    expect(r.hash, "rendered DDL differs from runs/20260910T234439Z-1fr9/schema.sql").toBe(CLOUD_HASH);
    expect(r.sql).toBe(normalizeSql(await readFile(CLOUD_DUMP, "utf8")));
  }, 60000);

  it("is a pure function of descriptor, database and engine flavor", async () => {
    const fds = await fdsFixture();
    const cloud = renderSchemaSql(fds, "vaultflows.v1", { database: CLOUD_DB });
    // the database prefixes every table name, so it is part of the identity
    expect(renderSchemaSql(fds, "vaultflows.v1", { database: "default" }).hash).not.toBe(cloud.hash);
    // a self-hosted server keeps the plain engine; nothing else about the DDL changes
    const oss = renderSchemaSql(fds, "vaultflows.v1", { database: CLOUD_DB, flavor: "clickhouse-oss" });
    expect(oss.sql).toContain("ENGINE = ReplacingMergeTree(_version_, _deleted_)");
    expect(oss.sql).not.toContain("SharedReplacingMergeTree");
    expect(oss.hash).not.toBe(cloud.hash);
    expect(oss.sql.replace(/^ENGINE = .*$/gm, "ENGINE")).toBe(cloud.sql.replace(/^ENGINE = .*$/gm, "ENGINE"));
    expect(renderSchemaSql(fds, "vaultflows.v1", { database: CLOUD_DB, flavor: "clickhouse-cloud" }).hash).toBe(cloud.hash);
    expect(() => renderSchemaSql(fds, "vaultflows.v1", { database: "bad name" })).toThrow(/unsafe database name/);
  });

  it("maps the sink's column rules: injected columns, wide numerics, dropped message fields", () => {
    expect(convertToType({ uint256: {} })).toBe("UInt256");
    expect(convertToType({ decimal128: { scale: 18 } })).toBe("Decimal(38, 18)");
    expect(convertToType({ decimal256: { scale: 6 } })).toBe("Decimal(76, 6)");
    expect(() => convertToType({ float128: {} })).toThrow(/unsupported .*convertTo/);
    const r = renderSchemaSql(
      fdsWith([
        table("t", [
          pkField,
          { name: "n", type: "TYPE_UINT64", label: "LABEL_OPTIONAL" },
          { name: "at", type: "TYPE_MESSAGE", typeName: ".google.protobuf.Timestamp", label: "LABEL_OPTIONAL" },
          { name: "dropped", type: "TYPE_MESSAGE", typeName: ".t.v1.Other", label: "LABEL_OPTIONAL" },
        ]),
      ]),
      "t.v1",
      { database: "db" },
    );
    expect(r.sql).toContain("    `_block_number_` UInt64,\n    `_block_timestamp_` DateTime,\n    `_version_` Int64,\n    `_deleted_` Bool,\n    `id` String,\n    `n` UInt64,\n    `at` DateTime\n)");
    expect(r.sql).not.toContain("dropped");
    expect(r.sql).toContain("PRIMARY KEY id\nORDER BY id");
  });

  it("refuses a proto the from-proto sink would reject", () => {
    const render = (messages: unknown[]) => renderSchemaSql(fdsWith(messages), "t.v1", { database: "db" });
    expect(() => render([table("t", [{ name: "x", type: "TYPE_STRING", label: "LABEL_OPTIONAL" }])])).toThrow(/exactly one primary_key field, found 0/);
    expect(() => render([table("t", [pkField, { ...pkField, name: "id2" }])])).toThrow(/found 2 \(id, id2\)/);
    expect(() => render([table("t", [pkField, { name: "vault", type: "TYPE_STRING", label: "LABEL_OPTIONAL" }], ["vault", "id"])])).toThrow(/order_by_fields\[0\] must be the primary key \(id\), got vault/);
    expect(() => render([table("t", [pkField], [])])).toThrow(/order_by_fields is required/);
    expect(() => render([table("t", [pkField, { name: "e", type: "TYPE_ENUM", label: "LABEL_OPTIONAL" }])])).toThrow(/enum fields are not supported/);
    expect(() => render([table("t", [pkField, { name: "b", type: "TYPE_BYTES", label: "LABEL_OPTIONAL" }])])).toThrow(/bytes fields have no verified/);
    expect(() => render([table("t", [pkField, { name: "r", type: "TYPE_STRING", label: "LABEL_REPEATED" }])])).toThrow(/repeated fields are not supported/);
    expect(() => render([{ name: "NoTables", field: [] }])).toThrow(/no message in package t\.v1 carries option \(schema\.table\)/);
  });

  it("orders tables by the sink module's output message, not by declaration order", () => {
    const t = (n: string) => ({ ...table(n, [pkField]), name: n.toUpperCase() });
    const root = { name: "Events", field: [{ name: "b", type: "TYPE_MESSAGE", label: "LABEL_REPEATED", typeName: ".t.v1.B" }, { name: "a", type: "TYPE_MESSAGE", label: "LABEL_REPEATED", typeName: ".t.v1.A" }] };
    expect(renderSchemaSql(fdsWith([t("a"), t("b"), root]), "t.v1", { database: "db" }).tables).toEqual(["b", "a"]);
    // no single such root message -> declaration order
    expect(renderSchemaSql(fdsWith([t("a"), t("b")]), "t.v1", { database: "db" }).tables).toEqual(["a", "b"]);
  });

  it.skipIf(!bufAvailable)("`schema-render --spkg` writes the DDL and prints the hash with no database in reach", async () => {
    const repo = await makeTempRepo();
    try {
      await repo.runner.run("substreams", ["build"], { cwd: repo.pkgDir }); // the fake build packs the stub spkg
      const r = await capture(() => main(["schema-render", "--spkg", repo.spkgPath, "--root", repo.root, "--run-id", "s1", "--database", CLOUD_DB, "--json"]));
      expect(r.code).toBe(0);
      const j = JSON.parse(r.stdout) as { file: string; sinkSchemaHash: string; tables: string[]; database: string; flavor: SchemaFlavor };
      expect(j.sinkSchemaHash).toBe(CLOUD_HASH);
      expect(j.database).toBe(CLOUD_DB);
      expect(j.flavor).toBe("clickhouse-cloud");
      expect(j.file).toBe(join(repo.root, "runs", "s1", "schema.rendered.sql"));
      expect(await readFile(j.file, "utf8")).toBe(normalizeSql(await readFile(CLOUD_DUMP, "utf8")));

      const oss = await capture(() => main(["schema-render", "--spkg", repo.spkgPath, "--root", repo.root, "--run-id", "s1", "--database", CLOUD_DB, "--engine", "oss", "--out", "runs/s1/oss.sql", "--json"]));
      expect((JSON.parse(oss.stdout) as { sinkSchemaHash: string }).sinkSchemaHash).not.toBe(CLOUD_HASH);
      await expect(main(["schema-render", "--spkg", repo.spkgPath, "--root", repo.root, "--run-id", "s1", "--engine", "sqlite"])).rejects.toThrow(/unknown --engine "sqlite" \(cloud \| oss\)/);
      await expect(main(["schema-render", "--root", repo.root, "--run-id", "s1"])).rejects.toThrow(/--spkg is required/);
    } finally {
      await repo.cleanup();
    }
  }, 120000);

  it.skipIf(!bufAvailable || !substreamsAvailable)("`receipt --schema-from-spkg` writes a complete receipt with no database at all", async () => {
    const repo = await makeTempRepo();
    try {
      expect((await runGate(repo.ctx, { runId: "s2", offline: true })).exitCode).toBe(0);
      const r = await capture(() => main(["receipt", "--spkg", repo.spkgPath, "--root", repo.root, "--run-id", "s2", "--schema-from-spkg", "--database", CLOUD_DB, "--json"]));
      expect(r.code).toBe(0);
      const j = JSON.parse(r.stdout) as { receipt: { sinkSchemaHash: string }; errors: unknown[] };
      expect(j.errors).toEqual([]);
      expect(j.receipt.sinkSchemaHash).toBe(CLOUD_HASH);
      // the rendered DDL is kept next to the run's evidence, so the receipt stays auditable
      expect(await readFile(join(repo.root, "runs", "s2", "schema.rendered.sql"), "utf8")).toContain("CREATE TABLE vaultflows.vault_flows");
      await expect(main(["receipt", "--spkg", repo.spkgPath, "--root", repo.root, "--run-id", "s2", "--schema-from-spkg", "--schema-hash", "a".repeat(64)])).rejects.toThrow(/cannot be combined with --schema-sql \/ --schema-hash/);
      // and the old error message now points at both sources
      await expect(main(["receipt", "--spkg", repo.spkgPath, "--root", repo.root, "--run-id", "s2"])).rejects.toThrow(/schema-render --spkg <file>.*offline/s);
    } finally {
      await repo.cleanup();
    }
  }, 180000);
});

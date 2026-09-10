import { describe, it, expect } from "vitest";
import { canonicalJson, sha256Canonical, sha256Hex } from "../src/util/hash.ts";
import { parametersHash } from "../src/config/streamsmith.ts";
import { normalizeFileDescriptorSet, descriptorFileNames } from "../src/proto/descriptor.ts";
import { encodeFields, decodeFields } from "../src/proto/wire.ts";

describe("canonical JSON", () => {
  it("is independent of key order and undefined members", () => {
    expect(canonicalJson({ b: 1, a: [{ y: 2, x: 1 }], c: undefined })).toBe('{"a":[{"x":1,"y":2}],"b":1}');
    expect(sha256Canonical({ a: 1, b: 2 })).toBe(sha256Canonical({ b: 2, a: 1 }));
  });
});

describe("parametersHash", () => {
  it("normalizes vault order, case and duplicates", () => {
    const a = parametersHash({ vaults: ["0xBEEF0E0834849ACC03F0089F01F4F1EEB06873C9", "0x050ce30b927da55177a4914ec73480238bad56f0"], sampleIntervalBlocks: 1800, chainId: 8453 });
    const b = parametersHash({ vaults: ["0x050ce30b927da55177a4914ec73480238bad56f0", "0xbeef0e0834849acc03f0089f01f4f1eeb06873c9", "0xbeef0e0834849acc03f0089f01f4f1eeb06873c9"], sampleIntervalBlocks: 1800, chainId: 8453 });
    expect(a).toBe(b);
    expect(a).toBe(sha256Hex('{"chainId":8453,"sampleIntervalBlocks":1800,"vaults":["0x050ce30b927da55177a4914ec73480238bad56f0","0xbeef0e0834849acc03f0089f01f4f1eeb06873c9"]}'));
    expect(parametersHash({ vaults: ["0x050ce30b927da55177a4914ec73480238bad56f0"], sampleIntervalBlocks: 1801, chainId: 8453 })).not.toBe(a);
  });
});

describe("wire codec + FileDescriptorSet normalization", () => {
  const file = (name: string, withSourceInfo: boolean) => {
    const fields = [
      { number: 1, wireType: 2 as const, bytes: new TextEncoder().encode(name) },
      { number: 2, wireType: 2 as const, bytes: new TextEncoder().encode("pkg.v1") },
    ];
    if (withSourceInfo) fields.push({ number: 9, wireType: 2 as const, bytes: new Uint8Array([0x0a, 0x02, 0x08, 0x01]) });
    return encodeFields(fields);
  };
  const fds = (files: Uint8Array[]) => encodeFields(files.map((f) => ({ number: 1, wireType: 2 as const, bytes: f })));

  it("round-trips fields", () => {
    const enc = encodeFields([{ number: 3, wireType: 0, varint: 300n }, { number: 1, wireType: 2, bytes: new Uint8Array([1, 2, 3]) }]);
    const dec = decodeFields(enc);
    expect(dec.map((f) => f.number)).toEqual([3, 1]);
    expect(dec[0]!.varint).toBe(300n);
    expect([...dec[1]!.bytes!]).toEqual([1, 2, 3]);
  });

  it("strips source_code_info and sorts files by name", () => {
    const a = normalizeFileDescriptorSet(fds([file("b.proto", true), file("a.proto", false)]));
    const b = normalizeFileDescriptorSet(fds([file("a.proto", true), file("b.proto", true)]));
    expect(sha256Hex(a)).toBe(sha256Hex(b));
    expect(descriptorFileNames(a)).toEqual(["a.proto", "b.proto"]);
    expect(sha256Hex(a)).not.toBe(sha256Hex(normalizeFileDescriptorSet(fds([file("a.proto", false)]))));
  });
});

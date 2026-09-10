import { describe, it, expect } from "vitest";
import { canonicalJson, sha256Canonical, sha256Hex } from "../src/util/hash.ts";
import { parametersHash } from "../src/config/streamsmith.ts";

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

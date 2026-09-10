// Minimal protobuf wire-format codec: just enough to walk a FileDescriptorSet at the top level
// (repeated FileDescriptorProto file = 1), strip source_code_info (= 9) and sort files by name (= 1).
// No dependency on a protobuf library; everything else about descriptor semantics is delegated to `buf`.

export type WireType = 0 | 1 | 2 | 5;

export interface WireField {
  number: number;
  wireType: WireType;
  /** varint value (wireType 0) */
  varint?: bigint;
  /** raw bytes for fixed32/fixed64/length-delimited */
  bytes?: Uint8Array;
}

function readVarint(buf: Uint8Array, pos: number): { value: bigint; next: number } {
  let result = 0n;
  let shift = 0n;
  let i = pos;
  for (;;) {
    if (i >= buf.length) throw new Error("wire: truncated varint");
    const b = buf[i]!;
    result |= BigInt(b & 0x7f) << shift;
    i++;
    if ((b & 0x80) === 0) break;
    shift += 7n;
    if (shift > 70n) throw new Error("wire: varint too long");
  }
  return { value: result, next: i };
}

export function encodeVarint(value: bigint | number): Uint8Array {
  let v = BigInt(value);
  if (v < 0n) v = BigInt.asUintN(64, v);
  const out: number[] = [];
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v !== 0n) b |= 0x80;
    out.push(b);
  } while (v !== 0n);
  return Uint8Array.from(out);
}

export function decodeFields(buf: Uint8Array): WireField[] {
  const fields: WireField[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const tag = readVarint(buf, pos);
    pos = tag.next;
    const number = Number(tag.value >> 3n);
    const wireType = Number(tag.value & 7n) as number;
    if (number === 0) throw new Error("wire: field number 0");
    switch (wireType) {
      case 0: {
        const v = readVarint(buf, pos);
        pos = v.next;
        fields.push({ number, wireType: 0, varint: v.value });
        break;
      }
      case 1: {
        if (pos + 8 > buf.length) throw new Error("wire: truncated fixed64");
        fields.push({ number, wireType: 1, bytes: buf.subarray(pos, pos + 8) });
        pos += 8;
        break;
      }
      case 5: {
        if (pos + 4 > buf.length) throw new Error("wire: truncated fixed32");
        fields.push({ number, wireType: 5, bytes: buf.subarray(pos, pos + 4) });
        pos += 4;
        break;
      }
      case 2: {
        const len = readVarint(buf, pos);
        pos = len.next;
        const n = Number(len.value);
        if (pos + n > buf.length) throw new Error("wire: truncated length-delimited field");
        fields.push({ number, wireType: 2, bytes: buf.subarray(pos, pos + n) });
        pos += n;
        break;
      }
      default:
        throw new Error(`wire: unsupported wire type ${wireType} (groups are not supported)`);
    }
  }
  return fields;
}

export function encodeFields(fields: WireField[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const f of fields) {
    parts.push(encodeVarint((BigInt(f.number) << 3n) | BigInt(f.wireType)));
    if (f.wireType === 0) parts.push(encodeVarint(f.varint ?? 0n));
    else if (f.wireType === 2) {
      const b = f.bytes ?? new Uint8Array(0);
      parts.push(encodeVarint(b.length));
      parts.push(b);
    } else parts.push(f.bytes ?? new Uint8Array(0));
  }
  return concat(parts);
}

export function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export function utf8(bytes: Uint8Array | undefined): string {
  return bytes ? Buffer.from(bytes).toString("utf8") : "";
}

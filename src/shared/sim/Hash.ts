/**
 * Incremental FNV-1a hash over numeric state. Two sims that produce the same
 * digest every tick are bit-identical for all hashed fields.
 */
export class StateHasher {
  private hash = 0x811c9dc5;
  private readonly floatView = new Float64Array(1);
  private readonly byteView = new Uint8Array(this.floatView.buffer);

  /** Mixes the exact 64-bit float bits of a number. */
  addNumber(value: number): this {
    // Normalize -0 to +0 so equal values always hash equally.
    this.floatView[0] = value === 0 ? 0 : value;
    for (let i = 0; i < 8; i++) {
      this.hash ^= this.byteView[i] as number;
      this.hash = Math.imul(this.hash, 0x01000193);
    }
    return this;
  }

  /** Mixes a 32-bit integer. */
  addInt(value: number): this {
    let v = value | 0;
    for (let i = 0; i < 4; i++) {
      this.hash ^= v & 0xff;
      this.hash = Math.imul(this.hash, 0x01000193);
      v >>>= 8;
    }
    return this;
  }

  /** Final unsigned 32-bit digest. */
  digest(): number {
    return this.hash >>> 0;
  }
}

/** Formats a digest as 8 hex characters. */
export function hashToHex(hash: number): string {
  return (hash >>> 0).toString(16).padStart(8, "0");
}

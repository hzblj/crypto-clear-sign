// Keccak-256 (the pre-standard padding Ethereum uses), for function selectors only. The chain client hashes everything
// it signs, but exposes no bare Keccak-256, and a selector is keccak256(signature)[0..4]: an ERC-7730 descriptor names
// functions by signature, so their selectors are computed here. Nothing signed or verified depends on this file; the
// tests hold it equal to viem's keccak256 over every length around the rate. 64-bit lanes are two 32-bit halves.

/** Rate in bytes for a 256-bit output: 1600 / 8 - 2 × 32. */
const RATE = 136

/** The round constants, as [high, low] 32-bit halves. */
const ROUND_CONSTANTS: readonly (readonly [number, number])[] = [
  [0x00000000, 0x00000001],
  [0x00000000, 0x00008082],
  [0x80000000, 0x0000808a],
  [0x80000000, 0x80008000],
  [0x00000000, 0x0000808b],
  [0x00000000, 0x80000001],
  [0x80000000, 0x80008081],
  [0x80000000, 0x00008009],
  [0x00000000, 0x0000008a],
  [0x00000000, 0x00000088],
  [0x00000000, 0x80008009],
  [0x00000000, 0x8000000a],
  [0x00000000, 0x8000808b],
  [0x80000000, 0x0000008b],
  [0x80000000, 0x00008089],
  [0x80000000, 0x00008003],
  [0x80000000, 0x00008002],
  [0x80000000, 0x00000080],
  [0x00000000, 0x0000800a],
  [0x80000000, 0x8000000a],
  [0x80000000, 0x80008081],
  [0x80000000, 0x00008080],
  [0x00000000, 0x80000001],
  [0x80000000, 0x80008008],
]

/** ρ offsets by lane index x + 5y. */
const ROTATIONS = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14]

const permute = (hi: Uint32Array, lo: Uint32Array) => {
  const cHi = new Uint32Array(5)
  const cLo = new Uint32Array(5)
  const bHi = new Uint32Array(25)
  const bLo = new Uint32Array(25)

  for (const [rcHi, rcLo] of ROUND_CONSTANTS) {
    // θ
    for (let x = 0; x < 5; x++) {
      cHi[x] = (hi[x] ?? 0) ^ (hi[x + 5] ?? 0) ^ (hi[x + 10] ?? 0) ^ (hi[x + 15] ?? 0) ^ (hi[x + 20] ?? 0)
      cLo[x] = (lo[x] ?? 0) ^ (lo[x + 5] ?? 0) ^ (lo[x + 10] ?? 0) ^ (lo[x + 15] ?? 0) ^ (lo[x + 20] ?? 0)
    }

    for (let x = 0; x < 5; x++) {
      const nextHi = cHi[(x + 1) % 5] ?? 0
      const nextLo = cLo[(x + 1) % 5] ?? 0
      const dHi = (cHi[(x + 4) % 5] ?? 0) ^ ((nextHi << 1) | (nextLo >>> 31))
      const dLo = (cLo[(x + 4) % 5] ?? 0) ^ ((nextLo << 1) | (nextHi >>> 31))

      for (let y = 0; y < 25; y += 5) {
        hi[x + y] = (hi[x + y] ?? 0) ^ dHi
        lo[x + y] = (lo[x + y] ?? 0) ^ dLo
      }
    }

    // ρ and π: B[y, 2x + 3y] = rotate(A[x, y])
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        const from = x + 5 * y
        const to = y + 5 * ((2 * x + 3 * y) % 5)
        const shift = ROTATIONS[from] ?? 0
        const h = hi[from] ?? 0
        const l = lo[from] ?? 0

        if (shift === 0) {
          bHi[to] = h
          bLo[to] = l
        } else if (shift < 32) {
          bHi[to] = (h << shift) | (l >>> (32 - shift))
          bLo[to] = (l << shift) | (h >>> (32 - shift))
        } else if (shift === 32) {
          bHi[to] = l
          bLo[to] = h
        } else {
          const rest = shift - 32
          bHi[to] = (l << rest) | (h >>> (32 - rest))
          bLo[to] = (h << rest) | (l >>> (32 - rest))
        }
      }
    }

    // χ
    for (let y = 0; y < 25; y += 5) {
      for (let x = 0; x < 5; x++) {
        const one = y + ((x + 1) % 5)
        const two = y + ((x + 2) % 5)
        hi[y + x] = (bHi[y + x] ?? 0) ^ (~(bHi[one] ?? 0) & (bHi[two] ?? 0))
        lo[y + x] = (bLo[y + x] ?? 0) ^ (~(bLo[one] ?? 0) & (bLo[two] ?? 0))
      }
    }

    // ι
    hi[0] = (hi[0] ?? 0) ^ rcHi
    lo[0] = (lo[0] ?? 0) ^ rcLo
  }
}

const absorb = (hi: Uint32Array, lo: Uint32Array, block: Uint8Array) => {
  for (let lane = 0; lane < RATE / 8; lane++) {
    const at = lane * 8
    lo[lane] =
      (lo[lane] ?? 0) ^
      ((block[at] ?? 0) | ((block[at + 1] ?? 0) << 8) | ((block[at + 2] ?? 0) << 16) | ((block[at + 3] ?? 0) << 24))
    hi[lane] =
      (hi[lane] ?? 0) ^
      ((block[at + 4] ?? 0) | ((block[at + 5] ?? 0) << 8) | ((block[at + 6] ?? 0) << 16) | ((block[at + 7] ?? 0) << 24))
  }

  permute(hi, lo)
}

/** Keccak-256 of `data`, as Ethereum computes it (not SHA3-256: the original 0x01 padding). Internal. */
export const keccak256 = (data: Uint8Array): Uint8Array => {
  const hi = new Uint32Array(25)
  const lo = new Uint32Array(25)
  let offset = 0

  for (; offset + RATE <= data.length; offset += RATE) {
    absorb(hi, lo, data.subarray(offset, offset + RATE))
  }

  const last = new Uint8Array(RATE)
  last.set(data.subarray(offset))
  last[data.length - offset] = (last[data.length - offset] ?? 0) ^ 0x01
  last[RATE - 1] = (last[RATE - 1] ?? 0) ^ 0x80
  absorb(hi, lo, last)

  const out = new Uint8Array(32)

  for (let lane = 0; lane < 4; lane++) {
    const l = lo[lane] ?? 0
    const h = hi[lane] ?? 0

    for (let byte = 0; byte < 4; byte++) {
      out[lane * 8 + byte] = (l >>> (8 * byte)) & 0xff
      out[lane * 8 + 4 + byte] = (h >>> (8 * byte)) & 0xff
    }
  }

  return out
}

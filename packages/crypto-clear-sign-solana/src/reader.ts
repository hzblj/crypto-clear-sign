import {base58, bytes, utf8} from '@hzblj/nitro-crypto/adapter'

/**
 * Data that does not read as its layout says: an instruction cut short, a tag no layout has, bytes left over, text
 * that is not UTF-8. Internal: a decoder that meets it gives up, and the instruction is shown raw with a warning.
 */
export class MalformedData extends Error {
  constructor() {
    super('The data does not read as its layout says.')
    this.name = 'MalformedData'
  }
}

/** Throws `MalformedData`: for expressions (`value ?? malformed()`). */
export const malformed = (): never => {
  throw new MalformedData()
}

/** A strict little-endian reader over instruction data: every read is bounds-checked, nothing is guessed. */
export type Reader = {
  readonly offset: () => number
  readonly remaining: () => number
  readonly u8: () => number
  readonly u16: () => number
  readonly u32: () => number
  readonly u64: () => bigint
  readonly i8: () => number
  readonly i16: () => number
  readonly i32: () => number
  readonly i64: () => bigint
  /** An unsigned or signed integer of 16 or 32 bytes (`u128`, `i128`, `u256`, `i256`). */
  readonly wide: (size: 16 | 32, signed: boolean) => bigint
  readonly f32: () => number
  readonly f64: () => number
  readonly bytes: (length: number) => Uint8Array
  /** 32 bytes, as a Base58 address. */
  readonly pubkey: () => string
  /** Text of `length` bytes, refused unless it is UTF-8 that decodes back to itself. */
  readonly text: (length: number) => string
  /** Everything left. */
  readonly rest: () => Uint8Array
  /** Throws unless every byte was read. */
  readonly end: () => void
}

/** Text from bytes, or `undefined` when they are not UTF-8 that decodes back to themselves. */
export const decodeText = (data: Uint8Array): string | undefined => {
  const decoded = utf8.decode(data)

  return bytes.equal(utf8.encode(decoded), data) ? decoded : undefined
}

export const createReader = (data: Uint8Array): Reader => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let offset = 0

  const advance = (length: number) => {
    if (!Number.isSafeInteger(length) || length < 0 || length > data.length - offset) {
      malformed()
    }

    const start = offset
    offset += length

    return start
  }

  const take = (length: number) => {
    const start = advance(length)

    return data.subarray(start, start + length)
  }

  const wide = (size: 16 | 32, signed: boolean) => {
    const start = advance(size)
    let value = 0n

    for (let index = size / 8 - 1; index >= 0; index--) {
      value = (value << 64n) | view.getBigUint64(start + index * 8, true)
    }

    return signed ? BigInt.asIntN(size * 8, value) : value
  }

  return Object.freeze({
    bytes: (length: number) => take(length).slice(),
    end: () => {
      if (offset !== data.length) {
        malformed()
      }
    },
    f32: () => view.getFloat32(advance(4), true),
    f64: () => view.getFloat64(advance(8), true),
    i8: () => view.getInt8(advance(1)),
    i16: () => view.getInt16(advance(2), true),
    i32: () => view.getInt32(advance(4), true),
    i64: () => view.getBigInt64(advance(8), true),
    offset: () => offset,
    pubkey: () => base58.encode(take(32)),
    remaining: () => data.length - offset,
    rest: () => take(data.length - offset).slice(),
    text: (length: number) => decodeText(take(length)) ?? malformed(),
    u8: () => view.getUint8(advance(1)),
    u16: () => view.getUint16(advance(2), true),
    u32: () => view.getUint32(advance(4), true),
    u64: () => view.getBigUint64(advance(8), true),
    wide,
  })
}

/** A length read as a `u64` (bincode's strings and vectors), refused past what is left to read. */
export const lengthU64 = (reader: Reader, size = 1): number => {
  const length = reader.u64()

  if (length > BigInt(reader.remaining())) {
    malformed()
  }

  const count = Number(length)

  return count * size > reader.remaining() ? malformed() : count
}

/** A `COption<Pubkey>` as SPL Token packs it in instruction data: a one-byte tag, then the key when it is 1. */
export const optionalPubkey = (reader: Reader): string | undefined => {
  const tag = reader.u8()

  return tag === 0 ? undefined : tag === 1 ? reader.pubkey() : malformed()
}

const ZERO_KEY = '11111111111111111111111111111111'

/** Token-2022's `OptionalNonZeroPubkey`: 32 bytes, all zeros meaning none. */
export const nonZeroPubkey = (reader: Reader): string | undefined => {
  const key = reader.pubkey()

  return key === ZERO_KEY ? undefined : key
}

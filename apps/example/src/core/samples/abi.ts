import type {Hex} from '@hzblj/crypto-ethereum'
import {hex, utf8} from '@hzblj/nitro-crypto/adapter'

/**
 * Just enough of the Solidity ABI to write the call data a dApp would send: static words, `bytes` and `bytes[]`.
 * The samples write their own call data so that what they show is what a wallet receives, never a description of it.
 */

export type Keccak256 = (data: Uint8Array) => Uint8Array

/** A 32-byte word: an unsigned integer, an address, a bool, left-padded. */
export type Word = {readonly kind: 'word'; readonly value: bigint}

/** A dynamic value: `bytes`, or `bytes[]`. */
export type Dynamic =
  | {readonly kind: 'bytes'; readonly value: Uint8Array}
  | {readonly kind: 'bytes[]'; readonly value: readonly Uint8Array[]}

export type AbiValue = Word | Dynamic

const WORD = 32

export const uint = (value: bigint | number): Word => ({kind: 'word', value: BigInt(value)})
export const address = (value: string): Word => ({kind: 'word', value: BigInt(value)})
export const bool = (value: boolean): Word => ({kind: 'word', value: value ? 1n : 0n})
export const bytes = (value: Uint8Array | Hex): Dynamic => ({
  kind: 'bytes',
  value: typeof value === 'string' ? hex.decode(value) : value,
})
export const bytesArray = (value: readonly (Uint8Array | Hex)[]): Dynamic => ({
  kind: 'bytes[]',
  value: value.map(item => (typeof item === 'string' ? hex.decode(item) : item)),
})

const word = (value: bigint) => {
  if (value < 0n || value >> 256n !== 0n) {
    throw new RangeError('An ABI word is an unsigned 256-bit integer.')
  }

  return hex.decode(value.toString(16).padStart(WORD * 2, '0'))
}

const padded = (data: Uint8Array) => {
  const out = new Uint8Array(Math.ceil(data.length / WORD) * WORD)
  out.set(data)

  return out
}

const concat = (parts: readonly Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
  let offset = 0

  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }

  return out
}

/** The tail of a dynamic value: its length and its padded bytes, or the head and tails of an array of `bytes`. */
const tail = (value: Dynamic): Uint8Array =>
  value.kind === 'bytes'
    ? concat([word(BigInt(value.value.length)), padded(value.value)])
    : concat([word(BigInt(value.value.length)), encodeParameters(value.value.map(item => bytes(item)))])

/** The ABI encoding of a tuple of values: static words in place, dynamic ones by offset after the head. */
export const encodeParameters = (values: readonly AbiValue[]): Uint8Array => {
  const head: Uint8Array[] = []
  const tails: Uint8Array[] = []
  let offset = values.length * WORD

  for (const value of values) {
    if (value.kind === 'word') {
      head.push(word(value.value))
    } else {
      const encoded = tail(value)
      head.push(word(BigInt(offset)))
      tails.push(encoded)
      offset += encoded.length
    }
  }

  return concat([...head, ...tails])
}

/** The first four bytes of the Keccak-256 of a function's signature: `approve(address,uint256)`. */
export const selector = (keccak256: Keccak256, signature: string) => keccak256(utf8.encode(signature)).subarray(0, 4)

/** Call data: the selector of `signature`, then its arguments. */
export const encodeCall = (keccak256: Keccak256, signature: string, values: readonly AbiValue[]): Hex =>
  hex.encode(concat([selector(keccak256, signature), encodeParameters(values)]), {prefix: true}) as Hex

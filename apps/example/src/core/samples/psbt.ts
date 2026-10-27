import type {BitcoinAccountType} from '@hzblj/crypto-bitcoin'
import {hex} from '@hzblj/nitro-crypto/adapter'

/**
 * A minimal BIP-174 (version 0) writer, for the PSBTs the adapter's `createPsbt` does not make: several coins, other
 * signature hash types, `OP_RETURN` outputs, change at its own path. It writes what a coordinator such as Sparrow
 * writes: each coin with its previous output (and, for P2WPKH, its whole previous transaction), its key origin, and the
 * origin of the change. The adapter reads every PSBT back, strictly, before a review says anything about it.
 */

export type Sha256 = (data: Uint8Array) => Uint8Array

/** An account's public side, as the chain client derives it: what an input spends from or an output pays. */
export type PsbtKey = {
  readonly addressType: BitcoinAccountType
  readonly path: string
  readonly publicKey: Uint8Array
  readonly scriptPubKey: Uint8Array
  readonly fingerprint: number
}

export type PsbtInput = {
  readonly key: PsbtKey
  /** Satoshis the coin holds. */
  readonly value: bigint
  readonly sighashType?: number
  /** Makes each coin's previous transaction, and so its id, different. */
  readonly salt: number
}

export type PsbtOutput = {
  readonly value: bigint
  readonly script: Uint8Array
  /** The key it pays, when it is the signer's: change, or a transfer to itself. */
  readonly key?: PsbtKey
}

const u32 = (value: number) => {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, value >>> 0, true)

  return out
}

/** Little-endian, by hand: not every JavaScript engine a phone runs has `DataView.setBigUint64`. */
const u64 = (value: bigint) => Uint8Array.from({length: 8}, (_, index) => Number((value >> BigInt(index * 8)) & 0xffn))

const compactSize = (value: number) =>
  value < 0xfd ? Uint8Array.of(value) : Uint8Array.of(0xfd, value & 0xff, value >> 8)

const concat = (...parts: readonly Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
  let offset = 0

  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }

  return out
}

const withLength = (data: Uint8Array) => concat(compactSize(data.length), data)

/** One key-value pair of a PSBT map. */
const pair = (key: Uint8Array, value: Uint8Array) => concat(withLength(key), withLength(value))

const HARDENED = 0x80000000

/** A BIP-32 path as PSBTs store it: the master fingerprint's 4 bytes, then each index, little-endian. */
const origin = (fingerprint: number, path: string) => {
  const head = new Uint8Array(4)
  new DataView(head.buffer).setUint32(0, fingerprint >>> 0, false)
  const steps = path
    .split('/')
    .slice(1)
    .map(step => (step.endsWith("'") ? Number.parseInt(step, 10) + HARDENED : Number.parseInt(step, 10)))

  return concat(head, ...steps.map(u32))
}

const xOnly = (key: Uint8Array) => (key.length === 33 ? key.subarray(1) : key)

/**
 * The key origin of an input (`0x06`, or BIP-371's `0x16` and `0x17`) or an output (`0x02`, or `0x07` and `0x05`):
 * how a signer tells its own coins and change.
 */
const keyPairs = (key: PsbtKey, place: 'input' | 'output') => {
  const derivation = origin(key.fingerprint, key.path)

  if (key.addressType === 'p2tr') {
    const internal = xOnly(key.publicKey)
    const [tapDerivation, tapInternal] = place === 'input' ? [0x16, 0x17] : [0x07, 0x05]

    return [
      pair(concat(Uint8Array.of(tapDerivation), internal), concat(compactSize(0), derivation)),
      pair(Uint8Array.of(tapInternal), internal),
    ]
  }

  return [pair(concat(Uint8Array.of(place === 'input' ? 0x06 : 0x02), key.publicKey), derivation)]
}

/** A transaction that paid `value` to `script` at output 0: the coin an input spends. */
const previousTransaction = (script: Uint8Array, value: bigint, salt: number) =>
  concat(
    u32(2),
    compactSize(1),
    new Uint8Array(32).fill(salt),
    u32(0),
    compactSize(0),
    u32(0xffffffff),
    compactSize(1),
    u64(value),
    withLength(script),
    u32(0)
  )

/** Serializes the unsigned transaction: version 2, replaceable inputs, no witnesses. */
const unsignedTransaction = (
  inputs: readonly {readonly txid: Uint8Array; readonly vout: number}[],
  outputs: readonly PsbtOutput[],
  lockTime: number
) =>
  concat(
    u32(2),
    compactSize(inputs.length),
    ...inputs.map(input => concat(input.txid, u32(input.vout), compactSize(0), u32(0xfffffffd))),
    compactSize(outputs.length),
    ...outputs.map(output => concat(u64(output.value), withLength(output.script))),
    u32(lockTime)
  )

/** The PSBT of these coins and outputs, and the ids of the coins it spends (display order) for an indexer's lookup. */
export const writePsbt = (
  sha256: Sha256,
  inputs: readonly PsbtInput[],
  outputs: readonly PsbtOutput[],
  {lockTime = 0}: {readonly lockTime?: number} = {}
): {readonly psbt: Uint8Array; readonly txids: readonly string[]} => {
  const coins = inputs.map(input => {
    const previous = previousTransaction(input.key.scriptPubKey, input.value, input.salt)
    // The id in internal byte order, as an outpoint stores it; explorers show it reversed.
    const txid = sha256(sha256(previous))

    return {input, previous, txid}
  })
  const separator = Uint8Array.of(0)
  const global = concat(
    pair(
      Uint8Array.of(0x00),
      unsignedTransaction(
        coins.map(coin => ({txid: coin.txid, vout: 0})),
        outputs,
        lockTime
      )
    ),
    separator
  )
  const inputMaps = coins.map(({input, previous}) =>
    concat(
      ...(input.key.addressType === 'p2wpkh' ? [pair(Uint8Array.of(0x00), previous)] : []),
      pair(Uint8Array.of(0x01), concat(u64(input.value), withLength(input.key.scriptPubKey))),
      ...(input.sighashType === undefined ? [] : [pair(Uint8Array.of(0x03), u32(input.sighashType))]),
      ...keyPairs(input.key, 'input'),
      separator
    )
  )
  const outputMaps = outputs.map(output =>
    concat(...(output.key === undefined ? [] : keyPairs(output.key, 'output')), separator)
  )

  return {
    psbt: concat(Uint8Array.of(0x70, 0x73, 0x62, 0x74, 0xff), global, ...inputMaps, ...outputMaps),
    txids: coins.map(coin => hex.encode(Uint8Array.from(coin.txid).reverse())),
  }
}

/** LEB128, as runestones write their integers. */
const leb128 = (value: bigint): number[] => {
  const out: number[] = []
  let rest = value

  while (rest >> 7n > 0n) {
    out.push(Number(rest & 0x7fn) | 0x80)
    rest >>= 7n
  }

  out.push(Number(rest))

  return out
}

/** `OP_RETURN OP_13` and the integers in one push: a runestone, as ord enciphers it. */
export const runestone = (integers: readonly bigint[]): Uint8Array => {
  const payload = integers.flatMap(leb128)

  return Uint8Array.from([0x6a, 0x5d, payload.length, ...payload])
}

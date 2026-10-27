// What a PSBT's fields mean for the person signing it, beyond what the adapter decodes: signature hash types, size and
// fee rate, lock times and sequences.

import type {BitcoinPsbt, BitcoinPsbtInput} from '@hzblj/crypto-bitcoin'
import type {WarningCode, WarningDefinition} from '@hzblj/crypto-clear-sign'

import {BITCOIN_WARNINGS} from './catalogs'
import type {BitcoinClearSignChain} from './options'

const SIGHASH_DEFAULT = 0x00
const SIGHASH_ALL = 0x01
const SIGHASH_NONE = 0x02
const SIGHASH_SINGLE = 0x03
const ANYONECANPAY = 0x80

const NAMES: Readonly<Record<number, string>> = {
  [SIGHASH_ALL]: 'ALL',
  [SIGHASH_DEFAULT]: 'DEFAULT',
  [SIGHASH_NONE]: 'NONE',
  [SIGHASH_SINGLE]: 'SINGLE',
  [SIGHASH_ALL | ANYONECANPAY]: 'ALL|ANYONECANPAY',
  [SIGHASH_NONE | ANYONECANPAY]: 'NONE|ANYONECANPAY',
  [SIGHASH_SINGLE | ANYONECANPAY]: 'SINGLE|ANYONECANPAY',
}

/** `OP_1 <32 bytes>`. */
export const isP2tr = (script: Uint8Array) => script.length === 34 && script[0] === 0x51 && script[1] === 32

/** Whether an input spends a Taproot coin: by its script, or by its Taproot fields when the PSBT gives no coin. */
export const isTaprootInput = (input: BitcoinPsbtInput) =>
  input.spent === undefined
    ? input.taprootInternalKey !== undefined ||
      input.taprootDerivations.length > 0 ||
      input.taprootKeySignature !== undefined
    : isP2tr(input.spent.scriptPubKey)

export type SighashReading = {
  /** `ALL`, `DEFAULT`, `SINGLE|ANYONECANPAY`, or the type in hex when it is none of them. */
  readonly name: string
  /** Whether the PSBT names a type at all: without one, ALL (DEFAULT for Taproot). */
  readonly explicit: boolean
  /** Whether the signature commits to every input and output, as ALL and DEFAULT do. */
  readonly commitsToAll: boolean
  /** Whether it commits to every input's value (no ANYONECANPAY): what makes a Taproot signature check them all. */
  readonly commitsToInputs: boolean
  /**
   * The outputs it fixes: every one (ALL, DEFAULT, ALL|ANYONECANPAY), the one at its input's index (SINGLE, with or
   * without ANYONECANPAY), or none (NONE, SINGLE past the outputs, and a type outside the standard ones, which is
   * taken to promise nothing).
   */
  readonly fixes: 'all' | 'same' | 'none'
  readonly warning?: {
    readonly definition: WarningDefinition<WarningCode>
    readonly params: Readonly<Record<string, number | string>>
  }
}

/**
 * What an input's signature hash type lets others do with its signature. Taproot's are BIP-341's seven (DEFAULT
 * among them); a SegWit v0 or legacy input's are the six standard ones (DEFAULT is not one). SIGHASH_SINGLE with no
 * output at the input's index signs no output at all under BIP-143 and legacy rules, and cannot be signed under
 * BIP-341.
 */
export const readSighash = (
  type: number | undefined,
  taproot: boolean,
  input: number,
  outputs: number
): SighashReading => {
  if (type === undefined || (type === SIGHASH_DEFAULT && taproot) || type === SIGHASH_ALL) {
    return {
      commitsToAll: true,
      commitsToInputs: true,
      explicit: type !== undefined,
      fixes: 'all',
      name: NAMES[type ?? (taproot ? SIGHASH_DEFAULT : SIGHASH_ALL)] ?? 'ALL',
    }
  }

  const name = NAMES[type] ?? `0x${type.toString(16).padStart(2, '0')}`
  const commitsToInputs = (type & ANYONECANPAY) === 0
  const base = {commitsToAll: false, commitsToInputs, explicit: true, fixes: 'none' as const, name}
  const unusual = {...base, warning: {definition: BITCOIN_WARNINGS.UNUSUAL_SIGHASH, params: {input, type: name}}}

  if (NAMES[type] === undefined || type === SIGHASH_DEFAULT) {
    return unusual
  }

  if ((type & 0x1f) === SIGHASH_SINGLE && input >= outputs) {
    return taproot ? unusual : {...base, warning: {definition: BITCOIN_WARNINGS.SIGHASH_NONE, params: {input}}}
  }

  switch (type) {
    case SIGHASH_NONE:
    case SIGHASH_NONE | ANYONECANPAY:
      return {...base, warning: {definition: BITCOIN_WARNINGS.SIGHASH_NONE, params: {input}}}
    case SIGHASH_SINGLE:
      return {
        ...base,
        fixes: 'same',
        warning: {definition: BITCOIN_WARNINGS.SIGHASH_SINGLE, params: {input, output: input}},
      }
    case SIGHASH_SINGLE | ANYONECANPAY:
      return {
        ...base,
        fixes: 'same',
        warning: {definition: BITCOIN_WARNINGS.SIGHASH_SINGLE_ANYONECANPAY, params: {input, output: input}},
      }
    default:
      return {...base, fixes: 'all', warning: {definition: BITCOIN_WARNINGS.SIGHASH_ANYONECANPAY, params: {input}}}
  }
}

const compactSizeLength = (value: number) => (value < 0xfd ? 1 : value <= 0xffff ? 3 : 5)

/**
 * An input's weight once signed, by the script of the coin it spends, as the adapter estimates its own (the longest
 * signatures): P2WPKH 272 weight units (68 vB), a Taproot key path 230 (57.5 vB, a byte more with a sighash type
 * other than DEFAULT), P2PKH 592 (148 vB), P2SH with one key named taken as P2SH-P2WPKH 364 (91 vB). `undefined` for
 * anything else (P2WSH, bare scripts), whose size depends on a script the PSBT does not show.
 */
const inputWeight = (input: BitcoinPsbtInput): {weight: number; witness: boolean} | undefined => {
  const script = input.spent?.scriptPubKey

  if (script === undefined) {
    return undefined
  }

  // Outpoint, script length, sequence: 41 bytes at four weight units each.
  const base = 41 * 4

  if (script.length === 22 && script[0] === 0x00 && script[1] === 20) {
    return {weight: base + 108, witness: true}
  }

  if (isP2tr(script)) {
    const sighash = input.sighashType !== undefined && input.sighashType !== SIGHASH_DEFAULT ? 1 : 0

    return {weight: base + 66 + sighash, witness: true}
  }

  if (script.length === 25 && script[0] === 0x76 && script[1] === 0xa9 && script[23] === 0x88 && script[24] === 0xac) {
    return {weight: base + 107 * 4, witness: false}
  }

  if (script.length === 23 && script[0] === 0xa9 && script[22] === 0x87 && input.derivations.length === 1) {
    return {weight: base + 23 * 4 + 108, witness: true}
  }

  return undefined
}

export type Size = {
  /** Virtual bytes. */
  readonly vsize: number
  /** From the signed transaction (every input signed), rather than estimated. */
  readonly exact: boolean
}

const isSigned = (input: BitcoinPsbtInput) =>
  input.finalized || input.partialSignatures.length > 0 || input.taprootKeySignature !== undefined

/**
 * The transaction's virtual size: exact when every input is signed and the adapter finalizes it (each signature
 * verified), else estimated from the inputs' scripts and the outputs' exact sizes, serialized as BIP-144 says (with
 * any witness, an empty one for each legacy input); `undefined` when an input's size cannot be estimated.
 */
export const transactionSize = (
  chain: Pick<BitcoinClearSignChain, 'finalizePsbt'>,
  bytes: Uint8Array,
  psbt: BitcoinPsbt
): Size | undefined => {
  if (psbt.inputs.every(isSigned)) {
    try {
      return {exact: true, vsize: chain.finalizePsbt(bytes).vsize}
    } catch {
      // Not every signature finalizes here (a script, a signature that fails): estimate instead.
    }
  }

  const inputs = psbt.inputs.map(inputWeight)

  if (inputs.some(input => input === undefined)) {
    return undefined
  }

  const witness = inputs.some(input => input?.witness)
  // With any witness, the marker and flag (2 weight units), and an empty witness (1) for every input without one.
  const legacy = inputs.filter(input => !input?.witness).length
  const overhead =
    (8 + compactSizeLength(psbt.inputs.length) + compactSizeLength(psbt.outputs.length)) * 4 +
    (witness ? 2 + legacy : 0)
  const outputs = psbt.outputs.reduce(
    (weight, output) => weight + (8 + compactSizeLength(output.scriptPubKey.length) + output.scriptPubKey.length) * 4,
    0
  )
  const weight = inputs.reduce((total, input) => total + (input?.weight ?? 0), overhead + outputs)

  return {exact: false, vsize: Math.ceil(weight / 4)}
}

/** Satoshis per virtual byte, to two decimals. */
export const feeRate = (fee: bigint, vsize: number) => Math.round((Number(fee) / vsize) * 100) / 100

const SEQUENCE_FINAL = 0xffffffff
const DISABLE_FLAG = 0x8000_0000
const TYPE_FLAG = 0x0040_0000
const VALUE_MASK = 0x0000_ffff

/** Lock times below this are block heights, from it on Unix times (`LOCKTIME_THRESHOLD`). */
export const LOCKTIME_THRESHOLD = 500_000_000

/** Whether the transaction may be replaced by fee (BIP-125): an input's sequence below `0xfffffffe`. */
export const signalsReplaceable = (psbt: BitcoinPsbt) => psbt.inputs.some(input => input.sequence < 0xfffffffe)

/** Whether the lock time binds: it is not 0, and an input's sequence is not final. */
export const lockTimeEnforced = (psbt: BitcoinPsbt) =>
  psbt.locktime !== 0 && psbt.inputs.some(input => input.sequence !== SEQUENCE_FINAL)

/**
 * An input's relative lock (BIP-68), in blocks or in seconds (multiples of 512): only for a transaction of version 2
 * or more, and a sequence without its disable flag. `undefined` when there is none (or it is 0).
 */
export const relativeLock = (
  sequence: number,
  version: number
): {readonly blocks: number} | {readonly seconds: number} | undefined => {
  if (version < 2 || (sequence & DISABLE_FLAG) !== 0) {
    return undefined
  }

  const value = sequence & VALUE_MASK

  if (value === 0) {
    return undefined
  }

  return (sequence & TYPE_FLAG) !== 0 ? {seconds: value * 512} : {blocks: value}
}

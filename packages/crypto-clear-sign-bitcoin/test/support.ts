import assert from 'node:assert/strict'

import {type BitcoinAccount, type BitcoinUtxo, bitcoinAdapter} from '@hzblj/crypto-bitcoin'
import {
  type ClearSigning,
  type ClearSigningAction,
  type Field,
  findField,
  isClearSignError,
  type Resolvers,
  type Warning,
} from '@hzblj/crypto-clear-sign'
import type {ExtendedPublicKey} from '@hzblj/nitro-crypto/adapter'
import {createTestCryptoEngine} from '@hzblj/nitro-crypto/testing'
import {bip32Path, Transaction} from '@scure/btc-signer'

import type {BitcoinWarningCode} from '../src'

export const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

/** The mnemonic's master fingerprint, which every PSBT here names. */
export const FINGERPRINT = 0x73c5da0a

export const crypto = createTestCryptoEngine({
  adapters: [
    bitcoinAdapter(),
    bitcoinAdapter({id: 'bitcoin-testnet', network: 'testnet'}),
    bitcoinAdapter({id: 'bitcoin-signet', network: 'signet'}),
    bitcoinAdapter({id: 'bitcoin-regtest', network: 'regtest'}),
  ],
})

export const chain = crypto.chains.bitcoin

export type Accounts = {
  /** m/84'/0'/0'/0/0 */
  readonly segwit: BitcoinAccount<'bitcoin'>
  /** m/84'/0'/0'/1/0 */
  readonly change: BitcoinAccount<'bitcoin'>
  /** m/84'/0'/0'/0/1 */
  readonly receive: BitcoinAccount<'bitcoin'>
  /** m/86'/0'/0'/0/0 */
  readonly taproot: BitcoinAccount<'bitcoin'>
  /** m/86'/0'/0'/1/0 */
  readonly taprootChange: BitcoinAccount<'bitcoin'>
  /** The stranger's: who pays, receives, or puts in coins of their own. */
  readonly other: BitcoinAccount<'bitcoin'>
  readonly otherTaproot: BitcoinAccount<'bitcoin'>
}

type XpubAccount = {readonly extendedKey: ExtendedPublicKey; readonly fingerprint: number; readonly path: string}

export type Fixtures = {
  readonly accounts: Accounts
  /** The wallet's BIP-84 and BIP-86 accounts by extended key: what a wallet passes to have change verified. */
  readonly xpubAccounts: readonly [XpubAccount, XpubAccount]
  /** The stranger's master fingerprint. */
  readonly strangerFingerprint: number
}

let fixtures: Promise<Fixtures> | undefined

/** The wallet of `MNEMONIC` and a stranger's, made once for every test file that asks. */
export const setup = (): Promise<Fixtures> => {
  fixtures ??= (async () => {
    const wallet = await crypto.createEphemeralWallet({mnemonic: MNEMONIC})
    const stranger = await crypto.createEphemeralWallet()

    return {
      accounts: {
        change: await wallet.deriveAccount({chain: 'bitcoin', change: 1}),
        other: await stranger.deriveAccount({chain: 'bitcoin'}),
        otherTaproot: await stranger.deriveAccount({addressType: 'p2tr', chain: 'bitcoin'}),
        receive: await wallet.deriveAccount({chain: 'bitcoin', index: 1}),
        segwit: await wallet.deriveAccount({chain: 'bitcoin'}),
        taproot: await wallet.deriveAccount({addressType: 'p2tr', chain: 'bitcoin'}),
        taprootChange: await wallet.deriveAccount({addressType: 'p2tr', chain: 'bitcoin', change: 1}),
      },
      strangerFingerprint: stranger.fingerprint,
      xpubAccounts: [
        {extendedKey: wallet.extendedPublicKey("m/84'/0'/0'"), fingerprint: FINGERPRINT, path: "m/84'/0'/0'"},
        {extendedKey: wallet.extendedPublicKey("m/86'/0'/0'"), fingerprint: FINGERPRINT, path: "m/86'/0'/0'"},
      ],
    }
  })()

  return fixtures
}

export const sha256 = crypto.hash.sha256

const u32 = (value: number) => {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, value >>> 0, true)

  return out
}

const u64 = (value: bigint) => {
  const out = new Uint8Array(8)
  new DataView(out.buffer).setBigUint64(0, value, true)

  return out
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
  let offset = 0

  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }

  return out
}

/**
 * A private key for btc-signer to sign with (31 zero bytes, then `n`): no wallet of the engine's, so the accounts that
 * own its coins are named by script.
 */
export const privateKey = (n: number) => Uint8Array.from({length: 32}, (_, index) => (index === 31 ? n : 0))

export const sum = (values: readonly bigint[]) => values.reduce((total, value) => total + value, 0n)

export const toHex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')

export const fromHex = (text: string) => Uint8Array.from(text.match(/../g) ?? [], byte => Number.parseInt(byte, 16))

/** A previous transaction (no witness) paying `value` to `script` at `vout`, and its id in display order. */
export const previousTransaction = (script: Uint8Array, value: bigint, vout = 0, salt = 1) => {
  const outputs = Array.from({length: vout + 1}, (_, index) =>
    index === vout ? {script, value} : {script: Uint8Array.of(0x6a), value: 0n}
  )
  const raw = concat(
    u32(2),
    Uint8Array.of(1),
    new Uint8Array(32).fill(salt),
    u32(0),
    Uint8Array.of(0),
    u32(0xffffffff),
    Uint8Array.of(outputs.length),
    ...outputs.map(output => concat(u64(output.value), Uint8Array.of(output.script.length), output.script)),
    u32(0)
  )

  return {raw, txid: toHex(sha256(sha256(raw)).reverse())}
}

type Origin = {readonly publicKey: Uint8Array; readonly path: string; readonly fingerprint?: number}

export type InputSpec = {
  /** The account whose coin it spends: its script, key and path. */
  readonly account: Pick<BitcoinAccount, 'addressType' | 'path' | 'publicKey' | 'scriptPubKey'> & {
    readonly fingerprint?: number
  }
  readonly value: bigint
  /** Include the previous transaction (a value a signer can check). */
  readonly previous?: boolean
  /** Leave out the coin altogether (no witness UTXO either): its value is unknown. */
  readonly noUtxo?: boolean
  /** Leave out the key origin: a coin the PSBT does not say is anyone's. */
  readonly noOrigin?: boolean
  readonly sighashType?: number
  readonly sequence?: number
  /** A different origin than the account's (a lie, or a key elsewhere). */
  readonly origin?: Origin
  readonly salt?: number
}

export type OutputSpec = {
  readonly value: bigint
  /** A script, or an account it pays (with its origin, as change). */
  readonly script?: Uint8Array
  readonly account?: Pick<BitcoinAccount, 'addressType' | 'path' | 'publicKey' | 'scriptPubKey'> & {
    readonly fingerprint?: number
  }
  /** With an account: leave out its origin, so it is a payment to an address like any other. */
  readonly noOrigin?: boolean
  readonly origin?: Origin
}

const xOnly = (key: Uint8Array) => (key.length === 33 ? key.subarray(1) : key)

const originFields = (
  addressType: string,
  {fingerprint = FINGERPRINT, path, publicKey}: Origin
): Record<string, unknown> =>
  addressType === 'p2tr'
    ? {
        tapBip32Derivation: [[xOnly(publicKey), {der: {fingerprint, path: bip32Path(path)}, hashes: []}]],
        tapInternalKey: xOnly(publicKey),
      }
    : {bip32Derivation: [[publicKey, {fingerprint, path: bip32Path(path)}]]}

/**
 * A PSBT written by `@scure/btc-signer`, an independent implementation: any inputs, outputs, sighash types, sequences
 * and lock time, which the adapter's own `createPsbt` (a payment from one account) does not make.
 */
export const btcSignerPsbt = (
  inputs: readonly InputSpec[],
  outputs: readonly OutputSpec[],
  {lockTime = 0, version = 2}: {readonly lockTime?: number; readonly version?: number} = {}
): Uint8Array => {
  const tx = new Transaction({
    allowUnknownInputs: true,
    allowUnknownOutputs: true,
    disableScriptCheck: true,
    lockTime,
    version,
  })

  inputs.forEach((input, index) => {
    const {account} = input
    const previous = previousTransaction(account.scriptPubKey, input.value, 0, input.salt ?? index + 1)
    tx.addInput({
      index: 0,
      sequence: input.sequence ?? 0xfffffffd,
      txid: fromHex(previous.txid),
      ...(input.noUtxo ? {} : {witnessUtxo: {amount: input.value, script: account.scriptPubKey}}),
      ...(input.previous ? {nonWitnessUtxo: previous.raw} : {}),
      ...(input.sighashType === undefined ? {} : {sighashType: input.sighashType}),
      ...(input.noOrigin
        ? {}
        : originFields(
            account.addressType,
            input.origin ?? {fingerprint: account.fingerprint, path: account.path, publicKey: account.publicKey}
          )),
    })
  })

  for (const output of outputs) {
    const {account} = output
    tx.addOutput({
      amount: output.value,
      script: output.script ?? account?.scriptPubKey ?? new Uint8Array(),
      ...(account === undefined || output.noOrigin
        ? {}
        : originFields(
            account.addressType,
            output.origin ?? {fingerprint: account.fingerprint, path: account.path, publicKey: account.publicKey}
          )),
    })
  }

  return tx.toPSBT(0)
}

export const utxo = (txid: string, value: number, vout = 0): BitcoinUtxo => ({
  txid: txid.repeat(64 / txid.length),
  value: BigInt(value),
  vout,
})

/** LEB128, as runestones write integers. */
export const varint = (value: bigint): number[] => {
  const out: number[] = []
  let rest = value

  while (rest >> 7n > 0n) {
    out.push(Number(rest & 0x7fn) | 0x80)
    rest >>= 7n
  }

  out.push(Number(rest))

  return out
}

/** A push of `data` in the shortest form for its length. */
export const push = (data: Uint8Array | readonly number[]): Uint8Array => {
  const bytes = Uint8Array.from(data)

  if (bytes.length <= 75) {
    return Uint8Array.of(bytes.length, ...bytes)
  }

  if (bytes.length <= 0xff) {
    return Uint8Array.of(0x4c, bytes.length, ...bytes)
  }

  return Uint8Array.of(0x4d, bytes.length & 0xff, bytes.length >> 8, ...bytes)
}

/** OP_RETURN OP_13 and the integers, pushed as one payload: ord's `Runestone::encipher` layout. */
export const runestoneScript = (integers: readonly bigint[]): Uint8Array =>
  Uint8Array.from([0x6a, 0x5d, ...push(integers.flatMap(varint))])

/** OP_RETURN and pushes. */
export const opReturn = (...pushes: (Uint8Array | readonly number[])[]): Uint8Array =>
  Uint8Array.from([0x6a, ...pushes.flatMap(data => [...push(data)])])

export const codes = (result: {readonly warnings: readonly Warning[]}) =>
  result.warnings.map(entry => entry.code).sort()

/** The one warning of `code`, asserting there is exactly one. */
export const only = (result: ClearSigning, code: BitcoinWarningCode): Warning => {
  const found = result.warnings.filter(entry => entry.code === code)
  assert.equal(found.length, 1, `expected one ${code}, found ${found.length}: ${codes(result).join(', ')}`)

  return found[0] as Warning
}

export const has = (result: ClearSigning, code: BitcoinWarningCode) =>
  result.warnings.some(entry => entry.code === code)

export const field = (action: ClearSigningAction, id: string): Field => {
  const found = findField(action, id)
  assert.ok(found, `no field ${id}`)

  return found
}

export const rejectsWith = (promise: Promise<unknown>, code: Parameters<typeof isClearSignError>[1]) =>
  assert.rejects(promise, error => isClearSignError(error, code))

/** Resolvers answering after a tick, as an app's would over storage. */
export const asyncResolvers = (resolvers: Resolvers): Resolvers => ({
  ...(resolvers.names && {
    names: {name: async query => (await Promise.resolve(), resolvers.names?.name(query))},
  }),
  ...(resolvers.tokens && {
    tokens: {token: async query => (await Promise.resolve(), resolvers.tokens?.token(query))},
  }),
  ...(resolvers.clock && {clock: resolvers.clock}),
})

/** A fixed clock: 2026-10-27T12:00:00Z. */
export const NOW = Date.UTC(2026, 9, 27, 12)

export const clock = {now: () => NOW}

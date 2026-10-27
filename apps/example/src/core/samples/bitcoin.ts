import {hex, utf8} from '@hzblj/nitro-crypto/adapter'

import {DOG_RUNE} from '../directory'
import {type PsbtInput, type PsbtKey, type PsbtOutput, runestone, writePsbt} from './psbt'
import type {Sample, SampleEnv} from './types'

const SIGHASH_NONE = 0x02
const SIGHASH_SINGLE_ANYONECANPAY = 0x83

/** The script that pays `address`, from the adapter. */
const scriptOf = (env: SampleEnv, address: string) => {
  const validation = env.crypto.chains.bitcoin.validateAddress(address)

  if (!validation.valid) {
    throw new Error('A sample pays an address of another network.')
  }

  return validation.scriptPubKey
}

/** A payment to someone else's address: no key origin, so it is no one the signer knows by derivation. */
const pay = (env: SampleEnv, address: string, value: bigint): PsbtOutput => ({script: scriptOf(env, address), value})

/** A payment to one of the signer's keys, with its origin: change, or a transfer to itself. */
const keep = (key: PsbtKey, value: bigint): PsbtOutput => ({key, script: key.scriptPubKey, value})

const coin = (key: PsbtKey, value: bigint, salt: number, sighashType?: number): PsbtInput => ({
  key,
  salt,
  value,
  ...(sighashType === undefined ? {} : {sighashType}),
})

const psbtOf = (env: SampleEnv, inputs: readonly PsbtInput[], outputs: readonly PsbtOutput[]) => ({
  request: {
    chain: 'bitcoin',
    kind: 'psbt',
    payload: writePsbt(env.crypto.hash.sha256, inputs, outputs).psbt,
  } as const,
})

/** A coin id made from a name: the inscribed coin the indexer knows, the coin beside it. */
const txidOf = (env: SampleEnv, name: string) => hex.encode(env.crypto.hash.sha256(utf8.encode(name)))

/** Rune ids and amounts, and the runestone's tags, as ord numbers them. */
const POINTER = 22n
const BODY = 0n
const [DOG_BLOCK, DOG_TX] = DOG_RUNE.split(':').map(BigInt) as [bigint, bigint]

export const BITCOIN_SAMPLES: readonly Sample[] = [
  {
    build: env => {
      const {change, segwit} = env.accounts.bitcoin

      return psbtOf(
        env,
        [coin(segwit, 100_000n, 1)],
        [pay(env, env.accounts.strangers.bitcoinTaproot, 25_000n), keep(change, 74_230n)]
      )
    },
    caption:
      '25,000 sats to a contact and the rest back as change, at the account’s change path. Change is verified by deriving its key from the account’s extended key.',
    chain: 'bitcoin',
    id: 'payment-with-change',
    title: 'Payment with change',
  },
  {
    build: env => {
      const {change, segwit} = env.accounts.bitcoin

      return psbtOf(
        env,
        [coin(segwit, 40_000n, 2), coin(segwit, 25_000n, 3), coin(segwit, 18_000n, 4)],
        [keep(change, 82_000n)]
      )
    },
    caption: 'Three of the account’s coins combined into one, paying only the account itself.',
    chain: 'bitcoin',
    id: 'consolidation',
    title: 'Consolidation',
  },
  {
    build: env => {
      const {change, segwit} = env.accounts.bitcoin

      return psbtOf(
        env,
        [coin(segwit, 250_000n, 5)],
        [pay(env, env.accounts.strangers.bitcoin, 100_000n), keep(change, 100_000n)]
      )
    },
    caption: 'A payment of 100,000 sats that leaves 50,000 to the miner: half of what it sends.',
    chain: 'bitcoin',
    id: 'high-fee',
    title: 'High fee',
  },
  {
    build: env => {
      const {change, segwit} = env.accounts.bitcoin

      return psbtOf(
        env,
        [coin(segwit, 80_000n, 6, SIGHASH_NONE)],
        [pay(env, env.accounts.strangers.bitcoin, 50_000n), keep(change, 29_000n)]
      )
    },
    caption:
      'The signer’s coin signed with SIGHASH_NONE: the signature commits to no output, so whoever holds it can send the coin anywhere.',
    chain: 'bitcoin',
    id: 'sighash-none',
    title: 'SIGHASH_NONE',
  },
  {
    build: env => {
      const {change, taproot} = env.accounts.bitcoin

      return psbtOf(env, [coin(taproot, 150_000n, 7, SIGHASH_SINGLE_ANYONECANPAY)], [keep(change, 149_000n)])
    },
    caption:
      'A Taproot coin and the one output at its index, SINGLE|ANYONECANPAY: an offer anyone can complete with inputs and outputs of their own, as marketplace listings (and scams) are.',
    chain: 'bitcoin',
    id: 'single-anyonecanpay',
    title: 'SINGLE|ANYONECANPAY',
  },
  {
    build: env => {
      const {change, taproot} = env.accounts.bitcoin

      return psbtOf(
        env,
        [coin(taproot, 3_000n, 8)],
        [
          pay(env, env.accounts.strangers.bitcoin, 546n),
          keep(change, 546n),
          // One DOG (5 decimals) to output 0, and the rest of the coin's runes to output 1, the change.
          {script: runestone([POINTER, 1n, BODY, DOG_BLOCK, DOG_TX, 100_000n, 0n]), value: 0n},
        ]
      )
    },
    caption:
      'A runestone, deciphered as ord does: one DOG to a stranger, the rest to change by its pointer. Offline, the rune is an unknown token.',
    chain: 'bitcoin',
    id: 'runestone-transfer',
    title: 'Runestone transfer',
  },
  {
    build: env => {
      const {change, taproot} = env.accounts.bitcoin

      return psbtOf(
        env,
        [coin(taproot, 3_000n, 9)],
        [
          pay(env, env.accounts.strangers.bitcoin, 546n),
          keep(change, 546n),
          // The edict names output 5 of 3: ord reads a cenotaph, and every rune the inputs hold is burned.
          {script: runestone([BODY, DOG_BLOCK, DOG_TX, 100_000n, 5n]), value: 0n},
        ]
      )
    },
    caption: 'The same transfer with an edict for an output that does not exist: a cenotaph, which burns the runes.',
    chain: 'bitcoin',
    id: 'cenotaph',
    title: 'Cenotaph',
  },
  {
    build: env => {
      const {taproot} = env.accounts.bitcoin
      const plain = txidOf(env, 'plain coin')
      const inscribed = txidOf(env, 'inscribed coin')
      // A wallet that knows nothing of inscriptions sends everything: the inscribed 546-sat coin's sats come last, and
      // the fee is more than 546 sats, so they all go to the miner.
      const plan = taproot.createTransaction({
        amount: 'max',
        feeRate: 6,
        to: env.accounts.strangers.bitcoin,
        utxos: [
          {txid: plain, value: 20_000n, vout: 0},
          {txid: inscribed, value: 546n, vout: 1},
        ],
      })

      return {
        context: {
          // What the app's indexer says the coins hold.
          assets: ({txid, vout}) =>
            txid === inscribed && vout === 1 ? {inscriptions: [{id: `${inscribed}i0`, offset: 0n}]} : undefined,
        },
        request: {chain: 'bitcoin', kind: 'psbt', payload: taproot.createPsbt(plan)},
      }
    },
    caption:
      '“Send all” from the adapter’s own createPsbt, with an inscription on the smallest coin: the indexer (the assets option) says so, and the review shows it lands in the fee.',
    chain: 'bitcoin',
    id: 'inscription-as-fee',
    title: 'Inscription spent as fee',
  },
  {
    build: () => ({
      request: {chain: 'bitcoin', kind: 'message', payload: 'Hello from the clear signing example, 2026-10-27.'},
    }),
    caption: 'A BIP-322 message for the signing address: text, read as it is.',
    chain: 'bitcoin',
    id: 'bip322-message',
    title: 'BIP-322 message',
  },
]

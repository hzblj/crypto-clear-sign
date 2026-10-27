/**
 * What a consumer of @hzblj/crypto-clear-sign-bitcoin writes. Type-checked against the packed tarballs by
 * scripts/pack-check.mjs, and against the source by this package's type check. Grow it with every export: real usage,
 * and an `@ts-expect-error` for each mistake the types must refuse (an unresolved declaration would make every import
 * `any`, and the negative cases are what notice).
 */

import type {BitcoinChain, BitcoinWatchAccount} from '@hzblj/crypto-bitcoin'
import {type ClearSigning, localize, plainText} from '@hzblj/crypto-clear-sign'
import {
  BITCOIN_CHAIN_IDS,
  BITCOIN_TEXTS,
  BITCOIN_WARNINGS,
  type BitcoinAssetResolver,
  type BitcoinClearSignOptions,
  type BitcoinCoinAssets,
  type BitcoinSigningAccount,
  type BitcoinWarningCode,
  clearSignMessage,
  clearSignPsbt,
  DEFAULT_MAX_FEE,
  DEFAULT_MAX_FEE_PERCENT,
  DEFAULT_MAX_FEE_RATE,
  VERSION,
} from '@hzblj/crypto-clear-sign-bitcoin'
import type {ExtendedPublicKey} from '@hzblj/nitro-crypto'

export const consume = async (
  chain: BitcoinChain,
  psbt: Uint8Array,
  account: BitcoinWatchAccount,
  extendedKey: ExtendedPublicKey,
  indexer: (txid: string, vout: number) => Promise<BitcoinCoinAssets | undefined>
) => {
  const accounts: readonly BitcoinSigningAccount[] = [
    account,
    {extendedKey, fingerprint: account.fingerprint, path: "m/86'/0'/0'"},
    {fingerprint: account.fingerprint},
  ]
  const assets: BitcoinAssetResolver = {assets: ({txid, vout}) => indexer(txid, vout)}
  const options: BitcoinClearSignOptions = {
    accounts,
    assets,
    maxFee: DEFAULT_MAX_FEE,
    maxFeePercent: DEFAULT_MAX_FEE_PERCENT,
    maxFeeRate: DEFAULT_MAX_FEE_RATE,
    resolvers: {clock: {now: () => Date.now()}, names: {name: () => undefined}},
    testnet: 'testnet4',
    tipHeight: 870_000,
  }

  const review: ClearSigning = await clearSignPsbt(chain, psbt, options)
  const fromText = await clearSignPsbt(chain, 'cHNidP8B…', {accounts: account})
  const message = await clearSignMessage(chain, 'Hello', {address: account.address, format: 'legacy'})
  const bytes = await clearSignMessage(chain, new Uint8Array([1, 2, 3]))
  const asRecord = await clearSignPsbt(chain, psbt, {
    assets: {'ab…:0': {inscriptions: [{offset: 0n}], runes: [{id: '840000:3'}]}},
  })

  const critical: BitcoinWarningCode = BITCOIN_WARNINGS.SIGHASH_NONE.code
  const shared: BitcoinWarningCode = 'HIGH_FEE'
  const literal: 'bitcoin.CENOTAPH' = BITCOIN_WARNINGS.CENOTAPH.code
  const label: 'bitcoin.label.feeRate' = BITCOIN_TEXTS.label.feeRate.code
  const mainnet: 'bip122:000000000019d6689c085ae165831e93' = BITCOIN_CHAIN_IDS.mainnet

  // @ts-expect-error: a code nobody defines
  const unknown: BitcoinWarningCode = 'bitcoin.NOT_A_CODE'
  // @ts-expect-error: the formats are bip322 and legacy
  await clearSignMessage(chain, 'Hello', {format: 'bip137'})
  // @ts-expect-error: testnet is testnet3 or testnet4
  await clearSignPsbt(chain, psbt, {testnet: 'testnet5'})
  // @ts-expect-error: maxFee is a bigint of satoshis
  await clearSignPsbt(chain, psbt, {maxFee: 1000})
  // @ts-expect-error: a PSBT is bytes or Base64 text
  await clearSignPsbt(chain, 42)
  // @ts-expect-error: a fingerprint is a number
  await clearSignPsbt(chain, psbt, {accounts: [{fingerprint: '73c5da0a'}]})

  return [
    VERSION,
    plainText(review),
    localize(review.intent),
    fromText.risk,
    message.kind,
    bytes.warnings,
    asRecord.actions,
    critical,
    shared,
    literal,
    label,
    mainnet,
    unknown,
  ]
}

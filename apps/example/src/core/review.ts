import type {ClearSigning, DescriptorResolver} from '@hzblj/crypto-clear-sign'
import {
  type BitcoinCoinAssets,
  type BitcoinCoinQuery,
  clearSignMessage as clearSignBitcoinMessage,
  clearSignPsbt,
} from '@hzblj/crypto-clear-sign-bitcoin'
import {
  clearSignAuthorization,
  clearSignMessage as clearSignEthereumMessage,
  clearSignTransaction as clearSignEthereumTransaction,
  clearSignTypedData,
} from '@hzblj/crypto-clear-sign-ethereum'
import {
  clearSignMessage as clearSignSolanaMessage,
  clearSignTransaction as clearSignSolanaTransaction,
  type SolanaDescriptorQuery,
  type SolanaIdl,
} from '@hzblj/crypto-clear-sign-solana'
import type {EthereumAuthorizationRequest, Hex, SignableMessage, TypedDataDefinition} from '@hzblj/crypto-ethereum'
import type {SolanaAddressLookupTables} from '@hzblj/crypto-solana'

import type {DemoCrypto} from './chains'
import type {ReviewOptions} from './options'

/**
 * What a wallet is asked to sign, as it receives it: the bytes, the typed data or the text, by chain and kind. The
 * samples build these, the Paste tab reads them from text, and `review` hands them to the chain package.
 */
export type ReviewRequest =
  | {readonly chain: 'ethereum'; readonly kind: 'transaction'; readonly payload: Hex}
  | {readonly chain: 'ethereum'; readonly kind: 'typed-data'; readonly payload: TypedDataDefinition}
  | {readonly chain: 'ethereum'; readonly kind: 'message'; readonly payload: SignableMessage}
  | {readonly chain: 'ethereum'; readonly kind: 'authorization'; readonly payload: EthereumAuthorizationRequest}
  | {readonly chain: 'solana'; readonly kind: 'transaction'; readonly payload: Uint8Array}
  | {readonly chain: 'solana'; readonly kind: 'message'; readonly payload: string | Uint8Array}
  | {readonly chain: 'bitcoin'; readonly kind: 'psbt'; readonly payload: Uint8Array}
  | {readonly chain: 'bitcoin'; readonly kind: 'message'; readonly payload: string}

export type ReviewChain = ReviewRequest['chain']
export type ReviewKind = ReviewRequest['kind']

/**
 * What the request comes with besides its payload, as a wallet knows it: the site that asks (from the connection,
 * never from the payload), IDLs the app trusts, the lookup tables it fetched, its indexer's word on what the signer's
 * coins hold.
 */
export type ReviewContext = {
  readonly origin?: string
  readonly idls?: DescriptorResolver<SolanaDescriptorQuery, SolanaIdl>
  readonly lookupTables?: SolanaAddressLookupTables
  readonly assets?: (query: BitcoinCoinQuery) => BitcoinCoinAssets | undefined
}

type Of<Chain extends ReviewChain> = Extract<ReviewRequest, {readonly chain: Chain}>

const ethereum = (crypto: DemoCrypto, request: Of<'ethereum'>, options: ReviewOptions, context: ReviewContext) => {
  const chain = crypto.chains.ethereum
  const settings = {...options.ethereum, ...(context.origin === undefined ? {} : {origin: context.origin})}

  switch (request.kind) {
    case 'transaction':
      return clearSignEthereumTransaction(chain, request.payload, settings)
    case 'typed-data':
      return clearSignTypedData(chain, request.payload, settings)
    case 'message':
      return clearSignEthereumMessage(chain, request.payload, settings)
    case 'authorization':
      return clearSignAuthorization(chain, request.payload, settings)
  }
}

const solana = (crypto: DemoCrypto, request: Of<'solana'>, options: ReviewOptions, context: ReviewContext) => {
  const chain = crypto.chains.solana
  const {idls, lookupTables, origin} = context
  const settings = {
    ...options.solana,
    ...(origin === undefined ? {} : {origin}),
    resolvers: {
      ...options.solana.resolvers,
      ...(idls === undefined ? {} : {descriptors: idls}),
      ...(lookupTables === undefined
        ? {}
        : {lookupTables: {lookupTable: ({address}: {readonly address: string}) => lookupTables[address]}}),
    },
  }

  return request.kind === 'transaction'
    ? clearSignSolanaTransaction(chain, request.payload, settings)
    : clearSignSolanaMessage(chain, request.payload, settings)
}

const bitcoin = (crypto: DemoCrypto, request: Of<'bitcoin'>, options: ReviewOptions, context: ReviewContext) => {
  const chain = crypto.chains.bitcoin
  const settings = {...options.bitcoin, ...(context.assets === undefined ? {} : {assets: {assets: context.assets}})}

  return request.kind === 'psbt'
    ? clearSignPsbt(chain, request.payload, settings)
    : clearSignBitcoinMessage(chain, request.payload, settings)
}

/**
 * The request read by its chain package into a `ClearSigning`, with the options the settings make and the request's
 * own context. Rejects with a `ClearSignError` when nothing could be signed (`INVALID_INPUT`, `CHAIN_MISMATCH`,
 * `UNSUPPORTED`); anything that parses is a result, however little of it is understood.
 */
export const review = (
  crypto: DemoCrypto,
  request: ReviewRequest,
  options: ReviewOptions,
  context: ReviewContext = {}
): Promise<ClearSigning> => {
  switch (request.chain) {
    case 'ethereum':
      return ethereum(crypto, request, options, context)
    case 'solana':
      return solana(crypto, request, options, context)
    case 'bitcoin':
      return bitcoin(crypto, request, options, context)
  }
}

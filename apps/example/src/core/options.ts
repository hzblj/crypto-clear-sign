import type {BitcoinClearSignOptions} from '@hzblj/crypto-clear-sign-bitcoin'
import type {Erc7730Resolver, EthereumClearSignOptions} from '@hzblj/crypto-clear-sign-ethereum'
import {registryResolver} from '@hzblj/crypto-clear-sign-ethereum/registry'
import type {SolanaClearSignOptions} from '@hzblj/crypto-clear-sign-solana'

import {type ChainId, type DemoAccounts, demoSigners} from './chains'
import {addressBook, namesResolver, tokensResolver} from './directory'

/**
 * What the Settings tab changes about every review: who signs on each chain, whether the app's own resolvers (its
 * token list and address book) answer, and whether the chain packages' built-in lists do. The language is the UI's
 * alone: the model is the same in every language, only `localize` differs.
 */
export type ReviewSettings = {
  /**
   * The signer of each chain where it is not the demo key's first account: another address, or `''` for none (then
   * nothing is `self`, and nothing the signer owns can be told from what others own).
   */
  readonly signers: {readonly [Id in ChainId]?: string}
  /** The app's token list and address book. */
  readonly resolvers: boolean
  /** The chain packages' own token lists and contract names (`builtins`, `builtinTokens`). */
  readonly builtins: boolean
}

export const DEFAULT_SETTINGS: ReviewSettings = {builtins: true, resolvers: true, signers: {}}

/** Each chain's options, as `review` passes them to its chain package. */
export type ReviewOptions = {
  readonly bitcoin: BitcoinClearSignOptions
  readonly ethereum: EthereumClearSignOptions
  readonly solana: SolanaClearSignOptions
}

let registry: Erc7730Resolver | undefined

/**
 * The bundled ERC-7730 registry (Uniswap, 1inch, Aave, Lido, …) as a descriptors resolver, compiled once: offline
 * knowledge the app chose to trust, so it answers whether or not the other resolvers are on.
 */
export const descriptors = (): Erc7730Resolver => {
  registry ??= registryResolver()

  return registry
}

/** The address that signs on `chain`: the setting, or the demo key's first account. `undefined` for none. */
export const signerOf = (settings: ReviewSettings, accounts: DemoAccounts, chain: ChainId): string | undefined => {
  const signer = settings.signers[chain] ?? demoSigners(accounts)[chain]

  return signer.trim() === '' ? undefined : signer.trim()
}

/**
 * Every chain's options for `settings`, on a clock fixed at `now` (one moment for a whole gallery, so deadlines read
 * alike). Bitcoin's signer is matched by the demo key's account keys when it is one of its addresses: then change and
 * the signer's coins are verified by derivation, as a wallet that holds the account would.
 */
export const reviewOptions = (settings: ReviewSettings, accounts: DemoAccounts, now: number): ReviewOptions => {
  const clock = {now: () => now}
  const book = addressBook(accounts)
  const known = (chain: ChainId) =>
    settings.resolvers ? {names: namesResolver(chain, book[chain]), tokens: tokensResolver(chain)} : {}
  const bitcoinSigner = signerOf(settings, accounts, 'bitcoin')
  const demoBitcoin = [accounts.bitcoin.segwit.address, accounts.bitcoin.taproot.address]

  return {
    bitcoin: {
      ...(bitcoinSigner === undefined ? {} : {signer: bitcoinSigner}),
      ...(bitcoinSigner !== undefined && demoBitcoin.includes(bitcoinSigner)
        ? {accounts: accounts.bitcoinAccounts}
        : {}),
      resolvers: {clock, ...known('bitcoin')},
    },
    ethereum: {
      builtins: settings.builtins,
      resolvers: {clock, descriptors: descriptors(), ...known('ethereum')},
      signer: signerOf(settings, accounts, 'ethereum'),
    },
    solana: {
      builtinTokens: settings.builtins,
      resolvers: {clock, ...known('solana')},
      signer: signerOf(settings, accounts, 'solana'),
    },
  }
}

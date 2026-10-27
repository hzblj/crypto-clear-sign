import {
  type ChainRef,
  ClearSignError,
  type ClearSignOptions,
  type MaybePromise,
  type Resolvers,
} from '@hzblj/crypto-clear-sign'
import type {SolanaAddressLookupTables} from '@hzblj/crypto-solana'

import {isAddress, type SolanaClearSignChain} from './chain'
import type {SolanaIdl} from './idl/types'

/** What the `descriptors` resolver is asked: the program an instruction calls, on the chain the result is for. */
export type SolanaDescriptorQuery = {readonly chain: ChainRef; readonly programId: string}

/** An address lookup table to read: its address, on the chain the result is for. */
export type LookupTableQuery = {readonly chain: ChainRef; readonly address: string}

/**
 * Finds the addresses an address lookup table holds, in order (the table account's `addresses`, as the RPC returns it
 * parsed, or kit's `fetchAddressesForLookupTables`): `undefined` when it does not know the table.
 */
export type LookupTableResolver = {
  readonly lookupTable: (query: LookupTableQuery) => MaybePromise<readonly string[] | undefined>
}

/** The core's resolvers, with IDLs for descriptors, and address lookup tables. */
export type SolanaResolvers = Resolvers<SolanaDescriptorQuery, SolanaIdl> & {
  /** Asked for each table a v0 transaction loads accounts from that `addressLookupTables` does not give. */
  readonly lookupTables?: LookupTableResolver
}

/**
 * The core's options (`signer`, `resolvers`) and Solana's own. Every option is optional; without a `signer` nothing is
 * `self`, and whatever depends on whose the accounts are is warned about rather than assumed.
 */
export type SolanaClearSignOptions = ClearSignOptions<SolanaDescriptorQuery, SolanaIdl> & {
  readonly resolvers?: SolanaResolvers
  /**
   * Transactions: the addresses of the lookup tables a v0 transaction loads from, by table, as the adapter takes them.
   * Taken as given (a signer offline cannot check them against the chain), and asked of `resolvers.lookupTables` for
   * any table not here.
   */
  readonly addressLookupTables?: SolanaAddressLookupTables
  /** Transactions: the priority fee, in lamports, above which `HIGH_FEE` is raised. `HIGH_PRIORITY_FEE` unless given. */
  readonly highPriorityFee?: bigint
  /** Whether `SOLANA_TOKENS` backs the `tokens` resolver (it answers only where the app's does not). Default `true`. */
  readonly builtinTokens?: boolean
  /**
   * Messages: the site that asks for the signature, as the wallet knows it (its origin, `https://app.example`, or
   * host), which a Sign In With Solana message's domain must match.
   */
  readonly origin?: string
}

/** The default `highPriorityFee`: 0.01 SOL, in lamports, about a hundred times what a busy hour's priority fee is. */
export const HIGH_PRIORITY_FEE = 10_000_000n

const U64_MAX = (1n << 64n) - 1n

/** The options, checked: anything out of range is `INVALID_ARGUMENT`, naming the option, never its value. */
export const checkOptions = (chain: SolanaClearSignChain, options: SolanaClearSignOptions) => {
  if (typeof options !== 'object' || options === null) {
    throw new ClearSignError('INVALID_ARGUMENT', 'The options are an object.')
  }

  const {builtinTokens, highPriorityFee, origin, signer} = options

  if (signer !== undefined && !isAddress(chain, signer)) {
    throw new ClearSignError('INVALID_ARGUMENT', 'The signer is a Solana address.')
  }

  if (
    highPriorityFee !== undefined &&
    (typeof highPriorityFee !== 'bigint' || highPriorityFee < 0n || highPriorityFee > U64_MAX)
  ) {
    throw new ClearSignError('INVALID_ARGUMENT', 'highPriorityFee is a bigint of lamports, 0 or more.')
  }

  if (builtinTokens !== undefined && typeof builtinTokens !== 'boolean') {
    throw new ClearSignError('INVALID_ARGUMENT', 'builtinTokens is a boolean.')
  }

  if (origin !== undefined && (typeof origin !== 'string' || origin === '')) {
    throw new ClearSignError('INVALID_ARGUMENT', 'origin is the site that asks: an origin or a host.')
  }
}

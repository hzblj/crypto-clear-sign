import type {Field} from './fields'
import type {RiskLevel} from './risk'
import type {DisplayText} from './text'
import type {Warning} from './warnings'

/** The chain families with a package here. Another chain's package names its own. */
export type ChainFamily = 'bitcoin' | 'ethereum' | 'solana' | (string & {})

/** Which chain a result is for. */
export type ChainRef = {
  /** The package's family, which also namespaces its codes: `ethereum`, `solana`, `bitcoin`. */
  readonly family: ChainFamily
  /**
   * The chain's CAIP-2 id: `eip155:1`, `eip155:8453`, `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`,
   * `bip122:000000000019d6689c085ae165831e93`. What resolvers key tokens and names by.
   */
  readonly id: string
  /** For people: the adapter's network name (`Ethereum`, `Base`, `Sepolia`), or the chain package's. */
  readonly name: string
}

/** What is signed. A new kind is a minor release; a UI shows an unknown one by its intent. */
export const SIGNING_KINDS = [
  /** A transaction: Ethereum's of any type, Solana's legacy or v0. */
  'transaction',
  /** EIP-712 typed data. */
  'typed-data',
  /** A message: EIP-191 personal messages, Solana message bytes, Bitcoin BIP-322 or legacy messages. */
  'message',
  /** Solana's off-chain message format. */
  'offchain-message',
  /** A Bitcoin PSBT. */
  'psbt',
  /** An EIP-7702 authorization, signed on its own. */
  'authorization',
] as const

export type SigningKind = (typeof SIGNING_KINDS)[number]

/** Whether `value` is a signing kind. */
export const isSigningKind = (value: unknown): value is SigningKind =>
  typeof value === 'string' && (SIGNING_KINDS as readonly string[]).includes(value)

/** A descriptor format: ERC-7730 for EVM calls and typed data, an IDL (Anchor's, Codama's) for Solana programs. */
export type DescriptorFormat = 'erc7730' | 'idl' | (string & {})

/**
 * How an action was understood, for a UI's "how do we know" and for the trust a user gives it:
 *
 * - `builtin`: one of the chain package's own decoders (`erc20`, `system-program`, `psbt`), named by `decoder`.
 * - `descriptor`: a descriptor a resolver gave (ERC-7730, an IDL), with its `id` and who `publisher` says made it.
 *   The words come from that file: it is as trustworthy as where the app loaded it from.
 * - `unknown`: nothing read it. Its raw data is in `raw`, and the action warns (`UNKNOWN_CONTRACT_CALL`,
 *   `BLIND_SIGNING`).
 */
export type Source =
  | {readonly kind: 'builtin'; readonly decoder: string}
  | {
      readonly kind: 'descriptor'
      readonly format: DescriptorFormat
      readonly id: string
      readonly publisher?: string
    }
  | {readonly kind: 'unknown'}

/** Where an action is in a result: `[]` is the result itself, `[1]` its second action, `[1, 0]` that one's first. */
export type ActionPath = readonly number[]

/**
 * One thing a signature does: the whole of it, or one call of a multicall, one instruction of a Solana transaction,
 * one output of a PSBT. Actions nest (`actions`): a batch of calls, a router's commands inside a call.
 */
export type ClearSigningAction = {
  /** Where it is in the result. */
  readonly path: ActionPath
  /** A short title with a stable code: `INTENTS.approve`, a chain package's, or a descriptor's (`externalText`). */
  readonly intent: DisplayText
  /** One sentence with the specifics: "Allow Uniswap to spend an unlimited amount of USDC". */
  readonly summary?: DisplayText
  /** What to show, in order. */
  readonly fields: readonly Field[]
  /** What was left undecoded, as fields to show behind "Show raw data": call data, instruction data, scripts. */
  readonly raw: readonly Field[]
  readonly source: Source
  /** The most serious severity of the warnings raised on it and on the actions below it; `none` without any. */
  readonly risk: RiskLevel
  /** The actions it is made of, in order: empty for a single one. */
  readonly actions: readonly ClearSigningAction[]
}

/**
 * What a wallet is about to sign, made readable: a chain package's answer, and what every UI renders. Plain data
 * (no class instances), deeply frozen. Amounts and some numbers are `bigint`: `JSON.stringify` needs `jsonReplacer`.
 *
 * The result is itself the root action (`path` `[]`); `warnings` holds every warning of the whole tree, most serious
 * first, each saying the action it was raised on, so a UI that shows only the top still shows them all, and `risk` is
 * their maximum.
 */
export type ClearSigning = ClearSigningAction & {
  readonly chain: ChainRef
  readonly kind: SigningKind
  readonly warnings: readonly Warning[]
}

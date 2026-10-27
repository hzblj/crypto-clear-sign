import type {ChainId, DemoAccounts, DemoCrypto} from '../chains'
import type {ReviewContext, ReviewRequest} from '../review'

/** What a sample is built from: the engine, the demo key's accounts and strangers' addresses, and the moment. */
export type SampleEnv = {
  readonly crypto: DemoCrypto
  readonly accounts: DemoAccounts
  /** Milliseconds: deadlines and expiries are set from it, so a sample reads the same on any day. */
  readonly now: number
}

/** A request as a dApp would send it, and what the wallet knows about it besides the payload. */
export type SampleRequest = {readonly request: ReviewRequest; readonly context?: ReviewContext}

/** One real-world signing request of the gallery. */
export type Sample = {
  /** Stable, kebab-case: the route and the tests name it. */
  readonly id: string
  readonly chain: ChainId
  readonly title: string
  /** What it is and what to notice in the review, in a sentence or two. */
  readonly caption: string
  readonly build: (env: SampleEnv) => SampleRequest | Promise<SampleRequest>
}

/** Seconds since the Unix epoch, as contracts and typed data count time. */
export const seconds = (milliseconds: number) => BigInt(Math.floor(milliseconds / 1000))

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

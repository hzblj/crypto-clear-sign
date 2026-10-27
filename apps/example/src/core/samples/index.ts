import type {ClearSigning} from '@hzblj/crypto-clear-sign'

import type {ChainId} from '../chains'
import type {ReviewOptions} from '../options'
import {review} from '../review'
import {BITCOIN_SAMPLES} from './bitcoin'
import {ETHEREUM_SAMPLES} from './ethereum'
import {SOLANA_SAMPLES} from './solana'
import type {Sample, SampleEnv, SampleRequest} from './types'

export {demoVaultIdl} from './solana'
export type {Sample, SampleEnv, SampleRequest} from './types'

/** The gallery, by chain, in the order each tab lists it. */
export const SAMPLES: {readonly [Id in ChainId]: readonly Sample[]} = {
  bitcoin: BITCOIN_SAMPLES,
  ethereum: ETHEREUM_SAMPLES,
  solana: SOLANA_SAMPLES,
}

export const sampleOf = (chain: ChainId, id: string): Sample | undefined =>
  SAMPLES[chain].find(sample => sample.id === id)

/** What a sample led to: its request and the review, or the error the chain package threw. */
export type SampleOutcome =
  | {readonly sample: Sample; readonly request: SampleRequest; readonly result: ClearSigning}
  | {readonly sample: Sample; readonly error: unknown}

/** Builds a sample's request and reviews it with `options`, as a wallet would on receiving it. */
export const runSample = async (sample: Sample, env: SampleEnv, options: ReviewOptions): Promise<SampleOutcome> => {
  try {
    const request = await sample.build(env)

    return {request, result: await review(env.crypto, request.request, options, request.context), sample}
  } catch (error) {
    return {error, sample}
  }
}

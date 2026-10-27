/**
 * What a consumer of @hzblj/crypto-clear-sign-solana writes. Type-checked against the packed tarballs by
 * scripts/pack-check.mjs, and against the source by this package's type check. Grow it with every export: real usage,
 * and an `@ts-expect-error` for each mistake the types must refuse (an unresolved declaration would make every import
 * `any`, and the negative cases are what notice).
 */
import type {ClearSigning} from '@hzblj/crypto-clear-sign'
import {VERSION} from '@hzblj/crypto-clear-sign-solana'
import type {SolanaChain} from '@hzblj/crypto-solana'

export const consume = (chain: SolanaChain, result: ClearSigning) => {
  // @ts-expect-error: VERSION is a string
  const version: number = VERSION

  return [chain.cluster, result.risk, version]
}

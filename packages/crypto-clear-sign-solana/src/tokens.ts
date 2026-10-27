import type {TokenInfo, TokenResolver} from '@hzblj/crypto-clear-sign'

import {SOLANA_CHAIN_IDS} from './chain'

const WRAPPED_SOL: TokenInfo = Object.freeze({decimals: 9, name: 'Wrapped SOL', symbol: 'wSOL'})

/**
 * The tokens this package knows by itself, by chain (CAIP-2) and mint: USDC and USDT on mainnet, USDC on devnet
 * (Circle's devnet mint), and wrapped SOL everywhere. They back the `tokens` resolver: the app's answer comes first,
 * this list only when it has none, and `builtinTokens: false` turns it off.
 */
export const SOLANA_TOKENS: Readonly<Record<string, Readonly<Record<string, TokenInfo>>>> = Object.freeze({
  [SOLANA_CHAIN_IDS['mainnet-beta']]: Object.freeze({
    EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: Object.freeze({decimals: 6, name: 'USD Coin', symbol: 'USDC'}),
    Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: Object.freeze({decimals: 6, name: 'Tether USD', symbol: 'USDT'}),
    So11111111111111111111111111111111111111112: WRAPPED_SOL,
  }),
  [SOLANA_CHAIN_IDS.devnet]: Object.freeze({
    '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU': Object.freeze({decimals: 6, name: 'USD Coin', symbol: 'USDC'}),
    So11111111111111111111111111111111111111112: WRAPPED_SOL,
  }),
  [SOLANA_CHAIN_IDS.testnet]: Object.freeze({
    So11111111111111111111111111111111111111112: WRAPPED_SOL,
  }),
})

/** The app's token resolver backed by the built-in list: the app answers first; a throw stays a failure. */
export const withBuiltinTokens = (resolver: TokenResolver | undefined, enabled: boolean): TokenResolver | undefined =>
  enabled
    ? {
        token: async query => {
          const answer = resolver === undefined ? undefined : await resolver.token(query)

          return answer ?? builtin(query.chain.id, query.address)
        },
      }
    : resolver

const builtin = (chain: string, mint: string): TokenInfo | undefined => {
  const list = Object.hasOwn(SOLANA_TOKENS, chain) ? SOLANA_TOKENS[chain] : undefined

  return list !== undefined && Object.hasOwn(list, mint) ? list[mint] : undefined
}

import type {TokenInfo} from '@hzblj/crypto-clear-sign'

/** A token the built-in list knows, on one chain. */
export type EthereumToken = TokenInfo & {
  /** The EIP-155 chain id. */
  readonly chainId: number
  /** EIP-55. */
  readonly address: string
}

/**
 * The built-in token list: the most used tokens of Ethereum mainnet and the common test tokens of Sepolia. It backs
 * the `tokens` resolver: the app's answer wins, and this list answers what the app's does not (unless
 * `builtins: false`). Anything else is an unknown token, shown in base units with `UNKNOWN_TOKEN`.
 */
export const ETHEREUM_TOKENS: readonly EthereumToken[] = Object.freeze(
  [
    {address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', chainId: 1, decimals: 6, name: 'USD Coin', symbol: 'USDC'},
    {
      address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      chainId: 1,
      decimals: 6,
      name: 'Tether USD',
      symbol: 'USDT',
    },
    {
      address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      chainId: 1,
      decimals: 18,
      name: 'Dai Stablecoin',
      symbol: 'DAI',
    },
    {
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      chainId: 1,
      decimals: 18,
      name: 'Wrapped Ether',
      symbol: 'WETH',
    },
    {
      address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
      chainId: 1,
      decimals: 8,
      name: 'Wrapped BTC',
      symbol: 'WBTC',
    },
    {
      address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      chainId: 11155111,
      decimals: 6,
      name: 'USD Coin',
      symbol: 'USDC',
    },
    {
      address: '0x08210F9170F89Ab7658F0B5E3fF39b0E03C594D4',
      chainId: 11155111,
      decimals: 6,
      name: 'Euro Coin',
      symbol: 'EURC',
    },
    {
      address: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14',
      chainId: 11155111,
      decimals: 18,
      name: 'Wrapped Ether',
      symbol: 'WETH',
    },
    {
      address: '0x779877A7B0D9E8603169DdbD7836e478b4624789',
      chainId: 11155111,
      decimals: 18,
      name: 'ChainLink Token',
      symbol: 'LINK',
    },
  ].map(token => Object.freeze(token))
)

/** Uniswap's Permit2, at the same address on every chain. */
export const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3'

/** Multicall3, at the same address on every chain. */
export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11'

/** Wrapped ether contracts the `weth` decoder reads `deposit` and `withdraw` of, by chain. */
export const WETH: Readonly<Record<number, string>> = Object.freeze({
  1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  10: '0x4200000000000000000000000000000000000006',
  8453: '0x4200000000000000000000000000000000000006',
  42161: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  11155111: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14',
})

/** Contracts named by the package itself, after the `names` resolver: the same on every chain. */
export const KNOWN_CONTRACTS: Readonly<Record<string, string>> = Object.freeze({
  [MULTICALL3.toLowerCase()]: 'Multicall3',
  [PERMIT2.toLowerCase()]: 'Permit2',
})

/** Chain names for the `chainId` field format and for chain references other than the client's. */
export const CHAIN_NAMES: Readonly<Record<number, string>> = Object.freeze({
  1: 'Ethereum',
  10: 'OP Mainnet',
  56: 'BNB Smart Chain',
  100: 'Gnosis',
  130: 'Unichain',
  137: 'Polygon',
  146: 'Sonic',
  250: 'Fantom',
  324: 'zkSync Era',
  480: 'World Chain',
  999: 'HyperEVM',
  1101: 'Polygon zkEVM',
  5000: 'Mantle',
  8453: 'Base',
  17000: 'Holesky',
  34443: 'Mode',
  42161: 'Arbitrum One',
  42220: 'Celo',
  43114: 'Avalanche C-Chain',
  59144: 'Linea',
  80094: 'Berachain',
  81457: 'Blast',
  84532: 'Base Sepolia',
  421614: 'Arbitrum Sepolia',
  534352: 'Scroll',
  560048: 'Hoodi',
  11155111: 'Sepolia',
  11155420: 'OP Sepolia',
})

/** The zero address: a burn, "none", or the chain's native asset in some protocols. */
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

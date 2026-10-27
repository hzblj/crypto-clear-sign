import type {BitcoinChain} from '@hzblj/crypto-bitcoin'
import {type ChainRef, ClearSignError} from '@hzblj/crypto-clear-sign'

/** Which test network the adapter's `testnet` is: its addresses are the same, its genesis block is not. */
export type BitcoinTestnet = 'testnet3' | 'testnet4'

/**
 * The CAIP-2 id of every Bitcoin network: `bip122:` and the first 32 hex characters of its genesis block's hash, as
 * CAIP-4 defines them.
 */
export const BITCOIN_CHAIN_IDS = Object.freeze({
  mainnet: 'bip122:000000000019d6689c085ae165831e93',
  regtest: 'bip122:0f9188f13cb7b2c71f2a335e3a4fc328',
  signet: 'bip122:00000008819873e925422c1ff0f99f7c',
  testnet3: 'bip122:000000000933ea01ad0ee984209779ba',
  testnet4: 'bip122:00000000da84f2bafbbc53dee25a72ae',
} as const)

const NAMES: Readonly<Record<keyof typeof BITCOIN_CHAIN_IDS, string>> = {
  mainnet: 'Bitcoin',
  regtest: 'Bitcoin Regtest',
  signet: 'Bitcoin Signet',
  testnet3: 'Bitcoin Testnet3',
  testnet4: 'Bitcoin Testnet4',
}

/** The adapter's network as a result names it: its CAIP-2 id and a name for people. Internal. */
export const chainRef = (
  chain: Pick<BitcoinChain<string>, 'network'>,
  testnet: BitcoinTestnet = 'testnet4'
): ChainRef => {
  if (testnet !== 'testnet3' && testnet !== 'testnet4') {
    throw new ClearSignError('INVALID_ARGUMENT', 'testnet is testnet3 or testnet4.')
  }

  const name = chain.network.name
  const key = name === 'testnet' ? testnet : name

  if (!(key in BITCOIN_CHAIN_IDS)) {
    throw new ClearSignError('INVALID_ARGUMENT', 'The chain client is for a Bitcoin network this does not know.')
  }

  return Object.freeze({family: 'bitcoin', id: BITCOIN_CHAIN_IDS[key], name: NAMES[key]})
}

/** The symbol an amount of the network's coin shows: BTC on mainnet, tBTC on every test network. Internal. */
export const symbolOf = (chain: Pick<BitcoinChain<string>, 'network'>) =>
  chain.network.name === 'mainnet' ? 'BTC' : 'tBTC'

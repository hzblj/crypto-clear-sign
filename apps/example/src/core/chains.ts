import {bitcoinAdapter} from '@hzblj/crypto-bitcoin'
import {ethereumAdapter} from '@hzblj/crypto-ethereum'
import {solanaAdapter} from '@hzblj/crypto-solana'
import type {AccountOf, ChainsOf, CryptoEngine, ExtendedPublicKey} from '@hzblj/nitro-crypto'

/**
 * The example's chains: the three published adapters on their main networks, under the plain chain names. Nothing is
 * signed for real or broadcast: the samples are what a dApp would ask a wallet on these networks to sign.
 * Apart from `engine.ts`, so the tests take the same list without the native module.
 */
export const createDemoAdapters = () =>
  [ethereumAdapter({chainId: 1, name: 'Ethereum'}), solanaAdapter(), bitcoinAdapter()] as const

type Chains = ChainsOf<ReturnType<typeof createDemoAdapters>>

export type DemoCrypto = CryptoEngine<Chains>
export type ChainId = keyof Chains & string
export type ChainAccount<Id extends ChainId> = AccountOf<Chains[Id]>

export const CHAIN_IDS = ['ethereum', 'solana', 'bitcoin'] as const satisfies readonly ChainId[]

/** BIP-39's published test phrase: the demo key holds nothing, and its addresses are everyone's to see. */
export const DEMO_PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

/** The same phrase with a BIP-39 passphrase: other people's addresses, valid on every chain, for the samples. */
const STRANGER_PASSPHRASE = 'stranger'

/** A Bitcoin account by its extended public key: what `clearSignPsbt` derives change and ownership from. */
export type XpubAccount = {readonly extendedKey: ExtendedPublicKey; readonly fingerprint: number; readonly path: string}

/**
 * The demo key's accounts, which the samples are built for (they are `self`), and strangers' addresses on each chain
 * (an attacker, a recipient nobody knows). The Ethereum account signs what a sample needs signed in advance: an
 * EIP-7702 authorization inside a type 4 transaction.
 */
export type DemoAccounts = {
  readonly fingerprint: number
  readonly ethereum: ChainAccount<'ethereum'>
  /** A second account of the same key: what the address book calls the user's own. */
  readonly ethereumSavings: ChainAccount<'ethereum'>
  readonly solana: ChainAccount<'solana'>
  readonly solanaSavings: ChainAccount<'solana'>
  /** BIP-84 receive and change, BIP-86 receive. */
  readonly bitcoin: {
    readonly segwit: ChainAccount<'bitcoin'>
    readonly change: ChainAccount<'bitcoin'>
    readonly taproot: ChainAccount<'bitcoin'>
  }
  /** The BIP-84 and BIP-86 accounts by extended key. */
  readonly bitcoinAccounts: readonly XpubAccount[]
  readonly strangers: {
    readonly ethereum: string
    readonly ethereumOther: string
    readonly solana: string
    readonly solanaOther: string
    readonly bitcoin: string
    readonly bitcoinTaproot: string
  }
}

/** The fields of the accounts the review needs: nothing that holds a key. */
export type DemoSigners = {readonly [Id in ChainId]: string}

/**
 * Opens the demo key in the engine and derives every account the samples use. The key stays in the engine for the
 * run (it signs one authorization); the strangers' key is disposed of at once.
 */
export const openDemoAccounts = async (crypto: DemoCrypto): Promise<DemoAccounts> => {
  const keys = await crypto.createEphemeralWallet({mnemonic: DEMO_PHRASE})
  const strangerKeys = await crypto.createEphemeralWallet({mnemonic: DEMO_PHRASE, passphrase: STRANGER_PASSPHRASE})

  try {
    const [ethereum, ethereumSavings, solana, solanaSavings, segwit, change, taproot] = await Promise.all([
      keys.deriveAccount({chain: 'ethereum', index: 0}),
      keys.deriveAccount({chain: 'ethereum', index: 1}),
      keys.deriveAccount({account: 0, chain: 'solana'}),
      keys.deriveAccount({account: 1, chain: 'solana'}),
      keys.deriveAccount({chain: 'bitcoin'}),
      keys.deriveAccount({chain: 'bitcoin', change: 1}),
      keys.deriveAccount({addressType: 'p2tr', chain: 'bitcoin'}),
    ])
    const [strangerEthereum, strangerEthereumOther, strangerSolana, strangerSolanaOther, strangerBitcoin, strangerTr] =
      await Promise.all([
        strangerKeys.deriveAccount({chain: 'ethereum', index: 0}),
        strangerKeys.deriveAccount({chain: 'ethereum', index: 1}),
        strangerKeys.deriveAccount({account: 0, chain: 'solana'}),
        strangerKeys.deriveAccount({account: 1, chain: 'solana'}),
        strangerKeys.deriveAccount({chain: 'bitcoin'}),
        strangerKeys.deriveAccount({addressType: 'p2tr', chain: 'bitcoin'}),
      ])

    return {
      bitcoin: {change, segwit, taproot},
      bitcoinAccounts: ["m/84'/0'/0'", "m/86'/0'/0'"].map(path => ({
        extendedKey: keys.extendedPublicKey(path),
        fingerprint: keys.fingerprint,
        path,
      })),
      ethereum,
      ethereumSavings,
      fingerprint: keys.fingerprint,
      solana,
      solanaSavings,
      strangers: {
        bitcoin: strangerBitcoin.address,
        bitcoinTaproot: strangerTr.address,
        ethereum: strangerEthereum.address,
        ethereumOther: strangerEthereumOther.address,
        solana: strangerSolana.address,
        solanaOther: strangerSolanaOther.address,
      },
    }
  } finally {
    strangerKeys.dispose()
  }
}

/** The address each chain's samples are signed by: the demo key's first account. */
export const demoSigners = (accounts: DemoAccounts): DemoSigners => ({
  bitcoin: accounts.bitcoin.segwit.address,
  ethereum: accounts.ethereum.address,
  solana: accounts.solana.address,
})

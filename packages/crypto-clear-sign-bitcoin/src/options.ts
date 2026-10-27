import type {BitcoinAccountType, BitcoinChain, BitcoinWatchAccount} from '@hzblj/crypto-bitcoin'
import type {ChainRef, ClearSignOptions, MaybePromise} from '@hzblj/crypto-clear-sign'
import type {ExtendedPublicKey} from '@hzblj/nitro-crypto/adapter'

import type {BitcoinTestnet} from './chain'

/**
 * An account that signs, by which a PSBT's inputs are told from others' and its change from payments. Three kinds,
 * from the most certain:
 *
 * - **One address** (`BitcoinWatchAccount`, or a `BitcoinAccount`, from the chain client): matched by its script.
 * - **An account's extended public key** (`wallet.extendedPublicKey("m/84'/0'/0'")`, or a signer's xpub): each key the
 *   PSBT names at a receiving or change path below it is derived here (the engine's public derivation) and checked
 *   against the coin's script, so change cannot be faked.
 * - **A wallet's master fingerprint** (and an account path, if known): keys the PSBT names under it are taken at the
 *   PSBT's word, checked only to pay the coin's script. Change found this way carries `bitcoin.UNVERIFIED_CHANGE`.
 */
export type BitcoinSigningAccount =
  | Pick<BitcoinWatchAccount, 'addressType' | 'scriptPubKey'>
  | {
      readonly extendedKey: ExtendedPublicKey
      /** The master key's fingerprint, which the PSBT's derivations name. */
      readonly fingerprint: number
      /** The extended key's own path: `m/84'/0'/0'`, or `m/86'/0'/0'` for Taproot. */
      readonly path: string
      /** `p2wpkh` or `p2tr`: by the path's purpose unless given (86 is Taproot, anything else P2WPKH). */
      readonly addressType?: BitcoinAccountType
    }
  | {
      readonly fingerprint: number
      /** The account's path (`m/84'/0'/0'`); any path under the fingerprint when absent. */
      readonly path?: string
    }

/** An inscription on one of a coin's sats. */
export type BitcoinInscription = {
  /** Its id, `<txid>i<index>`, when known. */
  readonly id?: string
  /**
   * The sat it is on, counted from the coin's first. When absent, or past the coin's value (it is on the coin, at a sat
   * the indexer misplaced), every sat of the coin is treated as carrying it.
   */
  readonly offset?: bigint | number
}

/** Runes a coin holds. */
export type BitcoinRuneBalance = {
  /** The rune's id, `840000:3`. When absent, every edict counts as moving it. */
  readonly id?: string
  /** Base units, when known. */
  readonly amount?: bigint
}

/** What an app's indexer knows a coin holds. */
export type BitcoinCoinAssets = {
  readonly inscriptions?: readonly BitcoinInscription[]
  readonly runes?: readonly BitcoinRuneBalance[]
}

/** The coin to look up: the chain, the id of the transaction that made it, and its output index. */
export type BitcoinCoinQuery = {readonly chain: ChainRef; readonly txid: string; readonly vout: number}

/**
 * Tells which coins hold inscriptions or runes (from the app's indexer: ord, a marketplace API, its own), so spending
 * one as plain bitcoin is caught. A trust boundary like every resolver: what it answers is believed.
 */
export type BitcoinAssetResolver = {
  readonly assets: (query: BitcoinCoinQuery) => MaybePromise<BitcoinCoinAssets | undefined>
}

/** The message formats `clearSignMessage` shows: BIP-322's simple signature, or the legacy BIP-137 one. */
export type BitcoinMessageFormat = 'bip322' | 'legacy'

/**
 * What `clearSignPsbt` and `clearSignMessage` take besides the payload: the core's `signer` (an address, shown as
 * `self`) and `resolvers`, and Bitcoin's own.
 */
export type BitcoinClearSignOptions = ClearSignOptions & {
  /** The accounts that sign: one, or several (P2WPKH and Taproot, of one wallet or more). See `BitcoinSigningAccount`. */
  readonly accounts?: BitcoinSigningAccount | readonly BitcoinSigningAccount[]
  /**
   * Coins holding inscriptions or runes: a resolver, or the coins as a record keyed `txid:vout`. Spending one into the
   * fee or to someone else is `ASSET_OWNERSHIP_TRANSFER`.
   */
  readonly assets?: BitcoinAssetResolver | Readonly<Record<string, BitcoinCoinAssets>>
  /** Which test network the adapter's `testnet` is, for the chain's CAIP-2 id. `testnet4` unless given. */
  readonly testnet?: BitcoinTestnet
  /** The best block's height, to tell whether a lock time by height has passed. */
  readonly tipHeight?: number
  /** `HIGH_FEE` above this many satoshis per virtual byte. 500 unless given. */
  readonly maxFeeRate?: number
  /**
   * `HIGH_FEE` when the fee is more than this percentage of the amount sent (of what moves, when nothing is sent to
   * others) and above 10,000 satoshis. 10 unless given.
   */
  readonly maxFeePercent?: number
  /** `HIGH_FEE` above this many satoshis, whatever the size. 1,000,000 (0.01 BTC) unless given. */
  readonly maxFee?: bigint
  /** `clearSignMessage`: the address the message is signed for (the `signer` unless given). */
  readonly address?: string
  /** `clearSignMessage`: the signature format. `bip322` unless given. */
  readonly format?: BitcoinMessageFormat
}

/** The members of the chain client this package calls: a `BitcoinChain` of any id is one. */
export type BitcoinClearSignChain = Pick<
  BitcoinChain<string>,
  | 'addressFromPublicKey'
  | 'decodePsbt'
  | 'derivePublic'
  | 'dustThreshold'
  | 'finalizePsbt'
  | 'network'
  | 'validateAddress'
>

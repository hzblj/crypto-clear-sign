import type {BitcoinAccountType, BitcoinKeyOrigin, BitcoinTaprootKeyOrigin} from '@hzblj/crypto-bitcoin'
import {ClearSignError} from '@hzblj/crypto-clear-sign'
import type {ExtendedPublicKey} from '@hzblj/nitro-crypto/adapter'

import {equalBytes} from './bytes'
import type {BitcoinClearSignChain, BitcoinClearSignOptions, BitcoinSigningAccount} from './options'

/** Whose a coin or an output is, as far as the accounts given can tell. */
export type Ownership = {
  readonly own: boolean
  /** Matched by script, or by a key derived here: not the PSBT's word. */
  readonly verified: boolean
  /** The derivation path that made it the signer's, when one did. */
  readonly path?: string
  /** 0 for a receiving address, 1 for change, below an account; absent for one address. */
  readonly branch?: 0 | 1
  /** The PSBT names a key at one of the accounts' paths that is not the key there: it lies about whose this is. */
  readonly falseClaim: boolean
}

type Account =
  | {readonly kind: 'script'; readonly scriptPubKey: Uint8Array}
  | {
      readonly kind: 'xpub'
      readonly extendedKey: ExtendedPublicKey
      readonly fingerprint: number
      readonly path: string
      readonly type: BitcoinAccountType
    }
  | {readonly kind: 'fingerprint'; readonly fingerprint: number; readonly path?: string}

const PATH = /^m(\/\d+['h]?)*$/

const invalid = (message: string) => new ClearSignError('INVALID_ARGUMENT', message)

const checkPath = (path: unknown): string => {
  if (typeof path !== 'string' || !PATH.test(path)) {
    throw invalid("An account's path is `m` and indexes, each with ' when hardened.")
  }

  return path.replaceAll('h', "'")
}

const checkFingerprint = (fingerprint: unknown): number => {
  if (
    typeof fingerprint !== 'number' ||
    !Number.isInteger(fingerprint) ||
    fingerprint < 0 ||
    fingerprint > 0xffffffff
  ) {
    throw invalid('A fingerprint is a 32-bit unsigned integer.')
  }

  return fingerprint
}

const readAccount = (account: BitcoinSigningAccount): Account => {
  if (typeof account !== 'object' || account === null) {
    throw invalid("An account is an address's account, an extended key with its origin, or a fingerprint.")
  }

  if ('scriptPubKey' in account) {
    if (!(account.scriptPubKey instanceof Uint8Array) || account.scriptPubKey.length === 0) {
      throw invalid("An account's scriptPubKey is the script its address is paid with.")
    }

    return {kind: 'script', scriptPubKey: account.scriptPubKey}
  }

  const fingerprint = checkFingerprint(account.fingerprint)

  if ('extendedKey' in account) {
    const path = checkPath(account.path)
    const type = account.addressType ?? (path.startsWith("m/86'/") ? 'p2tr' : 'p2wpkh')

    if (type !== 'p2wpkh' && type !== 'p2tr') {
      throw invalid("An account's address type is p2wpkh or p2tr.")
    }

    if (!(account.extendedKey?.publicKey instanceof Uint8Array)) {
      throw invalid('An extended key has its public key and chain code.')
    }

    return {extendedKey: account.extendedKey, fingerprint, kind: 'xpub', path, type}
  }

  return {fingerprint, kind: 'fingerprint', path: account.path === undefined ? undefined : checkPath(account.path)}
}

/** `<account>/<0 or 1>/<index>`: the branch and index of `path` below `accountPath`, when it is one of its addresses. */
const below = (path: string, accountPath: string): {branch: 0 | 1; index: number} | undefined => {
  if (!path.startsWith(`${accountPath}/`)) {
    return undefined
  }

  const [branch, index, ...rest] = path.slice(accountPath.length + 1).split('/')

  if (rest.length > 0 || (branch !== '0' && branch !== '1') || index === undefined || !/^\d+$/.test(index)) {
    return undefined
  }

  return {branch: branch === '0' ? 0 : 1, index: Number(index)}
}

const NOT_OWN: Ownership = Object.freeze({falseClaim: false, own: false, verified: false})

/**
 * Tells the signer's coins and outputs from others', by the accounts given (and the core's `signer` address).
 * `known` is `false` when there are none: then nothing is anyone's, and the review says what it cannot tell.
 */
export const createOwnership = (
  chain: BitcoinClearSignChain,
  given: BitcoinClearSignOptions['accounts'],
  signer: string | undefined
) => {
  const accounts: Account[] = (given === undefined ? [] : Array.isArray(given) ? given : [given]).map(readAccount)

  if (signer !== undefined) {
    const validation = typeof signer === 'string' ? chain.validateAddress(signer) : undefined

    if (!validation?.valid) {
      throw invalid("The signer is an address of the chain client's network.")
    }

    accounts.push({kind: 'script', scriptPubKey: validation.scriptPubKey})
  }

  const addressOf = (publicKey: Uint8Array, type: BitcoinAccountType) => {
    try {
      return chain.addressFromPublicKey(publicKey, type)
    } catch {
      return undefined
    }
  }

  const derive = (key: ExtendedPublicKey, branch: number, index: number) => {
    try {
      return chain.derivePublic(key, `m/${branch}/${index}`).publicKey
    } catch {
      return undefined
    }
  }

  const of = (
    script: Uint8Array | undefined,
    address: string | undefined,
    derivations: readonly BitcoinKeyOrigin[],
    taprootDerivations: readonly BitcoinTaprootKeyOrigin[]
  ): Ownership => {
    let falseClaim = false
    // The keys a PSBT names for a script, as the type of account that would pay it: BIP-86 key paths only for Taproot.
    const named = [
      ...derivations.map(origin => ({origin, type: 'p2wpkh' as const})),
      ...taprootDerivations
        .filter(origin => origin.leafHashes.length === 0)
        .map(origin => ({origin, type: 'p2tr' as const})),
    ]

    for (const account of accounts) {
      if (account.kind === 'script') {
        if (script !== undefined && equalBytes(script, account.scriptPubKey)) {
          return {falseClaim, own: true, verified: true}
        }

        continue
      }

      for (const {origin, type} of named) {
        if (origin.fingerprint !== account.fingerprint) {
          continue
        }

        const place = account.path === undefined ? undefined : below(origin.path, account.path)

        if (account.kind === 'xpub') {
          if (place === undefined || type !== account.type) {
            continue
          }

          const derived = derive(account.extendedKey, place.branch, place.index)

          if (derived !== undefined) {
            const key = type === 'p2tr' ? derived.subarray(1) : derived

            if (!equalBytes(key, origin.publicKey)) {
              falseClaim = true
              continue
            }

            if (address !== undefined && addressOf(derived, type) === address) {
              return {branch: place.branch, falseClaim, own: true, path: origin.path, verified: true}
            }

            continue
          }
          // An engine without public derivation: the PSBT's word, as for a fingerprint.
        } else if (account.path !== undefined && place === undefined) {
          continue
        }

        if (address !== undefined && addressOf(origin.publicKey, type) === address) {
          return {branch: place?.branch, falseClaim, own: true, path: origin.path, verified: false}
        }
      }
    }

    return falseClaim ? {...NOT_OWN, falseClaim} : NOT_OWN
  }

  return {known: accounts.length > 0, of}
}

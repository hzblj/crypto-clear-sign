import {type ChainRef, ClearSignError} from '@hzblj/crypto-clear-sign'
import type {SolanaChain, SolanaCluster} from '@hzblj/crypto-solana'
import {isCryptoError} from '@hzblj/nitro-crypto/adapter'

/**
 * What the `clearSign*` functions call on the chain client: `crypto.chains.solana` has all of it. Typed as a `Pick`,
 * so a test or an app can hand in exactly these.
 */
export type SolanaClearSignChain = Pick<
  SolanaChain<string>,
  | 'associatedTokenAddress'
  | 'cluster'
  | 'decodeMessage'
  | 'decodeOffchainMessage'
  | 'decodeTransaction'
  | 'validateAddress'
>

/** Each cluster's CAIP-2 chain id (its genesis hash, cut to 32 characters): what resolvers key tokens and names by. */
export const SOLANA_CHAIN_IDS: Readonly<Record<SolanaCluster, string>> = Object.freeze({
  devnet: 'solana:EtWTRABZaYq6iMfeYKouRu166VL2xqa1',
  'mainnet-beta': 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  testnet: 'solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z',
})

const NAMES: Readonly<Record<SolanaCluster, string>> = {
  devnet: 'Solana devnet',
  'mainnet-beta': 'Solana',
  testnet: 'Solana testnet',
}

/** The chain of a result, from the client's cluster; the names are the adapter's defaults. */
export const chainRef = (chain: Pick<SolanaClearSignChain, 'cluster'>): ChainRef => {
  const cluster = chain.cluster

  if (typeof cluster !== 'string' || !Object.hasOwn(SOLANA_CHAIN_IDS, cluster)) {
    throw new ClearSignError('INVALID_ARGUMENT', 'The chain client is for a cluster this package does not know.')
  }

  return {family: 'solana', id: SOLANA_CHAIN_IDS[cluster], name: NAMES[cluster]}
}

/** Whether `address` is a Solana address, by the chain's own rules (the canonical Base58 of 32 bytes). */
export const isAddress = (chain: Pick<SolanaClearSignChain, 'validateAddress'>, address: unknown): address is string =>
  typeof address === 'string' && chain.validateAddress(address).valid

/** The message's version byte, past a wire transaction's signatures: `undefined` when it cannot be found. */
const versionByte = (payload: Uint8Array, wire: boolean): number | undefined => {
  let offset = 0

  if (wire) {
    let count = 0

    for (let index = 0; index < 3; index++) {
      const byte = payload[offset++]

      if (byte === undefined) {
        return undefined
      }

      count |= (byte & 0x7f) << (index * 7)

      if ((byte & 0x80) === 0) {
        break
      }
    }

    offset += count * 64
  }

  return payload[offset]
}

/**
 * Runs an adapter's read of what is to be signed, its refusals as `ClearSignError`s with the adapter's error as the
 * cause: a message version the adapter does not read (v1 and later) is `UNSUPPORTED`, anything else it refuses is
 * `INVALID_INPUT`. Messages never quote the payload.
 */
export const readPayload = <Value>(
  run: () => Value,
  what: string,
  message?: {readonly payload: Uint8Array; readonly wire: boolean}
): Value => {
  try {
    return run()
  } catch (error) {
    if (!isCryptoError(error)) {
      throw error
    }

    const version = message === undefined ? undefined : versionByte(message.payload, message.wire)

    if (version !== undefined && version > 0x80) {
      throw new ClearSignError('UNSUPPORTED', 'Only legacy and v0 Solana messages are read.', {cause: error})
    }

    throw new ClearSignError('INVALID_INPUT', `The ${what} could not be read.`, {cause: error})
  }
}

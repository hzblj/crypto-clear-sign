import assert from 'node:assert/strict'

import {
  actionAt,
  type ClearSigning,
  type ClearSigningAction,
  type Field,
  findField,
  isClearSignError,
  type NameInfo,
  type TokenInfo,
  type Warning,
} from '@hzblj/crypto-clear-sign'
import {type EthereumChain, type EthereumTransactionRequest, ethereumAdapter, type Hex} from '@hzblj/crypto-ethereum'
import {createTestCryptoEngine} from '@hzblj/nitro-crypto/testing'
import {encodeFunctionData, parseAbiItem} from 'viem'

import {clearSignTransaction, type EthereumClearSignOptions} from '../src'

const chains = new Map<number, EthereumChain<string>>()

/** The chain client for `chainId`, on the WebAssembly engine (Ethereum mainnet unless told). */
export const chainOf = (chainId = 1, name?: string): EthereumChain<string> => {
  const known = chains.get(chainId)

  if (known !== undefined) {
    return known
  }

  const id = `evm${chainId}`
  const crypto = createTestCryptoEngine({adapters: [ethereumAdapter({chainId, id, name: name ?? `Chain ${chainId}`})]})
  const chain = (crypto.chains as Record<string, EthereumChain<string>>)[id] as EthereumChain<string>
  chains.set(chainId, chain)

  return chain
}

export const mainnet = chainOf(1, 'Ethereum')
export const sepolia = chainOf(11155111, 'Sepolia')

export const SIGNER = '0x1111111111111111111111111111111111111111'
export const OTHER = '0x2222222222222222222222222222222222222222'
export const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
export const DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F'
export const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
export const UNISWAP_ROUTER = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45'
export const UNKNOWN_TOKEN = '0x9999999999999999999999999999999999999999'
export const NFT = '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D'

/** 2026-10-27T12:00:00Z: every test's now. */
export const NOW = Date.UTC(2026, 9, 27, 12)
export const NOW_SECONDS = BigInt(NOW / 1000)
export const DAY = 86_400n

export const clock = {now: () => NOW}

/** An EIP-1559 request with the fee fields filled. */
export const request = (fields: Partial<EthereumTransactionRequest> & {readonly to: string | null}) =>
  ({
    gas: 100_000n,
    maxFeePerGas: 20_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
    nonce: 7,
    ...fields,
  }) as EthereumTransactionRequest

/** A names resolver that knows `entries`, answering synchronously or not. */
export const names = (entries: Readonly<Record<string, NameInfo>>, async = false) => ({
  name: ({address}: {readonly address: string}) => {
    const answer = entries[address.toLowerCase()]

    return async ? Promise.resolve(answer) : answer
  },
})

/** A token resolver that knows `entries`. */
export const tokens = (entries: Readonly<Record<string, TokenInfo>>, async = false) => ({
  token: ({address}: {readonly address: string}) => {
    const answer = entries[address.toLowerCase()]

    return async ? Promise.resolve(answer) : answer
  },
})

export const throwing = {
  name: () => {
    throw new Error('offline')
  },
  token: () => Promise.reject(new Error('offline')),
}

export const codes = (result: {readonly warnings: readonly Warning[]}) => result.warnings.map(entry => entry.code)

/** The warning of `code`, which must be there once. */
export const only = (result: ClearSigning, code: string): Warning => {
  const found = result.warnings.filter(entry => entry.code === code)
  assert.equal(found.length, 1, `exactly one ${code}, got ${codes(result).join(', ')}`)

  return found[0] as Warning
}

export const field = (action: ClearSigningAction, id: string): Field => {
  const found = findField(action, id)
  assert.ok(found, `field ${id}`)

  return found
}

export const fieldOf = <Kind extends Field['kind']>(action: ClearSigningAction, id: string, kind: Kind) => {
  const found = field(action, id)
  assert.equal(found.kind, kind, `field ${id} is ${kind}`)

  return found as Extract<Field, {readonly kind: Kind}>
}

/** Call data for a human-readable signature, encoded by viem (an independent encoder). */
export const encode = (signature: string, args: readonly unknown[] = []): Hex =>
  encodeFunctionData({abi: [parseAbiItem(`function ${signature}`)], args} as never)

/** Options on the fixed clock, signed by `SIGNER`, with `extra` merged (resolvers too). */
export const options = (extra: EthereumClearSignOptions = {}): EthereumClearSignOptions => ({
  signer: SIGNER,
  ...extra,
  resolvers: {clock, ...extra.resolvers},
})

/** A call on mainnet (an EIP-1559 request), described with `options(extra)`. */
export const call = (
  to: string,
  data: Hex,
  extra: EthereumClearSignOptions = {},
  fields: Partial<EthereumTransactionRequest> = {}
): Promise<ClearSigning> => clearSignTransaction(mainnet, request({data, to, ...fields}), options(extra))

/** The action at `path`, which must be there. */
export const at = (result: ClearSigning, path: readonly number[]): ClearSigningAction => {
  const found = actionAt(result, path)
  assert.ok(found, `action ${path.join('.')}`)

  return found
}

/** Warnings as `[code, severity, path, fields]`, sorted: the model, not the words. */
export const shape = (result: ClearSigning) =>
  result.warnings
    .map(entry => [entry.code, entry.severity, entry.action.join('.'), [...(entry.fields ?? [])].join(',')].join(' '))
    .sort()

/** Rejects with a `ClearSignError` of `code`. */
export const rejects = (run: () => Promise<unknown>, code: Parameters<typeof isClearSignError>[1]) =>
  assert.rejects(run, error => isClearSignError(error, code))

/** Seconds from now, as a uint for call data or typed data. */
export const inSeconds = (seconds: bigint) => NOW_SECONDS + seconds

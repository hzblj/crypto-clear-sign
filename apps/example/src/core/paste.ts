import {ClearSignError} from '@hzblj/crypto-clear-sign'
import {createIdlResolver} from '@hzblj/crypto-clear-sign-solana'
import type {Hex, TypedDataDefinition} from '@hzblj/crypto-ethereum'

import {base64Decode, base64Encode, hexDecode, hexEncode, looksLikeHex} from '../utils'
import type {ChainId} from './chains'
import type {ReviewContext, ReviewKind, ReviewRequest} from './review'
import {demoVaultIdl} from './samples/solana'
import type {SampleEnv} from './samples/types'

/** What each chain's Paste tab can read, in the order it offers them. */
export const PASTE_KINDS = {
  bitcoin: ['psbt', 'message'],
  ethereum: ['transaction', 'typed-data', 'message', 'authorization'],
  solana: ['transaction', 'message'],
} as const satisfies {readonly [Id in ChainId]: readonly ReviewKind[]}

export type PasteKind<Chain extends ChainId = ChainId> = (typeof PASTE_KINDS)[Chain][number]

/** How a message's text is read: as it is, or as the bytes it encodes. Bytes are always hex or Base64, by their look. */
export const MESSAGE_FORMATS = ['text', 'hex', 'base64'] as const

export type MessageFormat = (typeof MESSAGE_FORMATS)[number]

/** Text that is not what it says is the app's `INVALID_INPUT`, as a chain package says of bytes it cannot read. */
const invalid = (message: string) => new ClearSignError('INVALID_INPUT', message)

const bytesOf = (text: string): Uint8Array => {
  const bytes = looksLikeHex(text) ? hexDecode(text) : base64Decode(text)

  if (bytes === undefined || bytes.length === 0) {
    throw invalid('The text is neither hex nor Base64.')
  }

  return bytes
}

/** Ethereum writes bytes as hex, and only as hex. */
const hexOf = (text: string): Hex => {
  const bytes = hexDecode(text)

  if (bytes === undefined || bytes.length === 0) {
    throw invalid('The text is not hex.')
  }

  return hexEncode(bytes) as Hex
}

const messageBytes = (text: string, format: MessageFormat): string | Uint8Array => {
  if (format === 'text') {
    return text
  }

  const bytes = format === 'hex' ? hexDecode(text) : base64Decode(text)

  if (bytes === undefined) {
    throw invalid(format === 'hex' ? 'The text is not hex.' : 'The text is not Base64.')
  }

  return bytes
}

const json = (text: string): Record<string, unknown> => {
  try {
    const value: unknown = JSON.parse(text)

    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw invalid('The JSON is not an object.')
    }

    return value as Record<string, unknown>
  } catch (error) {
    throw error instanceof ClearSignError ? error : invalid('The text is not JSON.')
  }
}

/** An EIP-7702 authorization as JSON: `{"address": "0x…", "nonce": 7, "chainId": 1}`, `chainId` optional. */
const authorization = (text: string) => {
  const {address, chainId, nonce} = json(text)
  const integer = (value: unknown) =>
    (typeof value === 'number' && Number.isSafeInteger(value)) || (typeof value === 'string' && /^\d+$/.test(value))

  if (typeof address !== 'string' || !integer(nonce) || (chainId !== undefined && !integer(chainId))) {
    throw invalid('An authorization is {"address", "nonce", "chainId"?}, the numbers whole.')
  }

  return {
    address,
    nonce: BigInt(nonce as number | string),
    ...(chainId === undefined ? {} : {chainId: Number(chainId)}),
  }
}

/**
 * Pasted text as a request for `chain`: Ethereum transactions as hex, Solana transactions and PSBTs as hex or Base64
 * (by their look), typed data and
 * authorizations as JSON, messages as text or the bytes `format` says. Text that does not read is a `ClearSignError`
 * (`INVALID_INPUT`), as the chain package's own refusals are.
 */
export const parsePaste = (
  chain: ChainId,
  kind: PasteKind,
  text: string,
  format: MessageFormat = 'text'
): ReviewRequest => {
  const trimmed = format === 'text' && kind === 'message' ? text : text.trim()

  if (trimmed.trim() === '') {
    throw invalid('There is nothing to read.')
  }

  switch (`${chain}:${kind}`) {
    case 'ethereum:transaction':
      return {chain: 'ethereum', kind: 'transaction', payload: hexOf(trimmed)}
    case 'ethereum:typed-data':
      return {chain: 'ethereum', kind: 'typed-data', payload: json(trimmed) as TypedDataDefinition}
    case 'ethereum:message':
      return {chain: 'ethereum', kind: 'message', payload: messageBytes(trimmed, format)}
    case 'ethereum:authorization':
      return {chain: 'ethereum', kind: 'authorization', payload: authorization(trimmed)}
    case 'solana:transaction':
      return {chain: 'solana', kind: 'transaction', payload: bytesOf(trimmed)}
    case 'solana:message':
      return {chain: 'solana', kind: 'message', payload: messageBytes(trimmed, format)}
    case 'bitcoin:psbt':
      return {chain: 'bitcoin', kind: 'psbt', payload: bytesOf(trimmed)}
    case 'bitcoin:message': {
      const message = messageBytes(trimmed, format)

      if (typeof message !== 'string') {
        throw invalid('A Bitcoin message is pasted as text.')
      }

      return {chain: 'bitcoin', kind: 'message', payload: message}
    }
    default:
      throw new ClearSignError('UNSUPPORTED', 'This chain does not sign that kind of payload.')
  }
}

/** JSON that keeps `bigint`s, as decimal strings: how typed data and authorizations travel. */
const stringify = (value: unknown) =>
  JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? item.toString() : item), 2)

/**
 * A request as the text a dApp would hand over, and the format a message's bytes are written in: what the Paste tab
 * reads back, and what a review's "Raw" section shows as the payload. Transactions are hex on Ethereum and Base64 on
 * Solana, PSBTs Base64, as each ecosystem writes them.
 */
export const pasteTextOf = (request: ReviewRequest): {readonly text: string; readonly format: MessageFormat} => {
  const {payload} = request

  if (typeof payload === 'string') {
    return {format: 'text', text: payload}
  }

  if (payload instanceof Uint8Array) {
    return request.chain === 'ethereum'
      ? {format: 'hex', text: hexEncode(payload)}
      : {format: 'base64', text: base64Encode(payload)}
  }

  return {format: 'text', text: stringify(payload)}
}

const PAYLOAD_LABELS = {authorization: 'JSON', psbt: 'Base64', 'typed-data': 'JSON'} as const

/** What was signed as a review's Raw section shows it: the text a dApp would hand over, and what kind of text. */
export const payloadOf = (request: ReviewRequest): {readonly label: string; readonly text: string} => {
  const {format, text} = pasteTextOf(request)

  switch (request.kind) {
    case 'message':
      return {label: format === 'text' ? 'text' : format === 'hex' ? 'hex' : 'Base64', text}
    case 'transaction':
      return {label: request.chain === 'ethereum' ? 'hex' : 'Base64', text}
    default:
      return {label: PAYLOAD_LABELS[request.kind], text}
  }
}

/**
 * What a pasted request comes with: the site the user says asks (a wallet would know it from the connection), and
 * the IDLs the app trusts, here the demo vault's.
 */
export const pasteContext = (env: SampleEnv, origin: string): ReviewContext => ({
  idls: createIdlResolver([{id: 'demo-vault@0.1.0', idl: demoVaultIdl(env), publisher: 'Demo Vault'}]),
  ...(origin.trim() === '' ? {} : {origin: origin.trim()}),
})

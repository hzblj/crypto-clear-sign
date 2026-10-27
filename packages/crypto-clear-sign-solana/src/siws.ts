import type {SolanaCluster} from '@hzblj/crypto-solana'

import {SOLANA_CHAIN_IDS} from './chain'

/** A Sign In With Solana message, as its text lays it out (the wallet standard's `createSignInMessageText`). */
export type SignInMessage = {
  readonly domain: string
  readonly address: string
  readonly statement?: string
  readonly uri?: string
  readonly version?: string
  readonly chainId?: string
  readonly nonce?: string
  readonly issuedAt?: string
  readonly expirationTime?: string
  readonly notBefore?: string
  readonly requestId?: string
  readonly resources?: readonly string[]
}

const HEADER = ' wants you to sign in with your Solana account:'

/** The optional fields, in the one order the format allows, each at most once. */
const FIELDS = [
  ['uri', 'URI: '],
  ['version', 'Version: '],
  ['chainId', 'Chain ID: '],
  ['nonce', 'Nonce: '],
  ['issuedAt', 'Issued At: '],
  ['expirationTime', 'Expiration Time: '],
  ['notBefore', 'Not Before: '],
  ['requestId', 'Request ID: '],
] as const

const RESOURCES = 'Resources:'

/** RFC 3339, as the format's times are written. */
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

const URI = /^[A-Za-z][A-Za-z0-9+.-]*:\S*$/

const isFieldLine = (line: string) => line === RESOURCES || FIELDS.some(([, prefix]) => line.startsWith(prefix))

/** A time of the message in milliseconds, or `undefined` when it is not RFC 3339. */
export const parseTime = (value: string): number | undefined => {
  if (!TIME.test(value)) {
    return undefined
  }

  const time = Date.parse(value)

  return Number.isFinite(time) ? time : undefined
}

/**
 * Reads a Sign In With Solana message: `undefined` when the text is not one (its first line is not
 * `<domain> wants you to sign in with your Solana account:`), `'malformed'` when it starts as one but does not follow
 * the format (fields out of order or twice, a time that is not RFC 3339, a version other than 1, lines that belong to
 * nothing), the message otherwise. The address is not checked here.
 */
export const parseSignIn = (text: string): SignInMessage | 'malformed' | undefined => {
  const lines = text.split('\n')
  const first = lines[0] ?? ''

  if (!first.endsWith(HEADER)) {
    return undefined
  }

  const domain = first.slice(0, -HEADER.length)
  const address = lines[1]

  if (domain === '' || /\s/.test(domain) || address === undefined || address === '') {
    return 'malformed'
  }

  while (lines.length > 2 && lines[lines.length - 1] === '') {
    lines.pop()
  }

  const message: {-readonly [Key in keyof SignInMessage]: SignInMessage[Key]} = {address, domain}
  let index = 2

  if (index < lines.length) {
    if (lines[index] !== '') {
      return 'malformed'
    }

    index += 1
    const line = lines[index]

    if (line !== undefined && !isFieldLine(line)) {
      message.statement = line
      index += 1

      if (index < lines.length) {
        if (lines[index] !== '') {
          return 'malformed'
        }

        index += 1
      }
    }
  }

  let next = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''

    if (line === RESOURCES) {
      const resources = lines.slice(index + 1)

      if (!resources.every(resource => resource.startsWith('- ') && resource.length > 2)) {
        return 'malformed'
      }

      message.resources = resources.map(resource => resource.slice(2))
      index = lines.length
      break
    }

    const position = FIELDS.findIndex(([, prefix], at) => at >= next && line.startsWith(prefix))
    const field = FIELDS[position]

    if (field === undefined || line.length === field[1].length) {
      return 'malformed'
    }

    message[field[0]] = line.slice(field[1].length)
    next = position + 1
    index += 1
  }

  const times = [message.issuedAt, message.expirationTime, message.notBefore]

  if (
    (message.version !== undefined && message.version !== '1') ||
    (message.uri !== undefined && !URI.test(message.uri)) ||
    times.some(time => time !== undefined && parseTime(time) === undefined)
  ) {
    return 'malformed'
  }

  return message
}

/** The clusters a message's chain id may name: the format's names, the wallet standard's, and CAIP-2. */
const CHAIN_IDS: Readonly<Record<string, SolanaCluster>> = {
  devnet: 'devnet',
  mainnet: 'mainnet-beta',
  'mainnet-beta': 'mainnet-beta',
  'solana:devnet': 'devnet',
  'solana:mainnet': 'mainnet-beta',
  'solana:testnet': 'testnet',
  testnet: 'testnet',
  [SOLANA_CHAIN_IDS.devnet]: 'devnet',
  [SOLANA_CHAIN_IDS['mainnet-beta']]: 'mainnet-beta',
  [SOLANA_CHAIN_IDS.testnet]: 'testnet',
}

/** The cluster a chain id names, or `undefined` for one this package does not know (localnet, another chain). */
export const clusterOf = (chainId: string): SolanaCluster | undefined =>
  Object.hasOwn(CHAIN_IDS, chainId) ? CHAIN_IDS[chainId] : undefined

const DEFAULT_PORTS: Readonly<Record<string, string>> = {http: ':80', https: ':443'}

/**
 * The host (and port) of an origin, a URL or a bare authority, lowercased, without user info or a scheme's default
 * port: what a sign-in message's domain is compared by. No `URL`, which React Native does not fully have.
 */
export const hostOf = (value: string): string => {
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)/.exec(value)
  const scheme = match?.[1]?.toLowerCase()
  const authority = (match?.[2] ?? value).replace(/^[^@]*@/, '').toLowerCase()
  const port = scheme === undefined ? undefined : DEFAULT_PORTS[scheme]

  return port !== undefined && authority.endsWith(port) ? authority.slice(0, -port.length) : authority
}

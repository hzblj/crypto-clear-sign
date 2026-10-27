import {
  type AddressField,
  ClearSignError,
  type ClearSigning,
  createClearSigning,
  createResolverContext,
  dateTimeField,
  type Field,
  hasHiddenCharacters,
  INTENTS,
  LABELS,
  listField,
  type ResolverContext,
  rawField,
  SUMMARIES,
  text,
  textField,
  WARNINGS,
  type WarningInput,
  warning,
} from '@hzblj/crypto-clear-sign'

import {decodeUtf8} from './bytes'
import {BITCOIN_TEXTS, BITCOIN_WARNINGS} from './catalogs'
import {chainRef} from './chain'
import type {BitcoinClearSignChain, BitcoinClearSignOptions} from './options'

const LABEL = BITCOIN_TEXTS.label

/** Hex of 16 bytes or more, with or without `0x`: a hash or a blob, not words. */
const HEX = /^(?:0x)?(?:[0-9a-f]{2}){16,}$/i

/** Whether text has a control character (Unicode's Cc: C0, DEL and C1) other than tab and line breaks: bytes, not words. */
const hasControls = (words: string) =>
  [...words].some(character => {
    const point = character.codePointAt(0) ?? 0

    return (point < 0x20 && point !== 0x09 && point !== 0x0a && point !== 0x0d) || (point >= 0x7f && point <= 0x9f)
  })

/** Bytes as the text they are, or `undefined` when they are not UTF-8 or read as control characters. */
const textOf = (bytes: Uint8Array) => {
  const words = decodeUtf8(bytes)

  return words === undefined || hasControls(words) ? undefined : words
}

/**
 * The networks an address's prefix says it is for: Bech32's human-readable part (`bc`, `tb`, `bcrt`), or Base58Check's
 * first character (`1` and `3` on mainnet, `m`, `n` and `2` on every test network). `undefined` when it says nothing.
 */
const networksOf = (address: string): readonly string[] | undefined => {
  const hrp = /^(bc|tb|bcrt)1[02-9ac-hj-np-z]{6,87}$/i.exec(address)?.[1]?.toLowerCase()

  if (hrp !== undefined) {
    return hrp === 'bc' ? ['mainnet'] : hrp === 'tb' ? ['testnet', 'signet'] : ['regtest']
  }

  if (!/^[1-9A-HJ-NP-Za-km-z]{26,35}$/.test(address)) {
    return undefined
  }

  return /^[13]/.test(address) ? ['mainnet'] : /^[mn2]/.test(address) ? ['testnet', 'signet', 'regtest'] : undefined
}

/** Whether an address the client refuses is one of another network, by its prefix. */
const isOtherNetwork = (address: string, network: string) => {
  const networks = networksOf(address)

  return networks !== undefined && !networks.includes(network)
}

const checkAddress = (chain: BitcoinClearSignChain, address: string) => {
  if (typeof address !== 'string' || chain.validateAddress(address).valid) {
    return
  }

  throw isOtherNetwork(address, chain.network.name)
    ? new ClearSignError('CHAIN_MISMATCH', 'The address is of another Bitcoin network.')
    : new ClearSignError('INVALID_ARGUMENT', "The address is not one of the chain client's network.")
}

type SignIn = {
  readonly domain: string
  readonly address: string
  readonly statement?: string
  readonly fields: ReadonlyMap<string, string>
  readonly resources: readonly string[]
}

const SIGN_IN_HEADER = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(\S+) wants you to sign in with your Bitcoin account:$/
const SIGN_IN_FIELD = /^(URI|Version|Chain ID|Nonce|Issued At|Expiration Time|Not Before|Request ID): (.*)$/

/**
 * A sign-in message in the form CAIP-122 (Sign-In With X) gives Bitcoin, EIP-4361's text for the `bip122`
 * namespace: `<domain> wants you to sign in with your Bitcoin account:`, the address, a statement, then `URI:`,
 * `Version:`, `Chain ID:`, `Nonce:`, `Issued At:` and the optional fields. `undefined` for anything else, or for text
 * that starts like one and then does not follow the form.
 */
const parseSignIn = (words: string): SignIn | undefined => {
  const lines = words.split('\n')
  const domain = SIGN_IN_HEADER.exec(lines[0] ?? '')?.[1]
  const address = lines[1] ?? ''

  if (domain === undefined || !/^\S+$/.test(address) || lines[2] !== '') {
    return undefined
  }

  let index = 3
  const statement: string[] = []

  while (index < lines.length && !(lines[index] ?? '').startsWith('URI: ')) {
    statement.push(lines[index] ?? '')
    index++
  }

  const fields = new Map<string, string>()
  const resources: string[] = []

  for (; index < lines.length; index++) {
    const line = lines[index] ?? ''
    const field = SIGN_IN_FIELD.exec(line)

    if (field !== null && !fields.has(field[1] ?? '') && resources.length === 0) {
      fields.set(field[1] ?? '', field[2] ?? '')
    } else if (line === 'Resources:' && resources.length === 0 && fields.has('URI')) {
      resources.push('')
    } else if (line.startsWith('- ') && resources.length > 0) {
      resources.push(line.slice(2))
    } else {
      return undefined
    }
  }

  const said = statement.filter(line => line !== '')

  if (!fields.has('URI') || said.length > 1) {
    return undefined
  }

  return {address, domain, fields, resources: resources.slice(1), statement: said[0]}
}

/** A moment of a sign-in message (RFC 3339) as a field, or as text when it does not read as one. */
const moment = (id: string, label: Field['label'], value: string, now: number): Field => {
  const time = /^\d{4}-\d{2}-\d{2}T/.test(value) ? Date.parse(value) : Number.NaN

  return Number.isFinite(time) ? dateTimeField({id, label, now, value: time}) : textField({id, label, value})
}

const describeSignIn = async (
  signIn: SignIn,
  words: string,
  signing: string | undefined,
  context: ResolverContext,
  chain: BitcoinClearSignChain,
  testnet: BitcoinClearSignOptions['testnet']
) => {
  const ref = chainRef(chain, testnet)
  const chainId = signIn.fields.get('Chain ID')

  if (chainId !== undefined && chainId !== ref.id && `bip122:${chainId}` !== ref.id) {
    throw new ClearSignError('CHAIN_MISMATCH', 'The sign-in message is for another chain.')
  }

  const account = await context.address({id: 'account', label: LABELS.account, value: signIn.address})
  const fields: Field[] = [
    textField({id: 'domain', label: LABELS.domain, value: signIn.domain}),
    account,
    ...(signIn.statement === undefined
      ? []
      : [textField({id: 'statement', label: LABELS.statement, value: signIn.statement})]),
  ]
  const optional = (key: string, make: (value: string) => Field) => {
    const value = signIn.fields.get(key)

    if (value !== undefined) {
      fields.push(make(value))
    }
  }

  optional('URI', value => textField({id: 'uri', label: LABELS.uri, value}))
  optional('Chain ID', value => textField({id: 'network', label: LABELS.network, secondary: true, value}))
  optional('Nonce', value => textField({id: 'nonce', label: LABELS.nonce, secondary: true, value}))
  optional('Issued At', value => moment('issuedAt', LABELS.issuedAt, value, context.now))
  optional('Expiration Time', value => moment('expiry', LABELS.expiry, value, context.now))
  optional('Not Before', value => moment('notBefore', LABELS.notBefore, value, context.now))
  optional('Request ID', value => textField({id: 'requestId', label: LABEL.requestId, secondary: true, value}))
  optional('Version', value => textField({id: 'version', label: LABEL.version, secondary: true, value}))

  if (signIn.resources.length > 0) {
    fields.push(
      listField({
        id: 'resources',
        items: signIn.resources.map((value, index) =>
          textField({id: `resource-${index}`, label: LABEL.resources, value})
        ),
        label: LABEL.resources,
      })
    )
  }

  fields.push(textField({id: 'message', label: LABELS.message, secondary: true, value: words}))

  const warnings: WarningInput[] = []
  const hidden = fields.filter(
    field => field.kind === 'text' && field.id !== undefined && hasHiddenCharacters(field.value)
  )

  if (hidden.length > 0 || hasHiddenCharacters(words)) {
    warnings.push(
      warning(WARNINGS.HIDDEN_CHARACTERS, {fields: [...new Set(['message', ...hidden.map(field => field.id ?? '')])]})
    )
  }

  if (signing !== undefined && signing !== signIn.address) {
    warnings.push(warning(BITCOIN_WARNINGS.SIGN_IN_MISMATCH, {fields: ['account']}))
  }

  const expiry = fields.find(field => field.id === 'expiry')

  if (expiry?.kind === 'datetime' && expiry.expired) {
    warnings.push(warning(WARNINGS.EXPIRED, {fields: ['expiry']}))
  }

  return {
    fields,
    intent: INTENTS.signIn,
    source: {decoder: 'caip122', kind: 'builtin'} as const,
    summary: text(SUMMARIES.signIn, {domain: signIn.domain}),
    warnings,
  }
}

/**
 * A message a BIP-322 (or legacy BIP-137) signature would sign, for the address `options.address` (the `signer`
 * unless given): its text and the address with its relation to the user. Text with hidden characters is
 * `HIDDEN_CHARACTERS`; bytes that are not UTF-8 (or decode to control characters), and text that is only hex, are
 * `BLIND_SIGNING`. A sign-in message
 * in CAIP-122's Bitcoin form is `intent.signIn`, its fields read (domain, account, statement, URI, nonce, times), with
 * `bitcoin.SIGN_IN_MISMATCH` when it names another account than the one signing and `EXPIRED` past its expiry.
 *
 * Throws `ClearSignError`: `INVALID_INPUT` for a message that is neither text nor bytes, `CHAIN_MISMATCH` for an
 * address of another network or a sign-in message for another chain, `INVALID_ARGUMENT` for another option out of
 * range.
 *
 * ```ts
 * const result = await clearSignMessage(crypto.chains.bitcoin, 'Hello', {address: account.address})
 * result.intent.code // 'intent.signMessage'
 * ```
 */
export const clearSignMessage = async (
  chain: BitcoinClearSignChain,
  message: string | Uint8Array,
  options: BitcoinClearSignOptions = {}
): Promise<ClearSigning> => {
  const ref = chainRef(chain, options.testnet)
  const format = options.format ?? 'bip322'

  if (format !== 'bip322' && format !== 'legacy') {
    throw new ClearSignError('INVALID_ARGUMENT', 'format is bip322 or legacy.')
  }

  const address = options.address ?? options.signer

  if (address !== undefined) {
    checkAddress(chain, address)
  }

  if (options.signer !== undefined) {
    checkAddress(chain, options.signer)
  }

  const words = typeof message === 'string' ? message : message instanceof Uint8Array ? textOf(message) : undefined

  if (typeof message !== 'string' && !(message instanceof Uint8Array)) {
    throw new ClearSignError('INVALID_INPUT', 'A message is text or bytes.')
  }

  const context = createResolverContext({chain: ref, resolvers: options.resolvers, signer: options.signer ?? address})
  const signIn = words === undefined ? undefined : parseSignIn(words)
  const described =
    signIn === undefined || words === undefined
      ? undefined
      : await describeSignIn(signIn, words, address, context, chain, options.testnet)
  const account: AddressField[] =
    address === undefined || signIn !== undefined
      ? []
      : [await context.address({id: 'signer', label: LABELS.account, value: address})]
  const formatField = textField({
    id: 'format',
    label: LABEL.format,
    secondary: true,
    value: format === 'bip322' ? 'BIP-322' : 'BIP-137 (legacy)',
  })
  const source = {decoder: format === 'bip322' ? 'bip322' : 'bip137', kind: 'builtin'} as const
  const resolverWarnings = context.warnings()

  if (described !== undefined) {
    return createClearSigning({
      ...described,
      chain: ref,
      fields: [...described.fields, formatField],
      kind: 'message',
      warnings: [...described.warnings, ...resolverWarnings],
    })
  }

  if (words === undefined) {
    return createClearSigning({
      chain: ref,
      fields: [...account, formatField],
      intent: INTENTS.signMessage,
      kind: 'message',
      raw: [rawField({id: 'message', label: LABELS.message, value: message as Uint8Array})],
      source: {kind: 'unknown'},
      summary: text(SUMMARIES.blind),
      warnings: [warning(WARNINGS.BLIND_SIGNING, {fields: ['message']}), ...resolverWarnings],
    })
  }

  const warnings: WarningInput[] = []

  if (hasHiddenCharacters(words)) {
    warnings.push(warning(WARNINGS.HIDDEN_CHARACTERS, {fields: ['message']}))
  }

  if (HEX.test(words.trim())) {
    warnings.push(warning(WARNINGS.BLIND_SIGNING, {fields: ['message']}))
  }

  return createClearSigning({
    chain: ref,
    fields: [textField({id: 'message', label: LABELS.message, value: words}), ...account, formatField],
    intent: INTENTS.signMessage,
    kind: 'message',
    source,
    summary: text(SUMMARIES.signMessage),
    warnings: [...warnings, ...resolverWarnings],
  })
}

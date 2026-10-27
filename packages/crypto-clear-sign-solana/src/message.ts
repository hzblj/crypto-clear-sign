import {
  type AddressField,
  ClearSignError,
  type ClearSigning,
  checkDeadline,
  createClearSigning,
  createResolverContext,
  type DisplayText,
  dateTimeField,
  type Field,
  hasHiddenCharacters,
  INTENTS,
  LABELS,
  listField,
  numberField,
  rawField,
  SUMMARIES,
  text,
  textField,
  WARNINGS,
  type WarningInput,
  warning,
} from '@hzblj/crypto-clear-sign'
import {bytes as byteTools, isCryptoError, utf8} from '@hzblj/nitro-crypto/adapter'

import {SOLANA_TEXTS, SOLANA_WARNINGS} from './catalogs'
import {chainRef, isAddress, readPayload, type SolanaClearSignChain} from './chain'
import {checkOptions, type SolanaClearSignOptions} from './options'
import {decodeText} from './reader'
import {describeAddress, type SolanaResolverContext} from './scope'
import {clusterOf, hostOf, parseSignIn, parseTime, type SignInMessage} from './siws'
import {withBuiltinTokens} from './tokens'

/** `\xffsolana offchain`: every off-chain message starts with it, and no transaction can. */
const OFFCHAIN_DOMAIN = byteTools.concat(Uint8Array.of(0xff), utf8.encode('solana offchain'))

type Described = {
  readonly intent: DisplayText
  readonly summary?: DisplayText
  readonly fields: readonly Field[]
  readonly warnings: readonly WarningInput[]
  readonly decoder: string
}

/** `HIDDEN_CHARACTERS` on a field when its text hides anything. */
const hidden = (value: string | undefined, id: string) =>
  value !== undefined && hasHiddenCharacters(value) ? [warning(WARNINGS.HIDDEN_CHARACTERS, {fields: [id]})] : []

/** A Sign In With Solana message's fields, and what does not match: the site, the account, the network, the times. */
const describeSignIn = async (
  chain: SolanaClearSignChain,
  context: SolanaResolverContext,
  options: SolanaClearSignOptions,
  message: SignInMessage
): Promise<Described> => {
  const fields: Field[] = [textField({id: 'domain', label: LABELS.domain, value: message.domain})]
  const warnings: WarningInput[] = [...hidden(message.domain, 'domain')]
  const account = await describeAddress(context, message.address, {id: 'account', label: LABELS.account})
  fields.push(account)

  if (options.origin !== undefined && hostOf(options.origin) !== hostOf(message.domain)) {
    warnings.push(warning(SOLANA_WARNINGS.SIGN_IN_DOMAIN_MISMATCH, {fields: ['domain']}))
  }

  if (options.signer !== undefined && options.signer !== message.address) {
    warnings.push(warning(SOLANA_WARNINGS.SIGN_IN_ADDRESS_MISMATCH, {fields: ['account']}))
  }

  const optional = (id: string, label: DisplayText, value: string | undefined, secondary = false) => {
    if (value !== undefined) {
      fields.push(textField({id, label, secondary, value}))
      warnings.push(...hidden(value, id))
    }
  }

  optional('statement', LABELS.statement, message.statement)
  optional('uri', LABELS.uri, message.uri)
  optional('network', LABELS.network, message.chainId)

  if (message.chainId !== undefined && clusterOf(message.chainId) !== chain.cluster) {
    warnings.push(warning(SOLANA_WARNINGS.SIGN_IN_CHAIN_MISMATCH, {fields: ['network']}))
  }

  // Only the expiration time is a deadline: an issue time or a start in the past has not "expired".
  const moment = (id: string, label: DisplayText, value: string | undefined, deadline: boolean) => {
    const time = value === undefined ? undefined : parseTime(value)

    if (time === undefined) {
      return undefined
    }

    const field = dateTimeField({id, label, now: deadline ? context.now : time, value: time})
    fields.push(field)

    return field
  }

  moment('issuedAt', LABELS.issuedAt, message.issuedAt, false)
  const expiry = moment('expiry', LABELS.expiry, message.expirationTime, true)
  moment('notBefore', LABELS.notBefore, message.notBefore, false)

  if (expiry !== undefined) {
    const verdict = checkDeadline(expiry, {now: context.now})

    if (verdict !== undefined) {
      warnings.push(warning(WARNINGS[verdict], {fields: ['expiry']}))
    }
  }

  optional('nonce', LABELS.nonce, message.nonce, true)
  optional('requestId', SOLANA_TEXTS.label.requestId, message.requestId, true)
  optional('version', SOLANA_TEXTS.label.version, message.version, true)

  if (message.resources !== undefined) {
    const items = message.resources.map((resource, index) => {
      warnings.push(...hidden(resource, `resource-${index}`))

      return textField({
        id: `resource-${index}`,
        label: text(SOLANA_TEXTS.label.item, {index: index + 1}),
        value: resource,
      })
    })
    fields.push(listField({id: 'resources', items, label: SOLANA_TEXTS.label.resources}))
  }

  return {
    decoder: 'siws',
    fields,
    intent: INTENTS.signIn,
    summary: text(SUMMARIES.signIn, {domain: message.domain}),
    warnings,
  }
}

/** Text to sign: a Sign In With Solana message when it is one, plain text otherwise. */
const describeText = async (
  chain: SolanaClearSignChain,
  context: SolanaResolverContext,
  options: SolanaClearSignOptions,
  value: string
): Promise<Described> => {
  const signIn = parseSignIn(value)

  if (signIn !== undefined && signIn !== 'malformed' && isAddress(chain, signIn.address)) {
    return describeSignIn(chain, context, options, signIn)
  }

  return {
    decoder: 'text',
    fields: [textField({id: 'message', label: LABELS.message, value})],
    intent: INTENTS.signMessage,
    summary: SUMMARIES.signMessage,
    warnings: [
      ...hidden(value, 'message'),
      ...(signIn === undefined ? [] : [warning(SOLANA_WARNINGS.SIGN_IN_MALFORMED, {fields: ['message']})]),
    ],
  }
}

const startsWith = (data: Uint8Array, prefix: Uint8Array) =>
  data.length >= prefix.length && prefix.every((byte, index) => data[index] === byte)

/**
 * Reads a message to sign into a `ClearSigning`:
 *
 * - **Off-chain messages** (bytes that start with `\xffsolana offchain`, read with the adapter, versions 0 and 1):
 *   kind `offchain-message`, with the text, the signers (`solana.OTHER_SIGNERS` when others must sign too) and, for
 *   version 0, the application and the format.
 * - **Sign In With Solana**: kind `message`, intent `intent.signIn`, every field of the message, with
 *   `solana.SIGN_IN_DOMAIN_MISMATCH` when its domain is not `options.origin`, `solana.SIGN_IN_ADDRESS_MISMATCH` when
 *   its address is not the signer, `solana.SIGN_IN_CHAIN_MISMATCH` when it is for another cluster, and `EXPIRED` or
 *   `LONG_LIVED` by its expiration time. Text that starts as one and breaks the format is plain text with
 *   `solana.SIGN_IN_MALFORMED`.
 * - **Text** (UTF-8): kind `message`, `HIDDEN_CHARACTERS` when it hides anything.
 * - **Anything else**: raw, with `BLIND_SIGNING`; and bytes that read as a transaction message, with
 *   `solana.MESSAGE_IS_TRANSACTION`, since signing them signs the transaction.
 *
 * A string is signed as its UTF-8 bytes. Throws `INVALID_INPUT` for an off-chain message the adapter refuses, and
 * `INVALID_ARGUMENT` for an option out of range or a `signer` an off-chain message does not name.
 */
export const clearSignMessage = async (
  chain: SolanaClearSignChain,
  message: Uint8Array | string,
  options: SolanaClearSignOptions = {}
): Promise<ClearSigning> => {
  checkOptions(chain, options)

  if (typeof message !== 'string' && !(message instanceof Uint8Array)) {
    throw new ClearSignError('INVALID_ARGUMENT', 'A message is text or bytes.')
  }

  const ref = chainRef(chain)
  const bytes = typeof message === 'string' ? utf8.encode(message) : message
  const resolvers = options.resolvers ?? {}
  const context = createResolverContext({
    chain: ref,
    resolvers: {...resolvers, tokens: withBuiltinTokens(resolvers.tokens, options.builtinTokens !== false)},
    signer: options.signer,
  })
  const {signer} = options

  if (startsWith(bytes, OFFCHAIN_DOMAIN)) {
    const decoded = readPayload(() => chain.decodeOffchainMessage(bytes), 'off-chain message')

    if (signer !== undefined && !decoded.signers.includes(signer)) {
      throw new ClearSignError('INVALID_ARGUMENT', 'The signer is not one of the off-chain message`s signers.')
    }

    const described = await describeText(chain, context, options, decoded.text)
    const signers: AddressField[] = []

    for (const [index, entry] of decoded.signers.entries()) {
      signers.push(await describeAddress(context, entry, {id: `signer-${index}`, label: SOLANA_TEXTS.label.signer}))
    }

    const others = decoded.signers.filter(entry => entry !== signer).length

    return createClearSigning({
      chain: ref,
      fields: [
        ...described.fields,
        listField({id: 'signers', items: signers, label: SOLANA_TEXTS.label.signers}),
        ...(decoded.version === 0
          ? [
              await describeAddress(context, decoded.applicationDomain, {
                id: 'applicationDomain',
                label: SOLANA_TEXTS.label.applicationDomain,
              }),
              textField({id: 'format', label: SOLANA_TEXTS.label.format, secondary: true, value: decoded.format}),
            ]
          : []),
        numberField({
          id: 'offchainVersion',
          label: SOLANA_TEXTS.label.version,
          secondary: true,
          value: decoded.version,
        }),
      ],
      intent: described.intent,
      kind: 'offchain-message',
      source: {decoder: 'offchain-message', kind: 'builtin'},
      summary: described.summary,
      warnings: [
        ...described.warnings,
        ...(others > (signer === undefined ? 1 : 0)
          ? [warning(SOLANA_WARNINGS.OTHER_SIGNERS, {fields: ['signers']})]
          : []),
        ...context.warnings(),
      ],
    })
  }

  // Bytes that read as a transaction message are never a message to show as text. Signing them signs that
  // transaction when the signer is one of its signers (or may be, without a signer): a transaction in disguise.
  let transaction: 'signs' | 'other' | undefined

  try {
    const signers = chain.decodeMessage(bytes).signers
    transaction = signer === undefined || signers.includes(signer) ? 'signs' : 'other'
  } catch (error) {
    if (!isCryptoError(error)) {
      throw error
    }
  }

  const value = transaction === undefined ? decodeText(bytes) : undefined

  if (value === undefined) {
    return createClearSigning({
      chain: ref,
      intent: INTENTS.signMessage,
      kind: 'message',
      raw: [rawField({id: 'data', label: LABELS.data, value: bytes})],
      source: {kind: 'unknown'},
      summary: SUMMARIES.blind,
      warnings: [
        transaction === 'signs'
          ? warning(SOLANA_WARNINGS.MESSAGE_IS_TRANSACTION, {fields: ['data']})
          : warning(WARNINGS.BLIND_SIGNING, {fields: ['data']}),
        ...context.warnings(),
      ],
    })
  }

  const described = await describeText(chain, context, options, value)

  return createClearSigning({
    chain: ref,
    fields: described.fields,
    intent: described.intent,
    kind: 'message',
    source: {decoder: described.decoder, kind: 'builtin'},
    summary: described.summary,
    warnings: [...described.warnings, ...context.warnings()],
  })
}

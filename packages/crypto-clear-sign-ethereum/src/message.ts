import {
  type ActionInput,
  ClearSignError,
  type ClearSigning,
  createClearSigning,
  dateTimeField,
  type Field,
  hasHiddenCharacters,
  INTENTS,
  LABELS,
  listField,
  MAX_TIME,
  numberField,
  rawField,
  SUMMARIES,
  text,
  textField,
  WARNINGS,
  type WarningInput,
  warning,
} from '@hzblj/crypto-clear-sign'
import type {SignableMessage} from '@hzblj/crypto-ethereum'
import {bytes, utf8} from '@hzblj/nitro-crypto/adapter'

import {pointInTime} from './calls/time'
import {ETHEREUM_TEXTS, ETHEREUM_WARNINGS} from './catalogs'
import {createEnv, type Env, type EthereumClearSignChain, type EthereumClearSignOptions, lower} from './env'
import {hostOf, looksLikeSignIn, parseSignIn, type SignInMessage} from './siwe'

/** Text worth reading as text: valid UTF-8 that decodes back to the same bytes, and no control characters but line breaks and tabs. */
const asText = (message: Uint8Array): string | undefined => {
  const words = utf8.decode(message)

  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what marks bytes as binary.
  return bytes.equal(utf8.encode(words), message) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(words)
    ? words
    : undefined
}

/** Text that is hex, or a bare 32-byte hash: what a dApp asks to sign when it wants a signature over something else. */
const looksLikeHex = (words: string) => /^0x[0-9a-fA-F]+$/.test(words.trim()) || /^[0-9a-fA-F]{64}$/.test(words.trim())

/** An RFC 3339 moment as a field: a deadline (`expires`, marked expired once past) or a point in time. */
const moment = (env: Env, id: string, label: Field['label'], value: string, expires: boolean): Field | undefined => {
  const time = Date.parse(value)

  if (!Number.isFinite(time) || Math.abs(time) > MAX_TIME) {
    return undefined
  }

  return expires ? dateTimeField({id, label, now: env.context.now, value: time}) : pointInTime({id, label, value: time})
}

const signIn = async (env: Env, message: SignInMessage): Promise<ActionInput> => {
  const warnings: WarningInput[] = []
  const hidden = (id: string, value: string | undefined) => {
    if (value !== undefined && hasHiddenCharacters(value)) {
      warnings.push(warning(WARNINGS.HIDDEN_CHARACTERS, {fields: [id]}))
    }
  }
  const account = await env.address({id: 'account', label: LABELS.account, value: message.address})
  const expiry =
    message.expirationTime === undefined
      ? undefined
      : moment(env, 'expiry', LABELS.expiry, message.expirationTime, true)
  const notBefore =
    message.notBefore === undefined ? undefined : moment(env, 'notBefore', LABELS.notBefore, message.notBefore, false)
  const issuedAt = moment(env, 'issuedAt', LABELS.issuedAt, message.issuedAt, false)
  const domainHost = hostOf(message.domain)
  const uriHost = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(message.uri) ? hostOf(message.uri) : undefined
  const fields: Field[] = [
    textField({
      id: 'domain',
      label: LABELS.domain,
      value: message.scheme === undefined ? message.domain : `${message.scheme}://${message.domain}`,
    }),
    account,
    ...(message.statement === undefined
      ? []
      : [textField({id: 'statement', label: LABELS.statement, value: message.statement})]),
    textField({id: 'uri', label: LABELS.uri, value: message.uri}),
    numberField({id: 'chainId', label: ETHEREUM_TEXTS.label.chain, value: message.chainId}),
    ...(issuedAt === undefined ? [] : [issuedAt]),
    ...(expiry === undefined ? [] : [expiry]),
    ...(notBefore === undefined ? [] : [notBefore]),
    textField({id: 'nonce', label: LABELS.nonce, secondary: true, value: message.nonce}),
    textField({id: 'version', label: ETHEREUM_TEXTS.label.version, secondary: true, value: message.version}),
    ...(message.requestId === undefined
      ? []
      : [
          textField({
            id: 'requestId',
            label: ETHEREUM_TEXTS.label.requestId,
            secondary: true,
            value: message.requestId,
          }),
        ]),
    ...(message.resources.length === 0
      ? []
      : [
          listField({
            id: 'resources',
            items: message.resources.map((resource, index) =>
              textField({
                id: `resource-${index}`,
                label: text(ETHEREUM_TEXTS.label.item, {index: index + 1}),
                value: resource,
              })
            ),
            label: ETHEREUM_TEXTS.label.resources,
          }),
        ]),
  ]

  hidden('domain', message.domain)
  hidden('uri', message.uri)
  hidden('statement', message.statement)
  hidden('requestId', message.requestId)
  message.resources.forEach((resource, index) => hidden(`resource-${index}`, resource))

  if (env.options.signer !== undefined && lower(env.options.signer) !== lower(message.address)) {
    warnings.push(warning(ETHEREUM_WARNINGS.SIGN_IN_ACCOUNT_MISMATCH, {fields: ['account']}))
  }

  if (message.chainId !== env.chainId) {
    warnings.push(warning(ETHEREUM_WARNINGS.SIGN_IN_CHAIN_MISMATCH, {fields: ['chainId']}))
  }

  if (env.options.origin !== undefined && hostOf(env.options.origin) !== domainHost) {
    warnings.push(warning(ETHEREUM_WARNINGS.SIGN_IN_DOMAIN_MISMATCH, {fields: ['domain']}))
  }

  if (uriHost !== undefined && uriHost !== domainHost) {
    warnings.push(warning(ETHEREUM_WARNINGS.SIGN_IN_URI_MISMATCH, {fields: ['uri']}))
  }

  if (expiry?.kind === 'datetime' && expiry.expired) {
    warnings.push(warning(WARNINGS.EXPIRED, {fields: ['expiry']}))
  }

  return {
    fields,
    intent: INTENTS.signIn,
    source: {decoder: 'siwe', kind: 'builtin'},
    summary: text(SUMMARIES.signIn, {domain: message.domain}),
    warnings,
  }
}

/**
 * Describes a message for `personal_sign` (EIP-191), as the adapter signs it: text (signed as its UTF-8 bytes) or
 * bytes. A Sign-In with Ethereum request (ERC-4361) is `intent.signIn`, its fields read and checked: the account must
 * be the signer, the chain the client's, the URI on the domain, and the domain the site asking (`origin`, when given);
 * each mismatch is a warning, an expiry past `EXPIRED`. Text that is hex or a bare hash, and bytes that are not text,
 * are `BLIND_SIGNING`; hidden characters are `HIDDEN_CHARACTERS`.
 *
 * ```ts
 * const result = await clearSignMessage(crypto.chains.ethereum, siweMessage, {origin: 'example.com', signer})
 * result.intent.code // 'intent.signIn'
 * ```
 */
export const clearSignMessage = async (
  chain: EthereumClearSignChain,
  message: SignableMessage,
  options: EthereumClearSignOptions = {}
): Promise<ClearSigning> => {
  if (typeof message !== 'string' && !(message instanceof Uint8Array)) {
    throw new ClearSignError('INVALID_INPUT', 'A message is text or bytes.')
  }

  const env = createEnv(chain, options)
  const words = typeof message === 'string' ? message : asText(message)
  let action: ActionInput

  if (words === undefined) {
    action = {
      intent: INTENTS.signMessage,
      raw: [rawField({id: 'data', label: LABELS.data, value: message as Uint8Array})],
      source: {kind: 'unknown'},
      summary: text(SUMMARIES.blind),
      warnings: [warning(WARNINGS.BLIND_SIGNING)],
    }
  } else {
    const parsed = looksLikeSignIn(words) ? parseSignIn(words) : undefined

    if (parsed !== undefined) {
      action = await signIn(env, parsed)
    } else {
      const hexLike = looksLikeHex(words)
      action = {
        fields: [textField({id: 'message', label: LABELS.message, value: words})],
        intent: INTENTS.signMessage,
        source: {decoder: 'eip191', kind: 'builtin'},
        summary: hexLike ? text(SUMMARIES.blind) : text(SUMMARIES.signMessage),
        warnings: [
          ...(hexLike ? [warning(WARNINGS.BLIND_SIGNING, {fields: ['message']})] : []),
          ...(looksLikeSignIn(words) ? [warning(ETHEREUM_WARNINGS.MALFORMED_SIGN_IN, {fields: ['message']})] : []),
          ...(hasHiddenCharacters(words) ? [warning(WARNINGS.HIDDEN_CHARACTERS, {fields: ['message']})] : []),
        ],
      }
    }
  }

  return createClearSigning({
    ...action,
    chain: env.ref,
    kind: 'message',
    warnings: [...(action.warnings ?? []), ...env.warnings()],
  })
}

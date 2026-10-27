import {invalid} from './errors'
import type {ActionPath} from './model'
import {isSeverity, type Severity} from './risk'
import {interpolate, isNamespace, type TextParams} from './text'

/** A warning as a package defines it: its stable code, the severity it has unless a call says otherwise, and English. */
export type WarningDefinition<Code extends string = string> = {
  readonly code: Code
  readonly severity: Severity
  /** The English default. It may name `{params}`, which `warning` fills. */
  readonly message: string
}

/**
 * The warnings every chain shares. Codes are stable: a UI may branch on them and translate by them; a new one is a
 * minor release, and a code is never reused for another meaning.
 */
export const WARNINGS = Object.freeze({
  /** The signature binds to no chain (typed data without a chain id, an EIP-7702 authorization for chain 0). */
  ALL_CHAINS: {
    code: 'ALL_CHAINS',
    message: 'This signature is valid on every chain, not only this one.',
    severity: 'high',
  },
  /**
   * Control passes to someone else: an approval for all of a collection, a token account's or a program's authority,
   * an account's owner, an account's code (EIP-7702).
   */
  ASSET_OWNERSHIP_TRANSFER: {
    code: 'ASSET_OWNERSHIP_TRANSFER',
    message:
      'This hands control of assets, or of the account itself, to someone else, who needs no further signature to use it.',
    severity: 'critical',
  },
  /** Nothing here could read what is signed: bytes that are not text, a payload no decoder or descriptor knows. */
  BLIND_SIGNING: {
    code: 'BLIND_SIGNING',
    message: 'What this signs could not be read. Sign it only if you trust where it came from.',
    severity: 'high',
  },
  /** A deadline or an expiry already past, by the clock the result was made with. */
  EXPIRED: {
    code: 'EXPIRED',
    message: 'Its deadline has passed, so it should fail or be refused. A request like this is unusual.',
    severity: 'low',
  },
  /** Text (a message, a label) with control, invisible or direction-changing characters: see `hasHiddenCharacters`. */
  HIDDEN_CHARACTERS: {
    code: 'HIDDEN_CHARACTERS',
    message: 'The text has invisible or direction-changing characters, so it may not read as it is.',
    severity: 'medium',
  },
  /** A fee out of proportion, by the chain package's documented threshold. */
  HIGH_FEE: {
    code: 'HIGH_FEE',
    message: 'The fee is unusually high.',
    severity: 'medium',
  },
  /** A permission or signature valid for longer than `LONG_LIVED_AFTER`, or with no expiry at all. */
  LONG_LIVED: {
    code: 'LONG_LIVED',
    message: 'It stays valid for a long time, or until it is revoked.',
    severity: 'medium',
  },
  /** A resolver threw, or answered with something malformed: what it would have added is missing. */
  RESOLVER_FAILED: {
    code: 'RESOLVER_FAILED',
    message: 'A lookup failed, so some names, tokens or descriptions may be missing.',
    severity: 'info',
  },
  /** A call to a contract or program that no built-in decoder and no descriptor reads. */
  UNKNOWN_CONTRACT_CALL: {
    code: 'UNKNOWN_CONTRACT_CALL',
    message: 'This calls a contract in a way nothing here can read, so what it does is unknown.',
    severity: 'high',
  },
  /** Assets go to an address that is not the signer, one of the user's accounts, a contact or a known contract. */
  UNKNOWN_DESTINATION: {
    code: 'UNKNOWN_DESTINATION',
    message: 'The recipient is not one of your accounts, a contact or a known contract.',
    severity: 'low',
  },
  /** An amount of a token no resolver knows: no symbol, no decimals, so it shows in base units. */
  UNKNOWN_TOKEN: {
    code: 'UNKNOWN_TOKEN',
    message: 'The token is unknown: its symbol and decimals cannot be shown, so the amount is in base units.',
    severity: 'medium',
  },
  /** An approval of the largest amount the protocol can express (or one the chain package treats as such). */
  UNLIMITED_APPROVAL: {
    code: 'UNLIMITED_APPROVAL',
    message: 'The spender can take all of this token you hold, now or later, without asking again.',
    severity: 'critical',
  },
} as const satisfies Record<string, WarningDefinition>)

/** A code of `WARNINGS`. */
export type SharedWarningCode = keyof typeof WARNINGS

/** A chain package's own code, namespaced by its family: `ethereum.DELEGATION`. */
export type ChainWarningCode<Namespace extends string = string> = `${Namespace}.${string}`

/** Any warning code: a shared one, or a chain package's. */
export type WarningCode = SharedWarningCode | ChainWarningCode

/** A warning as a chain package raises it on an action; `createClearSigning` places it. `warning` makes one. */
export type WarningInput<Code extends string = WarningCode> = {
  readonly code: Code
  readonly severity: Severity
  /** English, its params filled. */
  readonly message: string
  readonly params?: TextParams
  /** Ids of the fields of its action it is about, which a UI can highlight. */
  readonly fields?: readonly string[]
}

/** A warning in a result: every one of the whole tree is in `result.warnings`, most serious first. */
export type Warning<Code extends string = WarningCode> = {
  readonly code: Code
  readonly severity: Severity
  /** English, its params filled: show it, or translate by `code` with `params` (`localize`). */
  readonly message: string
  readonly params?: TextParams
  /** Ids of the fields it is about, in the action at `action`; empty when it is about the action as a whole. */
  readonly fields: readonly string[]
  /** The action it was raised on: `[]` for the result itself, `[1]` for its second action, `[1, 0]` below that. */
  readonly action: ActionPath
}

const WARNING_KEY = /^[A-Z][A-Z0-9_]*$/
const CHAIN_WARNING_CODE = /^[a-z][a-z0-9-]*\.[A-Z][A-Z0-9_]*$/

/** Whether `code` is one of the shared codes of `WARNINGS`. */
export const isSharedWarningCode = (code: unknown): code is SharedWarningCode =>
  typeof code === 'string' && Object.hasOwn(WARNINGS, code)

/** Whether `code` is a warning code: a shared one, or a namespaced one (`ethereum.DELEGATION`). */
export const isWarningCode = (code: unknown): code is WarningCode =>
  isSharedWarningCode(code) || (typeof code === 'string' && CHAIN_WARNING_CODE.test(code))

/**
 * A chain package's own warnings, namespaced by its family:
 *
 * ```ts
 * export const ETHEREUM_WARNINGS = defineWarnings('ethereum', {
 *   DELEGATION: {message: 'This lets a contract run code as your account.', severity: 'critical'},
 * }) // ETHEREUM_WARNINGS.DELEGATION.code === 'ethereum.DELEGATION'
 * ```
 *
 * Keys are SCREAMING_SNAKE_CASE. A chain package defines a code of its own only for what no shared code says.
 */
export const defineWarnings = <
  const Namespace extends string,
  const Definitions extends Readonly<Record<string, {readonly severity: Severity; readonly message: string}>>,
>(
  namespace: Namespace,
  definitions: Definitions
): {
  readonly [Key in keyof Definitions & string]: {
    readonly code: `${Namespace}.${Key}`
    readonly severity: Definitions[Key]['severity']
    readonly message: Definitions[Key]['message']
  }
} => {
  if (!isNamespace(namespace)) {
    throw invalid('A namespace is lowercase letters, digits and hyphens, starting with a letter.')
  }

  const entries = Object.entries(definitions).map(([key, {message, severity}]) => {
    if (!WARNING_KEY.test(key) || !isSeverity(severity) || typeof message !== 'string') {
      throw invalid('A warning key is SCREAMING_SNAKE_CASE, with a severity and an English message.')
    }

    return [key, Object.freeze({code: `${namespace}.${key}`, message, severity})] as const
  })

  return Object.freeze(Object.fromEntries(entries)) as never
}

/**
 * A warning to raise on an action, from its definition: `warning(WARNINGS.UNLIMITED_APPROVAL, {fields: ['amount']})`.
 * `params` fill the definition's message (and travel for translations); `message` and `severity` override the
 * definition's, which a chain package does only where its README says why.
 */
export const warning = <Code extends string>(
  definition: WarningDefinition<Code>,
  options: {
    readonly fields?: readonly string[]
    readonly params?: TextParams
    readonly message?: string
    readonly severity?: Severity
  } = {}
): WarningInput<Code> => {
  const {fields, params} = options

  return {
    code: definition.code,
    message: interpolate(options.message ?? definition.message, params),
    severity: options.severity ?? definition.severity,
    ...(fields !== undefined && fields.length > 0 ? {fields: [...fields]} : {}),
    ...(params !== undefined && Object.keys(params).length > 0 ? {params: {...params}} : {}),
  }
}

/**
 * Every failure the packages report, as a `ClearSignError` with a stable `code`. A message says what is wrong and
 * never quotes the input: what is about to be signed can carry addresses, amounts and messages, none of which belongs
 * in a log.
 *
 * Not understanding something is never an error. A call nothing decodes, a token nobody knows, bytes that are not
 * text: each becomes a result with a warning (`UNKNOWN_CONTRACT_CALL`, `UNKNOWN_TOKEN`, `BLIND_SIGNING`), so the user
 * still sees what can be seen. An error means there is nothing that could be signed, or the caller made a mistake.
 */

export const CLEAR_SIGN_ERROR_CODES = [
  /** A caller's mistake: a result that breaks the model, a malformed definition, an option out of range. */
  'INVALID_ARGUMENT',
  /** What is to be signed does not read at all (the chain adapter refused it): nothing to show, and nothing to sign. */
  'INVALID_INPUT',
  /** What is to be signed is bound to another chain than the client's: show nothing, sign nothing. */
  'CHAIN_MISMATCH',
  /** A kind of payload the package does not read, such as a transaction type it was not written for. */
  'UNSUPPORTED',
] as const

export type ClearSignErrorCode = (typeof CLEAR_SIGN_ERROR_CODES)[number]

const DEFAULT_MESSAGES: Record<ClearSignErrorCode, string> = {
  CHAIN_MISMATCH: 'What is to be signed is for another chain.',
  INVALID_ARGUMENT: 'An argument is missing or out of range.',
  INVALID_INPUT: 'What is to be signed could not be read.',
  UNSUPPORTED: 'This kind of payload is not supported.',
}

export class ClearSignError extends Error {
  readonly code: ClearSignErrorCode

  constructor(code: ClearSignErrorCode, message: string = DEFAULT_MESSAGES[code], options?: {cause?: unknown}) {
    super(message, options)
    this.name = 'ClearSignError'
    this.code = code
  }
}

/** Whether `error` is a `ClearSignError`, of `code` when given; narrows `error.code` to it. */
export const isClearSignError = <Code extends ClearSignErrorCode = ClearSignErrorCode>(
  error: unknown,
  code?: Code
): error is ClearSignError & {readonly code: Code} =>
  error instanceof ClearSignError && (code === undefined || error.code === code)

/** An `INVALID_ARGUMENT` error. Internal. */
export const invalid = (message: string) => new ClearSignError('INVALID_ARGUMENT', message)

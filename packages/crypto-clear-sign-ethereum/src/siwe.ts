/** An ERC-4361 (Sign-In with Ethereum) message, as its fields are written. */
export type SignInMessage = {
  /** `example.com`, or `example.com:8080`; with the scheme it was written with, if any. */
  readonly domain: string
  readonly scheme?: string
  readonly address: string
  readonly statement?: string
  readonly uri: string
  readonly version: string
  readonly chainId: number
  readonly nonce: string
  readonly issuedAt: string
  readonly expirationTime?: string
  readonly notBefore?: string
  readonly requestId?: string
  readonly resources: readonly string[]
}

const HEADER = / wants you to sign in with your Ethereum account:$/

/** Whether `message` opens as a sign-in request does: its first line. */
export const looksLikeSignIn = (message: string): boolean => HEADER.test(message.split('\n', 1)[0] ?? '')

const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

const AUTHORITY = /^(?:[A-Za-z0-9._~!$&'()*+,;=%-]+@)?(?:\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)(?::[0-9]{1,5})?$/

const isUri = (value: string) => /^[A-Za-z][A-Za-z0-9+.-]*:[^\s]+$/.test(value)

/**
 * The fields of an ERC-4361 message, or `undefined` when it does not follow the format: the header line, the
 * address, an optional statement, then `URI`, `Version` (1), `Chain ID`, `Nonce` (8 or more letters and digits),
 * `Issued At` (RFC 3339), and optionally `Expiration Time`, `Not Before`, `Request ID` and `Resources`, in that order.
 */
export const parseSignIn = (message: string): SignInMessage | undefined => {
  const lines = message.split('\n')
  const header = /^(?:([A-Za-z][A-Za-z0-9+.-]*):\/\/)?(\S+) wants you to sign in with your Ethereum account:$/.exec(
    lines[0] ?? ''
  )
  const address = lines[1] ?? ''

  if (!header || !AUTHORITY.test(header[2] ?? '') || !/^0x[0-9a-fA-F]{40}$/.test(address) || lines[2] !== '') {
    return undefined
  }

  let at = 3
  let statement: string | undefined

  // A statement sits between two empty lines; without one, the empty line before the URI may be one or two.
  if (lines[at] !== undefined && lines[at] !== '' && !lines[at]?.startsWith('URI: ')) {
    statement = lines[at]
    at++
  }

  while (lines[at] === '') {
    at++
  }

  const take = (prefix: string, optional = false): string | undefined | null => {
    const line = lines[at]

    if (line?.startsWith(prefix)) {
      at++

      return line.slice(prefix.length)
    }

    return optional ? undefined : null
  }

  const uri = take('URI: ')
  const version = take('Version: ')
  const chainId = take('Chain ID: ')
  const nonce = take('Nonce: ')
  const issuedAt = take('Issued At: ')
  const expirationTime = take('Expiration Time: ', true)
  const notBefore = take('Not Before: ', true)
  const requestId = take('Request ID: ', true)
  const resources: string[] = []

  if (lines[at] === 'Resources:') {
    at++

    while (lines[at]?.startsWith('- ')) {
      resources.push((lines[at] ?? '').slice(2))
      at++
    }
  }

  if (
    typeof uri !== 'string' ||
    !isUri(uri) ||
    version !== '1' ||
    typeof chainId !== 'string' ||
    !/^[1-9][0-9]{0,15}$/.test(chainId) ||
    typeof nonce !== 'string' ||
    !/^[A-Za-z0-9]{8,}$/.test(nonce) ||
    typeof issuedAt !== 'string' ||
    !DATE_TIME.test(issuedAt) ||
    (expirationTime !== undefined && (expirationTime === null || !DATE_TIME.test(expirationTime))) ||
    (notBefore !== undefined && (notBefore === null || !DATE_TIME.test(notBefore))) ||
    !resources.every(isUri) ||
    at !== lines.length ||
    (statement !== undefined && statement.includes('\n'))
  ) {
    return undefined
  }

  return {
    address,
    chainId: Number(chainId),
    domain: header[2] ?? '',
    issuedAt,
    nonce,
    resources,
    uri,
    version,
    ...(header[1] === undefined ? {} : {scheme: header[1]}),
    ...(statement === undefined ? {} : {statement}),
    ...(typeof expirationTime === 'string' ? {expirationTime} : {}),
    ...(typeof notBefore === 'string' ? {notBefore} : {}),
    ...(typeof requestId === 'string' ? {requestId} : {}),
  }
}

/** The host of an authority or a URI, lowercase, without user info or port. */
export const hostOf = (value: string): string | undefined => {
  const authority = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#]*)/.exec(value)?.[1] ?? value
  const host = authority.replace(/^[^@]*@/, '').replace(/:[0-9]+$/, '')

  return host === '' ? undefined : host.toLowerCase()
}

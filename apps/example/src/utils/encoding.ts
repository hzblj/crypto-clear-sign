/**
 * Base64 and hex for text people paste: strict about what they accept (whitespace and line breaks aside), so a typo
 * is an error rather than other bytes. `@hzblj/nitro-crypto` has hex; Base64 is here because the engine has none.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const VALUES = new Map(Array.from(ALPHABET, (character, index) => [character, index]))

/** Standard Base64 (RFC 4648), padded. */
export const base64Encode = (bytes: Uint8Array): string => {
  let out = ''

  for (let index = 0; index < bytes.length; index += 3) {
    const [a = 0, b = 0, c = 0] = [bytes[index], bytes[index + 1], bytes[index + 2]]
    const triple = (a << 16) | (b << 8) | c
    const remaining = bytes.length - index
    out += ALPHABET[(triple >> 18) & 63]
    out += ALPHABET[(triple >> 12) & 63]
    out += remaining > 1 ? ALPHABET[(triple >> 6) & 63] : '='
    out += remaining > 2 ? ALPHABET[triple & 63] : '='
  }

  return out
}

/** Standard or URL-safe Base64, padding optional. `undefined` for anything else. */
export const base64Decode = (text: string): Uint8Array | undefined => {
  const clean = text.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')

  if (clean.length % 4 === 1) {
    return undefined
  }

  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let buffer = 0
  let bits = 0
  let length = 0

  for (const character of clean) {
    const value = VALUES.get(character)

    if (value === undefined) {
      return undefined
    }

    buffer = (buffer << 6) | value
    bits += 6

    if (bits >= 8) {
      bits -= 8
      out[length++] = (buffer >> bits) & 0xff
    }
  }

  return out.subarray(0, length)
}

/** Even-length hex, with or without `0x`. `undefined` for anything else. */
export const hexDecode = (text: string): Uint8Array | undefined => {
  const clean = text.replace(/\s+/g, '').replace(/^0x/i, '')

  if (clean.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(clean)) {
    return undefined
  }

  return Uint8Array.from(clean.match(/../g) ?? [], pair => Number.parseInt(pair, 16))
}

export const hexEncode = (bytes: Uint8Array): string =>
  `0x${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`

/** Whether the text reads as hex (a `0x` prefix, or hex digits only): what bytes are taken as before Base64. */
export const looksLikeHex = (text: string) => /^(0x)?[0-9a-f\s]+$/i.test(text.trim())

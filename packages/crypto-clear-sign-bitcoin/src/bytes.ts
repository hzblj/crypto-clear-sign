// Small byte helpers: Base64 for PSBTs given as text, hex, UTF-8, and Bitcoin script instructions (for OP_RETURN data
// and runestones, which the adapter has no reader for).

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const LOOKUP = new Map([...ALPHABET].map((character, index) => [character, index]))

/**
 * Standard Base64 (RFC 4648, `+` and `/`), strict: padding to a multiple of four, no other characters, and no bits
 * set past the last byte. Whitespace around it is ignored. `undefined` for anything else.
 */
export const decodeBase64 = (text: string): Uint8Array | undefined => {
  const trimmed = text.trim()

  if (trimmed.length === 0 || trimmed.length % 4 !== 0) {
    return undefined
  }

  const padding = trimmed.endsWith('==') ? 2 : trimmed.endsWith('=') ? 1 : 0
  const body = trimmed.slice(0, trimmed.length - padding)
  const out = new Uint8Array((body.length * 6) >> 3)
  let buffer = 0
  let bits = 0
  let offset = 0

  for (const character of body) {
    const value = LOOKUP.get(character)

    if (value === undefined) {
      return undefined
    }

    buffer = (buffer << 6) | value
    bits += 6

    if (bits >= 8) {
      bits -= 8
      out[offset++] = (buffer >> bits) & 0xff
    }
  }

  // What is left over is padding bits, which must be zero.
  if ((buffer & ((1 << bits) - 1)) !== 0) {
    return undefined
  }

  return out
}

/** Lowercase hex, without `0x`. */
export const toHex = (bytes: Uint8Array) => {
  let out = ''

  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0')
  }

  return out
}

export const equalBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, index) => byte === b[index])

export const concatBytes = (parts: readonly Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
  let offset = 0

  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }

  return out
}

const UTF8 = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true})

/** `bytes` as text when they are valid UTF-8, else `undefined`. */
export const decodeUtf8 = (bytes: Uint8Array): string | undefined => {
  try {
    return UTF8.decode(bytes)
  } catch {
    return undefined
  }
}

/** One instruction of a script: a push of data, or an opcode. */
export type Instruction = {readonly push: Uint8Array} | {readonly op: number}

export const OP_RETURN = 0x6a

const OP_PUSHDATA1 = 0x4c
const OP_PUSHDATA2 = 0x4d
const OP_PUSHDATA4 = 0x4e

/**
 * A script's instructions, as Bitcoin Core (and rust-bitcoin, which `ord` reads runestones with) step through them:
 * `OP_0` and `OP_PUSHBYTES_1` to `_75`, `OP_PUSHDATA1/2/4` are pushes, minimal or not; everything else is an opcode.
 * `undefined` when a push runs past the end of the script.
 */
export const instructions = (script: Uint8Array): Instruction[] | undefined => {
  const out: Instruction[] = []
  let offset = 0

  while (offset < script.length) {
    const opcode = script[offset++] ?? 0

    if (opcode > OP_PUSHDATA4) {
      out.push({op: opcode})
      continue
    }

    let length = opcode

    if (opcode >= OP_PUSHDATA1) {
      const width = opcode === OP_PUSHDATA1 ? 1 : opcode === OP_PUSHDATA2 ? 2 : 4

      if (offset + width > script.length) {
        return undefined
      }

      length = 0

      for (let index = width - 1; index >= 0; index--) {
        length = length * 256 + (script[offset + index] ?? 0)
      }

      offset += width
    }

    if (length > script.length - offset) {
      return undefined
    }

    out.push({push: script.subarray(offset, offset + length)})
    offset += length
  }

  return out
}

/** Whether a script is `OP_RETURN` data: it starts with `OP_RETURN`, as Bitcoin Core's `IsUnspendable` reads it. */
export const isOpReturn = (script: Uint8Array) => script[0] === OP_RETURN

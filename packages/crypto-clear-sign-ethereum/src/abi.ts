import {hex, utf8} from '@hzblj/nitro-crypto/adapter'

import {keccak256} from './keccak'

/**
 * A Solidity ABI type: what a function's parameters and an EIP-712 struct's members are made of. `bytes` with a
 * `size` is `bytesN`; an `array` with a `length` is `T[N]`.
 */
export type AbiType =
  | {readonly kind: 'uint' | 'int'; readonly bits: number}
  | {readonly kind: 'address' | 'bool' | 'string'}
  | {readonly kind: 'bytes'; readonly size?: number}
  | {readonly kind: 'array'; readonly item: AbiType; readonly length?: number}
  | {readonly kind: 'tuple'; readonly components: readonly AbiParameter[]}

/** A parameter, a tuple's component or a struct's member: its type and, when the source names it, its name. */
export type AbiParameter = {readonly name?: string; readonly type: AbiType}

/**
 * A decoded value, the same tree for call data and typed data: integers as `bigint`, addresses as lowercase hex, bytes
 * as bytes, text with the bytes it was read from, arrays, and tuples (or structs) of named values.
 */
export type AbiValue =
  | {readonly kind: 'uint' | 'int'; readonly bits: number; readonly value: bigint}
  | {readonly kind: 'address'; readonly value: string}
  | {readonly kind: 'bool'; readonly value: boolean}
  | {readonly kind: 'bytes'; readonly size?: number; readonly value: Uint8Array}
  | {readonly kind: 'string'; readonly value: string; readonly bytes: Uint8Array}
  | {readonly kind: 'array'; readonly items: readonly AbiValue[]}
  | {readonly kind: 'tuple'; readonly fields: readonly AbiField[]}

/** A tuple's or struct's member, decoded. */
export type AbiField = {readonly name?: string; readonly value: AbiValue}

/** A function as a signature names it: `transfer(address to,uint256 value)`. */
export type AbiFunction = {
  readonly name: string
  readonly inputs: readonly AbiParameter[]
  /** The canonical signature, types only: `transfer(address,uint256)`. */
  readonly signature: string
  /** `0x` and 8 lowercase hex digits: the first four bytes of Keccak-256 of `signature`. */
  readonly selector: string
}

/** How deep types nest and values are decoded: far beyond real ABIs, short of exhausting the stack. */
export const MAX_ABI_DEPTH = 32

/** How many values one decode may produce, so offsets that point at the same data many times cannot blow it up. */
export const MAX_ABI_VALUES = 20_000

/** The longest fixed array or text a signature may name: past any real ABI. */
const MAX_FIXED_LENGTH = 65_536

const MAX_SIGNATURE_LENGTH = 8192

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

const MODIFIERS = new Set(['indexed', 'calldata', 'memory', 'storage', 'payable'])

/** A failure to read a signature or decode data. Internal: callers turn it into a warning, never a crash. */
export class AbiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AbiError'
  }
}

const fail = (message: string): never => {
  throw new AbiError(message)
}

/** An elementary type's name read: `uint256`, `address`, `bytes32`; `uint` and `int` are read as 256 bits. */
export const elementaryType = (name: string): AbiType | undefined => {
  if (name === 'address' || name === 'bool' || name === 'string') {
    return {kind: name}
  }

  if (name === 'bytes') {
    return {kind: 'bytes'}
  }

  if (name === 'uint' || name === 'int') {
    return {bits: 256, kind: name}
  }

  const integer = /^(u?int)([1-9][0-9]{0,2})$/.exec(name)

  if (integer) {
    const bits = Number(integer[2])

    return bits % 8 === 0 && bits <= 256 ? {bits, kind: integer[1] === 'uint' ? 'uint' : 'int'} : undefined
  }

  const fixed = /^bytes([1-9][0-9]?)$/.exec(name)
  const size = Number(fixed?.[1])

  return fixed && size <= 32 ? {kind: 'bytes', size} : undefined
}

/** A type as the canonical signature writes it: `uint256`, `(address,uint256)[]`. */
export const canonicalType = (type: AbiType): string => {
  switch (type.kind) {
    case 'uint':
    case 'int':
      return `${type.kind}${type.bits}`
    case 'bytes':
      return type.size === undefined ? 'bytes' : `bytes${type.size}`
    case 'array':
      return `${canonicalType(type.item)}[${type.length ?? ''}]`
    case 'tuple':
      return `(${type.components.map(component => canonicalType(component.type)).join(',')})`
    default:
      return type.kind
  }
}

/** Reads a human-readable parameter list, one character at a time: `(address to,(uint256 a,bytes b)[] c)`. */
const parseParameters = (text: string, start: number, depth: number): {params: AbiParameter[]; end: number} => {
  if (depth > MAX_ABI_DEPTH) {
    fail('The signature nests tuples too deep.')
  }

  if (text[start] !== '(') {
    fail('A parameter list starts with "(".')
  }

  const params: AbiParameter[] = []
  let at = start + 1
  const skip = () => {
    while (text[at] === ' ' || text[at] === '\t' || text[at] === '\n') {
      at++
    }
  }
  const word = () => {
    const from = at

    while (at < text.length && /[A-Za-z0-9_$]/.test(text[at] ?? '')) {
      at++
    }

    return text.slice(from, at)
  }

  skip()

  if (text[at] === ')') {
    return {end: at + 1, params}
  }

  for (;;) {
    skip()
    let type: AbiType

    if (text[at] === '(' || text.startsWith('tuple(', at)) {
      if (text[at] !== '(') {
        at += 'tuple'.length
      }

      const inner = parseParameters(text, at, depth + 1)
      type = {components: inner.params, kind: 'tuple'}
      at = inner.end
    } else {
      const name = word()
      type = elementaryType(name) ?? fail('A parameter type is not an ABI type.')
    }

    while (text[at] === '[') {
      const close = text.indexOf(']', at)
      const size = close < 0 ? '' : text.slice(at + 1, close)

      if (close < 0 || !/^(?:[1-9][0-9]{0,5})?$/.test(size)) {
        fail('An array suffix is [] or [N].')
      }

      const length = size === '' ? undefined : Number(size)

      if (length !== undefined && length > MAX_FIXED_LENGTH) {
        fail('A fixed array is too long.')
      }

      type = length === undefined ? {item: type, kind: 'array'} : {item: type, kind: 'array', length}
      at = close + 1
    }

    let name: string | undefined

    for (;;) {
      skip()
      const next = word()

      if (next === '') {
        break
      }

      if (MODIFIERS.has(next) && name === undefined) {
        continue
      }

      if (name !== undefined || !IDENTIFIER.test(next)) {
        fail('A parameter has one type and at most one name.')
      }

      name = next
    }

    params.push(name === undefined ? {type} : {name, type})
    skip()

    if (text[at] === ',') {
      at++
      continue
    }

    if (text[at] === ')') {
      return {end: at + 1, params}
    }

    fail('Parameters are separated by commas and closed by ")".')
  }
}

/** The selector of a canonical signature: `0x` and the first four bytes of its Keccak-256. */
export const selectorOf = (signature: string): string =>
  `0x${hex.encode(keccak256(utf8.encode(signature)).subarray(0, 4))}`

/**
 * A function from a human-readable fragment, with or without parameter names, spaces after commas tolerated:
 * `transfer(address to,uint256 value)`, `swap((address a,uint256 b) desc,bytes data)`, `function approve(address,uint256)`.
 * Throws `AbiError` for anything else.
 */
export const parseFunction = (fragment: string): AbiFunction => {
  if (typeof fragment !== 'string' || fragment.length > MAX_SIGNATURE_LENGTH) {
    fail('A function signature is text of a sane length.')
  }

  const text = fragment.trim().replace(/^function\s+/, '')
  const open = text.indexOf('(')
  const name = text.slice(0, open).trim()

  if (open < 0 || !IDENTIFIER.test(name)) {
    fail('A function signature starts with its name.')
  }

  const {end, params} = parseParameters(text, open, 0)
  const rest = text.slice(end).trim()

  if (rest !== '' && !/^(?:(?:external|public|payable|nonpayable|view|pure)\s*)+$/.test(rest)) {
    fail('Nothing follows a function signature but its mutability.')
  }

  const signature = `${name}(${params.map(param => canonicalType(param.type)).join(',')})`

  return {inputs: params, name, selector: selectorOf(signature), signature}
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** A JSON ABI parameter (`{name, type, components}`), as `contract.abi` in a version 1 descriptor carries it. */
export const jsonParameter = (value: unknown, depth = 0): AbiParameter => {
  if (depth > MAX_ABI_DEPTH || !isRecord(value) || typeof value.type !== 'string') {
    return fail('A JSON ABI parameter has a type.')
  }

  const match = /^(tuple|[a-z0-9]+)((?:\[[0-9]*\])*)$/.exec(value.type)

  if (!match) {
    return fail('A JSON ABI type is an elementary type or a tuple, with array suffixes.')
  }

  let type: AbiType =
    match[1] === 'tuple'
      ? {
          components: (Array.isArray(value.components) ? value.components : fail('A tuple has components.')).map(
            (component: unknown) => jsonParameter(component, depth + 1)
          ),
          kind: 'tuple',
        }
      : (elementaryType(match[1] ?? '') ?? fail('A JSON ABI type is not an ABI type.'))

  for (const suffix of (match[2] ?? '').match(/\[[0-9]*\]/g) ?? []) {
    const size = suffix.slice(1, -1)
    const length = size === '' ? undefined : Number(size)

    if (length !== undefined && (!/^[1-9][0-9]*$/.test(size) || length > MAX_FIXED_LENGTH)) {
      fail('A fixed array has a length from 1 to 65536.')
    }

    type = length === undefined ? {item: type, kind: 'array'} : {item: type, kind: 'array', length}
  }

  const name = typeof value.name === 'string' && IDENTIFIER.test(value.name) ? value.name : undefined

  return name === undefined ? {type} : {name, type}
}

/** The functions of a JSON ABI, with their selectors; entries that are not readable functions are skipped. */
export const jsonFunctions = (abi: unknown): AbiFunction[] => {
  if (!Array.isArray(abi)) {
    return []
  }

  return abi.flatMap((entry: unknown) => {
    if (
      !isRecord(entry) ||
      entry.type !== 'function' ||
      typeof entry.name !== 'string' ||
      !Array.isArray(entry.inputs)
    ) {
      return []
    }

    try {
      const inputs = entry.inputs.map((input: unknown) => jsonParameter(input))
      const signature = `${entry.name}(${inputs.map(input => canonicalType(input.type)).join(',')})`

      return IDENTIFIER.test(entry.name) ? [{inputs, name: entry.name, selector: selectorOf(signature), signature}] : []
    } catch {
      return []
    }
  })
}

const isDynamic = (type: AbiType): boolean =>
  type.kind === 'string' ||
  (type.kind === 'bytes' && type.size === undefined) ||
  (type.kind === 'array' && (type.length === undefined || isDynamic(type.item))) ||
  (type.kind === 'tuple' && type.components.some(component => isDynamic(component.type)))

/** Bytes a type takes in its enclosing head: 32 for a dynamic one (its offset). */
const headSize = (type: AbiType): number => {
  if (isDynamic(type)) {
    return 32
  }

  if (type.kind === 'array') {
    return (type.length ?? 0) * headSize(type.item)
  }

  if (type.kind === 'tuple') {
    return type.components.reduce((sum, component) => sum + headSize(component.type), 0)
  }

  return 32
}

type Budget = {values: number}

const TWO_255 = 1n << 255n
const TWO_256 = 1n << 256n

const word = (data: Uint8Array, at: number): Uint8Array =>
  at >= 0 && at + 32 <= data.length ? data.subarray(at, at + 32) : fail('The data ends before a value it holds.')

const toBigInt = (bytes: Uint8Array): bigint => {
  let value = 0n

  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte)
  }

  return value
}

/** A length or an offset: a word that must fit in the data. */
const position = (data: Uint8Array, at: number): number => {
  const value = toBigInt(word(data, at))

  return value <= BigInt(data.length) ? Number(value) : fail('An offset or a length points past the data.')
}

const decodeValue = (type: AbiType, data: Uint8Array, at: number, depth: number, budget: Budget): AbiValue => {
  budget.values++

  if (depth > MAX_ABI_DEPTH || budget.values > MAX_ABI_VALUES) {
    fail('The data nests or repeats values past the decoding limits.')
  }

  switch (type.kind) {
    case 'uint': {
      const value = toBigInt(word(data, at))

      return value >> BigInt(type.bits) === 0n
        ? {bits: type.bits, kind: 'uint', value}
        : fail('A uint is out of range.')
    }
    case 'int': {
      const raw = toBigInt(word(data, at))
      const value = raw >= TWO_255 ? raw - TWO_256 : raw
      const limit = 1n << BigInt(type.bits - 1)

      return value >= -limit && value < limit ? {bits: type.bits, kind: 'int', value} : fail('An int is out of range.')
    }
    case 'address': {
      const bytes = word(data, at)

      return bytes.subarray(0, 12).every(byte => byte === 0)
        ? {kind: 'address', value: `0x${hex.encode(bytes.subarray(12))}`}
        : fail('An address has bits above its 20 bytes.')
    }
    case 'bool': {
      const value = toBigInt(word(data, at))

      return value <= 1n ? {kind: 'bool', value: value === 1n} : fail('A bool is 0 or 1.')
    }
    case 'bytes': {
      if (type.size !== undefined) {
        const bytes = word(data, at)

        return bytes.subarray(type.size).every(byte => byte === 0)
          ? {kind: 'bytes', size: type.size, value: bytes.slice(0, type.size)}
          : fail('A bytesN has bits past its size.')
      }

      const length = position(data, at)

      return at + 32 + length <= data.length
        ? {kind: 'bytes', value: data.slice(at + 32, at + 32 + length)}
        : fail('Bytes run past the data.')
    }
    case 'string': {
      const length = position(data, at)

      if (at + 32 + length > data.length) {
        fail('A string runs past the data.')
      }

      const bytes = data.slice(at + 32, at + 32 + length)

      return {bytes, kind: 'string', value: utf8.decode(bytes)}
    }
    case 'array': {
      const length = type.length ?? position(data, at)
      const base = type.length === undefined ? at + 32 : at
      const size = headSize(type.item)

      if (length * size > data.length - base) {
        fail('An array is longer than the data that would hold it.')
      }

      return {
        items: decodeSequence(
          Array.from({length}, () => type.item),
          data,
          base,
          depth,
          budget
        ),
        kind: 'array',
      }
    }
    case 'tuple': {
      const values = decodeSequence(
        type.components.map(component => component.type),
        data,
        at,
        depth,
        budget
      )

      return {
        fields: type.components.map((component, index) => ({
          ...(component.name === undefined ? {} : {name: component.name}),
          value: values[index] as AbiValue,
        })),
        kind: 'tuple',
      }
    }
  }
}

/** Values laid out one after another from `base`: static ones in place, dynamic ones at offsets from `base`. */
const decodeSequence = (
  types: readonly AbiType[],
  data: Uint8Array,
  base: number,
  depth: number,
  budget: Budget
): AbiValue[] => {
  let at = base

  return types.map(type => {
    const value = isDynamic(type)
      ? decodeValue(type, data, base + position(data, at), depth + 1, budget)
      : decodeValue(type, data, at, depth + 1, budget)
    at += headSize(type)

    return value
  })
}

/**
 * ABI-decodes `data` as `params`, strictly: every read within the data, integers and addresses without stray high
 * bits, bools 0 or 1, `bytesN` without stray low bits, arrays no longer than their data could hold, nesting and the
 * number of values bounded. Bytes after the encoded values are ignored, as Solidity ignores them. Throws `AbiError`.
 */
export const decodeParameters = (params: readonly AbiParameter[], data: Uint8Array): AbiField[] => {
  const values = decodeSequence(
    params.map(param => param.type),
    data,
    0,
    0,
    {values: 0}
  )

  return params.map((param, index) => ({
    ...(param.name === undefined ? {} : {name: param.name}),
    value: values[index] as AbiValue,
  }))
}

/** A function's arguments from call data that starts with its selector. Throws `AbiError` for anything else. */
export const decodeCall = (fn: AbiFunction, data: Uint8Array): AbiField[] => {
  if (data.length < 4 || `0x${hex.encode(data.subarray(0, 4))}` !== fn.selector) {
    fail('The call data does not start with the function`s selector.')
  }

  return decodeParameters(fn.inputs, data.subarray(4))
}

/** The value of a decoded tuple's member by name, or by position. */
export const member = (fields: readonly AbiField[], key: string | number): AbiValue | undefined =>
  typeof key === 'number' ? fields[key]?.value : fields.find(field => field.name === key)?.value

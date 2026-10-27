import {createReader, type Reader} from '../reader'

/**
 * How far an IDL is followed. An IDL is untrusted input (a registry's, a file's): every bound here keeps a malformed or
 * hostile one from running long, recursing without end or allocating without limit. Past any of them, the IDL does not
 * describe the instruction and it is shown raw.
 */
export const IDL_LIMITS = Object.freeze({
  /** Accounts an instruction may name, groups flattened. */
  accounts: 256,
  /** Arguments an instruction may take. */
  args: 256,
  /** The longest discriminator, in bytes. */
  discriminator: 32,
  /** Nested account groups. */
  groupDepth: 8,
  /** Instructions an IDL may define. */
  instructions: 1024,
  /** The longest name (of an instruction, an account, an argument, a type, a field, a variant), in characters. */
  name: 128,
  /** Types nested while reading one value: options, vectors, structs, aliases, generics. */
  typeDepth: 32,
  /** Types an IDL may define. */
  types: 1024,
  /** Values read from one instruction's data, every element and field counted. */
  values: 1024,
  /** Variants an enum may have (its tag is a byte). */
  variants: 256,
})

/** A value read from instruction data by an IDL type. */
export type IdlValue =
  | {readonly kind: 'integer'; readonly value: bigint; readonly bits: number}
  | {readonly kind: 'float'; readonly value: number}
  | {readonly kind: 'bool'; readonly value: boolean}
  | {readonly kind: 'string'; readonly value: string}
  | {readonly kind: 'bytes'; readonly value: Uint8Array}
  | {readonly kind: 'pubkey'; readonly value: string}
  | {readonly kind: 'none'}
  | {readonly kind: 'list'; readonly items: readonly IdlValue[]}
  | {readonly kind: 'struct'; readonly fields: readonly IdlNamedValue[]}
  | {readonly kind: 'enum'; readonly variant: string; readonly fields: readonly IdlNamedValue[]}

/** A field of a struct or a variant: named, or positional (`name` absent). */
export type IdlNamedValue = {readonly name?: string; readonly value: IdlValue}

/** An account as the IDL names it, groups flattened. */
export type IdlAccount = {
  readonly name: string
  readonly signer: boolean
  readonly writable: boolean
  readonly optional: boolean
  readonly address?: string
}

/** An instruction an IDL describes: its name, accounts, arguments read, and any bytes after them. */
export type IdlMatch = {
  /** The program's name in the IDL's metadata, when it has one. */
  readonly program?: string
  readonly name: string
  readonly accounts: readonly IdlAccount[]
  readonly args: readonly {readonly name: string; readonly value: IdlValue}[]
  readonly rest: Uint8Array
}

/** Thrown inside the interpreter: the IDL is malformed, or does not read the data. Never escapes `matchIdl`. */
class IdlRefused extends Error {}

const refuse = (): never => {
  throw new IdlRefused('refused')
}

type Entries = Readonly<Record<string, unknown>>

const isRecord = (value: unknown): value is Entries =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** An own property only: an IDL's `constructor` or `__proto__` is data, never the object's prototype. */
const own = (record: Entries, key: string): unknown => (Object.hasOwn(record, key) ? record[key] : undefined)

const list = (value: unknown, max: number): readonly unknown[] =>
  Array.isArray(value) && value.length <= max ? value : refuse()

const nameOf = (value: unknown): string =>
  typeof value === 'string' && value.length > 0 && value.length <= IDL_LIMITS.name ? value : refuse()

const flag = (record: Entries, ...keys: string[]) => keys.some(key => own(record, key) === true)

/** An integer type's size in bytes and signedness. */
const INTEGERS: Readonly<Record<string, readonly [1 | 2 | 4 | 8 | 16 | 32, boolean]>> = {
  i8: [1, true],
  i16: [2, true],
  i32: [4, true],
  i64: [8, true],
  i128: [16, true],
  i256: [32, true],
  u8: [1, false],
  u16: [2, false],
  u32: [4, false],
  u64: [8, false],
  u128: [16, false],
  u256: [32, false],
}

/** What a generic parameter is bound to: a type (read where it was given), or a number. */
type Binding = {readonly type: unknown; readonly scope: Bindings} | {readonly value: number}
type Bindings = ReadonlyMap<string, Binding>

const NO_BINDINGS: Bindings = new Map()

/** The one key of a type object (`{vec: …}`): an object with another key, or several, is no type. */
const typeKey = (type: Entries) => {
  const keys = Object.keys(type)

  return keys.length === 1 ? (keys[0] as string) : refuse()
}

const integer = (reader: Reader, size: 1 | 2 | 4 | 8 | 16 | 32, signed: boolean): bigint => {
  switch (size) {
    case 1:
      return BigInt(signed ? reader.i8() : reader.u8())
    case 2:
      return BigInt(signed ? reader.i16() : reader.u16())
    case 4:
      return BigInt(signed ? reader.i32() : reader.u32())
    case 8:
      return signed ? reader.i64() : reader.u64()
    default:
      return reader.wide(size, signed)
  }
}

const isU8 = (type: unknown) => type === 'u8'

/** Reads values by an IDL's types, within `IDL_LIMITS`. */
const createDecoder = (types: ReadonlyMap<string, Entries>, reader: Reader) => {
  let values = 0

  const count = () => {
    values += 1

    if (values > IDL_LIMITS.values) {
      refuse()
    }
  }

  const fieldsOf = (fields: unknown, scope: Bindings, depth: number): IdlNamedValue[] => {
    if (fields === undefined) {
      return []
    }

    const entries = list(fields, IDL_LIMITS.args)
    const named = entries.length > 0 && isRecord(entries[0]) && Object.hasOwn(entries[0], 'name')

    return entries.map(entry => {
      if (!named) {
        return {value: read(entry, scope, depth + 1)}
      }

      if (!isRecord(entry)) {
        return refuse()
      }

      return {name: nameOf(own(entry, 'name')), value: read(own(entry, 'type'), scope, depth + 1)}
    })
  }

  /** A type the IDL defines, with its generics bound to the arguments given where it is used. */
  const defined = (reference: unknown, scope: Bindings, depth: number): IdlValue => {
    const name = typeof reference === 'string' ? reference : isRecord(reference) ? own(reference, 'name') : undefined
    const definition = types.get(nameOf(name)) ?? refuse()
    const parameters = own(definition, 'generics')
    const given = isRecord(reference) ? own(reference, 'generics') : undefined
    const parameterList = parameters === undefined ? [] : list(parameters, IDL_LIMITS.args)
    const argumentList = given === undefined ? [] : list(given, IDL_LIMITS.args)

    if (parameterList.length !== argumentList.length) {
      return refuse()
    }

    const bindings = new Map<string, Binding>()

    for (const [index, parameter] of parameterList.entries()) {
      const argument = argumentList[index]

      if (!isRecord(parameter) || !isRecord(argument) || own(parameter, 'kind') !== own(argument, 'kind')) {
        return refuse()
      }

      const key = nameOf(own(parameter, 'name'))

      if (own(argument, 'kind') === 'type') {
        bindings.set(key, {scope, type: own(argument, 'type')})
      } else if (own(argument, 'kind') === 'const') {
        const value = Number(own(argument, 'value'))

        if (!Number.isInteger(value) || value < 0 || value > IDL_LIMITS.values) {
          return refuse()
        }

        bindings.set(key, {value})
      } else {
        return refuse()
      }
    }

    const serialization = own(definition, 'serialization')

    if (serialization !== undefined && serialization !== 'borsh') {
      return refuse()
    }

    const body = own(definition, 'type')

    if (!isRecord(body)) {
      return refuse()
    }

    switch (own(body, 'kind')) {
      case 'struct':
        return {fields: fieldsOf(own(body, 'fields'), bindings, depth), kind: 'struct'}
      case 'enum': {
        const variants = list(own(body, 'variants'), IDL_LIMITS.variants)
        const variant = variants[reader.u8()]

        if (!isRecord(variant)) {
          return refuse()
        }

        return {
          fields: fieldsOf(own(variant, 'fields'), bindings, depth),
          kind: 'enum',
          variant: nameOf(own(variant, 'name')),
        }
      }
      case 'type':
        return read(own(body, 'alias'), bindings, depth + 1)
      default:
        return refuse()
    }
  }

  const length = (type: unknown, scope: Bindings): number => {
    if (typeof type === 'number') {
      return Number.isInteger(type) && type >= 0 && type <= IDL_LIMITS.values ? type : refuse()
    }

    if (isRecord(type) && typeKey(type) === 'generic') {
      const binding = scope.get(nameOf(own(type, 'generic')))

      return binding !== undefined && 'value' in binding ? binding.value : refuse()
    }

    return refuse()
  }

  /** A generic parameter's type, followed to what it is bound to: a vector of `T` where `T` is `u8` is bytes too. */
  const resolve = (type: unknown, scope: Bindings): readonly [unknown, Bindings] => {
    let current: readonly [unknown, Bindings] = [type, scope]

    for (let step = 0; step < IDL_LIMITS.typeDepth; step++) {
      const [inner, bindings] = current

      if (!isRecord(inner) || Object.keys(inner).length !== 1 || !Object.hasOwn(inner, 'generic')) {
        return current
      }

      const binding = bindings.get(nameOf(own(inner, 'generic')))

      if (binding === undefined || !('type' in binding)) {
        return refuse()
      }

      current = [binding.type, binding.scope]
    }

    return refuse()
  }

  const items = (type: unknown, total: number, scope: Bindings, depth: number): IdlValue => {
    const [element, bindings] = resolve(type, scope)

    if (isU8(element)) {
      return {kind: 'bytes', value: reader.bytes(total)}
    }

    if (total > IDL_LIMITS.values) {
      return refuse()
    }

    return {items: Array.from({length: total}, () => read(element, bindings, depth + 1)), kind: 'list'}
  }

  const read = (type: unknown, scope: Bindings, depth: number): IdlValue => {
    if (depth > IDL_LIMITS.typeDepth) {
      return refuse()
    }

    count()

    if (typeof type === 'string') {
      const size = Object.hasOwn(INTEGERS, type) ? INTEGERS[type] : undefined

      if (size !== undefined) {
        return {bits: size[0] * 8, kind: 'integer', value: integer(reader, size[0], size[1])}
      }

      switch (type) {
        case 'bool': {
          const byte = reader.u8()

          return byte > 1 ? refuse() : {kind: 'bool', value: byte === 1}
        }
        case 'f32':
          return {kind: 'float', value: reader.f32()}
        case 'f64':
          return {kind: 'float', value: reader.f64()}
        case 'string':
          return {kind: 'string', value: reader.text(reader.u32())}
        case 'bytes':
          return {kind: 'bytes', value: reader.bytes(reader.u32())}
        case 'pubkey':
        case 'publicKey':
          return {kind: 'pubkey', value: reader.pubkey()}
        default:
          return refuse()
      }
    }

    if (!isRecord(type)) {
      return refuse()
    }

    const key = typeKey(type)
    const inner = own(type, key)

    switch (key) {
      case 'option': {
        const tag = reader.u8()

        return tag === 0 ? {kind: 'none'} : tag === 1 ? read(inner, scope, depth + 1) : refuse()
      }
      case 'coption': {
        // Anchor's COption: a u32 tag, then the value only when it is 1.
        const tag = reader.u32()

        return tag === 0 ? {kind: 'none'} : tag === 1 ? read(inner, scope, depth + 1) : refuse()
      }
      case 'vec':
        return items(inner, reader.u32(), scope, depth)
      case 'array': {
        const [element, size, ...more] = list(inner, 2)

        return more.length > 0 ? refuse() : items(element, length(size, scope), scope, depth)
      }
      case 'defined':
        return defined(inner, scope, depth + 1)
      case 'generic': {
        const binding = scope.get(nameOf(inner))

        return binding !== undefined && 'type' in binding ? read(binding.type, binding.scope, depth + 1) : refuse()
      }
      default:
        return refuse()
    }
  }

  return {read: (type: unknown) => read(type, NO_BINDINGS, 0)}
}

/** An IDL's accounts in order, groups flattened, within the limits. */
const flatten = (accounts: unknown, depth: number, out: IdlAccount[]): IdlAccount[] => {
  if (depth > IDL_LIMITS.groupDepth) {
    return refuse()
  }

  for (const account of list(accounts, IDL_LIMITS.accounts)) {
    if (!isRecord(account)) {
      return refuse()
    }

    const name = nameOf(own(account, 'name'))
    const group = own(account, 'accounts')

    if (group !== undefined) {
      flatten(group, depth + 1, out)
    } else {
      const address = own(account, 'address')

      if (address !== undefined && typeof address !== 'string') {
        return refuse()
      }

      out.push({
        ...(address === undefined ? {} : {address}),
        name,
        optional: flag(account, 'optional', 'isOptional'),
        signer: flag(account, 'signer', 'isSigner'),
        writable: flag(account, 'writable', 'isMut'),
      })
    }

    if (out.length > IDL_LIMITS.accounts) {
      return refuse()
    }
  }

  return out
}

const discriminatorOf = (instruction: Entries): Uint8Array | undefined => {
  const value = own(instruction, 'discriminator')

  if (value === undefined) {
    return undefined
  }

  const bytes = list(value, IDL_LIMITS.discriminator)

  if (
    bytes.length === 0 ||
    !bytes.every(byte => Number.isInteger(byte) && (byte as number) >= 0 && (byte as number) <= 255)
  ) {
    return refuse()
  }

  return Uint8Array.from(bytes as number[])
}

const startsWith = (data: Uint8Array, prefix: Uint8Array) =>
  prefix.length <= data.length && prefix.every((byte, index) => data[index] === byte)

/** The address an IDL is for: `address` (0.30 and later) or `metadata.address` (before). */
export const idlAddress = (idl: unknown): unknown => {
  if (!isRecord(idl)) {
    return undefined
  }

  const metadata = own(idl, 'metadata')

  return own(idl, 'address') ?? (isRecord(metadata) ? own(metadata, 'address') : undefined)
}

/** The program's name an IDL gives (`metadata.name`, or `name` before 0.30), when it gives one that reads. */
const programName = (idl: Entries): string | undefined => {
  const metadata = own(idl, 'metadata')
  const name = (isRecord(metadata) ? own(metadata, 'name') : undefined) ?? own(idl, 'name')

  return typeof name === 'string' && name.length > 0 && name.length <= IDL_LIMITS.name ? name : undefined
}

/**
 * The instruction of `idl` that `data` is, read: the one instruction whose discriminator starts the data, its
 * accounts named in order, its arguments read in Borsh, and the bytes after them. `undefined` when the IDL is
 * malformed, is for another program, has no such instruction or more than one, names more accounts than the
 * instruction has or a fixed address it does not have, or does not read the data. Never throws.
 */
export const matchIdl = (
  idl: unknown,
  instruction: {
    readonly programId: string
    readonly accounts: readonly (string | undefined)[]
    readonly data: Uint8Array
  }
): IdlMatch | undefined => {
  try {
    if (!isRecord(idl)) {
      return undefined
    }

    const address = idlAddress(idl)

    if (address !== undefined && address !== instruction.programId) {
      return undefined
    }

    const candidates = list(own(idl, 'instructions'), IDL_LIMITS.instructions).filter(entry => {
      if (!isRecord(entry)) {
        return refuse()
      }

      const discriminator = discriminatorOf(entry)

      return discriminator !== undefined && startsWith(instruction.data, discriminator)
    })

    const found = candidates.length === 1 ? candidates[0] : undefined

    if (!isRecord(found)) {
      return undefined
    }

    const types = new Map<string, Entries>()

    for (const definition of list(own(idl, 'types') ?? [], IDL_LIMITS.types)) {
      if (!isRecord(definition)) {
        return undefined
      }

      const name = nameOf(own(definition, 'name'))

      if (types.has(name)) {
        return undefined
      }

      types.set(name, definition)
    }

    const accounts = flatten(own(found, 'accounts'), 0, [])

    if (accounts.length > instruction.accounts.length) {
      return undefined
    }

    for (const [index, account] of accounts.entries()) {
      const actual = instruction.accounts[index]

      // A fixed address must be the one passed; an optional account left out is passed as the program itself.
      if (
        account.address !== undefined &&
        actual !== undefined &&
        actual !== account.address &&
        !(account.optional && actual === instruction.programId)
      ) {
        return undefined
      }
    }

    const discriminator = discriminatorOf(found) ?? refuse()
    const reader = createReader(instruction.data.subarray(discriminator.length))
    const decoder = createDecoder(types, reader)
    const args = list(own(found, 'args') ?? [], IDL_LIMITS.args).map(arg =>
      isRecord(arg) ? {name: nameOf(own(arg, 'name')), value: decoder.read(own(arg, 'type'))} : refuse()
    )
    const program = programName(idl)

    return {
      accounts,
      args,
      name: nameOf(own(found, 'name')),
      ...(program === undefined ? {} : {program}),
      rest: reader.rest(),
    }
  } catch {
    // A malformed IDL, data it does not read, or a getter that throws: the IDL does not describe this instruction.
    return undefined
  }
}

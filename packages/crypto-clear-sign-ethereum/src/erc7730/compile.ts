import {AbiError, type AbiFunction, jsonFunctions, parseFunction} from '../abi'
import {encodeType, normalizeEncodeType} from '../eip712'
import {type Path, parsePath} from './path'

/** Why a descriptor cannot be used. Internal: it becomes `ethereum.INVALID_DESCRIPTOR`, or a `rejected` entry. */
export class DescriptorError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DescriptorError'
  }
}

const reject = (message: string): never => {
  throw new DescriptorError(message)
}

/** Where a descriptor binds: a chain and an address, lowercase. */
export type Deployment = {readonly chainId: number; readonly address: string}

/** When a field shows, as `visible` (version 2) or `required` and `excluded` (version 1) say. */
export type Visibility =
  | {readonly kind: 'always' | 'optional' | 'never'}
  | {readonly kind: 'ifNotIn' | 'mustMatch'; readonly values: readonly unknown[]}

/** A field of a format, its `$ref` merged in. */
export type FieldNode = {
  readonly kind: 'field'
  readonly path?: Path
  /** The path as written (without `#.`): what `interpolatedIntent` names it by. */
  readonly source?: string
  /** A constant to show instead of a path's value. */
  readonly value?: string | number | boolean
  readonly label?: string
  /** `raw` when the descriptor gives none. */
  readonly format: string
  readonly params: Readonly<Record<string, unknown>>
  readonly visible: Visibility
  readonly separator?: string
  /** Its value is encrypted (ERC-7984): it cannot be read here. */
  readonly encrypted: boolean
}

/** A group of fields under a path. */
export type GroupNode = {
  readonly kind: 'group'
  readonly path?: Path
  readonly label?: string
  readonly iteration: 'sequential' | 'bundled'
  readonly fields: readonly DisplayNode[]
}

export type DisplayNode = FieldNode | GroupNode

/** One format: how a function's call or a message type is shown. */
export type Format = {
  readonly key: string
  /** A plain intent, or a complex one written as `key: value` pairs. */
  readonly intent: string
  readonly interpolatedIntent?: string
  readonly fields: readonly DisplayNode[]
  readonly required: readonly Path[]
  readonly excluded: readonly Path[]
  /** Call data: the function, its selector and parameter names. */
  readonly fn?: AbiFunction
  /** Typed data: the `encodeType` the key names, normalized. */
  readonly encodeType?: string
  /** Typed data (version 1): the primary type the key names. */
  readonly primaryType?: string
}

/** A descriptor checked and compiled: what the package reads from it, and the merged JSON its `$.` paths reach. */
export type CompiledDescriptor = {
  readonly kind: 'calldata' | 'eip712'
  readonly version: 1 | 2
  readonly json: Readonly<Record<string, unknown>>
  readonly deployments: readonly Deployment[]
  /** Typed data: the domain values the message's domain must have. */
  readonly domain?: Readonly<Record<string, unknown>>
  /** Typed data: the domain separator the message's domain must hash to, lowercase hex. */
  readonly domainSeparator?: string
  /** Typed data (version 1): the `encodeType` of each schema, by primary type. */
  readonly schemas: ReadonlyMap<string, string>
  readonly owner?: string
  readonly contractName?: string
  readonly token?: {readonly ticker: string; readonly name?: string; readonly decimals: number}
  readonly formats: readonly Format[]
}

const MAX_FORMATS = 2048
const MAX_NODES = 512
const MAX_GROUP_DEPTH = 8
const MAX_DEPLOYMENTS = 4096
/** Labels, intents, names: anything a descriptor puts on the screen as a title. */
export const MAX_LABEL = 128
export const MAX_INTERPOLATED = 512

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const own = (value: Readonly<Record<string, unknown>>, key: string): unknown =>
  Object.hasOwn(value, key) ? value[key] : undefined

const ADDRESS = /^0x[0-9a-fA-F]{40}$/

const optionalText = (value: unknown, where: string, max = MAX_LABEL): string | undefined => {
  if (value === undefined) {
    return undefined
  }

  return typeof value === 'string' && value.length <= max ? value : reject(`${where} is text of at most ${max}.`)
}

const deployments = (value: unknown, where: string): Deployment[] => {
  if (value === undefined) {
    return []
  }

  if (!Array.isArray(value) || value.length > MAX_DEPLOYMENTS) {
    return reject(`${where} is a list of deployments.`)
  }

  return value.map((entry: unknown) => {
    const chainId = isRecord(entry) ? own(entry, 'chainId') : undefined
    const address = isRecord(entry) ? own(entry, 'address') : undefined

    if (typeof chainId !== 'number' || !Number.isSafeInteger(chainId) || chainId < 1) {
      return reject(`${where} has a chain id that is not a positive integer.`)
    }

    return typeof address === 'string' && ADDRESS.test(address)
      ? {address: address.toLowerCase(), chainId}
      : reject(`${where} has an address that is not 20 bytes of hex.`)
  })
}

/** The value at a `$.` path in the descriptor, or `undefined`. */
export const lookupDescriptor = (json: unknown, path: Path): unknown => {
  let current: unknown = json

  for (const step of path.steps) {
    if (step.kind === 'field' && isRecord(current)) {
      current = own(current, step.name)
    } else if (step.kind === 'index' && Array.isArray(current)) {
      current = current[step.index < 0 ? current.length + step.index : step.index]
    } else {
      return undefined
    }
  }

  return current
}

/** A label: text, or a `$.` path to a constant. */
const label = (value: unknown, json: unknown, where: string): string | undefined => {
  const text = optionalText(value, where)

  if (text?.startsWith('$.')) {
    const path = parsePath(text)
    const resolved = path === undefined ? undefined : lookupDescriptor(json, path)

    return optionalText(
      typeof resolved === 'string' ? resolved : reject(`${where} names a constant that is not text.`),
      where
    )
  }

  return text
}

const visibility = (value: unknown, where: string): Visibility => {
  if (value === undefined || value === 'always' || value === true) {
    return {kind: 'always'}
  }

  if (value === 'optional' || value === 'never') {
    return {kind: value}
  }

  if (value === false) {
    return {kind: 'never'}
  }

  if (isRecord(value)) {
    const ifNotIn = own(value, 'ifNotIn')
    const mustMatch = own(value, 'mustMatch')

    if (Array.isArray(ifNotIn) && mustMatch === undefined && ifNotIn.length > 0 && ifNotIn.length <= 64) {
      return {kind: 'ifNotIn', values: ifNotIn}
    }

    if (Array.isArray(mustMatch) && ifNotIn === undefined && mustMatch.length > 0 && mustMatch.length <= 64) {
      return {kind: 'mustMatch', values: mustMatch}
    }
  }

  return reject(`${where}.visible is always, optional, never, ifNotIn or mustMatch.`)
}

const path = (value: unknown, where: string): Path | undefined => {
  if (value === undefined) {
    return undefined
  }

  return parsePath(value) ?? reject(`${where}.path is not an ERC-7730 path.`)
}

type Budget = {nodes: number}

const fieldNode = (
  value: Readonly<Record<string, unknown>>,
  definitions: Readonly<Record<string, unknown>>,
  json: unknown,
  where: string
): FieldNode => {
  const ref = own(value, '$ref')
  let definition: Readonly<Record<string, unknown>> = {}

  if (ref !== undefined) {
    const match = typeof ref === 'string' ? /^\$\.display\.definitions\.([A-Za-z0-9_$-]+)$/.exec(ref) : null
    const found = match ? own(definitions, match[1] ?? '') : undefined

    definition = isRecord(found) ? found : reject(`${where}.$ref names no definition.`)
  }

  const params = own(value, 'params')
  const definitionParams = own(definition, 'params')

  if ((params !== undefined && !isRecord(params)) || (definitionParams !== undefined && !isRecord(definitionParams))) {
    return reject(`${where}.params is an object.`)
  }

  const format = own(value, 'format') ?? own(definition, 'format') ?? 'raw'
  const constant = own(value, 'value') ?? own(definition, 'value')
  const fieldPath = path(own(value, 'path') ?? own(definition, 'path'), where)
  const separator = own(value, 'separator') ?? own(definition, 'separator')
  const source = own(value, 'path') ?? own(definition, 'path')

  if (typeof format !== 'string' || format.length > 64) {
    return reject(`${where}.format is a format name.`)
  }

  if (
    constant !== undefined &&
    typeof constant !== 'string' &&
    typeof constant !== 'number' &&
    typeof constant !== 'boolean'
  ) {
    return reject(`${where}.value is a string, a number or a boolean.`)
  }

  if ((constant === undefined) === (fieldPath === undefined)) {
    return reject(`${where} has a path or a value, not both and not neither.`)
  }

  return {
    encrypted: own(value, 'encryption') !== undefined || own(definition, 'encryption') !== undefined,
    format,
    kind: 'field',
    label: label(own(value, 'label') ?? own(definition, 'label'), json, `${where}.label`),
    params: {...(definitionParams ?? {}), ...(params ?? {})},
    visible: visibility(own(value, 'visible') ?? own(definition, 'visible'), where),
    ...(fieldPath === undefined ? {} : {path: fieldPath}),
    ...(typeof source === 'string' ? {source: source.startsWith('#.') ? source.slice(2) : source} : {}),
    ...(constant === undefined ? {} : {value: constant}),
    ...(separator === undefined ? {} : {separator: optionalText(separator, `${where}.separator`) ?? ''}),
  }
}

const nodes = (
  value: unknown,
  definitions: Readonly<Record<string, unknown>>,
  json: unknown,
  where: string,
  depth: number,
  budget: Budget
): DisplayNode[] => {
  if (value === undefined) {
    return []
  }

  if (!Array.isArray(value) || depth > MAX_GROUP_DEPTH) {
    return reject(`${where} is a list of fields, nested at most ${MAX_GROUP_DEPTH} deep.`)
  }

  return value.map((entry: unknown, index): DisplayNode => {
    const at = `${where}[${index}]`
    budget.nodes++

    if (budget.nodes > MAX_NODES || !isRecord(entry)) {
      return reject(`${at} is a field, and a format has at most ${MAX_NODES}.`)
    }

    const fields = own(entry, 'fields')

    if (fields === undefined) {
      return fieldNode(entry, definitions, json, at)
    }

    const iteration = own(entry, 'iteration') ?? 'sequential'

    if (iteration !== 'sequential' && iteration !== 'bundled') {
      return reject(`${at}.iteration is sequential or bundled.`)
    }

    const groupPath = path(own(entry, 'path'), at)
    const groupLabel = label(own(entry, 'label'), json, `${at}.label`)

    return {
      fields: nodes(fields, definitions, json, `${at}.fields`, depth + 1, budget),
      iteration,
      kind: 'group',
      ...(groupPath === undefined ? {} : {path: groupPath}),
      ...(groupLabel === undefined ? {} : {label: groupLabel}),
    }
  })
}

const intentOf = (value: unknown, where: string): string => {
  if (typeof value === 'string' && value.trim() !== '' && value.length <= MAX_LABEL) {
    return value
  }

  if (isRecord(value)) {
    const entries = Object.entries(value)
    const joined = entries.map(([key, entry]) => `${key}: ${typeof entry === 'string' ? entry : ''}`).join(', ')

    if (
      entries.length > 0 &&
      entries.length <= 8 &&
      entries.every(([, entry]) => typeof entry === 'string') &&
      joined.length <= MAX_LABEL
    ) {
      return joined
    }
  }

  return reject(`${where}.intent is text, or an object of text, of at most ${MAX_LABEL} characters.`)
}

const pathList = (value: unknown, where: string): Path[] => {
  if (value === undefined) {
    return []
  }

  return Array.isArray(value) && value.length <= MAX_NODES
    ? value.map(entry => parsePath(entry) ?? reject(`${where} lists something that is not a path.`))
    : reject(`${where} is a list of paths.`)
}

const MAJOR = /erc7730-v([0-9]+)(?:\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.]+)?)?\.schema\.json$/

const schemaVersion = (value: unknown): 1 | 2 => {
  if (value === undefined) {
    return 2
  }

  if (typeof value !== 'string') {
    return reject('$schema is a path or a URL.')
  }

  const major = Number(MAJOR.exec(value)?.[1] ?? 2)

  return major === 1 || major === 2 ? major : reject('$schema names a major version this package does not read.')
}

const SELECTOR = /^0x[0-9a-fA-F]{8}$/

const calldataFunction = (key: string, abi: readonly AbiFunction[], where: string): AbiFunction => {
  if (SELECTOR.test(key)) {
    const found = abi.find(fn => fn.selector === key.toLowerCase())

    return found ?? reject(`${where} is a selector its ABI does not have.`)
  }

  if (!key.includes('(')) {
    const named = abi.filter(fn => fn.name === key)

    return named.length === 1 && named[0] !== undefined
      ? named[0]
      : reject(`${where} names no single function of its ABI.`)
  }

  let fn: AbiFunction

  try {
    fn = parseFunction(key)
  } catch (error) {
    return error instanceof AbiError ? reject(`${where} is not a function signature.`) : reject(String(error))
  }

  // A signature without parameter names takes them from the ABI (version 1), when it has the function.
  const unnamed = fn.inputs.some(input => input.name === undefined)
  const fromAbi = abi.find(entry => entry.selector === fn.selector)

  return unnamed && fromAbi !== undefined ? fromAbi : fn
}

const schemasOf = (value: unknown): Map<string, string> => {
  const schemas = new Map<string, string>()

  if (value === undefined) {
    return schemas
  }

  if (!Array.isArray(value)) {
    return reject('context.eip712.schemas is a list.')
  }

  for (const schema of value) {
    // A schema given by URL cannot be fetched here: such a schema binds nothing.
    if (!isRecord(schema)) {
      continue
    }

    const primaryType = own(schema, 'primaryType')
    const types = own(schema, 'types')

    if (typeof primaryType !== 'string' || !isRecord(types)) {
      return reject('A schema of context.eip712.schemas has a primary type and types.')
    }

    const checked: Record<string, {name: string; type: string}[]> = {}

    for (const [name, fields] of Object.entries(types)) {
      checked[name] = Array.isArray(fields)
        ? fields.map(field =>
            isRecord(field) && typeof field.name === 'string' && typeof field.type === 'string'
              ? {name: field.name, type: field.type}
              : reject('A schema member is a {name, type} pair.')
          )
        : reject('A schema type is a list of members.')
    }

    schemas.set(primaryType, normalizeEncodeType(encodeType(checked, primaryType)))
  }

  return schemas
}

const metadataText = (metadata: Readonly<Record<string, unknown>>, key: string): string | undefined => {
  const value = own(metadata, key)

  return typeof value === 'string' && value.trim() !== '' && value.length <= MAX_LABEL ? value : undefined
}

/**
 * A descriptor checked against the ERC-7730 schema (version 1 or 2, keys of newer minor versions ignored) and
 * compiled: its binding, its metadata, and each format with its function or message type and its fields, `$ref`s
 * merged. Throws `DescriptorError` for anything malformed: a descriptor is untrusted input, and is used whole or not
 * at all. `includes` must already be merged.
 */
export const compileDescriptor = (content: unknown): CompiledDescriptor => {
  if (!isRecord(content)) {
    return reject('A descriptor is an object.')
  }

  if (own(content, 'includes') !== undefined) {
    return reject('A descriptor`s includes are merged before it is used.')
  }

  const version = schemaVersion(own(content, '$schema'))
  const context = own(content, 'context')
  const metadata = own(content, 'metadata') ?? {}
  const display = own(content, 'display')

  if (!isRecord(context) || !isRecord(metadata) || !isRecord(display)) {
    return reject('A descriptor has a context, display and, when present, metadata objects.')
  }

  const contract = own(context, 'contract')
  const eip712 = own(context, 'eip712')

  if ((contract === undefined) === (eip712 === undefined)) {
    return reject('context binds to a contract or to EIP-712 messages.')
  }

  const formatsValue = own(display, 'formats')
  const definitionsValue = own(display, 'definitions') ?? {}

  if (!isRecord(formatsValue) || !isRecord(definitionsValue)) {
    return reject('display.formats and display.definitions are objects.')
  }

  const keys = Object.keys(formatsValue)

  if (keys.length > MAX_FORMATS) {
    return reject(`display.formats has at most ${MAX_FORMATS} formats.`)
  }

  const token = own(metadata, 'token')
  const checkedToken =
    isRecord(token) &&
    typeof token.ticker === 'string' &&
    token.ticker.length > 0 &&
    token.ticker.length <= 32 &&
    Number.isInteger(token.decimals) &&
    (token.decimals as number) >= 0 &&
    (token.decimals as number) <= 255
      ? {
          decimals: token.decimals as number,
          ticker: token.ticker,
          ...(typeof token.name === 'string' && token.name.length <= MAX_LABEL ? {name: token.name} : {}),
        }
      : undefined
  const common = {
    json: content,
    version,
    ...(metadataText(metadata, 'owner') === undefined ? {} : {owner: metadataText(metadata, 'owner')}),
    ...(metadataText(metadata, 'contractName') === undefined
      ? {}
      : {contractName: metadataText(metadata, 'contractName')}),
    ...(checkedToken === undefined ? {} : {token: checkedToken}),
  }

  const formatOf = (key: string, extra: Partial<Format>): Format => {
    const value = own(formatsValue, key)
    const where = `display.formats[${JSON.stringify(key.slice(0, 64))}]`

    if (!isRecord(value)) {
      return reject(`${where} is an object.`)
    }

    const interpolated = optionalText(own(value, 'interpolatedIntent'), `${where}.interpolatedIntent`, MAX_INTERPOLATED)

    return {
      excluded: pathList(own(value, 'excluded'), `${where}.excluded`),
      fields: nodes(own(value, 'fields'), definitionsValue, content, `${where}.fields`, 0, {nodes: 0}),
      intent: intentOf(own(value, 'intent'), where),
      key,
      required: pathList(own(value, 'required'), `${where}.required`),
      ...(interpolated === undefined ? {} : {interpolatedIntent: interpolated}),
      ...extra,
    }
  }

  if (contract !== undefined) {
    if (!isRecord(contract)) {
      return reject('context.contract is an object.')
    }

    const abi = jsonFunctions(own(contract, 'abi'))
    const formats = keys.map(key =>
      formatOf(key, {fn: calldataFunction(key, abi, `display.formats[${JSON.stringify(key.slice(0, 64))}]`)})
    )
    const selectors = new Set(formats.map(format => format.fn?.selector))

    if (selectors.size !== formats.length) {
      return reject('Two formats of display.formats name the same function.')
    }

    return {
      ...common,
      deployments: deployments(own(contract, 'deployments'), 'context.contract.deployments'),
      formats,
      kind: 'calldata',
      schemas: new Map(),
    }
  }

  if (!isRecord(eip712)) {
    return reject('context.eip712 is an object.')
  }

  const domain = own(eip712, 'domain')
  const separator = own(eip712, 'domainSeparator')

  if (domain !== undefined && !isRecord(domain)) {
    return reject('context.eip712.domain is an object.')
  }

  if (separator !== undefined && (typeof separator !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(separator))) {
    return reject('context.eip712.domainSeparator is 32 bytes of hex.')
  }

  const formats = keys.map(key =>
    formatOf(key, key.includes('(') ? {encodeType: normalizeEncodeType(key)} : {primaryType: key.trim()})
  )

  if (new Set(formats.map(format => format.encodeType ?? format.primaryType)).size !== formats.length) {
    return reject('Two formats of display.formats name the same message type.')
  }

  return {
    ...common,
    deployments: deployments(own(eip712, 'deployments'), 'context.eip712.deployments'),
    formats,
    kind: 'eip712',
    schemas: schemasOf(own(eip712, 'schemas')),
    ...(domain === undefined ? {} : {domain}),
    ...(separator === undefined ? {} : {domainSeparator: separator.toLowerCase()}),
  }
}

const compiled = new WeakMap<object, CompiledDescriptor | DescriptorError>()

/** `compileDescriptor`, remembered per descriptor object: a resolver answers the same object again and again. */
export const compileCached = (content: unknown): CompiledDescriptor => {
  if (typeof content !== 'object' || content === null) {
    return compileDescriptor(content)
  }

  const known = compiled.get(content)

  if (known instanceof DescriptorError) {
    throw known
  }

  if (known !== undefined) {
    return known
  }

  try {
    const result = compileDescriptor(content)
    compiled.set(content, result)

    return result
  } catch (error) {
    if (error instanceof DescriptorError) {
      compiled.set(content, error)
    }

    throw error
  }
}

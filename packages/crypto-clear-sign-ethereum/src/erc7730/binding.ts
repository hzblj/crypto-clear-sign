import {AbiError, type AbiFunction, parseFunction} from '../abi'
import {normalizeEncodeType} from '../eip712'

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

/**
 * What a descriptor binds to, read from its `context` and the keys of `display.formats`: the calls (a contract's
 * deployments, each format's function) or the messages (deployments, a domain, a domain separator, each format's
 * `encodeType`). The rest is the reference implementation's to read when it renders.
 */
export type Binding =
  | {
      readonly kind: 'calldata'
      readonly deployments: readonly Deployment[]
      /** Each format's function, by selector. */
      readonly functions: ReadonlyMap<string, {readonly key: string; readonly fn: AbiFunction}>
    }
  | {
      readonly kind: 'eip712'
      readonly deployments: readonly Deployment[]
      readonly domain?: Readonly<Record<string, unknown>>
      /** Lowercase hex. */
      readonly domainSeparator?: string
      /** Each format's key, by its `encodeType` with spacing normalized. */
      readonly encodeTypes: ReadonlyMap<string, string>
    }

const MAX_FORMATS = 2048
const MAX_DEPLOYMENTS = 4096
/** Fields and groups a format may have, all levels counted: far past any registry descriptor. */
const MAX_NODES = 512
const MAX_DEPTH = 8

const ADDRESS = /^0x[0-9a-fA-F]{40}$/

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const own = (value: Readonly<Record<string, unknown>>, key: string): unknown =>
  Object.hasOwn(value, key) ? value[key] : undefined

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

/** Counts a format's fields and groups, refusing more than `MAX_NODES` or groups deeper than `MAX_DEPTH`. */
const countNodes = (value: unknown, depth: number, budget: {nodes: number}, where: string) => {
  if (value === undefined) {
    return
  }

  if (!Array.isArray(value) || depth > MAX_DEPTH) {
    return reject(`${where} is a list of fields, nested at most ${MAX_DEPTH} deep.`)
  }

  for (const entry of value) {
    budget.nodes++

    if (budget.nodes > MAX_NODES || !isRecord(entry)) {
      return reject(`${where} has fields, at most ${MAX_NODES} in a format.`)
    }

    countNodes(own(entry, 'fields'), depth + 1, budget, where)
  }
}

/**
 * The binding of an ERC-7730 descriptor (version 2 of the schema), with the shape of every part it reads checked:
 * `context` binds to a contract or to EIP-712 messages, deployments are chain ids and addresses, every calldata
 * format's key is a function signature, every format an object of at most 512 fields. Throws `DescriptorError`.
 * `includes` must already be merged.
 */
export const bindingOf = (content: unknown): Binding => {
  if (!isRecord(content)) {
    return reject('A descriptor is an object.')
  }

  const context = own(content, 'context')
  const display = own(content, 'display')
  const metadata = own(content, 'metadata')

  if (!isRecord(context) || !isRecord(display) || (metadata !== undefined && !isRecord(metadata))) {
    return reject('A descriptor has a context, display and, when present, metadata objects.')
  }

  const contract = own(context, 'contract')
  const eip712 = own(context, 'eip712')
  const formats = own(display, 'formats')
  const definitions = own(display, 'definitions')

  if ((contract === undefined) === (eip712 === undefined)) {
    return reject('context binds to a contract or to EIP-712 messages.')
  }

  if (!isRecord(formats) || (definitions !== undefined && !isRecord(definitions))) {
    return reject('display.formats and display.definitions are objects.')
  }

  const keys = Object.keys(formats)

  if (keys.length > MAX_FORMATS) {
    return reject(`display.formats has at most ${MAX_FORMATS} formats.`)
  }

  for (const key of keys) {
    const format = own(formats, key)

    if (!isRecord(format)) {
      return reject('Every format is an object.')
    }

    countNodes(own(format, 'fields'), 0, {nodes: 0}, `display.formats[${JSON.stringify(key.slice(0, 64))}].fields`)
  }

  if (contract !== undefined) {
    if (!isRecord(contract)) {
      return reject('context.contract is an object.')
    }

    const functions = new Map<string, {key: string; fn: AbiFunction}>()

    for (const key of keys) {
      let fn: AbiFunction

      try {
        fn = parseFunction(key)
      } catch (error) {
        if (error instanceof AbiError) {
          return reject('A format of a contract is keyed by a function signature.')
        }

        throw error
      }

      if (functions.has(fn.selector)) {
        return reject('Two formats name the same function.')
      }

      functions.set(fn.selector, {fn, key})
    }

    return {
      deployments: deployments(own(contract, 'deployments'), 'context.contract.deployments'),
      functions,
      kind: 'calldata',
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

  const encodeTypes = new Map<string, string>()

  for (const key of keys) {
    const normalized = normalizeEncodeType(key)

    if (!/^[A-Za-z_$][A-Za-z0-9_$]*\(/.test(normalized)) {
      return reject('A format of typed data is keyed by an EIP-712 encodeType.')
    }

    if (encodeTypes.has(normalized)) {
      return reject('Two formats name the same message type.')
    }

    encodeTypes.set(normalized, key)
  }

  return {
    deployments: deployments(own(eip712, 'deployments'), 'context.eip712.deployments'),
    encodeTypes,
    kind: 'eip712',
    ...(domain === undefined ? {} : {domain}),
    ...(separator === undefined ? {} : {domainSeparator: separator.toLowerCase()}),
  }
}

const bindings = new WeakMap<object, Binding | DescriptorError>()

/** `bindingOf`, remembered per descriptor object: a resolver answers the same object again and again. */
export const bindingCached = (content: unknown): Binding => {
  if (typeof content !== 'object' || content === null) {
    return bindingOf(content)
  }

  const known = bindings.get(content)

  if (known instanceof DescriptorError) {
    throw known
  }

  if (known !== undefined) {
    return known
  }

  try {
    const result = bindingOf(content)
    bindings.set(content, result)

    return result
  } catch (error) {
    if (error instanceof DescriptorError) {
      bindings.set(content, error)
    }

    throw error
  }
}

/** Whether a binding names a contract or a message at all: one bound to nothing is never used. */
export const isBound = (binding: Binding): boolean =>
  binding.deployments.length > 0 ||
  (binding.kind === 'eip712' && (binding.domain !== undefined || binding.domainSeparator !== undefined))

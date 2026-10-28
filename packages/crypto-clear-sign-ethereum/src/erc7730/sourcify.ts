// The bridge to @ethereum-sourcify/clear-signing, the ERC-7730 reference implementation that renders every descriptor.
// It is given one descriptor at a time through an in-memory resolver (nothing is fetched here), and runs twice:
//
// 1. As the descriptor says: the display (labels, intent, interpolated intent, formatted values, warnings). Nested
//    calls (`calldata` fields) find no descriptor here, so the reference stops at their bytes and callee, and the
//    package's own pipeline describes them, built-ins first.
// 2. With every field's format turned to `raw` and its label to a tag: the exact value behind each displayed field
//    (a token amount past a threshold shows "Unlimited", a date its string), which field of the descriptor it is, and,
//    through probe calls to an address nothing else uses, the ether and sender of each nested call, read by the
//    reference from the `amount` and `spender` parameters exactly as it reads them.
//
// Every field is processed in order and the same visibility rules apply in both runs, so the two line up one to one.

import {
  type DisplayField,
  type DisplayFieldGroup,
  type DisplayModel,
  type ExternalDataProvider,
  format,
  formatTypedData,
  type DescriptorResolver as SourcifyResolver,
  type TypedData,
} from '@ethereum-sourcify/clear-signing'
import type {NameRelation, TokenInfo} from '@hzblj/crypto-clear-sign'

import {selectorOf} from '../abi'
import {type Env, lower} from '../env'
import {CHAIN_NAMES} from '../known'

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const own = (value: Readonly<Record<string, unknown>>, key: string): unknown =>
  Object.hasOwn(value, key) ? value[key] : undefined

/** What a raw run's labels start with; nothing a descriptor writes can (labels with control characters are flagged). */
const TAG = '\u0000erc7730:'
/** After the tag: a field's index, and for a probe, what it reads. */
const LEAF = /^([0-9]+)$/
const PROBE = /^([0-9]+):(value|from)$/

const PROBE_VALUE = '__clearSignProbeValue()'
const PROBE_FROM = '__clearSignProbeFrom()'
/** Where probe calls go: two addresses, so that one is never the contract being described. */
const PROBE_ADDRESSES = ['0x00000000000000000000000000000000c1ea5160', '0x00000000000000000000000000000000c1ea5161']

/**
 * Typed data's `@.from` when there is no signer: the reference needs an account, and this one stands for "unknown".
 * A field that shows it makes the descriptor unusable here, as a call's missing `@.from` does.
 */
export const NO_SIGNER = '0x00000000000000000000000000000000c1ea51e0'

/** One field of the descriptor (`$ref` merged), as the raw run tags it. */
export type Leaf = {
  /** The data path as the descriptor writes it, under its group's path; absent for a constant. */
  readonly path?: string
  readonly constant: boolean
  readonly format?: string
  /** `optional`: shown behind "More details". */
  readonly secondary: boolean
  /** A base for the field's id: `data.<path>`, `container.<field>` or `value`; `#` stands for an element's index. */
  readonly id: string
}

/** What the reference read for a nested call's ether and sender (`amount`, `spender`), by occurrence. */
export type Probes = {readonly value: (bigint | undefined)[]; readonly from: (string | undefined)[]}

/** What the bridge to the resolvers was asked, for the fields that only show the answer. */
export type Lookups = {
  /** `resolveToken`, by lowercase address. */
  readonly tokens: Map<string, {readonly chainId: number; readonly token?: TokenInfo}[]>
  /** `resolveNftCollectionName`, in the order asked (the order of the fields). */
  readonly collections: {readonly chainId: number; readonly address: string}[]
}

/** Both runs of one descriptor over one call or message, or why it was not used. */
export type Run =
  | {
      readonly ok: true
      readonly display: DisplayModel
      /** The raw run's fields, in order, each with its descriptor field. */
      readonly raw: readonly {readonly field: DisplayField; readonly leaf: Leaf; readonly index: number}[]
      readonly probes: ReadonlyMap<number, Probes>
      readonly lookups: Lookups
    }
  | {readonly ok: false; readonly code: string}

const isGroup = (node: unknown): node is Readonly<Record<string, unknown>> & {readonly fields: unknown} =>
  isRecord(node) && Object.hasOwn(node, 'fields')

/** A field with its `$ref` merged, as the reference merges it (the field's own keys first, params key by key). */
const merged = (field: Readonly<Record<string, unknown>>, definitions: unknown): Readonly<Record<string, unknown>> => {
  const ref = own(field, '$ref')
  const name = typeof ref === 'string' && ref.startsWith('$.display.definitions.') ? ref.slice(22) : undefined
  const definition = name !== undefined && isRecord(definitions) ? own(definitions, name) : undefined

  if (!isRecord(definition)) {
    return field
  }

  const pick = (key: string) => own(field, key) ?? own(definition, key)
  const params = {
    ...(isRecord(own(definition, 'params')) ? (own(definition, 'params') as object) : {}),
    ...Object.fromEntries(
      Object.entries(isRecord(own(field, 'params')) ? (own(field, 'params') as object) : {}).filter(
        ([, value]) => value !== null && value !== undefined
      )
    ),
  }

  return {
    encryption: pick('encryption'),
    format: pick('format'),
    label: pick('label'),
    params,
    path: pick('path'),
    separator: pick('separator'),
    value: pick('value'),
    visible: pick('visible'),
  }
}

/** A field's id from its path: `data.<path>` or `container.<field>`, `#` where an element's index goes. */
const idBase = (path: string | undefined, constant: boolean): string => {
  if (constant || path === undefined) {
    return 'value'
  }

  const container = path.startsWith('@.')
  const plain = (container ? path.slice(2) : path.startsWith('#.') ? path.slice(2) : path)
    .replace(/\.?\[\]/g, '.#')
    .replace(/\.?\[(-?[0-9]*):?(-?[0-9]*)\]/g, (_, start: string, end: string) => `.${[start, end].join('-')}`)
    .replace(/-(?=\.|$)/g, '')
    .replace(/[^A-Za-z0-9_.:/#-]/g, '_')
    .replace(/\.{2,}/g, '.')

  return `${container ? 'container' : 'data'}.${plain}`.replace(/\.$/, '').slice(0, 112)
}

const joinPath = (group: string | undefined, path: string | undefined): string | undefined => {
  if (path === undefined || group === undefined || path.startsWith('@.') || path.startsWith('$.')) {
    return path
  }

  const strip = (text: string) => (text.startsWith('#.') ? text.slice(2) : text)

  return `${strip(group)}.${strip(path)}`
}

/**
 * The descriptor's format for the raw run: every field `raw`, labelled with its tag, and after each `calldata` field
 * that names an `amount` or a `spender`, a probe call per parameter, to the probe address, with everything else of the
 * field kept (its path, its visibility, the parameter as written).
 */
const rawFormat = (
  spec: Readonly<Record<string, unknown>>,
  definitions: unknown,
  probeAddress: string
): {readonly spec: Readonly<Record<string, unknown>>; readonly leaves: Leaf[]} => {
  const leaves: Leaf[] = []

  const leaf = (field: unknown, group: string | undefined): unknown[] => {
    if (!isRecord(field)) {
      return [field]
    }

    const full = merged(field, definitions)
    const index = leaves.length
    const path = typeof full.path === 'string' ? joinPath(group, full.path) : undefined
    const constant = full.value !== undefined
    leaves.push({
      constant,
      id: idBase(path, constant),
      secondary: full.visible === 'optional',
      ...(path === undefined ? {} : {path}),
      ...(typeof full.format === 'string' ? {format: full.format} : {}),
    })

    const tagged = {...field, format: 'raw', label: `${TAG}${index}`}
    const params = isRecord(full.params) ? full.params : {}
    const {callee, calleePath, chainId, chainIdPath, selector, selectorPath, ...rest} = params
    const probe = (kind: 'value' | 'from', signature: string) =>
      Object.fromEntries(
        Object.entries({
          encryption: full.encryption,
          format: 'calldata',
          label: `${TAG}${index}:${kind}`,
          params: {...rest, callee: probeAddress, selector: selectorOf(signature)},
          path: full.path,
          value: full.value,
          visible: full.visible,
        }).filter(([, value]) => value !== undefined)
      )

    if (full.format !== 'calldata') {
      return [tagged]
    }

    return [
      tagged,
      ...(rest.amount !== undefined || rest.amountPath !== undefined ? [probe('value', PROBE_VALUE)] : []),
      ...(rest.spender !== undefined || rest.spenderPath !== undefined ? [probe('from', PROBE_FROM)] : []),
    ]
  }

  const nodes = (fields: unknown, group: string | undefined): unknown =>
    Array.isArray(fields)
      ? fields.flatMap(node =>
          isGroup(node)
            ? [
                {
                  ...node,
                  fields: nodes(
                    node.fields,
                    typeof node.path === 'string' ? (joinPath(group, node.path) ?? node.path) : group
                  ),
                },
              ]
            : leaf(node, group)
        )
      : fields

  return {leaves, spec: {...spec, fields: nodes(own(spec, 'fields'), undefined)}}
}

/** The descriptor probe calls are read by: the ether and the sender of the call, raw. */
const probeDescriptor = (chainId: number, address: string) => ({
  context: {contract: {deployments: [{address, chainId}]}},
  display: {
    formats: {
      [PROBE_FROM]: {fields: [{format: 'raw', label: 'from', path: '@.from'}], intent: 'from'},
      [PROBE_VALUE]: {fields: [{format: 'raw', label: 'value', path: '@.value'}], intent: 'value'},
    },
  },
})

/**
 * A resolver over one descriptor. The call's own lookup is answered once: a nested call to the same contract finds
 * nothing, so the reference never recurses into it (the package describes nested calls itself). Probes find theirs.
 */
const served = (input: {
  readonly chainId: number
  readonly calldata?: {readonly address: string; readonly descriptor: object}
  readonly typedData?: {
    readonly address: string
    readonly primaryType: string
    readonly hash: string
    readonly descriptor: object
  }
  readonly probe?: string
}): SourcifyResolver => {
  const calldataIndex: Record<string, string> = Object.create(null)
  const typedDataIndex: Record<string, Record<string, {path: string; encodeTypeHashes: string[]}[]>> = Object.create(
    null
  )

  if (input.calldata !== undefined) {
    let asked = 0

    Object.defineProperty(calldataIndex, `eip155:${input.chainId}:${lower(input.calldata.address)}`, {
      enumerable: true,
      get: () => (asked++ === 0 ? 'call' : undefined),
    })
  }

  if (input.typedData !== undefined) {
    const byType: Record<string, {path: string; encodeTypeHashes: string[]}[]> = Object.create(null)
    byType[input.typedData.primaryType] = [{encodeTypeHashes: [input.typedData.hash], path: 'message'}]
    typedDataIndex[`eip155:${input.chainId}:${lower(input.typedData.address)}`] = byType
  }

  if (input.probe !== undefined) {
    calldataIndex[`eip155:${input.chainId}:${input.probe}`] = 'probe'
  }

  return {
    fetchDescriptor: async path => {
      const descriptor =
        path === 'call'
          ? input.calldata?.descriptor
          : path === 'message'
            ? input.typedData?.descriptor
            : path === 'probe' && input.probe !== undefined
              ? probeDescriptor(input.chainId, input.probe)
              : undefined

      if (descriptor === undefined) {
        throw new Error('Not served.')
      }

      return descriptor as Awaited<ReturnType<SourcifyResolver['fetchDescriptor']>>
    },
    index: {calldataIndex, typedDataIndex},
  }
}

/** Whether a name's relation fits the address types a descriptor accepts: `false` only where they contradict. */
const typeMatches = (relation: NameRelation, types: readonly string[] | undefined): boolean => {
  if (types === undefined || types.length === 0) {
    return true
  }

  const accepts = (...kinds: string[]) => types.some(type => kinds.includes(type))

  return relation === 'contract' ? accepts('contract', 'token', 'collection') : accepts('eoa', 'wallet', 'contract')
}

/**
 * The reference's external data, from the package's resolvers through the resolver context (failures are
 * `RESOLVER_FAILED`, the built-in lists stand in): tokens, names, chains. Lookups are logged for the fields that show
 * only their answer.
 */
const bridge = (env: Env, lookups: Lookups): ExternalDataProvider => ({
  resolveChainInfo: async chainId =>
    chainId === env.chainId
      ? {
          name: env.ref.name,
          nativeCurrency: {decimals: env.native.decimals, name: env.native.symbol, symbol: env.native.symbol},
        }
      : null,
  resolveLocalName: async (address, types) => {
    const known = await env.context.name(env.checksum(address))

    return known === undefined ? null : {name: known.name, typeMatch: typeMatches(known.relation, types)}
  },
  resolveNftCollectionName: async (chainId, address) => {
    lookups.collections.push({address, chainId})
    const context = env.contextFor(chainId)
    const checksum = env.checksum(address)
    const name = (await context.name(checksum))?.name ?? (await context.token(checksum))?.name

    return name === undefined ? null : {name}
  },
  resolveToken: async (chainId, address) => {
    const token = await env.contextFor(chainId).token(env.checksum(address))
    const key = lower(address)
    lookups.tokens.set(key, [...(lookups.tokens.get(key) ?? []), {chainId, ...(token === undefined ? {} : {token})}])

    return token === undefined
      ? null
      : {decimals: token.decimals, name: token.name ?? token.symbol, symbol: token.symbol}
  },
})

/** Every field of a display, groups opened, in order. */
export const flatten = (fields: readonly (DisplayField | DisplayFieldGroup)[] | undefined): DisplayField[] =>
  (fields ?? []).flatMap(entry => ('fields' in entry ? entry.fields : [entry]))

/** The first warning that kept the reference from using the descriptor, if any. */
const failure = (display: DisplayModel): string | undefined =>
  display.warnings?.find(entry => entry.code !== 'INTERPOLATION_ERROR')?.code ??
  (display.rawCalldataFallback === undefined ? undefined : 'NO_FORMAT_MATCH')

const probeValue = (field: DisplayField, kind: 'value' | 'from'): bigint | string | undefined => {
  const value = field.embeddedCalldata?.display.fields?.[0]

  if (value === undefined || 'fields' in value) {
    return undefined
  }

  if (kind === 'from') {
    return value.fieldType === 'address' ? value.value : undefined
  }

  return value.fieldType === 'uint' && /^[0-9]+$/.test(value.value) ? BigInt(value.value) : undefined
}

/** Lines the raw run up with its descriptor fields, and sets the probes aside. */
const readRaw = (
  display: DisplayModel,
  leaves: readonly Leaf[]
): {raw: {field: DisplayField; leaf: Leaf; index: number}[]; probes: Map<number, Probes>} | undefined => {
  const raw: {field: DisplayField; leaf: Leaf; index: number}[] = []
  const probes = new Map<number, Probes>()

  for (const field of flatten(display.fields)) {
    const label = field.label.startsWith(TAG) ? field.label.slice(TAG.length) : ''
    const tag = LEAF.exec(label)
    const probe = PROBE.exec(label)

    if (tag !== null && leaves[Number(tag[1])] !== undefined) {
      const index = Number(tag[1])
      raw.push({field, index, leaf: leaves[index] as Leaf})
    } else if (probe !== null) {
      const index = Number(probe[1])
      const kind = probe[2] === 'from' ? 'from' : 'value'
      const entry = probes.get(index) ?? {from: [], value: []}

      if (kind === 'from') {
        entry.from.push(probeValue(field, 'from') as string | undefined)
      } else {
        entry.value.push(probeValue(field, 'value') as bigint | undefined)
      }

      probes.set(index, entry)
    } else {
      return undefined
    }
  }

  return {probes, raw}
}

/** The reference's display; a throw (it returns its inner promise unawaited, so some escape it) is a failure. */
const safely = async (render: () => Promise<DisplayModel>): Promise<DisplayModel> => {
  try {
    return await render()
  } catch {
    return {warnings: [{code: 'UNEXPECTED_LIB_ERROR', message: 'The reference implementation failed.'}]}
  }
}

const optionalText = (value: unknown) => value === undefined || typeof value === 'string'

/**
 * Whether the reference's display has the shape its types promise: it passes a descriptor's labels and separators
 * through as they are, so a label that is not text means the descriptor is malformed.
 */
const wellFormed = (display: DisplayModel): boolean =>
  optionalText(display.interpolatedIntent) &&
  (display.fields ?? []).every(entry =>
    'fields' in entry
      ? optionalText(entry.label) &&
        Array.isArray(entry.fields) &&
        entry.fields.every(field => wellFormed({fields: [field]}))
      : typeof entry.label === 'string' &&
        typeof entry.value === 'string' &&
        typeof entry.format === 'string' &&
        optionalText(entry.separator)
  )

const both = async (
  descriptor: Readonly<Record<string, unknown>>,
  key: string,
  render: (descriptor: object, probe?: string) => Promise<DisplayModel>,
  avoid: string,
  lookups: Lookups
): Promise<Run> => {
  const display = await safely(() => render(descriptor))
  const failed = failure(display)

  if (failed !== undefined) {
    return {code: failed, ok: false}
  }

  if (!wellFormed(display)) {
    return {code: 'INVALID_DESCRIPTOR', ok: false}
  }

  const probe = PROBE_ADDRESSES.find(address => address !== lower(avoid)) ?? ''
  const shown = isRecord(descriptor.display) ? descriptor.display : {}
  const formats = isRecord(shown.formats) ? shown.formats : {}
  const spec = own(formats, key)
  const {leaves, spec: rawSpec} = rawFormat(isRecord(spec) ? spec : {}, own(shown, 'definitions'), probe)
  const rawDisplay = await safely(() =>
    render({...descriptor, display: {...shown, formats: {...formats, [key]: rawSpec}}}, probe)
  )
  const lined = failure(rawDisplay) === undefined ? readRaw(rawDisplay, leaves) : undefined

  if (lined === undefined || lined.raw.length !== flatten(display.fields).length) {
    return {code: 'UNEXPECTED_LIB_ERROR', ok: false}
  }

  if (lined.raw.some(({field}) => field.fieldType === 'address' && lower(field.value) === NO_SIGNER)) {
    return {code: 'CONTAINER_MISSING_REQUIRED_PATH', ok: false}
  }

  // An interpolated intent the descriptor does not write as text is none.
  const written = isRecord(spec) && typeof spec.interpolatedIntent === 'string'
  const {interpolatedIntent, ...rest} = display

  return {
    display: written && interpolatedIntent !== undefined ? {...rest, interpolatedIntent} : rest,
    lookups,
    ok: true,
    probes: lined.probes,
    raw: lined.raw,
  }
}

/**
 * Renders a call with the descriptor (its `includes` merged, bound to the call, with a format for its selector whose
 * function the call data decodes as): the display, and the raw run lined up with it.
 */
export const runCalldata = async (
  env: Env,
  input: {
    readonly to: string
    readonly data: string
    readonly value: bigint
    readonly from?: string
    readonly descriptor: Readonly<Record<string, unknown>>
    readonly key: string
  }
): Promise<Run> => {
  const lookups: Lookups = {collections: [], tokens: new Map()}
  const tx = {
    chainId: env.chainId,
    data: input.data,
    to: input.to,
    value: input.value,
    ...(input.from === undefined ? {} : {from: input.from}),
  }
  return both(
    input.descriptor,
    input.key,
    (descriptor, probe) =>
      format(tx, {
        descriptorResolverOptions: {
          resolver: served({
            calldata: {address: input.to, descriptor},
            chainId: env.chainId,
            ...(probe === undefined ? {} : {probe}),
          }),
          type: 'custom',
        },
        ...(probe === undefined ? {externalDataProvider: bridge(env, lookups)} : {}),
      }),
    input.to,
    lookups
  )
}

/**
 * Renders typed data with the descriptor (bound to its domain, with a format keyed by the message's exact
 * `encodeType`): the display, and the raw run lined up with it.
 */
export const runTypedData = async (
  env: Env,
  input: {
    readonly typedData: TypedData
    readonly verifyingContract: string
    readonly hash: string
    readonly descriptor: Readonly<Record<string, unknown>>
    readonly key: string
  }
): Promise<Run> => {
  const lookups: Lookups = {collections: [], tokens: new Map()}
  return both(
    input.descriptor,
    input.key,
    (descriptor, probe) =>
      formatTypedData(input.typedData, {
        descriptorResolverOptions: {
          resolver: served({
            chainId: env.chainId,
            typedData: {
              address: input.verifyingContract,
              descriptor,
              hash: input.hash,
              primaryType: input.typedData.primaryType,
            },
            ...(probe === undefined ? {} : {probe}),
          }),
          type: 'custom',
        },
        ...(probe === undefined ? {externalDataProvider: bridge(env, lookups)} : {}),
      }),
    input.verifyingContract,
    lookups
  )
}

/** A chain id as a name: the package's list, else its CAIP-2 id. */
export const chainName = (chainId: bigint): string =>
  chainId <= 2n ** 53n ? (CHAIN_NAMES[Number(chainId)] ?? `eip155:${chainId}`) : `eip155:${chainId}`

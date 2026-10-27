import {
  type ActionInput,
  amountField,
  booleanField,
  type DisplayText,
  durationField,
  externalText,
  type Field,
  formatAmount,
  formatField,
  fromUnixSeconds,
  hasHiddenCharacters,
  listField,
  numberField,
  percentField,
  rawField,
  text,
  textField,
  WARNINGS,
  type WarningInput,
  warning,
} from '@hzblj/crypto-clear-sign'
import {bytes, hex, utf8} from '@hzblj/nitro-crypto/adapter'

import type {AbiValue} from '../abi'
import type {DescribeCall} from '../calls/common'
import {tokenAmount} from '../calls/common'
import {pointInTime} from '../calls/time'
import {ETHEREUM_TEXTS, ETHEREUM_WARNINGS} from '../catalogs'
import {type Env, lower} from '../env'
import {CHAIN_NAMES} from '../known'
import {
  type CompiledDescriptor,
  DescriptorError,
  type DisplayNode,
  type FieldNode,
  type Format,
  lookupDescriptor,
  MAX_INTERPOLATED,
  MAX_LABEL,
} from './compile'
import {atText, joinPath, type Located, locate, MAX_LOCATED, type Path, parsePath} from './path'

/** The container a format reads `@.` values from: a transaction's or a typed message's. */
export type Container = {
  readonly from?: string
  readonly to?: string
  readonly value: bigint
  readonly chainId?: number
}

/** What a format renders to. */
export type Rendered = {
  readonly fields: Field[]
  readonly raw: Field[]
  readonly actions: ActionInput[]
  readonly warnings: WarningInput[]
  readonly summary?: DisplayText
}

type Context = {
  readonly env: Env
  readonly descriptor: CompiledDescriptor
  readonly format: Format
  /** The arguments or the message, as a tuple. */
  readonly data: AbiValue
  readonly container: Container
  readonly depth: number
  readonly nested?: DescribeCall
  readonly ids: Set<string>
  /** Concrete paths shown, hidden on purpose, or read by a parameter: what the "not described" rows leave out. */
  readonly covered: Set<string>
  readonly warnings: WarningInput[]
  readonly actions: ActionInput[]
  /** Fields by the path the descriptor wrote, for `interpolatedIntent`. */
  readonly byPath: Map<string, Field>
}

/** The descriptor does not fit the data it was asked about: it is not used at all. */
const mismatch = (message: string): never => {
  throw new DescriptorError(message)
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const idOf = (context: Context, base: string): string => {
  const clean = base.replace(/[^A-Za-z0-9_.:/-]/g, '_').slice(0, 112) || 'field'
  let id = clean

  for (let count = 2; context.ids.has(id); count++) {
    id = `${clean}-${count}`
  }

  context.ids.add(id)

  return id
}

const toUint = (bytes: Uint8Array): bigint => (bytes.length === 0 ? 0n : BigInt(`0x${hex.encode(bytes)}`))

/** A value as an integer: an integer, or the big-endian bytes of a slice. */
const numeric = (value: AbiValue | undefined): bigint | undefined => {
  if (value?.kind === 'uint' || value?.kind === 'int') {
    return value.value
  }

  if (value?.kind === 'bool') {
    return value.value ? 1n : 0n
  }

  return value?.kind === 'bytes' && value.value.length <= 32 ? toUint(value.value) : undefined
}

/** A value as an address (lowercase): an address, 20 bytes, a word or an integer that holds one, or hex text. */
const addressValue = (value: AbiValue | undefined): string | undefined => {
  switch (value?.kind) {
    case 'address':
      return value.value
    case 'bytes':
      if (value.value.length === 20) {
        return `0x${hex.encode(value.value)}`
      }

      return value.value.length === 32 && value.value.subarray(0, 12).every(byte => byte === 0)
        ? `0x${hex.encode(value.value.subarray(12))}`
        : undefined
    case 'uint':
      return value.value < 1n << 160n ? `0x${value.value.toString(16).padStart(40, '0')}` : undefined
    case 'string':
      return /^0x[0-9a-fA-F]{40}$/.test(value.value) ? value.value.toLowerCase() : undefined
    default:
      return undefined
  }
}

/** A descriptor constant (text, number, boolean) as a value. */
const constant = (value: unknown): AbiValue | undefined => {
  if (typeof value === 'boolean') {
    return {kind: 'bool', value}
  }

  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? {bits: 256, kind: 'uint', value: BigInt(value)} : undefined
  }

  if (typeof value !== 'string' || value.length > 1024) {
    return undefined
  }

  if (/^0x[0-9a-fA-F]{40}$/.test(value)) {
    return {kind: 'address', value: value.toLowerCase()}
  }

  if (/^0x(?:[0-9a-fA-F]{2}){0,32}$/.test(value)) {
    return {bits: 256, kind: 'uint', value: value === '0x' ? 0n : BigInt(value)}
  }

  if (/^[0-9]{1,78}$/.test(value)) {
    return {bits: 256, kind: 'uint', value: BigInt(value)}
  }

  return {bytes: utf8.encode(value), kind: 'string', value}
}

const containerValue = (context: Context, name: string): AbiValue | undefined => {
  const {container} = context

  switch (name) {
    case 'from':
      return container.from === undefined ? undefined : {kind: 'address', value: lower(container.from)}
    case 'to':
      return container.to === undefined ? undefined : {kind: 'address', value: lower(container.to)}
    case 'value':
      return {bits: 256, kind: 'uint', value: container.value}
    case 'chainId':
      return container.chainId === undefined ? undefined : {bits: 256, kind: 'uint', value: BigInt(container.chainId)}
    default:
      return undefined
  }
}

/** The values a path reaches, from wherever its root says. Data paths are read under the group's path. */
const valuesAt = (context: Context, path: Path, prefix: Path | undefined): Located[] => {
  if (path.root === 'container') {
    const step = path.steps[0]
    const value = step?.kind === 'field' ? containerValue(context, step.name) : undefined

    return value === undefined ? [] : [{at: ['@', step?.kind === 'field' ? step.name : ''], value}]
  }

  if (path.root === 'descriptor') {
    const value = constant(lookupDescriptor(context.descriptor.json, path))

    return value === undefined ? [] : [{at: ['$'], value}]
  }

  const full = joinPath(prefix, path)

  // A member the data does not have means the descriptor was written for something else.
  let probe: AbiValue | undefined = context.data

  for (const step of full.steps) {
    if (probe === undefined || step.kind !== 'field') {
      break
    }

    if (probe.kind !== 'tuple') {
      break
    }

    probe = probe.fields.find(field => field.name === step.name)?.value

    if (probe === undefined) {
      mismatch('A path names a member the data does not have.')
    }
  }

  return locate(context.data, full.steps)
}

/** A parameter given as a constant (`token`), a `$.` path, a map reference, or a path (`tokenPath`), per value. */
const parameter = (
  context: Context,
  node: FieldNode,
  prefix: Path | undefined,
  names: {readonly constant: string; readonly path?: string},
  count: number
): (AbiValue | undefined)[] | undefined => {
  const pathText = names.path === undefined ? undefined : node.params[names.path]

  if (pathText !== undefined) {
    const path = parsePath(pathText) ?? mismatch('A parameter path is not a path.')
    const found = valuesAt(context, path, prefix)

    for (const entry of found) {
      context.covered.add(atText(entry.at))
    }

    if (found.length === count) {
      return found.map(entry => entry.value)
    }

    return found.length === 1 ? Array.from({length: count}, () => found[0]?.value) : undefined
  }

  const raw = node.params[names.constant]

  if (raw === undefined) {
    return undefined
  }

  const resolve = (value: unknown): AbiValue | undefined => {
    if (typeof value === 'string' && value.startsWith('$.')) {
      const path = parsePath(value)

      return path === undefined ? undefined : constant(lookupDescriptor(context.descriptor.json, path))
    }

    if (isRecord(value) && typeof value.map === 'string' && typeof value.keyPath === 'string') {
      // A map: the constant for the key a path reaches. No entry means the descriptor does not apply.
      const map = parsePath(value.map)
      const keyPath = parsePath(value.keyPath)
      const values = map === undefined ? undefined : lookupDescriptor(context.descriptor.json, map)
      const key = keyPath === undefined ? undefined : valuesAt(context, keyPath, prefix)[0]?.value
      const keyText =
        key === undefined
          ? undefined
          : key.kind === 'address'
            ? key.value
            : String(numeric(key) ?? (key.kind === 'string' ? key.value : ''))
      const table = isRecord(values) && isRecord(values.values) ? values.values : undefined
      const entry =
        table === undefined || keyText === undefined
          ? undefined
          : Object.entries(table).find(([name]) => name.toLowerCase() === keyText.toLowerCase())?.[1]

      return entry === undefined ? mismatch('A map has no value for its key.') : constant(entry)
    }

    return constant(value)
  }

  const value = resolve(raw)

  return Array.from({length: count}, () => value)
}

const addressList = (context: Context, value: unknown): Set<string> => {
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value]

  return new Set(
    list.flatMap(entry => {
      const resolved =
        typeof entry === 'string' && entry.startsWith('$.')
          ? lookupDescriptor(
              context.descriptor.json,
              parsePath(entry) ?? {absolute: true, root: 'descriptor', steps: []}
            )
          : entry

      return typeof resolved === 'string' && /^0x[0-9a-fA-F]{40}$/.test(resolved) ? [resolved.toLowerCase()] : []
    })
  )
}

const bigintParam = (context: Context, value: unknown): bigint | undefined => {
  const resolved =
    typeof value === 'string' && value.startsWith('$.')
      ? lookupDescriptor(context.descriptor.json, parsePath(value) ?? {absolute: true, root: 'descriptor', steps: []})
      : value
  const parsed = constant(resolved)

  return parsed?.kind === 'uint' ? parsed.value : undefined
}

const unreadable = (context: Context, id: string | undefined) => {
  context.warnings.push(warning(ETHEREUM_WARNINGS.UNREADABLE_FIELD, id === undefined ? {} : {fields: [id]}))
}

const hiddenCheck = (context: Context, words: string | undefined, id: string) => {
  if (words !== undefined && hasHiddenCharacters(words)) {
    context.warnings.push(warning(WARNINGS.HIDDEN_CHARACTERS, {fields: [id]}))
  }
}

/** Any value as a field, as `raw` shows it: numbers, addresses (named), booleans, bytes, text, lists. */
export const genericField = async (
  env: Env,
  input: {readonly id: string; readonly label: DisplayText; readonly value: AbiValue; readonly secondary?: boolean},
  onText: (id: string, words: string) => void,
  depth = 0
): Promise<Field> => {
  const {id, label, value} = input
  const common = {id, label, ...(input.secondary === true ? {secondary: true} : {})}

  switch (value.kind) {
    case 'uint':
    case 'int':
      return numberField({...common, value: value.value})
    case 'address':
      return env.address({...common, value: value.value})
    case 'bool':
      return booleanField({...common, value: value.value})
    case 'bytes':
      return rawField({...common, value: value.value})
    case 'string':
      onText(id, value.value)

      return textField({...common, value: value.value})
    case 'array':
    case 'tuple': {
      if (depth > 8) {
        return textField({...common, value: '…'})
      }

      const entries =
        value.kind === 'array'
          ? value.items.slice(0, MAX_LOCATED).map((item, index) => ({
              label: text(ETHEREUM_TEXTS.label.item, {index: index + 1}),
              part: String(index),
              value: item,
            }))
          : value.fields.map((field, index) => ({
              label: externalText(field.name ?? String(index)),
              part: field.name ?? String(index),
              value: field.value,
            }))
      const items: Field[] = []

      for (const entry of entries) {
        items.push(
          await genericField(
            env,
            {id: `${id}.${entry.part}`.slice(0, 128), label: entry.label, value: entry.value},
            onText,
            depth + 1
          )
        )
      }

      return listField({...common, items})
    }
  }
}

const labelOf = (context: Context, node: FieldNode, fallback: string, id: string): DisplayText => {
  const words = node.label ?? fallback
  hiddenCheck(context, words, id)

  return externalText(words.slice(0, MAX_LABEL))
}

/** One value of a field, formatted as its format says. Nested calls go to `context.actions`. */
const formatValue = async (
  context: Context,
  node: FieldNode,
  value: AbiValue,
  params: {readonly index: number; readonly prefix: Path | undefined; readonly count: number},
  common: {readonly id: string; readonly label: DisplayText; readonly secondary?: boolean}
): Promise<Field | undefined> => {
  const {env} = context
  const {id} = common
  const raw = () => genericField(env, {...common, value}, (at, words) => hiddenCheck(context, words, at))
  const fallback = async () => {
    unreadable(context, id)

    return raw()
  }
  const param = (constantName: string, pathName?: string) =>
    parameter(
      context,
      node,
      params.prefix,
      {constant: constantName, ...(pathName === undefined ? {} : {path: pathName})},
      params.count
    )?.[params.index]
  const chainParam = () => {
    const chain = numeric(param('chainId', 'chainIdPath'))

    return chain !== undefined && chain > 0n && chain <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(chain) : undefined
  }

  if (node.encrypted) {
    return fallback()
  }

  switch (node.format) {
    case 'raw':
      return raw()
    case 'addressName': {
      const address = addressValue(value)

      if (address === undefined) {
        return fallback()
      }

      // An address the descriptor says stands for the sender (a router's "recipient: 0x…01") is the sender.
      const sender = addressList(context, node.params.senderAddress).has(address) ? context.container.from : undefined

      return env.address({...common, value: sender ?? address})
    }
    case 'tokenAmount':
    case 'amount': {
      const amount = numeric(value)

      if (amount === undefined) {
        return fallback()
      }

      const threshold = bigintParam(context, node.params.threshold)
      const unlimited = threshold !== undefined && amount >= threshold

      if (unlimited) {
        context.warnings.push(warning(ETHEREUM_WARNINGS.UNLIMITED_AMOUNT, {fields: [id]}))
      }

      if (node.format === 'amount') {
        return env.nativeAmount({...common, unlimited, value: amount})
      }

      const token = addressValue(param('token', 'tokenPath'))

      if (token !== undefined && addressList(context, node.params.nativeCurrencyAddress).has(token)) {
        return env.nativeAmount({...common, unlimited, value: amount})
      }

      if (token === undefined) {
        context.warnings.push(warning(WARNINGS.UNKNOWN_TOKEN, {fields: [id]}))

        return amountField({...common, unlimited, value: amount})
      }

      const {field, warnings} = await tokenAmount(
        env,
        {id, label: common.label, token, value: amount},
        {chainId: chainParam(), secondary: common.secondary, unlimited}
      )
      const own = context.descriptor.token

      // The descriptor's own token metadata, for the contract it binds to, when no token list has it.
      if (field.decimals === undefined && own !== undefined && lower(token) === lower(context.container.to ?? '')) {
        return amountField({
          ...common,
          decimals: own.decimals,
          symbol: own.ticker,
          token: field.token,
          unlimited,
          value: amount,
        })
      }

      context.warnings.push(...warnings)

      return field
    }
    case 'tokenTicker': {
      const token = addressValue(value)

      if (token === undefined) {
        return fallback()
      }

      const known = await env.contextFor(chainParam() ?? env.chainId).token(env.checksum(token))

      if (known === undefined) {
        context.warnings.push(warning(WARNINGS.UNKNOWN_TOKEN, {fields: [id]}))

        return env.address({...common, value: token})
      }

      return textField({...common, value: known.symbol})
    }
    case 'nftName': {
      const tokenId = numeric(value)
      const collection = addressValue(param('collection', 'collectionPath'))

      if (tokenId === undefined) {
        return fallback()
      }

      return listField({
        ...common,
        items: [
          ...(collection === undefined
            ? []
            : [await env.address({id: `${id}.collection`, label: ETHEREUM_TEXTS.label.collection, value: collection})]),
          numberField({id: `${id}.tokenId`, label: ETHEREUM_TEXTS.label.tokenId, value: tokenId}),
        ],
      })
    }
    case 'date': {
      const seconds = numeric(value)

      if (seconds === undefined || seconds < 0n) {
        return fallback()
      }

      if (node.params.encoding === 'blockheight') {
        return numberField({...common, unit: ETHEREUM_TEXTS.unit.blocks, value: seconds})
      }

      // What a descriptor's date means (a deadline, a start) is not known here, so it is never marked expired.
      return pointInTime({...common, value: fromUnixSeconds(seconds)})
    }
    case 'duration': {
      const seconds = numeric(value)

      if (seconds === undefined || seconds < 0n) {
        return fallback()
      }

      return seconds * 1000n > BigInt(Number.MAX_SAFE_INTEGER)
        ? durationField({...common, value: 'never'})
        : durationField({...common, value: Number(seconds) * 1000})
    }
    case 'unit': {
      const amount = numeric(value)
      const base = node.params.base
      const decimals = node.params.decimals ?? 0

      if (
        amount === undefined ||
        typeof base !== 'string' ||
        base.length > 16 ||
        typeof decimals !== 'number' ||
        !Number.isInteger(decimals) ||
        decimals < 0 ||
        decimals > 77
      ) {
        return fallback()
      }

      hiddenCheck(context, base, id)

      if (base === '%' && node.params.prefix !== true) {
        const percent = Number(formatAmount({decimals, value: amount}))

        if (Number.isFinite(percent)) {
          return percentField({...common, value: percent})
        }
      }

      let exponent = 0

      if (node.params.prefix === true) {
        for (
          let scaled = amount < 0n ? -amount : amount;
          scaled >= 10n ** BigInt(decimals + exponent + 3) && exponent < 30;
        ) {
          exponent += 3
        }
      }

      const prefixes: Readonly<Record<number, string>> = {
        0: '',
        3: 'k',
        6: 'M',
        9: 'G',
        12: 'T',
        15: 'P',
        18: 'E',
        21: 'Z',
        24: 'Y',
        27: 'R',
        30: 'Q',
      }

      return textField({
        ...common,
        value: `${formatAmount({decimals: decimals + exponent, value: amount})}${prefixes[exponent] ?? ''}${base}`,
      })
    }
    case 'enum': {
      const ref = node.params.$ref
      const table =
        typeof ref === 'string' && ref.startsWith('$.')
          ? lookupDescriptor(context.descriptor.json, parsePath(ref) ?? {absolute: true, root: 'descriptor', steps: []})
          : undefined
      const key =
        value.kind === 'bool'
          ? String(value.value)
          : (numeric(value)?.toString() ?? (value.kind === 'string' ? value.value : undefined))
      const entry = isRecord(table) && key !== undefined && Object.hasOwn(table, key) ? table[key] : undefined

      if (typeof entry !== 'string' || entry.length > MAX_LABEL) {
        return fallback()
      }

      hiddenCheck(context, entry, id)

      return textField({...common, value: entry})
    }
    case 'chainId': {
      const chain = numeric(value)

      if (chain === undefined) {
        return fallback()
      }

      return textField({
        ...common,
        value: chain <= 2n ** 53n ? (CHAIN_NAMES[Number(chain)] ?? `eip155:${chain}`) : `eip155:${chain}`,
      })
    }
    case 'interoperableAddressName': {
      // ERC-7930: version (2 bytes, 1), chain type (2 bytes, 0 for EIP-155), chain reference, address, each sized.
      const data = value.kind === 'bytes' ? value.value : undefined
      const referenceLength = data?.[4] ?? 0
      const addressLength = data?.[5 + referenceLength]

      if (
        data === undefined ||
        data[0] !== 0 ||
        data[1] !== 1 ||
        data[2] !== 0 ||
        data[3] !== 0 ||
        referenceLength > 8 ||
        addressLength !== 20 ||
        data.length !== 6 + referenceLength + 20
      ) {
        return fallback()
      }

      const chain = Number(toUint(data.subarray(5, 5 + referenceLength)))

      return env.address({
        ...common,
        ...(chain > 0 ? {chainId: chain} : {}),
        value: `0x${hex.encode(data.subarray(6 + referenceLength))}`,
      })
    }
    case 'calldata': {
      const call = value.kind === 'bytes' ? value.value : undefined
      const callee = addressValue(param('callee', 'calleePath'))
      const selectorValue = param('selector', 'selectorPath')
      const selector =
        selectorValue === undefined
          ? undefined
          : selectorValue.kind === 'bytes' && selectorValue.value.length === 4
            ? selectorValue.value
            : selectorValue.kind === 'uint' && selectorValue.value < 1n << 32n
              ? hex.decode(selectorValue.value.toString(16).padStart(8, '0'))
              : null
      const amount = numeric(param('amount', 'amountPath'))
      const spender = addressValue(param('spender', 'spenderPath'))
      const chain = chainParam()

      if (call === undefined || callee === undefined || selector === null || context.nested === undefined) {
        return fallback()
      }

      if (chain !== undefined && chain !== env.chainId) {
        // A call for another chain: this client's knowledge does not reach it.
        return fallback()
      }

      const data = selector === undefined ? call : bytes.concat(selector, call)
      const from = spender ?? context.container.from
      context.actions.push(
        await context.nested({
          data,
          depth: context.depth + 1,
          to: env.checksum(callee),
          value: amount ?? 0n,
          ...(from === undefined ? {} : {from}),
        })
      )

      return undefined
    }
    default:
      return fallback()
  }
}

const matches = (value: AbiValue, candidates: readonly unknown[]): boolean => {
  const asNumber = numeric(value)
  const asAddress = value.kind === 'address' ? value.value : undefined

  return candidates.some(candidate => {
    if (typeof candidate === 'boolean') {
      return value.kind === 'bool' && value.value === candidate
    }

    if (typeof candidate === 'string' && value.kind === 'string') {
      return value.value === candidate
    }

    const parsed = constant(candidate)

    if (parsed?.kind === 'address') {
      return asAddress === parsed.value
    }

    return parsed?.kind === 'uint' && asNumber !== undefined && asNumber === parsed.value
  })
}

const renderField = async (context: Context, node: FieldNode, prefix: Path | undefined): Promise<Field[]> => {
  const located: Located[] =
    node.value !== undefined
      ? (() => {
          // A constant may itself name one of the descriptor's: `"value": "$.metadata.constants.vaultTicker"`.
          const literal =
            typeof node.value === 'string' && node.value.startsWith('$.')
              ? lookupDescriptor(
                  context.descriptor.json,
                  parsePath(node.value) ?? mismatch('A value names no constant.')
                )
              : node.value
          const value = constant(literal)

          return value === undefined ? [] : [{at: ['$value'], value}]
        })()
      : node.path === undefined
        ? []
        : valuesAt(context, node.path, prefix)
  const full = node.path === undefined ? undefined : joinPath(prefix, node.path)
  const excluded =
    full !== undefined &&
    context.format.excluded.some(
      path =>
        atText(path.steps.map(step => (step.kind === 'field' ? step.name : '[]'))) ===
        atText(full.steps.map(step => (step.kind === 'field' ? step.name : '[]')))
    )

  for (const entry of located) {
    context.covered.add(atText(entry.at))
  }

  const {visible} = node

  if (visible.kind === 'mustMatch') {
    if (!located.every(entry => matches(entry.value, visible.values))) {
      mismatch('A value does not match what the descriptor requires.')
    }

    return []
  }

  if (visible.kind === 'never' || excluded) {
    return []
  }

  const shown = visible.kind === 'ifNotIn' ? located.filter(entry => !matches(entry.value, visible.values)) : located

  if (shown.length === 0) {
    return []
  }

  const base =
    node.value !== undefined
      ? 'value'
      : full?.root === 'container'
        ? `container.${atText(located[0]?.at.slice(1) ?? [])}`
        : `data.${atText(located[0]?.at ?? [])}`
  const secondary = visible.kind === 'optional'
  const fields: Field[] = []

  if (shown.length === 1 && shown[0] !== undefined) {
    const id = idOf(context, base)
    const field = await formatValue(
      context,
      node,
      shown[0].value,
      {count: 1, index: 0, prefix},
      {id, label: labelOf(context, node, node.source ?? 'Value', id), ...(secondary ? {secondary: true} : {})}
    )

    if (field !== undefined) {
      fields.push(field)

      if (node.source !== undefined && !context.byPath.has(node.source)) {
        context.byPath.set(node.source, field)
      }
    }

    return fields
  }

  // Several values (an array, or `[]`): one list, an item per value, parameters read per value.
  const listId = idOf(context, `${base.replace(/\.[0-9]+(?=\.|$)/g, '')}.all`)
  const items: Field[] = []

  for (const [index, entry] of shown.entries()) {
    const id = idOf(context, `data.${atText(entry.at)}`)
    const itemLabel =
      node.separator !== undefined
        ? externalText(node.separator.replace('{index}', String(index)).slice(0, MAX_LABEL))
        : text(ETHEREUM_TEXTS.label.item, {index: index + 1})
    const field = await formatValue(
      context,
      node,
      entry.value,
      {count: located.length, index: located.indexOf(entry), prefix},
      {id, label: itemLabel}
    )

    if (field !== undefined) {
      items.push(field)
    }
  }

  return items.length === 0
    ? []
    : [
        listField({
          id: listId,
          items,
          label: labelOf(context, node, node.source ?? 'Values', listId),
          ...(secondary ? {secondary: true} : {}),
        }),
      ]
}

const renderNodes = async (
  context: Context,
  nodes: readonly DisplayNode[],
  prefix: Path | undefined
): Promise<Field[]> => {
  const fields: Field[] = []

  for (const node of nodes) {
    if (node.kind === 'field') {
      fields.push(...(await renderField(context, node, prefix)))
      continue
    }

    const groupPath = node.path === undefined ? prefix : joinPath(prefix, node.path)
    const wrap = (inner: Field[], suffix: string) => {
      if (node.label === undefined || inner.length === 0) {
        return inner
      }

      const id = idOf(context, `group.${suffix}`)
      hiddenCheck(context, node.label, id)

      return [listField({id, items: inner, label: externalText(node.label)})]
    }

    if (node.iteration === 'bundled' && groupPath !== undefined && groupPath.root === 'data') {
      // Bundled: each element's fields together, element after element.
      for (const element of locate(context.data, groupPath.steps)) {
        const concrete: Path = {
          absolute: true,
          root: 'data',
          steps: element.at.map(part =>
            typeof part === 'number' ? {index: part, kind: 'index'} : {kind: 'field', name: part}
          ),
        }
        fields.push(...wrap(await renderNodes(context, node.fields, concrete), atText(element.at)))
      }
    } else {
      fields.push(
        ...wrap(
          await renderNodes(context, node.fields, groupPath),
          groupPath === undefined
            ? 'fields'
            : atText(groupPath.steps.map(step => (step.kind === 'field' ? step.name : 'all')))
        )
      )
    }
  }

  return fields
}

/** The leaves of the data no field shows, hides or reads: shown behind "More details", so nothing goes unseen. */
const uncovered = (context: Context): {at: (string | number)[]; value: AbiValue}[] => {
  const out: {at: (string | number)[]; value: AbiValue}[] = []
  const isCovered = (at: readonly (string | number)[]) => {
    const key = atText(at)

    for (const covered of context.covered) {
      if (key === covered || key.startsWith(`${covered}.`)) {
        return true
      }
    }

    return false
  }
  const walk = (value: AbiValue, at: (string | number)[]) => {
    if (out.length > 64 || isCovered(at)) {
      return
    }

    if (value.kind === 'tuple' && value.fields.length > 0) {
      value.fields.forEach((field, index) => walk(field.value, [...at, field.name ?? index]))
    } else if (value.kind === 'array' && value.items.length > 0) {
      value.items.slice(0, MAX_LOCATED).forEach((item, index) => walk(item, [...at, index]))
    } else {
      out.push({at, value})
    }
  }
  walk(context.data, [])

  return out
}

const interpolate = (context: Context, template: string): string | undefined => {
  let out = ''

  for (let at = 0; at < template.length; ) {
    const char = template[at]

    if ((char === '{' || char === '}') && template[at + 1] === char) {
      out += char
      at += 2
      continue
    }

    if (char === '}') {
      return undefined
    }

    if (char !== '{') {
      out += char
      at++
      continue
    }

    const close = template.indexOf('}', at)
    const key = close < 0 ? undefined : template.slice(at + 1, close).trim()
    const field = key === undefined ? undefined : context.byPath.get(key.startsWith('#.') ? key.slice(2) : key)

    if (field === undefined || field.kind === 'list') {
      return undefined
    }

    out += formatField(field)
    at = close + 1
  }

  return out.length <= MAX_INTERPOLATED * 2 ? out : undefined
}

/**
 * The fields of `format` over `data`: each field's values formatted as it says, hidden ones left out, nested call
 * data described as actions, parameters it neither shows nor hides listed after (as secondary fields), and the
 * interpolated intent when every placeholder reads. Throws `DescriptorError` when the descriptor does not fit the data
 * (a member it names is missing, a `mustMatch` value differs, a map has no entry).
 */
export const renderFormat = async (input: {
  readonly env: Env
  readonly descriptor: CompiledDescriptor
  readonly format: Format
  readonly data: AbiValue
  readonly container: Container
  readonly depth: number
  readonly nested?: DescribeCall
  /** Field ids already taken in the action. */
  readonly taken?: readonly string[]
}): Promise<Rendered> => {
  const context: Context = {
    ...input,
    actions: [],
    byPath: new Map(),
    covered: new Set(),
    ids: new Set(input.taken ?? []),
    warnings: [],
  }

  if (input.format.intent !== undefined && hasHiddenCharacters(input.format.intent)) {
    context.warnings.push(warning(WARNINGS.HIDDEN_CHARACTERS))
  }

  const fields = await renderNodes(context, input.format.fields, undefined)

  for (const required of input.format.required) {
    const found = locate(context.data, required.steps)

    if (required.root === 'data' && found.some(entry => !context.covered.has(atText(entry.at)))) {
      unreadable(context, undefined)
    }
  }

  const rest = uncovered(context)

  for (const {at, value} of rest.slice(0, 64)) {
    const id = idOf(context, `data.${atText(at)}`)
    fields.push(
      await genericField(
        input.env,
        {id, label: externalText(atText(at) || 'Data'), secondary: true, value},
        (where, words) => hiddenCheck(context, words, where)
      )
    )
  }

  const interpolated =
    input.format.interpolatedIntent === undefined ? undefined : interpolate(context, input.format.interpolatedIntent)

  return {
    actions: context.actions,
    fields,
    raw: [],
    warnings: context.warnings,
    ...(interpolated === undefined ? {} : {summary: externalText(interpolated)}),
  }
}

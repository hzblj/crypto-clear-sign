import type {DisplayField} from '@ethereum-sourcify/clear-signing'
import {
  type ActionInput,
  amountField,
  booleanField,
  type DisplayText,
  durationField,
  externalText,
  type Field,
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
import {hex, utf8} from '@hzblj/nitro-crypto/adapter'

import type {DescribeCall} from '../calls/common'
import {tokenAmount} from '../calls/common'
import {pointInTime} from '../calls/time'
import {ETHEREUM_TEXTS, ETHEREUM_WARNINGS} from '../catalogs'
import {type Env, lower} from '../env'
import {chainName, type Leaf, NO_SIGNER, type Run} from './sourcify'

/** Labels, intents, names: anything a descriptor puts on the screen as a title. */
const MAX_LABEL = 128
/** An interpolated intent, values and all. */
const MAX_SUMMARY = 1024

/** What a descriptor's display became: the model's fields, nested calls as actions, warnings, the words. */
export type Rendered = {
  readonly intent?: DisplayText
  readonly summary?: DisplayText
  readonly fields: Field[]
  readonly actions: ActionInput[]
  readonly warnings: WarningInput[]
}

type Ok = Extract<Run, {ok: true}>

type Context = {
  readonly env: Env
  readonly run: Ok
  readonly descriptor: Readonly<Record<string, unknown>>
  /** The container's `@.to` and `@.from`, as the descriptor reads them. */
  readonly to?: string
  readonly from?: string
  /** Call data: the reference reads strings byte by byte, so text is decoded again as UTF-8. */
  readonly calldata: boolean
  readonly depth: number
  readonly nested?: DescribeCall
  readonly ids: Set<string>
  readonly warnings: WarningInput[]
  readonly actions: ActionInput[]
  /** How many times each descriptor field has been shown, for its probes. */
  readonly seen: Map<number, number>
  /** How many times each descriptor field has been shown, for its elements' ids. */
  readonly shown: Map<number, number>
}

/** A raw run's value, as its field type says. */
type Raw =
  | {readonly kind: 'address'; readonly value: string}
  | {readonly kind: 'integer'; readonly value: bigint}
  | {readonly kind: 'bool'; readonly value: boolean}
  | {readonly kind: 'string'; readonly value: string}
  | {readonly kind: 'bytes'; readonly value: Uint8Array}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const KNOWN_FORMATS = new Set([
  'raw',
  'amount',
  'tokenAmount',
  'nftName',
  'date',
  'duration',
  'unit',
  'enum',
  'chainId',
  'addressName',
  'tokenTicker',
  'calldata',
  'interoperableAddressName',
])

const rawOf = (field: DisplayField): Raw | undefined => {
  try {
    switch (field.fieldType) {
      case 'address':
        return {kind: 'address', value: lower(field.value)}
      case 'uint':
      case 'int':
        return {kind: 'integer', value: BigInt(field.value)}
      case 'bool':
        return {kind: 'bool', value: field.value === 'true'}
      case 'string':
        return {kind: 'string', value: field.value}
      case 'bytes':
        return {kind: 'bytes', value: hex.decode(field.value.slice(2))}
      default:
        return undefined
    }
  } catch {
    return undefined
  }
}

const toUint = (bytes: Uint8Array): bigint => (bytes.length === 0 ? 0n : BigInt(`0x${hex.encode(bytes)}`))

/** An integer, as the reference reads a field for a numeric format: an integer, or the bytes of a slice. */
const integerOf = (raw: Raw | undefined, signed: boolean): bigint | undefined => {
  if (raw?.kind === 'integer') {
    return raw.value
  }

  if (raw?.kind === 'bytes' && raw.value.length <= 32) {
    const value = toUint(raw.value)

    return signed && raw.value.length > 0 ? BigInt.asIntN(raw.value.length * 8, value) : value
  }

  return undefined
}

/** An address, as the reference reads one: an address, the low 20 bytes of a word or of bytes. */
const addressOf = (raw: Raw | undefined): string | undefined => {
  if (raw?.kind === 'address') {
    return raw.value
  }

  if (raw?.kind === 'integer' && raw.value >= 0n && raw.value < 1n << 256n) {
    return `0x${(raw.value & ((1n << 160n) - 1n)).toString(16).padStart(40, '0')}`
  }

  return raw?.kind === 'bytes' && raw.value.length >= 20 ? `0x${hex.encode(raw.value.subarray(-20))}` : undefined
}

/** Base units in a token's decimals, as the reference writes them: no grouping, no trailing zeros. */
const units = (amount: bigint, decimals: number): string => {
  if (decimals === 0) {
    return amount.toString()
  }

  const factor = 10n ** BigInt(decimals)
  const fraction = (amount % factor).toString().padStart(decimals, '0').replace(/0+$/, '')

  return fraction === '' ? (amount / factor).toString() : `${amount / factor}.${fraction}`
}

const idOf = (context: Context, base: string): string => {
  const clean = base.replace(/[^A-Za-z0-9_.:/-]/g, '_').slice(0, 112) || 'field'
  let id = clean

  for (let count = 2; context.ids.has(id); count++) {
    id = `${clean}-${count}`
  }

  context.ids.add(id)

  return id
}

const hidden = (context: Context, words: string | undefined, id?: string) => {
  if (words !== undefined && hasHiddenCharacters(words)) {
    context.warnings.push(warning(WARNINGS.HIDDEN_CHARACTERS, id === undefined ? {} : {fields: [id]}))
  }
}

/** A field the descriptor could not have read as it says, with the reference's reason when it gave one. */
const unreadable = (context: Context, id: string, code?: string) => {
  context.warnings.push(
    warning(ETHEREUM_WARNINGS.UNREADABLE_FIELD, {fields: [id], ...(code === undefined ? {} : {params: {code}})})
  )
}

/** Text the reference decoded byte by byte, as UTF-8 again: what was signed. */
const decoded = (context: Context, leaf: Leaf, value: string): string => {
  const data = leaf.path !== undefined && !leaf.path.startsWith('@.') && !leaf.path.startsWith('$.')

  if (!context.calldata || !data || leaf.constant || [...value].some(char => (char.codePointAt(0) ?? 0) > 0xff)) {
    return value
  }

  return utf8.decode(Uint8Array.from(value, char => char.charCodeAt(0)))
}

type Common = {readonly id: string; readonly label: DisplayText; readonly secondary?: boolean}

/** The raw run's value as the field it is: an address (named), a number, a boolean, bytes or text. */
const genericOf = async (context: Context, leaf: Leaf, raw: Raw | undefined, common: Common): Promise<Field> => {
  switch (raw?.kind) {
    case 'address':
      return context.env.address({...common, value: raw.value})
    case 'integer':
      return numberField({...common, value: raw.value})
    case 'bool':
      return booleanField({...common, value: raw.value})
    case 'bytes':
      return rawField({...common, value: raw.value})
    case 'string': {
      const value = decoded(context, leaf, raw.value)
      hidden(context, value, common.id)

      return textField({...common, value})
    }
    default:
      return textField({...common, value: ''})
  }
}

/** ERC-7930: version 1, EVM chain type, a chain reference and a 20-byte address, each sized. */
const interoperable = (data: Uint8Array): {readonly chainId?: number; readonly address: string} | undefined => {
  const referenceLength = data[4] ?? 0
  const addressLength = data[5 + referenceLength]

  if (
    data[0] !== 0 ||
    data[1] !== 1 ||
    data[2] !== 0 ||
    data[3] !== 0 ||
    referenceLength > 8 ||
    addressLength !== 20 ||
    data.length !== 6 + referenceLength + 20
  ) {
    return undefined
  }

  const chainId = Number(toUint(data.subarray(5, 5 + referenceLength)))

  return {address: `0x${hex.encode(data.subarray(6 + referenceLength))}`, ...(chainId > 0 ? {chainId} : {})}
}

/** A token amount, from what the reference showed and the exact value under it. */
const tokenAmountOf = async (context: Context, shown: DisplayField, value: bigint, common: Common): Promise<Field> => {
  const {env} = context
  const code = shown.warning?.code
  const address = shown.tokenAddress === undefined ? undefined : lower(shown.tokenAddress)
  const asked = address === undefined ? [] : (context.run.lookups.tokens.get(address) ?? [])
  const unlimited = (decimals: number, symbol: string) => {
    const over = shown.value !== `${units(value, decimals)} ${symbol}`

    if (over) {
      context.warnings.push(warning(ETHEREUM_WARNINGS.UNLIMITED_AMOUNT, {fields: [common.id]}))
    }

    return over
  }

  // The descriptor's own token (`$.metadata.token`), and the contract it binds to when no token list knows it.
  const metadata = isRecord(context.descriptor.metadata) ? context.descriptor.metadata : {}
  const own = isRecord(metadata.token) ? metadata.token : {}
  const ownToken =
    typeof own.ticker === 'string' &&
    own.ticker.length > 0 &&
    own.ticker.length <= 32 &&
    typeof own.decimals === 'number' &&
    Number.isInteger(own.decimals) &&
    own.decimals >= 0 &&
    own.decimals <= 255
      ? {decimals: own.decimals, symbol: own.ticker}
      : undefined
  const ownAmount = (token: typeof ownToken & {}) => {
    hidden(context, token.symbol, common.id)

    return amountField({
      ...common,
      decimals: token.decimals,
      symbol: token.symbol,
      unlimited: code === undefined && unlimited(token.decimals, token.symbol),
      value,
      ...(context.to === undefined ? {} : {token: env.checksum(context.to)}),
    })
  }

  if (code === 'UNKNOWN_TOKEN' && address !== undefined) {
    if (ownToken !== undefined && context.to !== undefined && address === lower(context.to)) {
      return ownAmount(ownToken)
    }

    const {field, warnings} = await tokenAmount(
      env,
      {id: common.id, label: common.label, token: address, value},
      {chainId: asked[0]?.chainId, secondary: common.secondary}
    )
    context.warnings.push(...warnings)

    return field
  }

  if (code !== undefined) {
    unreadable(context, common.id, code)

    return amountField({...common, value, ...(address === undefined ? {} : {token: env.checksum(address)})})
  }

  if (address === undefined) {
    return ownToken === undefined ? amountField({...common, value}) : ownAmount(ownToken)
  }

  const known = asked.find(entry => entry.token !== undefined && shown.value.endsWith(` ${entry.token.symbol}`))

  if (known?.token === undefined) {
    // No token answered for it: the chain's native currency (`nativeCurrencyAddress`).
    return env.nativeAmount({...common, unlimited: unlimited(env.native.decimals, env.native.symbol), value})
  }

  const over = unlimited(known.token.decimals, known.token.symbol)
  const {field} = await tokenAmount(
    env,
    {id: common.id, label: common.label, token: address, value},
    {chainId: known.chainId, secondary: common.secondary, unlimited: over}
  )

  return field
}

/** A nested call, described by the package's own pipeline (built-ins first) as an action of its own. */
const nestedCall = async (context: Context, shown: DisplayField, index: number, common: Common) => {
  const {env} = context
  const embedded = shown.embeddedCalldata
  const occurrence = context.seen.get(index) ?? 0
  context.seen.set(index, occurrence + 1)
  const probes = context.run.probes.get(index)

  if (
    embedded?.callee === undefined ||
    shown.warning !== undefined ||
    context.nested === undefined ||
    !/^0x(?:[0-9a-fA-F]{2})*$/.test(shown.value)
  ) {
    unreadable(context, common.id, shown.warning?.code)

    return rawField({...common, value: /^0x(?:[0-9a-fA-F]{2})*$/.test(shown.value) ? shown.value : '0x'})
  }

  if (embedded.chainId !== undefined && embedded.chainId !== env.chainId) {
    // A call for another chain: this client's knowledge does not reach it.
    unreadable(context, common.id)

    return rawField({...common, value: shown.value})
  }

  const from = probes?.from[occurrence] ?? context.from
  context.actions.push(
    await context.nested({
      data: hex.decode(shown.value.slice(2)),
      depth: context.depth + 1,
      to: env.checksum(embedded.callee),
      value: probes?.value[occurrence] ?? 0n,
      ...(from === undefined ? {} : {from: env.checksum(from)}),
    })
  )

  return undefined
}

/** One field the reference showed, with its raw run twin, as the model's field (or a nested action). */
const fieldOf = async (
  context: Context,
  shown: DisplayField,
  twin: Ok['raw'][number],
  common: Common
): Promise<Field | undefined> => {
  const {env} = context
  const {leaf} = twin
  const raw = rawOf(twin.field)
  const code = shown.warning?.code
  const fallback = async (reason?: string) => {
    unreadable(context, common.id, reason)

    return genericOf(context, leaf, raw, common)
  }

  if (shown.rawEncryptedValue !== undefined) {
    // An encrypted value (ERC-7984) is not decrypted here: shown as it is signed.
    unreadable(context, common.id, code ?? 'DECRYPTION_FAILED')

    return /^0x(?:[0-9a-fA-F]{2})*$/.test(shown.rawEncryptedValue)
      ? rawField({...common, value: shown.rawEncryptedValue})
      : genericOf(context, leaf, raw, common)
  }

  if (!KNOWN_FORMATS.has(shown.format)) {
    return fallback()
  }

  switch (shown.format) {
    case 'addressName': {
      if (shown.rawAddress === undefined) {
        return fallback(code)
      }

      if (code === 'ADDRESS_TYPE_MISMATCH') {
        context.warnings.push(warning(ETHEREUM_WARNINGS.ADDRESS_TYPE_MISMATCH, {fields: [common.id]}))
      } else if (code !== undefined && code !== 'UNKNOWN_ADDRESS') {
        unreadable(context, common.id, code)
      }

      // The sender's placeholder, with no signer to stand for: the address as the data has it.
      const address = lower(shown.rawAddress) === NO_SIGNER ? addressOf(raw) : shown.rawAddress

      return address === undefined ? fallback(code) : env.address({...common, value: address})
    }
    case 'tokenAmount':
    case 'amount': {
      const value = integerOf(raw, shown.fieldType === 'int')

      if (value === undefined || value < 0n || (code !== undefined && shown.fieldType !== 'uint')) {
        return fallback(code)
      }

      if (shown.format === 'tokenAmount') {
        return tokenAmountOf(context, shown, value, common)
      }

      if (code !== undefined) {
        unreadable(context, common.id, code)

        return amountField({...common, value})
      }

      return env.nativeAmount({...common, value})
    }
    case 'tokenTicker': {
      const address = addressOf(raw)

      if (address === undefined || (code !== undefined && code !== 'UNKNOWN_TOKEN')) {
        return fallback(code)
      }

      if (code === 'UNKNOWN_TOKEN') {
        context.warnings.push(warning(WARNINGS.UNKNOWN_TOKEN, {fields: [common.id]}))

        return env.address({...common, value: address})
      }

      hidden(context, shown.value, common.id)

      return textField({...common, value: shown.value})
    }
    case 'nftName': {
      const tokenId = integerOf(raw, false)

      if (tokenId === undefined || (code !== undefined && code !== 'UNKNOWN_NFT_COLLECTION')) {
        return fallback(code)
      }

      // The collections were asked for in the order of the fields: this field's is the next one.
      const collection = context.run.lookups.collections.shift()

      return listField({
        ...common,
        items: [
          ...(collection === undefined
            ? []
            : [
                await env.address({
                  chainId: collection.chainId,
                  id: idOf(context, `${common.id}.collection`),
                  label: ETHEREUM_TEXTS.label.collection,
                  value: collection.address,
                }),
              ]),
          numberField({id: idOf(context, `${common.id}.tokenId`), label: ETHEREUM_TEXTS.label.tokenId, value: tokenId}),
        ],
      })
    }
    case 'date': {
      const seconds = integerOf(raw, false)

      if (seconds === undefined || seconds < 0n || (code !== undefined && code !== 'UNKNOWN_BLOCK')) {
        return fallback(code)
      }

      // A block height no resolver turns into a time: a number of blocks.
      if (code === 'UNKNOWN_BLOCK') {
        return numberField({...common, unit: ETHEREUM_TEXTS.unit.blocks, value: seconds})
      }

      // What a descriptor's date means (a deadline, a start) is not known here, so it is never marked expired.
      return pointInTime({...common, value: fromUnixSeconds(seconds)})
    }
    case 'duration': {
      const seconds = integerOf(raw, false)

      if (seconds === undefined || seconds < 0n || code !== undefined) {
        return fallback(code)
      }

      return seconds * 1000n > BigInt(Number.MAX_SAFE_INTEGER)
        ? durationField({...common, value: 'never'})
        : durationField({...common, value: Number(seconds) * 1000})
    }
    case 'unit':
    case 'enum': {
      if (code !== undefined) {
        return fallback(code)
      }

      hidden(context, shown.value, common.id)
      const percent = /^-?[0-9]+(?:\.[0-9]+)?%$/.test(shown.value) ? Number(shown.value.slice(0, -1)) : undefined

      return shown.format === 'unit' && percent !== undefined && Number.isFinite(percent)
        ? percentField({...common, value: percent})
        : textField({...common, value: shown.value.slice(0, 1024)})
    }
    case 'chainId': {
      const chainId = integerOf(raw, false)

      if (chainId === undefined || (code !== undefined && code !== 'UNKNOWN_CHAIN')) {
        return fallback(code)
      }

      return textField({...common, value: chainName(chainId)})
    }
    case 'interoperableAddressName': {
      const found = raw?.kind === 'bytes' ? interoperable(raw.value) : undefined

      return found === undefined
        ? fallback(code)
        : env.address({
            ...common,
            value: found.address,
            ...(found.chainId === undefined ? {} : {chainId: found.chainId}),
          })
    }
    case 'calldata':
      return nestedCall(context, shown, twin.index, common)
    default:
      return code === undefined || code === 'UNKNOWN_ADDRESS' ? genericOf(context, leaf, raw, common) : fallback(code)
  }
}

const labelOf = (context: Context, words: string | undefined, id: string): DisplayText => {
  const label = (words ?? '').trim() || 'Value'
  hidden(context, label, id)

  return externalText(label.slice(0, MAX_LABEL))
}

/** The reference's intent as the action's: text, or a complex one as `key: value` pairs. */
const intentOf = (context: Context, intent: unknown): DisplayText | undefined => {
  const words =
    typeof intent === 'string'
      ? intent
      : isRecord(intent)
        ? Object.entries(intent)
            .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : ''}`)
            .join(', ')
        : undefined

  if (words === undefined || words.trim() === '') {
    return undefined
  }

  hidden(context, words)

  return externalText(words.trim().slice(0, MAX_LABEL))
}

/**
 * A descriptor's display, as the reference rendered it, in the model: each field as the field kind its format means
 * (amounts exact, addresses named by the resolvers, dates, durations, bytes), labelled groups and arrays as lists,
 * nested calls as actions described by the package's pipeline, the reference's field warnings as the package's codes,
 * the intent, and the interpolated intent as the summary.
 */
export const renderDisplay = async (input: {
  readonly env: Env
  readonly run: Ok
  readonly descriptor: Readonly<Record<string, unknown>>
  readonly to?: string
  readonly from?: string
  readonly calldata: boolean
  readonly depth: number
  readonly nested?: DescribeCall
  /** Field ids already taken in the action. */
  readonly taken: readonly string[]
}): Promise<Rendered> => {
  const context: Context = {
    ...input,
    actions: [],
    ids: new Set(input.taken),
    seen: new Map(),
    shown: new Map(),
    warnings: [],
  }
  const {display, raw} = input.run
  const fields: Field[] = []
  let at = 0

  const one = async (shown: DisplayField, label?: DisplayText): Promise<Field | undefined> => {
    const twin = raw[at++]

    if (twin === undefined) {
      return undefined
    }

    const element = context.shown.get(twin.index) ?? 0
    context.shown.set(twin.index, element + 1)
    const id = idOf(context, twin.leaf.id.replace('#', String(element)).replace(/\.#/g, ''))

    return fieldOf(context, shown, twin, {
      id,
      label: label ?? labelOf(context, shown.label, id),
      ...(twin.leaf.secondary ? {secondary: true} : {}),
    })
  }

  for (const entry of display.fields ?? []) {
    if (!('fields' in entry)) {
      const field = await one(entry)

      if (field !== undefined) {
        fields.push(field)
      }

      continue
    }

    // An array of one field, or a group: a list. A group without a label is its fields.
    const leaves = new Set(entry.fields.map((_, index) => raw[at + index]?.index))
    const array = entry.label === undefined && leaves.size === 1 && entry.fields.length > 1
    const items: Field[] = []

    for (const [index, shown] of entry.fields.entries()) {
      const item = await one(
        shown,
        array
          ? shown.separator !== undefined
            ? externalText(shown.separator.slice(0, MAX_LABEL))
            : text(ETHEREUM_TEXTS.label.item, {index: index + 1})
          : undefined
      )

      if (item !== undefined) {
        items.push(item)
      }
    }

    if (items.length === 0) {
      continue
    }

    if (entry.label === undefined && !array) {
      fields.push(...items)
      continue
    }

    const first = entry.fields[0]
    const listId = idOf(
      context,
      array ? `${(raw[at - 1]?.leaf.id ?? 'data').replace(/\.#/g, '')}.all` : `group.${fields.length}`
    )
    fields.push(
      listField({
        id: listId,
        items,
        label: labelOf(context, entry.label ?? first?.label, listId),
        ...(array && raw[at - 1]?.leaf.secondary === true ? {secondary: true} : {}),
      })
    )
  }

  const intent = intentOf(context, display.intent)
  const summary = typeof display.interpolatedIntent === 'string' ? display.interpolatedIntent : undefined

  if (summary !== undefined) {
    hidden(context, summary)
  }

  return {
    actions: context.actions,
    fields,
    warnings: context.warnings,
    ...(intent === undefined ? {} : {intent}),
    ...(summary === undefined || summary.trim() === '' || summary.length > MAX_SUMMARY
      ? {}
      : {summary: externalText(summary.trim())}),
  }
}

import {type FormatAmountOptions, formatAmount, isDecimals} from './amount'
import {invalid} from './errors'
import {type DisplayText, isTextCode, localize, type TextParams, type Translations} from './text'
import {formatDateTime, formatDuration, isTime} from './time'

/** Every kind of field, in no particular order. A new kind is a minor release; a UI shows an unknown one as text. */
export const FIELD_KINDS = [
  'amount',
  'address',
  'text',
  'datetime',
  'duration',
  'raw',
  'percent',
  'number',
  'boolean',
  'list',
] as const

export type FieldKind = (typeof FIELD_KINDS)[number]

/** What every field has. */
export type FieldCommon = {
  /**
   * Unique within its action (its fields, its raw fields and every list in them): what a warning's `fields` name.
   * Optional for a field nothing points at. Letters, digits and `_ . : / -`.
   */
  readonly id?: string
  /** What the field is: `LABELS.spender`, a chain package's label, or a descriptor's (`externalText`). */
  readonly label: DisplayText
  /** Shown behind "More details" rather than up front: a nonce, a gas limit, a fee's parts. */
  readonly secondary?: boolean
}

/**
 * An amount of an asset, exact. `value` is a `bigint` in the asset's smallest unit; `formatAmount` shows it.
 *
 * A token no resolver knows has no `decimals` and no `symbol`: show the base units, and its action carries
 * `UNKNOWN_TOKEN`.
 */
export type AmountField = FieldCommon & {
  readonly kind: 'amount'
  /** In the smallest unit: wei, lamports, satoshis, a token's base units. A `bigint` (see the README on JSON). */
  readonly value: bigint
  /** The asset's decimals (18 for ETH, 9 for SOL, 8 for BTC, the token's), absent when unknown. */
  readonly decimals?: number
  /** `ETH`, `USDC`; absent when unknown. */
  readonly symbol?: string
  /** The token's contract or mint; absent for the chain's native asset. */
  readonly token?: string
  /** The protocol's "unlimited" (an approval of `maxUint(256)`): show "Unlimited", never the number. */
  readonly unlimited: boolean
  /** A native asset's smallest unit, for a UI that shows it: `wei`, `lamports`, `sat`. */
  readonly baseUnit?: string
}

/**
 * Who an address is to the signer, as far as anything here knows:
 *
 * - `self`: the account that signs.
 * - `own`: another account of the user's: the `names` resolver says so, or the chain package knows it from what is
 *   signed (the signer's own token accounts, its change).
 * - `contact`: an entry of the user's address book (the `names` resolver).
 * - `contract`: a contract or program known by name (a resolver, a descriptor, or a built-in such as the System
 *   Program).
 * - `token`: a token contract or mint the `tokens` resolver knows.
 * - `unknown`: none of these.
 */
export const ADDRESS_RELATIONS = ['self', 'own', 'contact', 'contract', 'token', 'unknown'] as const

export type AddressRelation = (typeof ADDRESS_RELATIONS)[number]

/** An address, in the chain's own form (EIP-55, Base58, Bech32), with what is known of it. */
export type AddressField = FieldCommon & {
  readonly kind: 'address'
  readonly value: string
  /** A name for people (`Uniswap Universal Router`, `Savings`, `USDC`), when one is known. */
  readonly name?: string
  readonly relation: AddressRelation
}

/** Text to show as it is. When it comes from outside (a message, a descriptor), check `hasHiddenCharacters`. */
export type TextField = FieldCommon & {
  readonly kind: 'text'
  readonly value: string
}

/** A moment: a deadline, an expiry, a start. */
export type DateTimeField = FieldCommon & {
  readonly kind: 'datetime'
  /** Milliseconds since the Unix epoch, UTC. Absent when `never`. */
  readonly value?: number
  /** It never comes: the protocol's "no deadline" (as the chain package documents), or past `MAX_TIME`. */
  readonly never: boolean
  /**
   * Past, by the clock the result was made with (`Clock`). Always `false` when `never`, and for a moment that is not
   * a deadline (an issue time, a start: `dateTimeField`'s `deadline: false`).
   */
  readonly expired: boolean
}

/** A length of time: how long something stays valid, a lock. */
export type DurationField = FieldCommon & {
  readonly kind: 'duration'
  /** Milliseconds. Absent when `never`. */
  readonly value?: number
  /** It never ends. */
  readonly never: boolean
}

/** Bytes, as lowercase hex with `0x`: call data, a script, data nothing decoded. */
export type RawField = FieldCommon & {
  readonly kind: 'raw'
  readonly value: string
}

/** A percentage: `0.5` is 0.5 %. */
export type PercentField = FieldCommon & {
  readonly kind: 'percent'
  readonly value: number
}

/** A number that is not an amount: a nonce, a gas limit, a count. */
export type NumberField = FieldCommon & {
  readonly kind: 'number'
  readonly value: bigint | number
  /** What it counts (`blocks`, `gas`), for people. */
  readonly unit?: DisplayText
}

export type BooleanField = FieldCommon & {
  readonly kind: 'boolean'
  readonly value: boolean
}

/** Fields that belong together, in order: a recipient's address and amount, the tokens of a batch permit. */
export type ListField = FieldCommon & {
  readonly kind: 'list'
  readonly items: readonly Field[]
}

/** A field, discriminated by `kind`. */
export type Field =
  | AmountField
  | AddressField
  | TextField
  | DateTimeField
  | DurationField
  | RawField
  | PercentField
  | NumberField
  | BooleanField
  | ListField

/** The field of `kind`. */
export type FieldOf<Kind extends FieldKind> = Extract<Field, {readonly kind: Kind}>

/** Whether `value` is a field kind. */
export const isFieldKind = (value: unknown): value is FieldKind =>
  typeof value === 'string' && (FIELD_KINDS as readonly string[]).includes(value)

/** Whether `value` is a well-formed field (of `kind`, when given); narrows to it. */
export const isField = <Kind extends FieldKind = FieldKind>(value: unknown, kind?: Kind): value is FieldOf<Kind> => {
  if (kind !== undefined && (typeof value !== 'object' || value === null || (value as Field).kind !== kind)) {
    return false
  }

  try {
    checkField(value, 'field', new Set())

    return true
  } catch {
    return false
  }
}

const FIELD_ID = /^[A-Za-z0-9_.:/-]{1,128}$/
const HEX = /^0x(?:[0-9a-f]{2})*$/

/** Whether `value` is an object literal, not an instance of a class. Internal. */
export const isPlainObject = (value: unknown): value is Readonly<Record<string, unknown>> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)

  return prototype === Object.prototype || prototype === null
}

/** The object without its `undefined` values: absent is absent. Internal. */
export const compact = <Value extends Record<string, unknown>>(value: Value): Value =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Value

/** Text params, checked and copied; `undefined` when empty. Internal. */
export const checkParams = (params: unknown, where: string): TextParams | undefined => {
  if (params === undefined) {
    return undefined
  }

  if (
    !isPlainObject(params) ||
    !Object.values(params).every(
      value => typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
    )
  ) {
    throw invalid(`${where} has params that are strings and finite numbers.`)
  }

  return Object.keys(params).length === 0 ? undefined : (Object.freeze({...params}) as TextParams)
}

/** A `DisplayText`, checked and copied. Internal. */
export const checkText = (value: unknown, where: string): DisplayText => {
  if (!isPlainObject(value) || !isTextCode(value.code) || typeof value.text !== 'string') {
    throw invalid(`${where} is a DisplayText: a text code and its English.`)
  }

  return Object.freeze(compact({code: value.code, params: checkParams(value.params, where), text: value.text}))
}

const optionalString = (value: unknown, where: string): string | undefined => {
  if (value !== undefined && typeof value !== 'string') {
    throw invalid(`${where} is a string when present.`)
  }

  return value
}

const flag = (value: unknown, where: string, fallback?: boolean): boolean => {
  if (value === undefined && fallback !== undefined) {
    return fallback
  }

  if (typeof value !== 'boolean') {
    throw invalid(`${where} is a boolean.`)
  }

  return value
}

/**
 * `value` as a field, checked against the model and copied (frozen, `undefined` dropped): what `createClearSigning`
 * does to every field. `ids` collects the action's field ids, which must be unique. Internal.
 */
export const checkField = (value: unknown, where: string, ids: Set<string>): Field => {
  if (!isPlainObject(value) || !isFieldKind(value.kind)) {
    throw invalid(`${where} is a field: an object literal with a known kind.`)
  }

  const id = optionalString(value.id, `${where}.id`)

  if (id !== undefined) {
    if (!FIELD_ID.test(id)) {
      throw invalid(`${where}.id is 1 to 128 letters, digits and _ . : / -.`)
    }

    if (ids.has(id)) {
      throw invalid(`${where}.id is not unique in its action.`)
    }

    ids.add(id)
  }

  const common = {
    id,
    label: checkText(value.label, `${where}.label`),
    secondary: value.secondary === undefined ? undefined : flag(value.secondary, `${where}.secondary`),
  }
  const field = ((): Field => {
    switch (value.kind) {
      case 'amount': {
        if (typeof value.value !== 'bigint') {
          throw invalid(`${where}.value is a bigint of base units.`)
        }

        if (value.decimals !== undefined && !isDecimals(value.decimals)) {
          throw invalid(`${where}.decimals is a whole number from 0 to 255.`)
        }

        return {
          ...common,
          baseUnit: optionalString(value.baseUnit, `${where}.baseUnit`),
          decimals: value.decimals,
          kind: 'amount',
          symbol: optionalString(value.symbol, `${where}.symbol`),
          token: optionalString(value.token, `${where}.token`),
          unlimited: flag(value.unlimited, `${where}.unlimited`, false),
          value: value.value,
        }
      }
      case 'address': {
        if (typeof value.value !== 'string' || value.value === '') {
          throw invalid(`${where}.value is an address.`)
        }

        const relation = value.relation ?? 'unknown'

        if (!(ADDRESS_RELATIONS as readonly unknown[]).includes(relation)) {
          throw invalid(`${where}.relation is one of ${ADDRESS_RELATIONS.join(', ')}.`)
        }

        return {
          ...common,
          kind: 'address',
          name: optionalString(value.name, `${where}.name`),
          relation: relation as AddressRelation,
          value: value.value,
        }
      }
      case 'text': {
        if (typeof value.value !== 'string') {
          throw invalid(`${where}.value is a string.`)
        }

        return {...common, kind: 'text', value: value.value}
      }
      case 'datetime': {
        const never = flag(value.never, `${where}.never`, false)

        if (never ? value.value !== undefined || value.expired === true : !isTime(value.value)) {
          throw invalid(`${where} is a moment in milliseconds, or never (without a value, and not expired).`)
        }

        return {
          ...common,
          expired: flag(value.expired, `${where}.expired`, false),
          kind: 'datetime',
          never,
          value: value.value as number | undefined,
        }
      }
      case 'duration': {
        const never = flag(value.never, `${where}.never`, false)
        const length = value.value

        if (never ? length !== undefined : typeof length !== 'number' || !Number.isFinite(length) || length < 0) {
          throw invalid(`${where} is a number of milliseconds, 0 or more, or never (without a value).`)
        }

        return {...common, kind: 'duration', never, value: length as number | undefined}
      }
      case 'raw': {
        if (typeof value.value !== 'string' || !HEX.test(value.value)) {
          throw invalid(`${where}.value is lowercase hex of whole bytes, with 0x.`)
        }

        return {...common, kind: 'raw', value: value.value}
      }
      case 'percent': {
        if (typeof value.value !== 'number' || !Number.isFinite(value.value)) {
          throw invalid(`${where}.value is a finite number.`)
        }

        return {...common, kind: 'percent', value: value.value}
      }
      case 'number': {
        if (typeof value.value !== 'bigint' && (typeof value.value !== 'number' || !Number.isFinite(value.value))) {
          throw invalid(`${where}.value is a bigint or a finite number.`)
        }

        return {
          ...common,
          kind: 'number',
          unit: value.unit === undefined ? undefined : checkText(value.unit, `${where}.unit`),
          value: value.value,
        }
      }
      case 'boolean':
        return {...common, kind: 'boolean', value: flag(value.value, `${where}.value`)}
      case 'list': {
        if (!Array.isArray(value.items)) {
          throw invalid(`${where}.items is an array of fields.`)
        }

        const items = value.items.map((item, index) => checkField(item, `${where}.items[${index}]`, ids))

        return {...common, items: Object.freeze(items), kind: 'list'}
      }
    }
  })()

  return Object.freeze(compact(field))
}

const hex = (bytes: Uint8Array) => {
  let out = '0x'

  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0')
  }

  return out
}

type Input<F extends Field> = Omit<F, 'kind'>

/** An amount field; `unlimited` is `false` unless given. */
export const amountField = (input: Omit<Input<AmountField>, 'unlimited'> & {readonly unlimited?: boolean}) =>
  checkField({...input, kind: 'amount'}, 'amountField', new Set()) as AmountField

/** An address field; `relation` is `unknown` unless given (a chain package's resolver context finds it). */
export const addressField = (input: Omit<Input<AddressField>, 'relation'> & {readonly relation?: AddressRelation}) =>
  checkField({...input, kind: 'address'}, 'addressField', new Set()) as AddressField

export const textField = (input: Input<TextField>) =>
  checkField({...input, kind: 'text'}, 'textField', new Set()) as TextField

/**
 * What `dateTimeField` takes: the moment, and either `now` (a deadline, the default) or `deadline: false` (a moment
 * that does not expire).
 */
export type DateTimeFieldInput = FieldCommon & {readonly value: number | 'never'} & (
    | {
        /** The resolver context's `now`: a moment before it has passed. */
        readonly now: number
        /** A deadline or an expiry (the default): `expired` once it has passed. */
        readonly deadline?: true
      }
    | {
        /**
         * Not a deadline: when something was issued, when it starts, a moment a descriptor names without saying what
         * it means. Never `expired`, whatever the clock says.
         */
        readonly deadline: false
        /** Not needed, and checked when given. */
        readonly now?: number
      }
  )

/**
 * A moment, from milliseconds or `'never'` (`fromUnixSeconds` turns chain timestamps into either). A deadline (the
 * default) is `expired` when it lies before `now` (the resolver context's `now`); a moment with `deadline: false` (an
 * issue time, a "valid from") is past without having expired, and never is.
 *
 * ```ts
 * dateTimeField({id: 'deadline', label: LABELS.deadline, now: context.now, value: fromUnixSeconds(deadline)})
 * dateTimeField({deadline: false, id: 'issuedAt', label: LABELS.issuedAt, value: Date.parse(issuedAt)})
 * ```
 */
export const dateTimeField = (input: DateTimeFieldInput): DateTimeField => {
  const {deadline, now, value, ...common} = input

  if (deadline !== undefined && typeof deadline !== 'boolean') {
    throw invalid('dateTimeField.deadline is a boolean when present.')
  }

  if ((deadline !== false || now !== undefined) && !isTime(now)) {
    throw invalid('dateTimeField.now is a moment in milliseconds.')
  }

  return checkField(
    value === 'never'
      ? {...common, expired: false, kind: 'datetime', never: true}
      : {
          ...common,
          expired: deadline !== false && typeof value === 'number' && value < (now as number),
          kind: 'datetime',
          never: false,
          value,
        },
    'dateTimeField',
    new Set()
  ) as DateTimeField
}

/** A length of time, from milliseconds or `'never'`. */
export const durationField = (input: FieldCommon & {readonly value: number | 'never'}): DurationField => {
  const {value, ...common} = input

  return checkField(
    value === 'never' ? {...common, kind: 'duration', never: true} : {...common, kind: 'duration', never: false, value},
    'durationField',
    new Set()
  ) as DurationField
}

/** Bytes, from a `Uint8Array` or hex (with `0x`, any case). */
export const rawField = (input: FieldCommon & {readonly value: Uint8Array | string}): RawField =>
  checkField(
    {...input, kind: 'raw', value: typeof input.value === 'string' ? input.value.toLowerCase() : hex(input.value)},
    'rawField',
    new Set()
  ) as RawField

export const percentField = (input: Input<PercentField>) =>
  checkField({...input, kind: 'percent'}, 'percentField', new Set()) as PercentField

export const numberField = (input: Input<NumberField>) =>
  checkField({...input, kind: 'number'}, 'numberField', new Set()) as NumberField

export const booleanField = (input: Input<BooleanField>) =>
  checkField({...input, kind: 'boolean'}, 'booleanField', new Set()) as BooleanField

/** A group of fields; their ids share the action's namespace. */
export const listField = (input: Input<ListField>) =>
  checkField({...input, kind: 'list'}, 'listField', new Set()) as ListField

export type FormatFieldOptions = FormatAmountOptions & {
  /** For the labels inside lists and for units. */
  readonly translations?: Translations
}

/**
 * A field's value as English text, exact: amounts by `formatAmount` (base units when the decimals are unknown),
 * addresses with their name, moments as ISO 8601 in UTC, durations in exact units, booleans as Yes or No, a list as
 * `label: value` pairs. What `plainText` shows; a UI with its own number and date formats renders the fields itself.
 */
export const formatField = (field: Field, options: FormatFieldOptions = {}): string => {
  switch (field.kind) {
    case 'amount':
      return field.decimals === undefined && !field.unlimited
        ? `${formatAmount(field, {...options, symbol: false})} base units${field.symbol ? ` of ${field.symbol}` : ''}`
        : formatAmount(field, options)
    case 'address':
      return field.name === undefined ? field.value : `${field.name} (${field.value})`
    case 'text':
    case 'raw':
      return field.value
    case 'datetime':
      return field.never || field.value === undefined
        ? 'Never'
        : `${formatDateTime(field.value)}${field.expired ? ' (expired)' : ''}`
    case 'duration':
      return field.never || field.value === undefined ? 'Forever' : formatDuration(field.value)
    case 'percent':
      return `${field.value}%`
    case 'number':
      return field.unit === undefined
        ? String(field.value)
        : `${field.value} ${localize(field.unit, options.translations)}`
    case 'boolean':
      return field.value ? 'Yes' : 'No'
    case 'list':
      return field.items
        .map(item => `${localize(item.label, options.translations)}: ${formatField(item, options)}`)
        .join('; ')
  }
}

/** The field `id` names among `fields` (and inside their lists), if any. */
export const findFieldIn = (fields: readonly Field[], id: string): Field | undefined => {
  for (const field of fields) {
    if (field.id === id) {
      return field
    }

    if (field.kind === 'list') {
      const found = findFieldIn(field.items, id)

      if (found !== undefined) {
        return found
      }
    }
  }

  return undefined
}

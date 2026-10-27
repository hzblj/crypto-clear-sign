import {invalid} from './errors'

/** The most decimals an amount may have (ERC-20's `decimals` is a `uint8`). */
export const MAX_DECIMALS = 255

/** What `formatAmount` shows for an unlimited amount unless told otherwise. */
export const UNLIMITED_TEXT = 'Unlimited'

/** What `formatAmount` reads: an `AmountField` is one. */
export type AmountLike = {
  /** In the asset's smallest unit (wei, lamports, satoshis, a token's base units). */
  readonly value: bigint
  /** Absent when unknown: the value shows as an integer of base units. */
  readonly decimals?: number
  readonly symbol?: string
  /** The protocol's "unlimited": shown as such, never as the number. */
  readonly unlimited?: boolean
}

export type FormatAmountOptions = {
  /** Whether to follow the number with the symbol, when there is one. Default `true`. */
  readonly symbol?: boolean
  /** Thousands separators in the integer part (`1,234,567.5`). Default `false`: digits only, as they are. */
  readonly grouping?: boolean
  /** The word for an unlimited amount, for a translated UI. Default `UNLIMITED_TEXT`. */
  readonly unlimited?: string
}

/** Whether `decimals` is a whole number from 0 to `MAX_DECIMALS`. Internal. */
export const isDecimals = (decimals: unknown): decimals is number =>
  typeof decimals === 'number' && Number.isInteger(decimals) && decimals >= 0 && decimals <= MAX_DECIMALS

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/**
 * An amount as exact decimal text: every digit, nothing rounded, trailing zeros of the fraction dropped.
 *
 * ```ts
 * formatAmount({decimals: 6, symbol: 'USDC', value: 1_500_000n}) // '1.5 USDC'
 * formatAmount({decimals: 18, value: 1n}) // '0.000000000000000001'
 * formatAmount({unlimited: true, symbol: 'USDC', value: maxUint(256)}) // 'Unlimited USDC'
 * formatAmount({value: 1_500_000n}) // '1500000': no decimals, base units
 * ```
 */
export const formatAmount = (amount: AmountLike, options: FormatAmountOptions = {}): string => {
  const {decimals, symbol, unlimited, value} = amount

  if (typeof value !== 'bigint') {
    throw invalid('An amount is a bigint of base units.')
  }

  if (decimals !== undefined && !isDecimals(decimals)) {
    throw invalid(`An amount's decimals are a whole number from 0 to ${MAX_DECIMALS}.`)
  }

  const suffix = options.symbol !== false && symbol !== undefined && symbol !== '' ? ` ${symbol}` : ''

  if (unlimited === true) {
    return `${options.unlimited ?? UNLIMITED_TEXT}${suffix}`
  }

  const sign = value < 0n ? '-' : ''
  const digits = (value < 0n ? -value : value).toString()
  const places = decimals ?? 0
  const padded = digits.padStart(places + 1, '0')
  const whole = padded.slice(0, padded.length - places)
  const fraction = padded.slice(padded.length - places).replace(/0+$/, '')
  const integer = options.grouping === true ? group(whole) : whole

  return `${sign}${integer}${fraction === '' ? '' : `.${fraction}`}${suffix}`
}

/**
 * The largest unsigned integer of `bits` bits, `2 ** bits - 1`: what protocols use for "unlimited" (an ERC-20
 * approval of `maxUint(256)`, Permit2's `maxUint(160)`, an SPL approval of `maxUint(64)`).
 */
export const maxUint = (bits: number): bigint => {
  if (!Number.isInteger(bits) || bits < 1 || bits > 1024) {
    throw invalid('maxUint takes a whole number of bits from 1 to 1024.')
  }

  return (1n << BigInt(bits)) - 1n
}

import {invalid} from './errors'

/** Where "now" comes from, in milliseconds since the Unix epoch: `Date.now` unless a test or an app gives its own. */
export type Clock = {
  readonly now: () => number
}

/** The device's clock. */
export const systemClock: Clock = Object.freeze({now: () => Date.now()})

/** The latest moment a `Date` can hold, in milliseconds: the year 275760. Later is "never" here. */
export const MAX_TIME = 8_640_000_000_000_000

/**
 * How long a permission or signature may stay valid before it is `LONG_LIVED`: 30 days, in milliseconds (the default
 * lifetime of a Uniswap Permit2 allowance, which is long already).
 */
export const LONG_LIVED_AFTER = 30 * 24 * 60 * 60 * 1000

/** Whether `value` is a moment a `Date` can hold. Internal. */
export const isTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_TIME

/**
 * A Unix timestamp in seconds (EVM deadlines, Solana's `i64`, Bitcoin's lock times) in milliseconds, or `'never'`
 * when it lies past `MAX_TIME`, as an EVM deadline of `maxUint(256)` does.
 */
export const fromUnixSeconds = (seconds: bigint | number): number | 'never' => {
  if (typeof seconds === 'number' && !Number.isInteger(seconds)) {
    throw invalid('A Unix timestamp is a whole number of seconds.')
  }

  const whole = BigInt(seconds)

  if (whole * 1000n > BigInt(MAX_TIME)) {
    return 'never'
  }

  if (whole * 1000n < -BigInt(MAX_TIME)) {
    throw invalid('A Unix timestamp lies before the earliest moment a Date can hold.')
  }

  return Number(whole) * 1000
}

/**
 * Whether a deadline or an expiry calls for a warning, by `now` (milliseconds): `EXPIRED` once it has passed (a
 * deadline equal to `now` is still valid), `LONG_LIVED` when it never comes or lies more than `longLivedAfter` ahead,
 * `undefined` otherwise.
 */
export const checkDeadline = (
  deadline: {readonly value?: number; readonly never: boolean},
  options: {readonly now: number; readonly longLivedAfter?: number}
): 'EXPIRED' | 'LONG_LIVED' | undefined => {
  if (deadline.never) {
    return 'LONG_LIVED'
  }

  if (!isTime(deadline.value) || !isTime(options.now)) {
    throw invalid('A deadline and now are moments in milliseconds.')
  }

  if (deadline.value < options.now) {
    return 'EXPIRED'
  }

  return deadline.value - options.now > (options.longLivedAfter ?? LONG_LIVED_AFTER) ? 'LONG_LIVED' : undefined
}

/** Whether a duration calls for `LONG_LIVED`: it never ends, or lasts longer than `longLivedAfter`. */
export const checkDuration = (
  duration: {readonly value?: number; readonly never: boolean},
  options: {readonly longLivedAfter?: number} = {}
): 'LONG_LIVED' | undefined => {
  if (duration.never) {
    return 'LONG_LIVED'
  }

  if (typeof duration.value !== 'number' || !Number.isFinite(duration.value) || duration.value < 0) {
    throw invalid('A duration is a number of milliseconds, 0 or more.')
  }

  return duration.value > (options.longLivedAfter ?? LONG_LIVED_AFTER) ? 'LONG_LIVED' : undefined
}

/** A moment as ISO 8601 in UTC, without milliseconds when there are none: `2026-10-27T12:00:00Z`. */
export const formatDateTime = (time: number): string => {
  if (!isTime(time)) {
    throw invalid('A moment is a number of milliseconds a Date can hold.')
  }

  return new Date(time).toISOString().replace('.000Z', 'Z')
}

const UNITS = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
  ['second', 1000],
  ['millisecond', 1],
] as const

/** A duration in exact English units, nothing rounded: `30 days`, `1 day 2 hours 5 seconds`, `0 seconds`. */
export const formatDuration = (duration: number): string => {
  if (!Number.isFinite(duration) || duration < 0) {
    throw invalid('A duration is a number of milliseconds, 0 or more.')
  }

  let rest = Math.round(duration)
  const parts: string[] = []

  for (const [unit, size] of UNITS) {
    const count = Math.floor(rest / size)
    rest -= count * size

    if (count > 0) {
      parts.push(`${count} ${unit}${count === 1 ? '' : 's'}`)
    }
  }

  return parts.length === 0 ? '0 seconds' : parts.join(' ')
}

import {
  checkDeadline,
  type DateTimeField,
  type DisplayText,
  dateTimeField,
  fromUnixSeconds,
  WARNINGS,
  type WarningInput,
  warning,
} from '@hzblj/crypto-clear-sign'

import type {Env} from '../env'

/**
 * A chain timestamp as a moment field, with `EXPIRED` when it has passed and, unless `longLived` is `false`,
 * `LONG_LIVED` when it lies more than 30 days ahead or never comes. `zeroIsNever` reads 0 as "no deadline" (DAI's
 * permit). Internal.
 */
export const momentField = (
  env: Env,
  input: {
    readonly id: string
    readonly label: DisplayText
    readonly seconds: bigint
    readonly secondary?: boolean
    readonly zeroIsNever?: boolean
    readonly longLived?: boolean
  }
): {readonly field: DateTimeField; readonly warnings: WarningInput[]} => {
  const value = input.zeroIsNever === true && input.seconds === 0n ? 'never' : fromUnixSeconds(input.seconds)
  const field = dateTimeField({
    id: input.id,
    label: input.label,
    now: env.context.now,
    value,
    ...(input.secondary === true ? {secondary: true} : {}),
  })
  const verdict = checkDeadline(field, {now: env.context.now})
  const warnings =
    verdict === 'EXPIRED'
      ? [warning(WARNINGS.EXPIRED, {fields: [input.id]})]
      : verdict === 'LONG_LIVED' && input.longLived !== false
        ? [warning(WARNINGS.LONG_LIVED, {fields: [input.id]})]
        : []

  return {field, warnings}
}

/**
 * A moment that is not a deadline (when something was issued, when it starts): never marked expired, whatever the
 * clock says. Internal.
 */
export const pointInTime = (input: {
  readonly id: string
  readonly label: DisplayText
  readonly value: number | 'never'
  readonly secondary?: boolean
}): DateTimeField => dateTimeField({...input, deadline: false})

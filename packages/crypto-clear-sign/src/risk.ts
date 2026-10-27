import {invalid} from './errors'

/**
 * How serious a warning is, from least to most:
 *
 * - `info`: context worth knowing, no risk by itself (a lookup failed, a contract is created).
 * - `low`: worth a look; nothing is lost by it alone (a recipient not in the address book, a deadline already past).
 * - `medium`: check before signing, the result may not be what it seems (an unknown token, hidden characters, a
 *   permission that lasts for months).
 * - `high`: what this moves can be lost if the other side is malicious, and what it does is not fully known (a call
 *   nothing decodes, data signed blind, a signature valid on every chain).
 * - `critical`: everything it covers can be lost, now or later, without another signature (an unlimited approval,
 *   control of assets or of the account handed over).
 */
export const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const

export type Severity = (typeof SEVERITIES)[number]

/** A result's or an action's overall level: `none` without warnings, else the most serious one's severity. */
export const RISK_LEVELS = ['none', ...SEVERITIES] as const

export type RiskLevel = (typeof RISK_LEVELS)[number]

const RANK: Readonly<Record<RiskLevel, number>> = {critical: 5, high: 4, info: 1, low: 2, medium: 3, none: 0}

/** Whether `value` is a warning severity. */
export const isSeverity = (value: unknown): value is Severity =>
  typeof value === 'string' && (SEVERITIES as readonly string[]).includes(value)

/** Whether `value` is a risk level (a severity, or `none`). */
export const isRiskLevel = (value: unknown): value is RiskLevel =>
  typeof value === 'string' && (RISK_LEVELS as readonly string[]).includes(value)

/** Orders risk levels: negative when `a` is less serious than `b`, 0 when equal, positive when more. */
export const compareRisk = (a: RiskLevel, b: RiskLevel): number => RANK[a] - RANK[b]

/**
 * The most serious of `items`: risk levels, severities, or anything with a `severity` (warnings), mixed as needed.
 * `none` when there are none: `maxRisk(result.warnings)` is the result's `risk`.
 */
export const maxRisk = (items: Iterable<RiskLevel | {readonly severity: Severity}>): RiskLevel => {
  let max: RiskLevel = 'none'

  for (const item of items) {
    const level = typeof item === 'string' ? item : item.severity

    if (!isRiskLevel(level)) {
      throw invalid('maxRisk takes risk levels, severities and warnings.')
    }

    if (RANK[level] > RANK[max]) {
      max = level
    }
  }

  return max
}

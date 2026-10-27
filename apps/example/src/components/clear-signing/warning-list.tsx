import {
  actionAt,
  type ClearSigning,
  compareRisk,
  findField,
  localize,
  type RiskLevel,
  type Translations,
  type Warning,
} from '@hzblj/crypto-clear-sign'
import {Box, RnIcon, RnText} from '@hzblj/kara-ui'

import {RISK_TONES, RISK_WORDS} from './risk'

type WarningListProps = {
  result: ClearSigning
  /** Which warnings: every one of the result unless given (an action's, say: `warningsAt(result, path)`). */
  warnings?: readonly Warning[]
  translations?: Translations
  /** The app's words for each level. */
  riskLabels?: {readonly [Level in RiskLevel]: string}
}

/** `2.1` is the first action of the second, as `plainText` numbers them. */
export const actionNumber = (path: readonly number[]) => path.map(index => index + 1).join('.')

/** Where a warning was raised and what it is about, in words: the action by its intent, the fields by their labels. */
const whereOf = (result: ClearSigning, warning: Warning, translations?: Translations) => {
  const action = actionAt(result, warning.action)
  const fields = action
    ? warning.fields
        .map(id => findField(action, id))
        .flatMap(field => (field === undefined ? [] : [localize(field.label, translations)]))
    : []
  const place =
    warning.action.length === 0
      ? undefined
      : `In action ${actionNumber(warning.action)}${action ? `, ${localize(action.intent, translations)}` : ''}`

  return [place, fields.length > 0 ? `About ${[...new Set(fields)].join(', ')}` : undefined].filter(Boolean).join('. ')
}

/**
 * The warnings, most serious first, each in its severity's colour: the message (translated by its code), the code
 * itself, the action it was raised on and the fields it points to.
 */
export const WarningList = ({result, riskLabels, translations, warnings = result.warnings}: WarningListProps) => {
  const sorted = [...warnings].sort((a, b) => compareRisk(b.severity, a.severity))

  return (
    <Box gap="s8">
      {sorted.map((warning, index) => {
        const tone = RISK_TONES[warning.severity]
        const where = whereOf(result, warning, translations)

        return (
          <Box
            bg={tone.bg}
            borderColor={tone.border}
            borderRadius="large"
            borderWidth={tone.border ? 1 : undefined}
            gap="s6"
            // A code may be raised more than once, on several actions: its place in the list is its identity.
            key={`${warning.code}:${warning.action.join('.')}:${index}`}
            p="s12"
            testID={`warning-${warning.code}`}
          >
            <Box align="center" gap="s6" row>
              <RnIcon color={tone.fg} name={tone.icon} size="s16" />
              <RnText color={tone.fg} variant="footnoteMedium">
                {(riskLabels ?? RISK_WORDS)[warning.severity]}
              </RnText>
              <RnText color={tone.fg} fill monospaced numberOfLines={1} variant="caption">
                {warning.code}
              </RnText>
            </Box>
            <RnText color={warning.severity === 'critical' ? tone.fg : 'content.primary'} variant="subheadline">
              {localize(warning, translations)}
            </RnText>
            {where === '' ? null : (
              <RnText color={warning.severity === 'critical' ? tone.fg : 'content.secondary'} variant="footnote">
                {where}
              </RnText>
            )}
          </Box>
        )
      })}
    </Box>
  )
}

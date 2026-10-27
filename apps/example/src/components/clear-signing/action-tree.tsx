import {
  type ClearSigning,
  type ClearSigningAction,
  localize,
  type RiskLevel,
  warningsAt,
} from '@hzblj/crypto-clear-sign'
import {Box, type ColorToken, RnText} from '@hzblj/kara-ui'
import {FieldList} from './field-list'
import type {FieldDisplay} from './field-row'
import {RiskBadge} from './risk'
import {SourceLine} from './source-line'
import {actionNumber} from './warning-list'

type ActionTreeProps = FieldDisplay & {
  result: ClearSigning
  riskLabels?: {readonly [Level in RiskLevel]: string}
}

/** The line beside an action, by its risk: red where a warning is, from medium up. */
const LINE: {readonly [Level in RiskLevel]: ColorToken} = {
  critical: 'border.destructive',
  high: 'border.destructive',
  info: 'border.accent',
  low: 'border.secondary.base',
  medium: 'border.destructive',
  none: 'border.tertiary',
}

const ActionNode = ({
  action,
  result,
  riskLabels,
  ...display
}: Omit<ActionTreeProps, 'result'> & {action: ClearSigningAction; result: ClearSigning}) => (
  <Box
    borderColor={LINE[action.risk]}
    borderLeftWidth={3}
    gap="s10"
    pl="s12"
    testID={`action-${actionNumber(action.path)}`}
  >
    <Box gap="s4">
      <Box align="center" gap="s8" row wrap>
        <RnText color="content.tertiary" monospacedDigit variant="footnoteMedium">
          {actionNumber(action.path)}
        </RnText>
        <RnText shrink variant="subheadlineMedium">
          {localize(action.intent, display.translations)}
        </RnText>
        <RiskBadge label={riskLabels?.[action.risk]} level={action.risk} size="small" />
      </Box>
      {action.summary === undefined ? null : (
        <RnText color="content.secondary" variant="footnote">
          {localize(action.summary, display.translations)}
        </RnText>
      )}
    </Box>
    <FieldList fields={action.fields} warnings={warningsAt(result, action.path, {below: false})} {...display} />
    <SourceLine source={action.source} />
    {action.actions.map(child => (
      <ActionNode action={child} key={child.path.join('.')} result={result} riskLabels={riskLabels} {...display} />
    ))}
  </Box>
)

/**
 * The actions a signature is made of (a multicall's calls, a transaction's instructions, a PSBT's outputs), as an
 * indented tree, each numbered as `plainText` numbers them, with its own risk, fields and source.
 */
export const ActionTree = ({result, ...rest}: ActionTreeProps) => (
  <Box gap="s16">
    {result.actions.map(action => (
      <ActionNode action={action} key={action.path.join('.')} result={result} {...rest} />
    ))}
  </Box>
)

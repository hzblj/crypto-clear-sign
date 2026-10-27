import {
  type ClearSigning,
  localize,
  plainText,
  type RiskLevel,
  type SigningKind,
  type Translations,
  warningsAt,
} from '@hzblj/crypto-clear-sign'
import {Box, RnText} from '@hzblj/kara-ui'

import {Section} from '../page'
import {Pill} from '../pill'
import {ActionTree} from './action-tree'
import {FieldList} from './field-list'
import {PlainTextView} from './plain-text-view'
import {RawSection} from './raw-section'
import {RiskBadge} from './risk'
import {SourceLine} from './source-line'
import {WarningList} from './warning-list'

/** Each signing kind in words. A kind added later shows as its name. */
const KINDS: {readonly [Kind in SigningKind]: string} = {
  authorization: 'Authorization',
  message: 'Message',
  'offchain-message': 'Off-chain message',
  psbt: 'PSBT',
  transaction: 'Transaction',
  'typed-data': 'Typed data',
}

export type ClearSigningViewProps = {
  result: ClearSigning
  /** A translation table by code, for `localize`; English without one. */
  translations?: Translations
  /** The app's words for the risk levels. */
  riskLabels?: {readonly [Level in RiskLevel]: string}
  /** The moment the review was made at: moments show how far away they are. */
  now?: number
  /** What was signed, as it came, for the Raw section. */
  payload?: {readonly label: string; readonly text: string}
  testID?: string
}

/**
 * A whole review, from the model alone: the intent and summary, the risk, every warning (most serious first, each
 * pointing at its fields), the fields by kind, the actions as a tree, how it was understood, the raw remainder and
 * the plain text. What a wallet shows before it asks for a signature; nothing in it knows a chain.
 */
export const ClearSigningView = ({now, payload, result, riskLabels, testID, translations}: ClearSigningViewProps) => (
  <Box gap="s24" testID={testID}>
    <Box accessibilityLabel={plainText(result, {translations})} accessible gap="s8" testID="review-header">
      <Box align="center" gap="s6" row wrap>
        <Pill label={result.chain.name} tone="accent" />
        <Pill label={KINDS[result.kind] ?? result.kind} />
      </Box>
      <RnText variant="headingS">{localize(result.intent, translations)}</RnText>
      {result.summary === undefined ? null : (
        <RnText color="content.secondary" selectable variant="body">
          {localize(result.summary, translations)}
        </RnText>
      )}
      <RiskBadge label={riskLabels?.[result.risk]} level={result.risk} testID="review-risk" />
    </Box>
    {result.warnings.length === 0 ? null : (
      <Section title={`Warnings (${result.warnings.length})`}>
        <WarningList result={result} riskLabels={riskLabels} translations={translations} />
      </Section>
    )}
    {result.fields.length === 0 ? null : (
      <Section title="Details">
        <FieldList
          fields={result.fields}
          now={now}
          testID="review-fields"
          translations={translations}
          warnings={warningsAt(result, [], {below: false})}
        />
      </Section>
    )}
    {result.actions.length === 0 ? null : (
      <Section title={`Actions (${result.actions.length})`}>
        <ActionTree now={now} result={result} riskLabels={riskLabels} translations={translations} />
      </Section>
    )}
    <Section title="Understood by">
      <SourceLine source={result.source} />
    </Section>
    <Box gap="s4">
      <RawSection payload={payload} result={result} translations={translations} />
      <PlainTextView result={result} translations={translations} />
    </Box>
  </Box>
)

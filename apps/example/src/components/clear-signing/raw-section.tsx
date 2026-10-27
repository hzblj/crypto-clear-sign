import {
  type ClearSigning,
  type ClearSigningAction,
  jsonReplacer,
  localize,
  type Translations,
} from '@hzblj/crypto-clear-sign'
import {Box, Pressable, RnText} from '@hzblj/kara-ui'

import {useCopy} from '../copy'
import {Disclosure} from './disclosure'
import {FieldRow} from './field-row'
import {actionNumber} from './warning-list'

type RawSectionProps = {
  result: ClearSigning
  /** What was signed, as it was received: the hex, the Base64, the JSON or the text. */
  payload?: {readonly label: string; readonly text: string}
  translations?: Translations
}

const withRaw = (action: ClearSigningAction): ClearSigningAction[] => [
  ...(action.raw.length > 0 ? [action] : []),
  ...action.actions.flatMap(withRaw),
]

const Copyable = ({label, text}: {label: string; text: string}) => {
  const copy = useCopy()

  return (
    <Box bg="surface.primary" borderRadius="large" gap="s8" p="s12">
      <RnText monospaced numberOfLines={12} selectable variant="caption">
        {text}
      </RnText>
      <Pressable accessibilityRole="button" alignSelf="flex-start" onPress={() => copy(text, label)}>
        <RnText color="content.accent" variant="footnoteMedium">
          {`Copy the ${label}`}
        </RnText>
      </Pressable>
    </Box>
  )
}

/**
 * What nothing decoded, action by action (call data, instruction data, scripts), then what was signed as it came, and
 * the whole model as JSON (`jsonReplacer` for its bigints): the "Show raw data" of a review.
 */
export const RawSection = ({payload, result, translations}: RawSectionProps) => {
  const actions = withRaw(result)

  return (
    <Disclosure label="Raw" testID="raw-section">
      <Box gap="s12">
        {actions.length === 0 ? (
          <RnText color="content.secondary" variant="footnote">
            Every byte was decoded: nothing is left raw.
          </RnText>
        ) : (
          actions.map(action => (
            <Box gap="s4" key={action.path.join('.')}>
              <RnText color="content.secondary" variant="footnoteMedium">
                {action.path.length === 0
                  ? 'The whole request'
                  : `Action ${actionNumber(action.path)}, ${localize(action.intent, translations)}`}
              </RnText>
              <Box bg="surface.primary" borderRadius="large" px="s16" py="s4">
                {action.raw.map((field, index) => (
                  <FieldRow field={field} key={field.id ?? index} translations={translations} />
                ))}
              </Box>
            </Box>
          ))
        )}
        {payload === undefined ? null : (
          <Box gap="s4">
            <RnText color="content.secondary" variant="footnoteMedium">
              {`What was signed (${payload.label})`}
            </RnText>
            <Copyable label="payload" text={payload.text} />
          </Box>
        )}
        <Disclosure label="The model as JSON">
          <Copyable label="JSON" text={JSON.stringify(result, jsonReplacer, 2)} />
        </Disclosure>
      </Box>
    </Disclosure>
  )
}

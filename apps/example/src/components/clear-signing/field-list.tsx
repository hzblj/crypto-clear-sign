import type {Field, Warning} from '@hzblj/crypto-clear-sign'
import {Box} from '@hzblj/kara-ui'
import {Fragment} from 'react'
import {StyleSheet} from 'react-native'

import {Disclosure} from './disclosure'
import {type FieldDisplay, FieldRow, flagsOf} from './field-row'

type FieldListProps = FieldDisplay & {
  fields: readonly Field[]
  /** The warnings raised on the action these fields are of: the fields they name are marked. */
  warnings: readonly Warning[]
  /** The words of the row that shows the secondary fields. */
  moreLabel?: string
  testID?: string
}

const Rule = () => <Box bg="border.tertiary" h={StyleSheet.hairlineWidth} />

const Fields = ({fields, ...display}: FieldDisplay & {fields: readonly Field[]; flags: ReturnType<typeof flagsOf>}) => (
  <Box bg="surface.primary" borderRadius="large" px="s16" py="s4">
    {fields.map((field, index) => (
      // Fields are positional, and their ids optional: the index is their identity.
      <Fragment key={field.id ?? index}>
        {index > 0 ? <Rule /> : null}
        <FieldRow field={field} {...display} />
      </Fragment>
    ))}
  </Box>
)

/**
 * An action's fields in order: the primary ones in a card, the secondary ones (`secondary: true`: gas, nonces, sizes)
 * behind "More details", as the model suggests. Fields a warning names are marked.
 */
export const FieldList = ({fields, moreLabel, now, testID, translations, warnings}: FieldListProps) => {
  const flags = flagsOf(warnings)
  const primary = fields.filter(field => field.secondary !== true)
  const secondary = fields.filter(field => field.secondary === true)

  return (
    <Box gap="s8" testID={testID}>
      {primary.length > 0 ? <Fields fields={primary} flags={flags} now={now} translations={translations} /> : null}
      {secondary.length > 0 ? (
        <Disclosure label={moreLabel ?? `More details (${secondary.length})`}>
          <Fields fields={secondary} flags={flags} now={now} translations={translations} />
        </Disclosure>
      ) : null}
    </Box>
  )
}

import {type ClearSigning, plainText, type Translations} from '@hzblj/crypto-clear-sign'
import {Box, Pressable, RnText} from '@hzblj/kara-ui'

import {useCopy} from '../copy'
import {Disclosure} from './disclosure'

/**
 * The whole review as `plainText` writes it (translated where the table has a code): one element for a screen
 * reader, selectable, and a copy button for "copy details". Hidden characters come out escaped.
 */
export const PlainTextView = ({result, translations}: {result: ClearSigning; translations?: Translations}) => {
  const copy = useCopy()
  const text = plainText(result, {translations})

  return (
    <Disclosure label="Plain text" testID="plain-text">
      <Box bg="surface.primary" borderRadius="large" gap="s8" p="s12">
        <RnText accessibilityLabel={text} accessible monospaced selectable variant="caption">
          {text}
        </RnText>
        <Pressable accessibilityRole="button" alignSelf="flex-start" onPress={() => copy(text, 'review as text')}>
          <RnText color="content.accent" variant="footnoteMedium">
            Copy the text
          </RnText>
        </Pressable>
      </Box>
    </Disclosure>
  )
}

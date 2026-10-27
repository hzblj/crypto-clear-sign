import {Box, Pressable, RnIcon, RnText} from '@hzblj/kara-ui'
import {type ReactNode, useState} from 'react'

type DisclosureProps = {
  children: ReactNode
  /** The row's text: "More details", "Raw". */
  label: string
  initiallyOpen?: boolean
  testID?: string
}

/**
 * A row that shows and hides React Native content: what a review keeps one tap away (secondary fields, raw bytes, the
 * plain text). Kara's `Collapsible` is native and takes native children only; this one wraps anything.
 */
export const Disclosure = ({children, initiallyOpen = false, label, testID}: DisclosureProps) => {
  const [open, setOpen] = useState(initiallyOpen)

  return (
    <Box gap="s8">
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityValue={open ? 'Expanded' : 'Collapsed'}
        align="center"
        alignSelf="flex-start"
        gap="s6"
        onPress={() => setOpen(!open)}
        py="s4"
        row
        testID={testID}
      >
        <RnIcon color="content.accent" name={open ? 'chevron-down' : 'chevron-right'} size="s16" />
        <RnText color="content.accent" variant="subheadlineMedium">
          {label}
        </RnText>
      </Pressable>
      {open ? children : null}
    </Box>
  )
}

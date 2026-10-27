import type {Source} from '@hzblj/crypto-clear-sign'
import {Box, type IconName, RnIcon, RnText} from '@hzblj/kara-ui'

/** How a source reads, for people: what decoded it, or that nothing did. */
export const sourceText = (
  source: Source
): {readonly icon: IconName; readonly title: string; readonly detail?: string} => {
  switch (source.kind) {
    case 'builtin':
      return {detail: source.decoder, icon: 'verified-user', title: 'Built-in decoder'}
    case 'descriptor':
      return {
        detail: source.publisher === undefined ? source.id : `${source.id}, by ${source.publisher}`,
        icon: 'description',
        title: source.format === 'erc7730' ? 'ERC-7730 descriptor' : source.format === 'idl' ? 'IDL' : 'Descriptor',
      }
    default:
      return {icon: 'help', title: 'Not understood: shown raw'}
  }
}

/**
 * Where an action's understanding came from: a decoder of the chain package's own, a descriptor the app trusted (its
 * id and publisher, so the user can judge it), or nothing.
 */
export const SourceLine = ({source}: {source: Source}) => {
  const {detail, icon, title} = sourceText(source)

  return (
    <Box align="flex-start" gap="s6" row>
      <RnIcon color={source.kind === 'unknown' ? 'content.destructive' : 'content.secondary'} name={icon} size="s16" />
      <Box fill gap="s2">
        <RnText color="content.secondary" variant="footnoteMedium">
          {title}
        </RnText>
        {detail === undefined ? null : (
          <RnText color="content.tertiary" monospaced selectable variant="caption">
            {detail}
          </RnText>
        )}
      </Box>
    </Box>
  )
}

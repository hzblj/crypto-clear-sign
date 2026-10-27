import type {AddressRelation, RiskLevel} from '@hzblj/crypto-clear-sign'
import {Box, type ColorToken, type IconName, RnIcon, RnText} from '@hzblj/kara-ui'

type Tone = {
  readonly bg: ColorToken
  readonly fg: ColorToken
  readonly border?: ColorToken
  readonly icon: IconName
}

/**
 * How each risk level looks, as a ramp: green for none, the accent for context, grey for low, then red outlined,
 * tinted and solid as it gets worse. Every badge also says its level in words: colour is never the only signal.
 */
export const RISK_TONES: {readonly [Level in RiskLevel]: Tone} = {
  critical: {bg: 'fill.destructive.primary', fg: 'content.on.destructive', icon: 'error'},
  high: {bg: 'fill.destructive.base', fg: 'content.destructive', icon: 'warning-filled'},
  info: {bg: 'fill.accent.base', fg: 'content.accent', icon: 'info'},
  low: {bg: 'fill.tertiary', fg: 'content.secondary', icon: 'info'},
  medium: {bg: 'surface.primary', border: 'border.destructive', fg: 'content.destructive', icon: 'warning-filled'},
  none: {bg: 'fill.success.base', fg: 'content.success', icon: 'check-circle-filled'},
}

/** The words for each level when an app gives none: the library's own level names, for people. */
export const RISK_WORDS: {readonly [Level in RiskLevel]: string} = {
  critical: 'Critical',
  high: 'High',
  info: 'Info',
  low: 'Low',
  medium: 'Medium',
  none: 'No warnings',
}

type RiskBadgeProps = {
  level: RiskLevel
  /** The word for the level, translated by the app; `RISK_WORDS` unless given. */
  label?: string
  /** `small` inside rows and action headers. */
  size?: 'regular' | 'small'
  testID?: string
}

/** A risk level as a capsule: its colour, its icon and its word. */
export const RiskBadge = ({label, level, size = 'regular', testID}: RiskBadgeProps) => {
  const tone = RISK_TONES[level]
  const word = label ?? RISK_WORDS[level]

  return (
    <Box
      accessibilityLabel={`Risk: ${word}`}
      accessible
      align="center"
      alignSelf="flex-start"
      bg={tone.bg}
      borderColor={tone.border}
      borderRadius="full"
      borderWidth={tone.border ? 1 : undefined}
      gap="s4"
      px={size === 'small' ? 's6' : 's10'}
      py={size === 'small' ? 's2' : 's4'}
      row
      testID={testID}
    >
      <RnIcon color={tone.fg} name={tone.icon} size={size === 'small' ? 's12' : 's16'} />
      <RnText color={tone.fg} variant={size === 'small' ? 'captionMedium' : 'footnoteMedium'}>
        {word}
      </RnText>
    </Box>
  )
}

/** What each relation says about an address, as a badge beside it. */
export const RELATION_WORDS: {readonly [Relation in AddressRelation]: string} = {
  contact: 'Contact',
  contract: 'Known contract',
  own: 'Your account',
  self: 'You',
  token: 'Token',
  unknown: 'Unknown',
}

const RELATION_TONES: {readonly [Relation in AddressRelation]: {readonly bg: ColorToken; readonly fg: ColorToken}} = {
  contact: {bg: 'fill.accent.base', fg: 'content.accent'},
  contract: {bg: 'fill.accent.base', fg: 'content.accent'},
  own: {bg: 'fill.success.base', fg: 'content.success'},
  self: {bg: 'fill.success.base', fg: 'content.success'},
  token: {bg: 'fill.accent.base', fg: 'content.accent'},
  unknown: {bg: 'fill.tertiary', fg: 'content.secondary'},
}

/** How an address relates to the signer: you, your account, a contact, a known contract, a token, or unknown. */
export const RelationBadge = ({label, relation}: {label?: string; relation: AddressRelation}) => (
  <Box alignSelf="flex-start" bg={RELATION_TONES[relation].bg} borderRadius="full" px="s6" py="s2">
    <RnText color={RELATION_TONES[relation].fg} variant="captionMedium">
      {label ?? RELATION_WORDS[relation]}
    </RnText>
  </Box>
)

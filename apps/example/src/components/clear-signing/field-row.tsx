import {
  type AmountField,
  compareRisk,
  type DateTimeField,
  type Field,
  formatAmount,
  formatDateTime,
  formatDuration,
  hasHiddenCharacters,
  localize,
  type Severity,
  type Translations,
  type Warning,
} from '@hzblj/crypto-clear-sign'
import {Box, Pressable, RnIcon, RnText} from '@hzblj/kara-ui'
import {useState} from 'react'

import {useCopy} from '../copy'
import {RelationBadge, RISK_TONES} from './risk'

/** Shared by every field: how to word it, and the moment the review was made, for "in 30 days". */
export type FieldDisplay = {
  readonly translations?: Translations
  /** Milliseconds. Without it, moments show without how far away they are. */
  readonly now?: number
}

/** Thousands separators, for digits people count. */
const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

const UNITS = [
  ['year', 365 * 86_400_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
] as const

/** How far a moment is from now, in its largest whole unit: beside the exact moment, never instead of it. */
const distance = (moment: number, now: number) => {
  const gap = Math.abs(moment - now)
  const [unit, size] = UNITS.find(([, length]) => gap >= length) ?? UNITS[3]
  const count = Math.floor(gap / size)

  if (count === 0) {
    return 'now'
  }

  const amount = `${group(String(count))} ${unit}${count === 1 ? '' : 's'}`

  return moment > now ? `in ${amount}` : `${amount} ago`
}

/** The colour of the mark on a field a warning is about: red from medium up, as the warning itself is. */
const FLAG_COLORS = {
  critical: 'content.destructive',
  high: 'content.destructive',
  info: 'content.accent',
  low: 'content.secondary',
  medium: 'content.destructive',
} as const satisfies {readonly [Level in Severity]: string}

const Tag = ({label, severity}: {label: string; severity: Severity | 'none'}) => (
  <Box
    alignSelf="flex-start"
    bg={RISK_TONES[severity].bg}
    borderColor={RISK_TONES[severity].border}
    borderRadius="full"
    borderWidth={RISK_TONES[severity].border ? 1 : undefined}
    px="s6"
    py="s2"
  >
    <RnText color={RISK_TONES[severity].fg} variant="captionMedium">
      {label}
    </RnText>
  </Box>
)

/**
 * An amount, exactly: every digit `formatAmount` gives, grouped, nothing rounded. Unlimited is said in words and in
 * red, never as the number; an amount of an unknown token is its base units, said as such.
 */
const AmountValue = ({field}: {field: AmountField}) => {
  if (field.unlimited) {
    return (
      <Box gap="s2">
        <RnText color="content.destructive" selectable variant="headingXs">
          {formatAmount(field, {grouping: true})}
        </RnText>
        <RnText color="content.secondary" variant="footnote">
          Every unit there is, now and later
        </RnText>
      </Box>
    )
  }

  if (field.decimals === undefined) {
    return (
      <Box gap="s2">
        <RnText monospacedDigit selectable variant="body">
          {`${formatAmount(field, {grouping: true, symbol: false})} base units`}
        </RnText>
        <RnText color="content.secondary" variant="footnote">
          {field.token === undefined ? 'Unknown token: no decimals' : `Unknown token ${field.token}: no decimals`}
        </RnText>
      </Box>
    )
  }

  return (
    <Box gap="s2">
      <RnText monospacedDigit selectable variant="headline">
        {formatAmount(field, {grouping: true})}
      </RnText>
      {field.baseUnit === undefined ? null : (
        <RnText color="content.tertiary" monospacedDigit selectable variant="footnote">
          {`${group(field.value.toString())} ${field.baseUnit}`}
        </RnText>
      )}
      {field.symbol === undefined && field.token !== undefined ? (
        <RnText color="content.secondary" monospaced selectable variant="caption">
          {`of ${field.token}`}
        </RnText>
      ) : null}
    </Box>
  )
}

const MomentValue = ({field, now}: {field: DateTimeField; now?: number}) => {
  if (field.never || field.value === undefined) {
    return (
      <Box align="center" gap="s8" row>
        <RnText variant="body">Never</RnText>
        <Tag label="No expiry" severity="medium" />
      </Box>
    )
  }

  return (
    <Box gap="s2">
      <Box align="center" gap="s8" row wrap>
        <RnText monospacedDigit selectable variant="body">
          {formatDateTime(field.value)}
        </RnText>
        {field.expired ? <Tag label="Expired" severity="low" /> : null}
      </Box>
      {now === undefined ? null : (
        <RnText color="content.secondary" variant="footnote">
          {distance(field.value, now)}
        </RnText>
      )}
    </Box>
  )
}

/** The first characters of raw bytes, with the rest a tap away, and a copy button. */
const RawValue = ({label, value}: {label: string; value: string}) => {
  const copy = useCopy()
  const [open, setOpen] = useState(false)
  const bytes = Math.max(0, (value.length - 2) / 2)
  const long = value.length > 66

  return (
    <Box gap="s6">
      <RnText monospaced selectable variant="footnote">
        {open || !long ? value : `${value.slice(0, 66)}…`}
      </RnText>
      <Box gap="s16" row>
        {long ? (
          <Pressable accessibilityRole="button" onPress={() => setOpen(!open)}>
            <RnText color="content.accent" variant="footnoteMedium">
              {open ? 'Show less' : `Show all ${group(String(bytes))} bytes`}
            </RnText>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" onPress={() => copy(value, label.toLowerCase())}>
          <RnText color="content.accent" variant="footnoteMedium">
            Copy
          </RnText>
        </Pressable>
      </Box>
    </Box>
  )
}

type FieldRowProps = FieldDisplay & {
  field: Field
  /**
   * The most serious severity of the warnings about each field, by id (see `flagsOf`): a field a warning names is
   * marked with that severity's colour and icon, inside lists too.
   */
  flags?: ReadonlyMap<string, Severity>
}

/** Each field id the warnings name, with the most serious severity among them. */
export const flagsOf = (warnings: readonly Warning[]): ReadonlyMap<string, Severity> => {
  const flags = new Map<string, Severity>()

  for (const warning of warnings) {
    for (const id of warning.fields) {
      const known = flags.get(id)

      if (known === undefined || compareRisk(warning.severity, known) > 0) {
        flags.set(id, warning.severity)
      }
    }
  }

  return flags
}

/** A field's value, by its kind. A kind this app does not know shows nothing but its label, as the README asks. */
const FieldValue = ({field, flags, now, translations}: FieldRowProps) => {
  switch (field.kind) {
    case 'amount':
      return <AmountValue field={field} />
    case 'address':
      return (
        <Box gap="s4">
          {field.name === undefined ? null : <RnText variant="subheadlineMedium">{field.name}</RnText>}
          <RnText monospaced selectable variant="footnote">
            {field.value}
          </RnText>
          <RelationBadge relation={field.relation} />
        </Box>
      )
    case 'text':
      return (
        <Box gap="s4">
          <RnText selectable variant="body">
            {field.value}
          </RnText>
          {hasHiddenCharacters(field.value) ? <Tag label="Hidden characters" severity="medium" /> : null}
        </Box>
      )
    case 'datetime':
      return <MomentValue field={field} now={now} />
    case 'duration':
      return (
        <RnText selectable variant="body">
          {field.never || field.value === undefined ? 'Forever' : formatDuration(field.value)}
        </RnText>
      )
    case 'raw':
      return <RawValue label={localize(field.label, translations)} value={field.value} />
    case 'percent':
      return <RnText variant="body">{`${field.value}%`}</RnText>
    case 'number':
      return (
        <RnText monospacedDigit selectable variant="body">
          {field.unit === undefined
            ? String(field.value)
            : `${String(field.value)} ${localize(field.unit, translations)}`}
        </RnText>
      )
    case 'boolean':
      return <RnText variant="body">{field.value ? 'Yes' : 'No'}</RnText>
    case 'list':
      return (
        <Box borderColor="border.tertiary" borderLeftWidth={2} gap="s4" pl="s12">
          {field.items.map((item, index) => (
            // Items are positional, and their ids optional: the index is their identity.
            <FieldRow field={item} flags={flags} key={item.id ?? index} now={now} translations={translations} />
          ))}
        </Box>
      )
    default:
      return null
  }
}

/** One field: its label (translated by code), its value by kind, and a mark when a warning is about it. */
export const FieldRow = ({field, flags, now, translations}: FieldRowProps) => {
  const flagged = field.id === undefined ? undefined : flags?.get(field.id)

  return (
    <Box gap="s4" py="s8" testID={field.id === undefined ? undefined : `field-${field.id}`}>
      <Box align="center" gap="s6" row>
        {flagged === undefined ? null : (
          <RnIcon color={FLAG_COLORS[flagged]} name={RISK_TONES[flagged].icon} size="s12" />
        )}
        <RnText color={flagged === undefined ? 'content.secondary' : 'content.primary'} variant="footnoteMedium">
          {localize(field.label, translations)}
        </RnText>
      </Box>
      <FieldValue field={field} flags={flags} now={now} translations={translations} />
    </Box>
  )
}

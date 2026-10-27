import {
  type ActionInput,
  type AmountField,
  amountField,
  booleanField,
  type DisplayText,
  type Field,
  hasHiddenCharacters,
  LABELS,
  listField,
  numberField,
  type ResolverContext,
  rawField,
  text,
  textField,
  WARNINGS,
  type WarningInput,
  warning,
} from '@hzblj/crypto-clear-sign'

import {isOpReturn} from './bytes'
import {BITCOIN_TEXTS, BITCOIN_WARNINGS} from './catalogs'
import {type Artifact, type Etching, formatRuneId, type RuneId, runeName} from './runes'

const LABEL = BITCOIN_TEXTS.label

type Described = Pick<ActionInput, 'fields' | 'intent' | 'raw' | 'source' | 'summary' | 'warnings'>

/** The name a rune id is known by (the token list's name, or its symbol), with the id: `DOG (840000:3)`. */
const runeText = async (id: RuneId, context: ResolverContext) => {
  const formatted = formatRuneId(id)
  const known = await context.token(formatted)

  return known === undefined ? formatted : `${known.name ?? known.symbol} (${formatted})`
}

/** The etching's fields, and the name it etches (`undefined` when one is left to be assigned). */
const etchingFields = (etching: Etching): {fields: Field[]; hidden: string[]; name?: string} => {
  const name = etching.rune === undefined ? undefined : runeName(etching.rune, etching.spacers)
  const symbol = etching.symbol
  const hidden = symbol !== undefined && hasHiddenCharacters(symbol) ? ['etching-symbol'] : []
  const units = (id: string, label: DisplayText, value: bigint | undefined): AmountField[] =>
    value === undefined
      ? []
      : [
          amountField({
            decimals: etching.divisibility ?? 0,
            id,
            label,
            symbol: hidden.length === 0 ? symbol : undefined,
            value,
          }),
        ]
  const count = (id: string, label: DisplayText, value: bigint | undefined, unit?: DisplayText) =>
    value === undefined ? [] : [numberField({id, label, unit, value})]
  const {terms} = etching

  return {
    fields: [
      ...(name === undefined ? [] : [textField({id: 'etching-rune', label: LABEL.rune, value: name})]),
      ...(symbol === undefined ? [] : [textField({id: 'etching-symbol', label: LABEL.symbol, value: symbol})]),
      numberField({id: 'etching-divisibility', label: LABEL.divisibility, value: etching.divisibility ?? 0}),
      ...units('etching-premine', LABEL.premine, etching.premine),
      ...count('etching-cap', LABEL.cap, terms?.cap),
      ...units('etching-amount', LABEL.amountPerMint, terms?.amount),
      ...count('etching-heightStart', LABEL.heightStart, terms?.heightStart),
      ...count('etching-heightEnd', LABEL.heightEnd, terms?.heightEnd),
      ...count('etching-offsetStart', LABEL.offsetStart, terms?.offsetStart, BITCOIN_TEXTS.unit.blocks),
      ...count('etching-offsetEnd', LABEL.offsetEnd, terms?.offsetEnd, BITCOIN_TEXTS.unit.blocks),
      booleanField({id: 'etching-turbo', label: LABEL.turbo, secondary: true, value: etching.turbo}),
    ],
    hidden,
    name,
  }
}

/**
 * A runestone's output as an action: what it etches, mints and moves, by edict and by pointer, and the runes it
 * burns; or a cenotaph, which burns every rune the inputs hold. Rune amounts take their decimals and symbol from the
 * token list, asked by rune id (`840000:3`); without them they show in base units, with `UNKNOWN_TOKEN`.
 */
export const describeRunestone = async (
  artifact: Artifact,
  script: Uint8Array,
  scripts: readonly Uint8Array[],
  context: ResolverContext
): Promise<Described> => {
  const source = {decoder: 'runestone', kind: 'builtin'} as const

  if (artifact.kind === 'cenotaph') {
    const named = artifact.etching === undefined ? undefined : runeName(artifact.etching)

    return {
      fields: [
        textField({id: 'flaw', label: LABEL.flaw, value: artifact.flaw}),
        ...(named === undefined ? [] : [textField({id: 'etching-rune', label: LABEL.rune, value: named})]),
        ...(artifact.mint === undefined
          ? []
          : [textField({id: 'mint', label: LABEL.mint, value: await runeText(artifact.mint, context)})]),
      ],
      intent: BITCOIN_TEXTS.intent.runestone,
      raw: [rawField({id: 'script', label: LABEL.script, value: script})],
      source,
      summary: text(BITCOIN_TEXTS.summary.cenotaph),
      warnings: [warning(BITCOIN_WARNINGS.CENOTAPH, {fields: ['flaw'], params: {flaw: artifact.flaw}})],
    }
  }

  const fields: Field[] = []
  const warnings: WarningInput[] = []
  const unknownTokens: string[] = []
  const burning: string[] = []
  const etched = artifact.etching === undefined ? undefined : etchingFields(artifact.etching)

  if (etched !== undefined) {
    fields.push(listField({id: 'etching', items: etched.fields, label: LABEL.etching}))

    if (etched.hidden.length > 0) {
      warnings.push(warning(WARNINGS.HIDDEN_CHARACTERS, {fields: etched.hidden}))
    }
  }

  const minted = artifact.mint === undefined ? undefined : await runeText(artifact.mint, context)

  if (minted !== undefined) {
    fields.push(textField({id: 'mint', label: LABEL.mint, value: minted}))
  }

  const burns = (output: number) => isOpReturn(scripts[output] ?? new Uint8Array())

  for (const [index, edict] of artifact.edicts.entries()) {
    const id = `edict-${index}`
    // Block 0 is the rune this transaction etches: its decimals and symbol are the etching's.
    const etchedHere = edict.id.block === 0n
    const items: Field[] = [
      textField({
        id: `${id}-rune`,
        label: LABEL.rune,
        value: etchedHere ? (etched?.name ?? formatRuneId(edict.id)) : await runeText(edict.id, context),
      }),
    ]

    if (edict.amount === 0n) {
      items.push(booleanField({id: `${id}-all`, label: LABEL.allRemaining, value: true}))
    } else {
      const amount = etchedHere
        ? amountField({
            decimals: artifact.etching?.divisibility ?? 0,
            id: `${id}-amount`,
            label: LABELS.amount,
            symbol: etched?.hidden.length === 0 ? artifact.etching?.symbol : undefined,
            value: edict.amount,
          })
        : await context.amount({
            id: `${id}-amount`,
            label: LABELS.amount,
            token: formatRuneId(edict.id),
            value: edict.amount,
          })

      if (amount.decimals === undefined) {
        unknownTokens.push(`${id}-amount`)
      }

      items.push(amount)
    }

    if (edict.output === scripts.length) {
      items.push(booleanField({id: `${id}-split`, label: LABEL.allOutputs, value: true}))
    } else {
      items.push(numberField({id: `${id}-output`, label: LABEL.toOutput, value: edict.output}))

      if (burns(edict.output)) {
        burning.push(id)
      }
    }

    fields.push(listField({id, items, label: text(LABEL.edict, {index})}))
  }

  if (artifact.pointer !== undefined) {
    fields.push(numberField({id: 'pointer', label: LABEL.pointer, value: artifact.pointer}))

    if (burns(artifact.pointer)) {
      burning.push('pointer')
    }
  }

  if (unknownTokens.length > 0) {
    warnings.push(warning(WARNINGS.UNKNOWN_TOKEN, {fields: unknownTokens}))
  }

  if (burning.length > 0) {
    warnings.push(warning(BITCOIN_WARNINGS.RUNES_BURNED, {fields: burning}))
  }

  const [intent, summary] =
    etched !== undefined
      ? [
          BITCOIN_TEXTS.intent.etchRune,
          etched.name === undefined ? undefined : text(BITCOIN_TEXTS.summary.etchRune, {rune: etched.name}),
        ]
      : minted !== undefined
        ? [BITCOIN_TEXTS.intent.mintRune, text(BITCOIN_TEXTS.summary.mintRune, {rune: minted})]
        : [BITCOIN_TEXTS.intent.runestone, text(BITCOIN_TEXTS.summary.runestone, {count: artifact.edicts.length})]

  return {fields, intent, raw: [], source, summary, warnings}
}

import {invalid} from './errors'

/**
 * Values a text's template names, already formatted for display: `{spender: 'Uniswap', amount: '100 USDC'}`. Numbers
 * are for counts (`{count: 3}`); amounts, addresses and dates arrive as the strings the English text shows, so a
 * translation shows the same values.
 */
export type TextParams = Readonly<Record<string, string | number>>

/**
 * Words shown to the user: a stable `code` to translate by, and the English `text`, with `params` filled in.
 *
 * - A code says its group and key: `intent.approve` (a short title), `summary.approveUnlimited` (a sentence),
 *   `label.amount` (a field's label), `unit.gas` (what a number counts). A chain package's codes are namespaced by its
 *   family in front: `ethereum.label.gasLimit`. Groups keep a title and a sentence about the same thing apart.
 * - `text` is the English default with every `{param}` already replaced: a UI with no translations shows it as is.
 * - A UI that translates looks `code` up in its own table and fills the same `params` (`localize` does both).
 * - `code: 'external'` marks words that are not this library's: a descriptor's label, an IDL's name. They are shown as
 *   they are and never translated by code.
 */
export type DisplayText = {
  readonly code: string
  readonly text: string
  readonly params?: TextParams
}

/** Translations by code: `{'intent.approve': 'Schválit', 'summary.approve': 'Povolit {spender} utratit {amount}'}`. */
export type Translations = Readonly<Record<string, string>>

/** The code of words that come from outside the library (a descriptor, an IDL): never translated by code. */
export const EXTERNAL_TEXT_CODE = 'external'

/** The groups of the shared texts, and the ones a chain package uses too. A package may add a group of its own. */
export const TEXT_GROUPS = ['intent', 'summary', 'label', 'unit'] as const

const NAMESPACE = /^[a-z][a-z0-9-]*$/
const WORD = /^[a-z][A-Za-z0-9]*$/
const TEXT_CODE = /^(?:external|(?:[a-z][a-z0-9-]*\.)?[a-z][A-Za-z0-9]*\.[a-z][A-Za-z0-9]*)$/
const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g

/** Whether `namespace` can prefix codes: lowercase letters, digits and hyphens, starting with a letter. Internal. */
export const isNamespace = (namespace: string) => NAMESPACE.test(namespace)

/**
 * Whether `code` is a text code: `group.key` (`label.amount`), `family.group.key` (`ethereum.label.gasLimit`), or
 * `external`. Groups and keys are lowerCamel words.
 */
export const isTextCode = (code: unknown): code is string => typeof code === 'string' && TEXT_CODE.test(code)

/**
 * `template` with each `{name}` replaced by `params[name]`. A placeholder without a value stays as it is, so a
 * missing parameter shows rather than vanishing.
 */
export const interpolate = (template: string, params?: TextParams): string =>
  params === undefined
    ? template
    : template.replace(PLACEHOLDER, (placeholder, name: string) =>
        Object.hasOwn(params, name) ? String(params[name]) : placeholder
      )

/**
 * Text from a template (one of `INTENTS`, `SUMMARIES`, `LABELS`, or a chain package's `defineTexts`), its
 * placeholders filled: `text(SUMMARIES.approve, {amount: '100 USDC', spender: 'Uniswap'})`.
 */
export const text = (template: DisplayText, params?: TextParams): DisplayText => {
  if (!isTextCode(template.code)) {
    throw invalid('A text code is group.key, or family.group.key, of lowerCamel words.')
  }

  return params === undefined || Object.keys(params).length === 0
    ? {code: template.code, text: template.text}
    : {code: template.code, params: {...params}, text: interpolate(template.text, params)}
}

/** Words that are not this library's (a descriptor's label, an IDL's name): shown as they are, never translated. */
export const externalText = (words: string): DisplayText => ({code: EXTERNAL_TEXT_CODE, text: words})

/**
 * A chain package's own texts, by group and namespaced by its family:
 *
 * ```ts
 * export const ETHEREUM_TEXTS = defineTexts('ethereum', {
 *   intent: {permit: 'Permit'},
 *   label: {gasLimit: 'Gas limit'},
 *   summary: {permit: 'Allow {spender} to spend {amount} by signature'},
 * })
 * ETHEREUM_TEXTS.label.gasLimit // {code: 'ethereum.label.gasLimit', text: 'Gas limit'}
 * ```
 *
 * Groups and keys are lowerCamel words; templates may name `{params}`.
 */
export const defineTexts = <
  const Namespace extends string,
  const Groups extends Readonly<Record<string, Readonly<Record<string, string>>>>,
>(
  namespace: Namespace,
  groups: Groups
): {
  readonly [Group in keyof Groups & string]: {
    readonly [Key in keyof Groups[Group] & string]: {
      readonly code: `${Namespace}.${Group}.${Key}`
      readonly text: Groups[Group][Key]
    }
  }
} => {
  if (!isNamespace(namespace)) {
    throw invalid('A namespace is lowercase letters, digits and hyphens, starting with a letter.')
  }

  const entries = Object.entries(groups).map(([group, texts]) => {
    if (!WORD.test(group) || typeof texts !== 'object' || texts === null) {
      throw invalid('A text group is a lowerCamel word, holding texts by key.')
    }

    return [group, catalog(texts, `${namespace}.${group}`)] as const
  })

  return Object.freeze(Object.fromEntries(entries)) as never
}

/** Texts by key, coded `${prefix}.${key}`, frozen. Internal: `defineTexts` and the shared catalogs. */
export const catalog = (texts: Readonly<Record<string, string>>, prefix: string) =>
  Object.freeze(
    Object.fromEntries(
      Object.entries(texts).map(([key, english]) => {
        if (!WORD.test(key) || typeof english !== 'string') {
          throw invalid('A text key is a lowerCamel word, and its text a string.')
        }

        return [key, Object.freeze({code: `${prefix}.${key}`, text: english})]
      })
    )
  )

type Localizable =
  | {readonly code: string; readonly text: string; readonly params?: TextParams}
  | {readonly code: string; readonly message: string; readonly params?: TextParams}

/**
 * What to show for a text or a warning: its translation by code with its params filled, or its English default when
 * `translations` has none (and always for external text).
 */
export const localize = (item: Localizable, translations?: Translations): string => {
  const english = 'message' in item ? item.message : item.text
  const translated =
    translations !== undefined && item.code !== EXTERNAL_TEXT_CODE && Object.hasOwn(translations, item.code)
      ? translations[item.code]
      : undefined

  return translated === undefined ? english : interpolate(translated, item.params)
}

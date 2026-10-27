import {invalid} from './errors'
import {checkField, checkParams, checkText, compact, type Field, findFieldIn, isPlainObject} from './fields'
import {
  type ActionPath,
  type ChainRef,
  type ClearSigning,
  type ClearSigningAction,
  isSigningKind,
  type SigningKind,
  type Source,
} from './model'
import {compareRisk, isSeverity, maxRisk, type RiskLevel} from './risk'
import type {DisplayText} from './text'
import {isWarningCode, type Warning, type WarningCode, type WarningInput} from './warnings'

/** An action as a chain package describes it; `createClearSigning` checks it, places its warnings and adds risk. */
export type ActionInput = {
  readonly intent: DisplayText
  readonly summary?: DisplayText
  readonly fields?: readonly Field[]
  readonly raw?: readonly Field[]
  readonly source: Source
  /** Raised on this action, their `fields` naming its fields' ids. */
  readonly warnings?: readonly WarningInput<WarningCode>[]
  readonly actions?: readonly ActionInput[]
}

/** A whole result as a chain package describes it: the root action, the chain, and what is signed. */
export type ClearSigningInput = ActionInput & {
  readonly chain: ChainRef
  readonly kind: SigningKind
}

/** How deep actions may nest: a router inside a multicall inside a batch is 3. */
export const MAX_ACTION_DEPTH = 16

const CAIP2 = /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value !== ''

const checkChain = (chain: unknown): ChainRef => {
  if (!isPlainObject(chain) || !nonEmpty(chain.family) || typeof chain.name !== 'string') {
    throw invalid('chain is {family, id, name}.')
  }

  if (typeof chain.id !== 'string' || !CAIP2.test(chain.id)) {
    throw invalid('chain.id is a CAIP-2 chain id (eip155:1).')
  }

  return Object.freeze({family: chain.family, id: chain.id, name: chain.name})
}

const checkSource = (source: unknown, where: string): Source => {
  if (isPlainObject(source)) {
    if (source.kind === 'unknown') {
      return Object.freeze({kind: 'unknown'})
    }

    if (source.kind === 'builtin' && nonEmpty(source.decoder)) {
      return Object.freeze({decoder: source.decoder, kind: 'builtin'})
    }

    if (
      source.kind === 'descriptor' &&
      nonEmpty(source.format) &&
      nonEmpty(source.id) &&
      (source.publisher === undefined || typeof source.publisher === 'string')
    ) {
      return Object.freeze(
        compact({format: source.format, id: source.id, kind: 'descriptor' as const, publisher: source.publisher})
      )
    }
  }

  throw invalid(`${where}.source is builtin (with its decoder), descriptor (with its format and id), or unknown.`)
}

const list = (value: unknown, where: string): readonly unknown[] => {
  if (value === undefined) {
    return []
  }

  if (!Array.isArray(value)) {
    throw invalid(`${where} is an array.`)
  }

  return value
}

const checkWarning = (value: unknown, where: string, path: ActionPath, ids: ReadonlySet<string>): Warning => {
  if (!isPlainObject(value) || !isWarningCode(value.code)) {
    throw invalid(`${where} is a warning with a shared or namespaced code.`)
  }

  if (!isSeverity(value.severity) || typeof value.message !== 'string') {
    throw invalid(`${where} has a severity and an English message.`)
  }

  const fields = list(value.fields, `${where}.fields`)

  for (const id of fields) {
    if (typeof id !== 'string' || !ids.has(id)) {
      throw invalid(`${where}.fields names a field its action does not have.`)
    }
  }

  return Object.freeze(
    compact({
      action: path,
      code: value.code,
      fields: Object.freeze([...fields] as string[]),
      message: value.message,
      params: checkParams(value.params, where),
      severity: value.severity,
    })
  )
}

/**
 * A result, from what a chain package describes: every field, text and source checked against the model and copied,
 * every warning placed (`action` set to its action's path, `fields` checked against that action's field ids), risk
 * added to every action (the most serious severity at and below it), warnings gathered at the root, most serious
 * first, and the whole deeply frozen. Anything that breaks the model is `INVALID_ARGUMENT`, naming where.
 *
 * ```ts
 * createClearSigning({
 *   chain: {family: 'ethereum', id: 'eip155:1', name: 'Ethereum'},
 *   fields: [addressField({id: 'spender', label: LABELS.spender, name: 'Uniswap', relation: 'contract', value})],
 *   intent: INTENTS.approve,
 *   kind: 'transaction',
 *   source: {decoder: 'erc20', kind: 'builtin'},
 *   warnings: [warning(WARNINGS.UNLIMITED_APPROVAL, {fields: ['amount']})],
 * })
 * ```
 */
export const createClearSigning = (input: ClearSigningInput): ClearSigning => {
  if (!isPlainObject(input)) {
    throw invalid('A result is an object literal.')
  }

  const chain = checkChain(input.chain)

  if (!isSigningKind(input.kind)) {
    throw invalid('kind is a signing kind (transaction, typed-data, message, offchain-message, psbt, authorization).')
  }

  const warnings: Warning[] = []

  const build = (action: unknown, path: ActionPath, where: string): ClearSigningAction => {
    if (path.length > MAX_ACTION_DEPTH) {
      throw invalid(`Actions nest at most ${MAX_ACTION_DEPTH} deep.`)
    }

    if (!isPlainObject(action)) {
      throw invalid(`${where} is an action: an object literal.`)
    }

    const ids = new Set<string>()
    const fields = list(action.fields, `${where}.fields`).map((field, index) =>
      checkField(field, `${where}.fields[${index}]`, ids)
    )
    const raw = list(action.raw, `${where}.raw`).map((field, index) => checkField(field, `${where}.raw[${index}]`, ids))
    const own = list(action.warnings, `${where}.warnings`).map((entry, index) =>
      checkWarning(entry, `${where}.warnings[${index}]`, path, ids)
    )
    warnings.push(...own)
    const actions = list(action.actions, `${where}.actions`).map((child, index) =>
      build(child, Object.freeze([...path, index]), `${where}.actions[${index}]`)
    )
    const risk: RiskLevel = maxRisk([...own, ...actions.map(child => child.risk)])

    return Object.freeze(
      compact({
        actions: Object.freeze(actions),
        fields: Object.freeze(fields),
        intent: checkText(action.intent, `${where}.intent`),
        path,
        raw: Object.freeze(raw),
        risk,
        source: checkSource(action.source, where),
        summary: action.summary === undefined ? undefined : checkText(action.summary, `${where}.summary`),
      })
    )
  }

  const root = build(input, Object.freeze([]), 'result')
  const ordered = warnings
    .map((entry, index) => ({entry, index}))
    .sort((a, b) => compareRisk(b.entry.severity, a.entry.severity) || a.index - b.index)
    .map(({entry}) => entry)

  return Object.freeze({...root, chain, kind: input.kind, warnings: Object.freeze(ordered)})
}

const startsWith = (path: ActionPath, prefix: ActionPath) =>
  prefix.length <= path.length && prefix.every((index, depth) => path[depth] === index)

/** The action at `path` (`[]` is the result itself), or `undefined` when there is none. */
export const actionAt = (result: ClearSigning, path: ActionPath): ClearSigningAction | undefined => {
  let action: ClearSigningAction | undefined = result

  for (const index of path) {
    action = action?.actions[index]
  }

  return action
}

/**
 * The warnings raised on the action at `path` and, unless `below` is `false`, on the actions under it: what a UI
 * shows beside that action. Most serious first, as in `result.warnings`.
 */
export const warningsAt = (
  result: ClearSigning,
  path: ActionPath,
  options: {readonly below?: boolean} = {}
): readonly Warning[] =>
  result.warnings.filter(entry =>
    options.below === false
      ? entry.action.length === path.length && startsWith(entry.action, path)
      : startsWith(entry.action, path)
  )

/** Whether the result carries a warning of `code`, anywhere in it. */
export const hasWarning = (result: ClearSigning, code: WarningCode): boolean =>
  result.warnings.some(entry => entry.code === code)

/** The field `id` names in an action (among its fields, its raw fields and their lists), if any. */
export const findField = (action: ClearSigningAction, id: string): Field | undefined =>
  findFieldIn(action.fields, id) ?? findFieldIn(action.raw, id)

/**
 * For `JSON.stringify(result, jsonReplacer)`: bigints as decimal strings. For logs and debugging; a result is not
 * meant to travel (see the README: it is only worth anything where it was made).
 */
export const jsonReplacer = (_key: string, value: unknown): unknown =>
  typeof value === 'bigint' ? value.toString() : value

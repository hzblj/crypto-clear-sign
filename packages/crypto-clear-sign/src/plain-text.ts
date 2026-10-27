import {escapeHidden} from './characters'
import {actionAt} from './create'
import {type AddressRelation, type Field, type FormatFieldOptions, findFieldIn, formatField} from './fields'
import type {ActionPath, ClearSigning, ClearSigningAction, SigningKind, Source} from './model'
import {localize} from './text'

export type PlainTextOptions = FormatFieldOptions & {
  /** Include each action's raw data. Default `false`, as a UI keeps it behind "Show raw data". */
  readonly raw?: boolean
}

const KINDS: Readonly<Record<SigningKind, string>> = {
  authorization: 'Authorization',
  message: 'Message',
  'offchain-message': 'Off-chain message',
  psbt: 'PSBT',
  transaction: 'Transaction',
  'typed-data': 'Typed data',
}

const RELATIONS: Readonly<Record<AddressRelation, string>> = {
  contact: 'contact',
  contract: 'known contract',
  own: 'your account',
  self: 'this account',
  token: 'token',
  unknown: 'unknown address',
}

const sourceText = (source: Source) => {
  switch (source.kind) {
    case 'builtin':
      return `built-in decoder (${source.decoder})`
    case 'descriptor':
      return `${source.format} descriptor ${source.id}${source.publisher === undefined ? '' : ` by ${source.publisher}`}`
    case 'unknown':
      return 'nothing, shown raw'
  }
}

const number = (path: ActionPath) => path.map(index => index + 1).join('.')

/**
 * The result as plain text, for logs, tests, screen readers and a "copy details" button: the intent and summary, what
 * is signed and on which chain, the risk, every field (lists indented), the actions numbered (`2.1` is the first
 * action of the second), every warning with its code, where it was raised and the fields it is about, and how each
 * action was understood. Characters that hide or reorder text are written escaped (`\u{202E}`).
 *
 * English unless `translations` cover the codes. The layout is for people and may change in a minor release: assert
 * on the model in tests, not on this text.
 */
export const plainText = (result: ClearSigning, options: PlainTextOptions = {}): string => {
  const {translations} = options
  const lines: string[] = []

  const push = (indent: string, line: string) => {
    const [first = '', ...rest] = line.split(/\r\n|\n/)
    lines.push(indent + first, ...rest.map(more => `${indent}  ${more}`))
  }

  const fields = (list: readonly Field[], indent: string) => {
    for (const field of list) {
      const label = localize(field.label, translations)

      if (field.kind === 'list') {
        push(indent, `${label}:`)
        fields(field.items, `${indent}  `)
      } else {
        const relation = field.kind === 'address' ? `, ${RELATIONS[field.relation]}` : ''
        push(indent, `${label}: ${formatField(field, options)}${relation}`)
      }
    }
  }

  const heading = (action: ClearSigningAction) =>
    action.summary === undefined
      ? localize(action.intent, translations)
      : `${localize(action.intent, translations)}: ${localize(action.summary, translations)}`

  const body = (action: ClearSigningAction, indent: string) => {
    fields(action.fields, indent)

    if (options.raw === true && action.raw.length > 0) {
      push(indent, 'Raw data:')
      fields(action.raw, `${indent}  `)
    }

    push(indent, `Understood by: ${sourceText(action.source)}`)

    if (action.actions.length > 0) {
      push(indent, 'Actions:')

      for (const child of action.actions) {
        push(`${indent}  `, `${number(child.path)}. ${heading(child)} (risk: ${child.risk})`)
        body(child, `${indent}  ${' '.repeat(number(child.path).length + 2)}`)
      }
    }
  }

  push('', heading(result))
  push('', `${KINDS[result.kind] ?? result.kind} on ${result.chain.name}. Risk: ${result.risk}.`)
  body(result, '')

  if (result.warnings.length > 0) {
    push('', 'Warnings:')

    for (const entry of result.warnings) {
      const action = entry.action.length === 0 ? undefined : actionAt(result, entry.action)
      const about = entry.fields
        .map(id => findFieldIn([...(action ?? result).fields, ...(action ?? result).raw], id))
        .flatMap(field => (field === undefined ? [] : [localize(field.label, translations)]))
      const where = [
        entry.code,
        ...(entry.action.length === 0 ? [] : [`in action ${number(entry.action)}`]),
        ...(about.length === 0 ? [] : [`about ${about.join(', ')}`]),
      ]
      push('  ', `- ${entry.severity}: ${localize(entry, translations)} (${where.join(', ')})`)
    }
  }

  return escapeHidden(lines.join('\n')).replaceAll('\r', '\\u{D}')
}

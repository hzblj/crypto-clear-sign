import {
  type ActionInput,
  booleanField,
  type Descriptor,
  type DisplayText,
  externalText,
  type Field,
  hasHiddenCharacters,
  LABELS,
  listField,
  numberField,
  rawField,
  SUMMARIES,
  text,
  textField,
  WARNINGS,
  type WarningInput,
  warning,
} from '@hzblj/crypto-clear-sign'

import {SOLANA_TEXTS} from '../catalogs'
import {type ActionBuilder, createActionBuilder, describeAddress, type Instruction, type Scope} from '../scope'
import {type IdlMatch, type IdlValue, matchIdl} from './decode'
import type {SolanaIdl} from './types'

/** The descriptor resolver's answers, one lookup per program for a whole transaction. */
export type DescriptorCache = Map<string, Promise<Descriptor<SolanaIdl> | undefined>>

const MAX_FIELD_ID = 128

/** A name from the IDL as a label, and `HIDDEN_CHARACTERS` on the field when it hides anything. */
const labelOf = (name: string, id: string, warnings: WarningInput[]): DisplayText => {
  if (hasHiddenCharacters(name)) {
    warnings.push(warning(WARNINGS.HIDDEN_CHARACTERS, {fields: [id]}))
  }

  return externalText(name)
}

/** A value read by the IDL, as a field: numbers, text, bytes, addresses (resolved), and lists for the rest. */
const toField = async (
  value: IdlValue,
  id: string,
  label: DisplayText,
  build: ActionBuilder,
  warnings: WarningInput[]
): Promise<Field> => {
  if (id.length > MAX_FIELD_ID) {
    throw new RangeError('Nested too deep to name.')
  }

  switch (value.kind) {
    case 'integer':
      return numberField({id, label, value: value.bits <= 32 ? Number(value.value) : value.value})
    case 'float':
      return Number.isFinite(value.value)
        ? numberField({id, label, value: value.value})
        : textField({id, label, value: String(value.value)})
    case 'bool':
      return booleanField({id, label, value: value.value})
    case 'string':
      if (hasHiddenCharacters(value.value)) {
        warnings.push(warning(WARNINGS.HIDDEN_CHARACTERS, {fields: [id]}))
      }

      return textField({id, label, value: value.value})
    case 'bytes':
      return rawField({id, label, value: value.value})
    case 'pubkey':
      return (await build.address(value.value, {id, label})).field
    case 'none':
      return textField({id, label, value: 'None'})
    case 'list': {
      const items: Field[] = []

      for (const [index, item] of value.items.entries()) {
        items.push(
          await toField(item, `${id}.${index}`, text(SOLANA_TEXTS.label.item, {index: index + 1}), build, warnings)
        )
      }

      return listField({id, items, label})
    }
    case 'struct':
    case 'enum': {
      const items: Field[] = []

      if (value.kind === 'enum') {
        if (value.fields.length === 0) {
          return toField({kind: 'string', value: value.variant}, id, label, build, warnings)
        }

        items.push(
          await toField(
            {kind: 'string', value: value.variant},
            `${id}.variant`,
            SOLANA_TEXTS.label.variant,
            build,
            warnings
          )
        )
      }

      for (const [index, field] of value.fields.entries()) {
        const itemId = `${id}.${index}`
        const itemLabel =
          field.name === undefined
            ? text(SOLANA_TEXTS.label.item, {index: index + 1})
            : labelOf(field.name, itemId, warnings)
        items.push(await toField(field.value, itemId, itemLabel, build, warnings))
      }

      return listField({id, items, label})
    }
  }
}

/** An instruction an IDL describes: its name as the intent, its arguments, its accounts by name, the rest raw. */
const describeMatch = async (
  scope: Scope,
  instruction: Instruction,
  match: IdlMatch,
  descriptor: Descriptor<SolanaIdl>
): Promise<ActionInput> => {
  const build = createActionBuilder(scope, instruction, 'idl')
  const warnings: WarningInput[] = []
  const programName = match.program !== undefined && !hasHiddenCharacters(match.program) ? match.program : undefined
  const program = await describeAddress(
    scope.context,
    instruction.programId,
    {id: 'program', label: LABELS.program},
    programName
  )
  const fields: Field[] = []

  if (hasHiddenCharacters(match.name)) {
    warnings.push(warning(WARNINGS.HIDDEN_CHARACTERS))
  }

  for (const [index, arg] of match.args.entries()) {
    const id = `arg-${index}`
    fields.push(await toField(arg.value, id, labelOf(arg.name, id, warnings), build, warnings))
  }

  for (const [index, account] of match.accounts.entries()) {
    const id = `account-${index}`
    const signs = instruction.accounts[index]?.isSigner === true
    fields.push(
      (
        await build.account(index, {
          id,
          label: labelOf(account.name, id, warnings),
          ...(signs ? {} : {secondary: true}),
        })
      ).field
    )
  }

  return build.finish({
    fields,
    intent: externalText(match.name),
    programName,
    raw:
      match.rest.length === 0
        ? undefined
        : [rawField({id: 'trailingData', label: SOLANA_TEXTS.label.trailingData, value: match.rest})],
    source: {
      format: 'idl',
      id: descriptor.id,
      kind: 'descriptor',
      ...(descriptor.publisher === undefined ? {} : {publisher: descriptor.publisher}),
    },
    summary: text(SUMMARIES.contractCall, {contract: program.name ?? program.value}),
    warnings,
  })
}

/**
 * The instruction as the IDL the `descriptors` resolver gives for its program describes it, or `undefined` when there
 * is none, or it does not describe this instruction (it is malformed, for another program, has no instruction with
 * this discriminator, or does not read the data): the IDL is then ignored, not believed, and the instruction shown raw.
 */
export const describeWithIdl = async (
  scope: Scope,
  instruction: Instruction,
  cache: DescriptorCache
): Promise<ActionInput | undefined> => {
  let answer = cache.get(instruction.programId)

  if (answer === undefined) {
    answer = scope.context.descriptor({chain: scope.context.chain, programId: instruction.programId})
    cache.set(instruction.programId, answer)
  }

  const descriptor = await answer

  if (descriptor === undefined) {
    return undefined
  }

  const match = matchIdl(descriptor.content, {
    accounts: instruction.accounts.map(account => account.address),
    data: instruction.data,
    programId: instruction.programId,
  })

  if (match === undefined) {
    return undefined
  }

  try {
    return await describeMatch(scope, instruction, match, descriptor)
  } catch {
    // A value the model refuses (a name nested past what a field id holds): the IDL does not describe it after all.
    return undefined
  }
}

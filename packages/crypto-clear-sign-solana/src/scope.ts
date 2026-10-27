import {
  type ActionInput,
  type AddressField,
  type AddressRelation,
  type AmountField,
  addressField,
  amountField,
  type DisplayText,
  type Field,
  formatField,
  INTENTS,
  LABELS,
  listField,
  numberField,
  type ResolverContext,
  rawField,
  type Source,
  SUMMARIES,
  text,
  WARNINGS,
  type WarningInput,
  warning,
} from '@hzblj/crypto-clear-sign'
import type {DecodedSolanaAccount} from '@hzblj/crypto-solana'

import {SOLANA_TEXTS, SOLANA_WARNINGS} from './catalogs'
import type {SolanaClearSignChain} from './chain'
import type {SolanaIdl} from './idl/types'
import type {SolanaDescriptorQuery} from './options'
import {SOLANA_PROGRAMS, SYSTEM_PROGRAM} from './programs'
import {malformed} from './reader'

export type SolanaResolverContext = ResolverContext<SolanaDescriptorQuery, SolanaIdl>

/** An instruction as the decoders read it: where it is, its program, accounts and data. */
export type Instruction = {
  readonly index: number
  readonly programId: string
  readonly accounts: readonly DecodedSolanaAccount[]
  readonly data: Uint8Array
}

/** A token amount leaving the wallet, for the transaction's "You send". */
type Outflow = {mint?: string; decimals?: number; account?: string; amount: bigint}

/** What leaves the wallet, as the built-in decoders read it: lamports, and tokens by mint (or by account). */
export type Ledger = {
  /** Lamports `from` sends; counted when `from` is the wallet. */
  readonly lamports: (from: string | undefined, amount: bigint) => void
  /** Tokens `authority` moves out of a token account; counted when the authority is the wallet. */
  readonly tokens: (authority: string | undefined, outflow: Outflow) => void
  readonly totals: () => {readonly lamports: bigint; readonly tokens: readonly Outflow[]}
}

export const createLedger = (wallet: string): Ledger => {
  let lamports = 0n
  const tokens = new Map<string, Outflow>()

  return {
    lamports: (from, amount) => {
      if (from === wallet) {
        lamports += amount
      }
    },
    tokens: (authority, outflow) => {
      if (authority !== wallet) {
        return
      }

      const key = outflow.mint === undefined ? `account:${outflow.account}` : `mint:${outflow.mint}`
      const known = tokens.get(key)

      tokens.set(
        key,
        known === undefined
          ? {...outflow}
          : {...known, amount: known.amount + outflow.amount, decimals: known.decimals ?? outflow.decimals}
      )
    },
    totals: () => ({lamports, tokens: [...tokens.values()]}),
  }
}

/** What every decoder of one transaction shares. */
export type Scope = {
  readonly context: SolanaResolverContext
  readonly chain: SolanaClearSignChain
  /** The `signer` option, when given. */
  readonly signer: string | undefined
  /** Whose balance "You send" counts: the signer, or the fee payer without one. */
  readonly wallet: string
  /** The transaction's signers. */
  readonly signers: readonly string[]
  readonly ledger: Ledger
  /** The associated token accounts the transaction creates: each one's owner, mint and token program. */
  readonly associated: ReadonlyMap<string, {readonly owner: string; readonly mint: string; readonly program: string}>
  /**
   * The signer's own token accounts this package can tell without asking: its associated token accounts the
   * transaction creates, and its wrapped SOL accounts. Shown as `own` when no resolver says more.
   */
  readonly ownTokenAccounts: ReadonlySet<string>
}

/** An account an instruction names, as shown: its field, and who it is when that is known. */
export type AccountRef = {
  readonly field: Field
  /** `undefined` when it is loaded from a lookup table that was not given. */
  readonly address: string | undefined
  /** `undefined` with the address. */
  readonly relation: AddressRelation | undefined
  /** How a summary names it: its name, its address, or its table and index. */
  readonly display: string
}

type Common = {readonly id: string; readonly label: DisplayText; readonly secondary?: boolean}

/**
 * An address field with what the resolvers know of it, and this package's names for Solana's own programs when the
 * names resolver has none.
 */
export const describeAddress = async (
  context: SolanaResolverContext,
  value: string,
  common: Common,
  fallbackName?: string
): Promise<AddressField> => {
  const field = await context.address({...common, value})
  const name = Object.hasOwn(SOLANA_PROGRAMS, value) ? SOLANA_PROGRAMS[value] : fallbackName

  return field.relation !== 'unknown' || name === undefined
    ? field
    : addressField({...common, name, relation: 'contract', value})
}

/** An address in a transaction: `describeAddress`, and `own` for the signer's token accounts the scope knows. */
const describeInScope = async (scope: Scope, value: string, common: Common): Promise<AddressField> => {
  const field = await describeAddress(scope.context, value, common)

  return field.relation === 'unknown' && scope.ownTokenAccounts.has(value)
    ? addressField({...common, relation: 'own', value})
    : field
}

const refOf = (field: AddressField): AccountRef => ({
  address: field.value,
  display: field.name ?? field.value,
  field,
  relation: field.relation,
})

/** Lamports as an amount of SOL. */
export const solAmount = (common: Common, value: bigint): AmountField =>
  amountField({...common, baseUnit: 'lamports', decimals: 9, symbol: 'SOL', value})

/** An amount as a summary shows it: exact, its symbol, or "base units" when the token is unknown. */
export const showAmount = (field: AmountField) => formatField(field)

/** Whether an address field is the user's: the signer, or an account the names resolver says is theirs. */
export const isUsers = (ref: {readonly relation: AddressRelation | undefined}) =>
  ref.relation === 'self' || ref.relation === 'own'

/**
 * Whether an account may be the user's, for warnings that only apply then: with a `signer`, when it is theirs; without
 * one, when it signs the transaction (any signer may be the wallet), so that less known means more warned.
 */
export const mayBeUsers = (scope: Scope, ref: AccountRef) =>
  isUsers(ref) || (scope.signer === undefined && (ref.address === undefined || scope.signers.includes(ref.address)))

/** How each account's role reads, for accounts no decoder named. */
export const roleLabel = (account: DecodedSolanaAccount): DisplayText =>
  account.isSigner
    ? account.isWritable
      ? SOLANA_TEXTS.label.writableSignerAccount
      : SOLANA_TEXTS.label.signerAccount
    : account.isWritable
      ? SOLANA_TEXTS.label.writableAccount
      : SOLANA_TEXTS.label.readonlyAccount

/** An account loaded from a lookup table that was not given: its table and index, as a list. */
const unresolvedField = (account: DecodedSolanaAccount, common: Common): Field =>
  listField({
    ...common,
    items: [
      addressField({
        id: `${common.id}.lookupTable`,
        label: SOLANA_TEXTS.label.lookupTable,
        value: account.lookup?.lookupTable ?? SYSTEM_PROGRAM,
      }),
      numberField({
        id: `${common.id}.lookupIndex`,
        label: SOLANA_TEXTS.label.lookupIndex,
        value: account.lookup?.index ?? 0,
      }),
    ],
  })

/** Builds one instruction's action: its accounts by role, the rest of them, its program, and lookups not given. */
export type ActionBuilder = {
  /** The decoder's name, for the action's `source`. */
  readonly decoder: string
  /** The account at `index`, as a field with `common`; a missing one is `MalformedData`. */
  readonly account: (index: number, common: Common) => Promise<AccountRef>
  /** The account at `index` when the instruction has it. */
  readonly optionalAccount: (index: number, common: Common) => Promise<AccountRef | undefined>
  /** An address that is in the instruction's data. */
  readonly address: (value: string, common: Common) => Promise<AccountRef>
  /** The action: the fields given, then every account no role named, then the program; and its warnings. */
  readonly finish: (input: {
    readonly intent: DisplayText
    readonly summary?: DisplayText
    readonly fields: readonly (Field | undefined)[]
    readonly warnings?: readonly (WarningInput | undefined)[]
    readonly raw?: readonly Field[]
    readonly actions?: readonly ActionInput[]
    readonly source?: Source
    /**
     * How the accounts no role named are shown: labelled by their role (the default), as signers of a multisig
     * (`signer`), or not at all (`none`, for an action whose nested actions show them).
     */
    readonly rest?: 'role' | 'signer' | 'none'
    readonly programName?: string
  }) => Promise<ActionInput>
}

export const createActionBuilder = (scope: Scope, instruction: Instruction, decoder: string): ActionBuilder => {
  const named = new Set<number>()
  const unresolved: string[] = []

  const accountField = async (index: number, common: Common): Promise<AccountRef> => {
    const account = instruction.accounts[index]

    if (account === undefined) {
      return malformed()
    }

    named.add(index)

    if (account.address !== undefined) {
      return refOf(await describeInScope(scope, account.address, common))
    }

    unresolved.push(common.id)

    return {
      address: undefined,
      display: `${account.lookup?.lookupTable}[${account.lookup?.index}]`,
      field: unresolvedField(account, common),
      relation: undefined,
    }
  }

  return {
    account: (index, common) => (instruction.accounts[index] === undefined ? malformed() : accountField(index, common)),
    address: async (value, common) => refOf(await describeInScope(scope, value, common)),
    decoder,
    finish: async ({actions, fields, intent, programName, raw, rest = 'role', source, summary, warnings = []}) => {
      const extra: Field[] = []

      for (const [index, account] of instruction.accounts.entries()) {
        if (!named.has(index) && rest !== 'none') {
          const label = rest === 'signer' ? SOLANA_TEXTS.label.signer : roleLabel(account)
          extra.push((await accountField(index, {id: `account-${index}`, label, secondary: true})).field)
        }
      }

      const program = await describeAddress(
        scope.context,
        instruction.programId,
        {id: 'program', label: LABELS.program, secondary: true},
        programName
      )

      return {
        ...(actions === undefined ? {} : {actions}),
        fields: [...fields.filter(field => field !== undefined), ...extra, program],
        intent,
        ...(raw === undefined ? {} : {raw}),
        source: source ?? {decoder, kind: 'builtin'},
        ...(summary === undefined ? {} : {summary}),
        warnings: [
          ...warnings.filter(entry => entry !== undefined),
          ...(unresolved.length === 0 ? [] : [warning(SOLANA_WARNINGS.UNRESOLVED_LOOKUPS, {fields: unresolved})]),
        ],
      }
    },
    optionalAccount: (index, common) =>
      instruction.accounts[index] === undefined ? Promise.resolve(undefined) : accountField(index, common),
  }
}

/**
 * An instruction nothing reads: its program, its data and accounts raw (the signer's own token accounts as `own`, as
 * every other action shows them), and `UNKNOWN_CONTRACT_CALL`.
 */
export const unknownAction = async (scope: Scope, instruction: Instruction): Promise<ActionInput> => {
  const program = await describeAddress(scope.context, instruction.programId, {id: 'program', label: LABELS.program})
  const unresolved: string[] = []
  const accounts: Field[] = []

  for (const [index, account] of instruction.accounts.entries()) {
    const id = `account-${index}`

    if (account.address === undefined) {
      unresolved.push(id)
      accounts.push(unresolvedField(account, {id, label: roleLabel(account)}))
    } else {
      accounts.push(await describeInScope(scope, account.address, {id, label: roleLabel(account)}))
    }
  }

  return {
    fields: [program],
    intent: INTENTS.contractCall,
    raw: [rawField({id: 'data', label: LABELS.data, value: instruction.data}), ...accounts],
    source: {kind: 'unknown'},
    summary: text(SUMMARIES.contractCall, {contract: program.name ?? program.value}),
    warnings: [
      warning(WARNINGS.UNKNOWN_CONTRACT_CALL, {fields: ['program']}),
      ...(unresolved.length === 0 ? [] : [warning(SOLANA_WARNINGS.UNRESOLVED_LOOKUPS, {fields: unresolved})]),
    ],
  }
}

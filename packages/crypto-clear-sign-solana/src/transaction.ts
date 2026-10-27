import {
  type ActionInput,
  type AddressField,
  amountField,
  ClearSignError,
  type ClearSigning,
  createClearSigning,
  createResolverContext,
  dateTimeField,
  type Field,
  INTENTS,
  LABELS,
  listField,
  numberField,
  SUMMARIES,
  text,
  textField,
  WARNINGS,
  type WarningInput,
  warning,
} from '@hzblj/crypto-clear-sign'
import type {DecodedSolanaMessage, SolanaAddressLookupTables} from '@hzblj/crypto-solana'

import {SOLANA_TEXTS, SOLANA_WARNINGS} from './catalogs'
import {chainRef, readPayload, type SolanaClearSignChain} from './chain'
import {readComputeBudget} from './decoders/compute-budget'
import {BUILTIN_DECODERS} from './decoders/index'
import {isAdvanceNonce} from './decoders/system'
import {describeWithIdl} from './idl/describe'
import {checkOptions, HIGH_PRIORITY_FEE, type SolanaClearSignOptions} from './options'
import {
  ASSOCIATED_TOKEN_PROGRAM,
  BUILTIN_PROGRAMS,
  COMPUTE_BUDGET_PROGRAM,
  MEMO_PROGRAMS,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
  WRAPPED_SOL_MINT,
} from './programs'
import {MalformedData} from './reader'
import {
  createActionBuilder,
  createLedger,
  describeAddress,
  type Instruction,
  type Scope,
  solAmount,
  unknownAction,
} from './scope'
import {withBuiltinTokens} from './tokens'

/** A transaction to sign: the wire bytes a dApp sends (signatures and message), or the bare message an air-gapped signer receives. */
export type SolanaTransactionPayload = Uint8Array | {readonly message: Uint8Array}

/** Every transaction pays this per signature, whatever its priority fee. */
export const LAMPORTS_PER_SIGNATURE = 5000n

/** The compute units an instruction reserves when the transaction sets no limit: a native program's, and any other's. */
const BUILTIN_UNITS = 3000
const DEFAULT_UNITS = 200_000

/** The most compute units a transaction may use, which caps any limit it asks for. */
const MAX_UNITS = 1_400_000

const MAX_TABLE_ADDRESSES = 256

type Read = (tables: SolanaAddressLookupTables | undefined) => DecodedSolanaMessage

const readerOf = (chain: SolanaClearSignChain, payload: SolanaTransactionPayload): Read => {
  if (payload instanceof Uint8Array) {
    return tables =>
      readPayload(
        () => chain.decodeTransaction(payload, tables === undefined ? {} : {addressLookupTables: tables}),
        'transaction',
        {payload, wire: true}
      )
  }

  if (typeof payload === 'object' && payload !== null && payload.message instanceof Uint8Array) {
    const {message} = payload

    return tables =>
      readPayload(
        () => chain.decodeMessage(message, tables === undefined ? {} : {addressLookupTables: tables}),
        'transaction message',
        {payload: message, wire: false}
      )
  }

  throw new ClearSignError('INVALID_ARGUMENT', 'A transaction is its wire bytes, or {message} with its message bytes.')
}

const isTable = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.length <= MAX_TABLE_ADDRESSES && value.every(entry => typeof entry === 'string')

/**
 * The message, read with the lookup tables it loads from: the option's first, the resolver's for the rest. Tables the
 * resolver answers that the message cannot be read with count as its failure; the option's tables are the caller's,
 * so a message they do not fit is `INVALID_ARGUMENT`.
 */
const readWithTables = async (
  read: Read,
  options: SolanaClearSignOptions,
  ask: (address: string) => Promise<readonly string[] | undefined>
): Promise<{readonly decoded: DecodedSolanaMessage; readonly failed: boolean}> => {
  const bare = read(undefined)
  const needed = [...new Set(bare.addressTableLookups.map(lookup => lookup.lookupTable))]

  if (needed.length === 0) {
    return {decoded: bare, failed: false}
  }

  const given: Record<string, readonly string[]> = {}
  const asked: Record<string, readonly string[]> = {}
  let failed = false

  for (const table of needed) {
    const option = options.addressLookupTables
    const own = option !== undefined && Object.hasOwn(option, table) ? option[table] : undefined

    if (own !== undefined) {
      given[table] = own
    } else {
      try {
        const answer = await ask(table)

        if (answer !== undefined) {
          if (!isTable(answer)) {
            throw new TypeError('Not a lookup table.')
          }

          asked[table] = [...answer]
        }
      } catch {
        failed = true
      }
    }
  }

  const attempt = (tables: SolanaAddressLookupTables) => {
    try {
      return read(tables)
    } catch (error) {
      if (error instanceof ClearSignError) {
        return undefined
      }

      throw error
    }
  }

  if (Object.keys(asked).length > 0) {
    const decoded = attempt({...given, ...asked})

    if (decoded !== undefined) {
      return {decoded, failed}
    }

    failed = true
  }

  if (Object.keys(given).length === 0) {
    return {decoded: bare, failed}
  }

  const decoded = attempt(given)

  if (decoded === undefined) {
    throw new ClearSignError(
      'INVALID_ARGUMENT',
      'The address lookup tables given do not hold the accounts the transaction loads from them.'
    )
  }

  return {decoded, failed}
}

/** Instructions that set a transaction up rather than say what it does: they never make its intent. */
const isSupport = (instruction: Instruction) =>
  instruction.programId === COMPUTE_BUDGET_PROGRAM ||
  MEMO_PROGRAMS.has(instruction.programId) ||
  (instruction.programId === ASSOCIATED_TOKEN_PROGRAM && (instruction.data[0] ?? 0) <= 1) ||
  (instruction.index === 0 && isAdvanceNonce(instruction.programId, instruction.data, instruction.accounts.length))

/** The associated token accounts the transaction creates, each with its owner, mint and token program. */
const associatedAccounts = (instructions: readonly Instruction[]) => {
  const created = new Map<string, {owner: string; mint: string; program: string}>()

  for (const {accounts, data, programId} of instructions) {
    const [, account, owner, mint, , program] = accounts.map(entry => entry.address)

    if (
      programId === ASSOCIATED_TOKEN_PROGRAM &&
      data.length <= 1 &&
      (data[0] ?? 0) <= 1 &&
      account !== undefined &&
      owner !== undefined &&
      mint !== undefined &&
      program !== undefined
    ) {
      created.set(account, {mint, owner, program})
    }
  }

  return created
}

/** The wrapped SOL mints: the Token program's, and Token-2022's. */
const NATIVE_MINTS = [
  [WRAPPED_SOL_MINT, TOKEN_PROGRAM],
  ['9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP', TOKEN_2022_PROGRAM],
] as const

/** The signer's associated token accounts the transaction creates, and its wrapped SOL accounts. */
const ownTokenAccounts = (
  chain: SolanaClearSignChain,
  signer: string | undefined,
  associated: ReadonlyMap<string, {readonly owner: string}>
): ReadonlySet<string> => {
  if (signer === undefined) {
    return new Set()
  }

  return new Set([
    ...[...associated].flatMap(([account, {owner}]) => (owner === signer ? [account] : [])),
    ...NATIVE_MINTS.map(([mint, tokenProgram]) => chain.associatedTokenAddress({mint, owner: signer, tokenProgram})),
  ])
}

/**
 * Reads a Solana transaction, legacy or v0, into a `ClearSigning` of kind `transaction`: one action per instruction,
 * in order, each read by a built-in decoder (System, Token and Token-2022, Associated Token Account, Compute Budget,
 * Memo, Stake, Address Lookup Table, BPF Upgradeable Loader), by an IDL the `descriptors` resolver gives for its
 * program, or shown raw with `UNKNOWN_CONTRACT_CALL`. The result itself carries what the whole does: what the wallet
 * sends (`sent`), the fee payer and the fee, the priority fee, the signers, the blockhash or the durable nonce, and
 * the lookup tables.
 *
 * `transaction` is the wire transaction a dApp sends (Base64-decoded), or `{message}` with the message bytes alone. A
 * v0 transaction's looked-up accounts are named from `options.addressLookupTables` and `resolvers.lookupTables`;
 * without them they show as their table and index, with `solana.UNRESOLVED_LOOKUPS`.
 *
 * Throws `INVALID_INPUT` when the adapter cannot read it, `UNSUPPORTED` for a message version after v0, and
 * `INVALID_ARGUMENT` for an option out of range or a `signer` that is not one of the transaction's signers.
 *
 * ```ts
 * const result = await clearSignTransaction(crypto.chains.solana, bytes, {resolvers, signer: account.address})
 * result.summary?.text // 'Send 0.5 SOL to 9xQe…'
 * ```
 */
export const clearSignTransaction = async (
  chain: SolanaClearSignChain,
  transaction: SolanaTransactionPayload,
  options: SolanaClearSignOptions = {}
): Promise<ClearSigning> => {
  checkOptions(chain, options)
  const ref = chainRef(chain)
  const read = readerOf(chain, transaction)
  const resolvers = options.resolvers ?? {}
  const lookupTables = resolvers.lookupTables
  const {decoded, failed} = await readWithTables(read, options, async address =>
    lookupTables === undefined ? undefined : lookupTables.lookupTable({address, chain: ref})
  )
  const {signer} = options

  if (signer !== undefined && !decoded.signers.includes(signer)) {
    throw new ClearSignError('INVALID_ARGUMENT', 'The signer is not one of the transaction`s signers.')
  }

  const context = createResolverContext({
    chain: ref,
    resolvers: {...resolvers, tokens: withBuiltinTokens(resolvers.tokens, options.builtinTokens !== false)},
    signer,
  })
  const instructions: Instruction[] = decoded.instructions.map((instruction, index) => ({
    accounts: instruction.accounts,
    data: instruction.data,
    index,
    programId: instruction.programId,
  }))
  const wallet = signer ?? decoded.feePayer
  const associated = associatedAccounts(instructions)
  const scope: Scope = {
    associated,
    chain,
    context,
    ledger: createLedger(wallet),
    ownTokenAccounts: ownTokenAccounts(chain, signer, associated),
    signer,
    signers: decoded.signers,
    wallet,
  }
  const descriptors = new Map<string, ReturnType<typeof context.descriptor>>()
  const actions: ActionInput[] = []

  for (const instruction of instructions) {
    const builtin = BUILTIN_DECODERS.get(instruction.programId)

    if (builtin === undefined) {
      const described = await describeWithIdl(scope, instruction, descriptors)
      actions.push(described ?? (await unknownAction(scope, instruction)))
      continue
    }

    try {
      actions.push(await builtin.describe(instruction, createActionBuilder(scope, instruction, builtin.decoder), scope))
    } catch (error) {
      if (!(error instanceof MalformedData)) {
        throw error
      }

      actions.push(await unknownAction(scope, instruction))
    }
  }

  const fields: Field[] = []
  const warnings: WarningInput[] = []
  const {lamports, tokens} = scope.ledger.totals()
  const sent: Field[] = []

  if (lamports > 0n) {
    sent.push(solAmount({id: 'sent-0', label: LABELS.amount}, lamports))
  }

  for (const outflow of tokens) {
    const known = outflow.mint === undefined ? undefined : await context.token(outflow.mint)
    sent.push(
      amountField({
        decimals: outflow.decimals ?? known?.decimals,
        id: `sent-${sent.length}`,
        label: LABELS.amount,
        symbol: known?.symbol,
        token: outflow.mint,
        value: outflow.amount,
      })
    )
  }

  if (sent.length > 0) {
    fields.push(listField({id: 'sent', items: sent, label: SOLANA_TEXTS.label.sent}))
  }

  const feePayer = await describeAddress(context, decoded.feePayer, {
    id: 'feePayer',
    label: SOLANA_TEXTS.label.feePayer,
  })
  fields.push(
    feePayer,
    solAmount({id: 'fee', label: LABELS.fee}, LAMPORTS_PER_SIGNATURE * BigInt(decoded.signers.length))
  )

  if (signer !== undefined && signer !== decoded.feePayer) {
    warnings.push(warning(SOLANA_WARNINGS.NOT_FEE_PAYER, {fields: ['feePayer']}))
  }

  // The priority fee: the price per compute unit times the limit the transaction asks for (or the runtime's default).
  const budget = instructions
    .filter(instruction => instruction.programId === COMPUTE_BUDGET_PROGRAM)
    .map(instruction => readComputeBudget(instruction.data))
  const price = budget.find(entry => entry.price !== undefined)?.price ?? 0n
  const requested = budget.find(entry => entry.limit !== undefined)?.limit
  const limit = Math.min(
    MAX_UNITS,
    requested ??
      instructions
        .filter(instruction => instruction.programId !== COMPUTE_BUDGET_PROGRAM)
        .reduce(
          (sum, instruction) => sum + (BUILTIN_PROGRAMS.has(instruction.programId) ? BUILTIN_UNITS : DEFAULT_UNITS),
          0
        )
  )

  if (price > 0n) {
    const priorityFee = (price * BigInt(limit) + 999_999n) / 1_000_000n
    fields.push(solAmount({id: 'priorityFee', label: SOLANA_TEXTS.label.priorityFee}, priorityFee))

    if (priorityFee > (options.highPriorityFee ?? HIGH_PRIORITY_FEE)) {
      warnings.push(warning(WARNINGS.HIGH_FEE, {fields: ['priorityFee']}))
    }
  }

  const others = decoded.signers.filter(entry => entry !== signer)

  if (decoded.signers.length > 1) {
    const items: AddressField[] = []

    for (const [index, entry] of decoded.signers.entries()) {
      items.push(await describeAddress(context, entry, {id: `signer-${index}`, label: SOLANA_TEXTS.label.signer}))
    }

    fields.push(listField({id: 'signers', items, label: SOLANA_TEXTS.label.signers}))

    if (others.length > (signer === undefined ? 1 : 0)) {
      warnings.push(warning(SOLANA_WARNINGS.OTHER_SIGNERS, {fields: ['signers']}))
    }
  }

  const first = instructions[0]
  const nonceAccount = first?.accounts[0]?.address

  if (first !== undefined && isAdvanceNonce(first.programId, first.data, first.accounts.length)) {
    if (nonceAccount !== undefined) {
      fields.push(
        await describeAddress(context, nonceAccount, {id: 'nonceAccount', label: SOLANA_TEXTS.label.nonceAccount})
      )
    }

    fields.push(
      textField({id: 'nonce', label: LABELS.nonce, secondary: true, value: decoded.recentBlockhash}),
      dateTimeField({id: 'expiry', label: LABELS.expiry, now: context.now, value: 'never'})
    )
    warnings.push(
      warning(SOLANA_WARNINGS.DURABLE_NONCE, {
        fields: nonceAccount === undefined ? ['nonce', 'expiry'] : ['nonceAccount', 'nonce', 'expiry'],
      })
    )
  } else {
    fields.push(
      textField({
        id: 'recentBlockhash',
        label: SOLANA_TEXTS.label.recentBlockhash,
        secondary: true,
        value: decoded.recentBlockhash,
      })
    )
  }

  fields.push(
    numberField({
      id: 'computeUnitLimit',
      label: SOLANA_TEXTS.label.computeUnitLimit,
      secondary: true,
      unit: SOLANA_TEXTS.unit.computeUnits,
      value: limit,
    })
  )

  if (price > 0n) {
    fields.push(
      numberField({
        id: 'computeUnitPrice',
        label: SOLANA_TEXTS.label.computeUnitPrice,
        secondary: true,
        unit: SOLANA_TEXTS.unit.microLamports,
        value: price,
      })
    )
  }

  fields.push(
    textField({
      id: 'version',
      label: SOLANA_TEXTS.label.version,
      secondary: true,
      value: decoded.version === 'legacy' ? 'legacy' : 'v0',
    })
  )

  if (decoded.addressTableLookups.length > 0) {
    const items: AddressField[] = []

    for (const [index, lookup] of decoded.addressTableLookups.entries()) {
      items.push(
        await describeAddress(context, lookup.lookupTable, {
          id: `lookupTable-${index}`,
          label: SOLANA_TEXTS.label.lookupTable,
        })
      )
    }

    fields.push(listField({id: 'lookupTables', items, label: SOLANA_TEXTS.label.lookupTables, secondary: true}))
  }

  // What the whole does: the one instruction that is not set-up, when there is one; a batch otherwise.
  const main = instructions.filter(instruction => !isSupport(instruction))
  const lead =
    main.length === 1
      ? actions[main[0]?.index ?? 0]
      : main.length === 0 && actions.length === 1
        ? actions[0]
        : undefined
  const failures = [...context.failures(), ...(failed ? ['lookupTables'] : [])]

  return createClearSigning({
    actions,
    chain: ref,
    fields,
    intent: lead?.intent ?? (actions.length === 0 ? INTENTS.unknown : INTENTS.batch),
    kind: 'transaction',
    source: {decoder: 'solana-transaction', kind: 'builtin'},
    summary:
      lead !== undefined
        ? lead.summary
        : actions.length === 0
          ? undefined
          : text(SUMMARIES.batch, {count: actions.length}),
    warnings: [
      ...warnings,
      ...(failures.length === 0 ? [] : [warning(WARNINGS.RESOLVER_FAILED, {params: {resolvers: failures.join(', ')}})]),
    ],
  })
}

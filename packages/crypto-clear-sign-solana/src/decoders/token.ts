import {
  type ActionInput,
  type AmountField,
  amountField,
  booleanField,
  type DisplayText,
  dateTimeField,
  type Field,
  fromUnixSeconds,
  INTENTS,
  LABELS,
  listField,
  maxUint,
  numberField,
  SUMMARIES,
  text,
  textField,
  WARNINGS,
  type WarningInput,
  warning,
} from '@hzblj/crypto-clear-sign'

import {SOLANA_TEXTS, SOLANA_WARNINGS} from '../catalogs'
import {TOKEN_2022_PROGRAM} from '../programs'
import {createReader, MalformedData, malformed, nonZeroPubkey, optionalPubkey, type Reader} from '../reader'
import {
  type AccountRef,
  createActionBuilder,
  type Instruction,
  isUsers,
  type Scope,
  showAmount,
  solAmount,
  unknownAction,
} from '../scope'
import {destinationWarning, handoverWarning} from './system'
import type {Decoder} from './types'

/** SPL Token's "unlimited": an approval of the largest `u64`. */
const UNLIMITED = maxUint(64)

/** The program's names for its authorities (`AuthorityType`), by number: Token's first four, then Token-2022's. */
export const AUTHORITY_TYPES = [
  'mintTokens',
  'freezeAccount',
  'accountOwner',
  'closeAccount',
  'transferFeeConfig',
  'withheldWithdraw',
  'closeMint',
  'interestRate',
  'permanentDelegate',
  'confidentialTransferMint',
  'transferHookProgramId',
  'confidentialTransferFeeConfig',
  'metadataPointer',
  'groupPointer',
  'groupMemberPointer',
  'scaledUiAmount',
  'pause',
  'permissionedBurn',
] as const

/** A token account's states (`AccountState`), by number. */
const ACCOUNT_STATES = ['uninitialized', 'initialized', 'frozen'] as const

type Common = {readonly id: string; readonly label: DisplayText; readonly secondary?: boolean}

/** A token amount: the instruction's decimals when it carries them, the token list's symbol (and decimals) else. */
const tokenAmount = async (
  scope: Scope,
  common: Common,
  {decimals, mint, unlimited = false, value}: {value: bigint; mint?: string; decimals?: number; unlimited?: boolean}
): Promise<{readonly field: AmountField; readonly warning?: WarningInput}> => {
  const known = mint === undefined ? undefined : await scope.context.token(mint)
  const field = amountField({
    ...common,
    decimals: decimals ?? known?.decimals,
    symbol: known?.symbol,
    token: mint,
    unlimited,
    value,
  })

  return known === undefined ? {field, warning: warning(WARNINGS.UNKNOWN_TOKEN, {fields: [common.id]})} : {field}
}

/** The mint of a token account the transaction creates as an associated token account, when it does. */
const mintOf = (scope: Scope, account: AccountRef) =>
  account.address === undefined ? undefined : scope.associated.get(account.address)?.mint

/**
 * Who owns a token account, when this transaction says: an associated token account it creates, or the wallet's own
 * associated token account for the mint.
 */
const ownerOf = (scope: Scope, account: AccountRef, mint: string | undefined, program: string) => {
  if (account.address === undefined) {
    return undefined
  }

  const created = scope.associated.get(account.address)

  if (created !== undefined) {
    return created.owner
  }

  return mint !== undefined &&
    scope.chain.associatedTokenAddress({mint, owner: scope.wallet, tokenProgram: program}) === account.address
    ? scope.wallet
    : undefined
}

const authorityType = (reader: Reader) => AUTHORITY_TYPES[reader.u8()] ?? malformed()

/**
 * A Unix timestamp in seconds as a moment; one a `Date` cannot hold is `MalformedData`. A `deadline` is expired once
 * past; any other moment (a rate's start) is not.
 */
export const momentField = (scope: Scope, common: Common, seconds: bigint, deadline: boolean) => {
  try {
    const value = fromUnixSeconds(seconds)
    const now = deadline || value === 'never' ? scope.context.now : value

    return dateTimeField({...common, now, value})
  } catch {
    return malformed()
  }
}

const typeField = (value: string) => textField({id: 'authorityType', label: SOLANA_TEXTS.label.authorityType, value})

/** A pointer, hook or similar configuration's address field, when it is set. */
const optionalAddress = async (build: Parameters<Decoder>[1], value: string | undefined, common: Common) =>
  value === undefined ? undefined : (await build.address(value, common)).field

/**
 * Token and Token-2022: one decoder for both programs (their shared instructions are laid out alike), with
 * Token-2022's extensions read where they can be described. Accounts after the ones an instruction names are the
 * signers of a multisig authority.
 */
const describe = async (
  instruction: Instruction,
  build: Parameters<Decoder>[1],
  scope: Scope,
  nested: boolean
): Promise<ActionInput> => {
  const program = instruction.programId
  const is2022 = program === TOKEN_2022_PROGRAM
  const reader = createReader(instruction.data)
  const tag = reader.u8()
  const finish = (input: Parameters<typeof build.finish>[0]) => build.finish({rest: 'signer', ...input})

  /** Transfer, TransferChecked, TransferCheckedWithFee: source, (mint), destination, authority. */
  const transfer = async (checked: boolean, value: bigint, decimals?: number, fee?: bigint) => {
    const source = await build.account(0, {
      id: 'sourceAccount',
      label: SOLANA_TEXTS.label.sourceAccount,
      secondary: true,
    })
    const mintRef = checked
      ? await build.account(1, {id: 'mint', label: SOLANA_TEXTS.label.mint, secondary: true})
      : undefined
    const destination = await build.account(checked ? 2 : 1, {
      id: 'destinationAccount',
      label: SOLANA_TEXTS.label.destinationAccount,
    })
    const authority = await build.account(checked ? 3 : 2, {id: 'owner', label: LABELS.owner, secondary: true})
    const mint = mintRef?.address ?? mintOf(scope, destination)
    const amount = await tokenAmount(scope, {id: 'amount', label: LABELS.amount}, {decimals, mint, value})
    const feeAmount =
      fee === undefined
        ? undefined
        : (await tokenAmount(scope, {id: 'fee', label: LABELS.fee}, {decimals, mint, value: fee})).field
    const owner = ownerOf(scope, destination, mint, program)
    const recipient =
      owner === undefined ? undefined : await build.address(owner, {id: 'recipient', label: LABELS.recipient})
    scope.ledger.tokens(authority.address, {
      account: source.address,
      amount: value,
      decimals: amount.field.decimals,
      mint,
    })

    return finish({
      fields: [
        recipient?.field,
        amount.field,
        feeAmount,
        destination.field,
        source.field,
        authority.field,
        mintRef?.field,
      ],
      intent: INTENTS.send,
      summary: text(SUMMARIES.send, {amount: showAmount(amount.field), recipient: (recipient ?? destination).display}),
      warnings: [
        amount.warning,
        recipient === undefined
          ? destinationWarning(destination, ['destinationAccount'])
          : destinationWarning(recipient, ['recipient', 'destinationAccount']),
      ],
    })
  }

  /** Approve, ApproveChecked: source, (mint), delegate, owner. */
  const approve = async (checked: boolean, value: bigint, decimals?: number) => {
    const source = await build.account(0, {id: 'sourceAccount', label: SOLANA_TEXTS.label.sourceAccount})
    const mintRef = checked
      ? await build.account(1, {id: 'mint', label: SOLANA_TEXTS.label.mint, secondary: true})
      : undefined
    const delegate = await build.account(checked ? 2 : 1, {id: 'spender', label: LABELS.spender})
    const owner = await build.account(checked ? 3 : 2, {id: 'owner', label: LABELS.owner, secondary: true})
    const mint = mintRef?.address ?? mintOf(scope, source)
    const unlimited = value === UNLIMITED
    const amount = await tokenAmount(scope, {id: 'amount', label: LABELS.amount}, {decimals, mint, unlimited, value})

    return finish({
      fields: [delegate.field, amount.field, source.field, owner.field, mintRef?.field],
      intent: INTENTS.approve,
      summary: unlimited
        ? text(SUMMARIES.approveUnlimited, {
            spender: delegate.display,
            token: amount.field.symbol ?? mint ?? source.display,
          })
        : text(SUMMARIES.approve, {amount: showAmount(amount.field), spender: delegate.display}),
      warnings: [
        unlimited ? warning(WARNINGS.UNLIMITED_APPROVAL, {fields: ['amount', 'spender']}) : undefined,
        amount.warning,
      ],
    })
  }

  /** MintTo, MintToChecked: mint, destination, mint authority. */
  const mintTo = async (value: bigint, decimals?: number) => {
    const mintRef = await build.account(0, {id: 'mint', label: SOLANA_TEXTS.label.mint})
    const destination = await build.account(1, {id: 'destinationAccount', label: SOLANA_TEXTS.label.destinationAccount})
    const authority = await build.account(2, {id: 'authority', label: SOLANA_TEXTS.label.authority, secondary: true})
    const amount = await tokenAmount(
      scope,
      {id: 'amount', label: LABELS.amount},
      {decimals, mint: mintRef.address, value}
    )

    return finish({
      fields: [amount.field, destination.field, mintRef.field, authority.field],
      intent: SOLANA_TEXTS.intent.mintTokens,
      summary: text(SOLANA_TEXTS.summary.mintTokens, {
        amount: showAmount(amount.field),
        recipient: destination.display,
      }),
      warnings: [amount.warning],
    })
  }

  /** Burn, BurnChecked: account, mint, authority (and PermissionedBurn's: account, mint, burn authority, authority). */
  const burn = async (value: bigint, decimals?: number, permissioned = false) => {
    const account = await build.account(0, {id: 'account', label: LABELS.account})
    const mintRef = await build.account(1, {id: 'mint', label: SOLANA_TEXTS.label.mint, secondary: true})
    const burner = permissioned
      ? await build.account(2, {id: 'burnAuthority', label: SOLANA_TEXTS.label.authority, secondary: true})
      : undefined
    const authority = await build.account(permissioned ? 3 : 2, {id: 'owner', label: LABELS.owner, secondary: true})
    const amount = await tokenAmount(
      scope,
      {id: 'amount', label: LABELS.amount},
      {decimals, mint: mintRef.address, value}
    )
    scope.ledger.tokens(authority.address, {
      account: account.address,
      amount: value,
      decimals: amount.field.decimals,
      mint: mintRef.address,
    })

    return finish({
      fields: [amount.field, account.field, mintRef.field, burner?.field, authority.field],
      intent: SOLANA_TEXTS.intent.burnTokens,
      summary: text(SOLANA_TEXTS.summary.burnTokens, {account: account.display, amount: showAmount(amount.field)}),
      warnings: [amount.warning],
    })
  }

  /** InitializeMint, InitializeMint2: the mint, its decimals and authorities. */
  const initializeMint = async () => {
    const decimals = reader.u8()
    const mintAuthority = reader.pubkey()
    const freezeAuthority = optionalPubkey(reader)
    reader.end()
    const mintRef = await build.account(0, {id: 'mint', label: SOLANA_TEXTS.label.mint})

    return finish({
      fields: [
        mintRef.field,
        numberField({id: 'decimals', label: SOLANA_TEXTS.label.decimals, value: decimals}),
        await optionalAddress(build, mintAuthority, {id: 'mintAuthority', label: SOLANA_TEXTS.label.mintAuthority}),
        await optionalAddress(build, freezeAuthority, {
          id: 'freezeAuthority',
          label: SOLANA_TEXTS.label.freezeAuthority,
        }),
      ],
      intent: SOLANA_TEXTS.intent.initializeMint,
      rest: 'role',
      summary: text(SOLANA_TEXTS.summary.initializeMint, {decimals, mint: mintRef.display}),
    })
  }

  /** InitializeAccount, 2 and 3: account, mint, and the owner (an account, or in the data). */
  const initializeAccount = async (owner?: string) => {
    reader.end()
    const account = await build.account(0, {id: 'account', label: LABELS.account})
    const mintRef = await build.account(1, {id: 'mint', label: SOLANA_TEXTS.label.mint})
    const ownerRef =
      owner === undefined
        ? await build.account(2, {id: 'owner', label: LABELS.owner})
        : await build.address(owner, {id: 'owner', label: LABELS.owner})
    const known = mintRef.address === undefined ? undefined : await scope.context.token(mintRef.address)

    return finish({
      fields: [account.field, ownerRef.field, mintRef.field],
      intent: SOLANA_TEXTS.intent.initializeTokenAccount,
      rest: 'role',
      summary: text(SOLANA_TEXTS.summary.initializeTokenAccount, {
        account: account.display,
        owner: ownerRef.display,
        token: known?.symbol ?? mintRef.display,
      }),
    })
  }

  /** A mint's or an account's settings changed by an extension: the subject, what is set, who may change it. */
  const configure = async (
    fields: readonly (Field | undefined)[],
    {authorityAt, subject = 'mint'}: {authorityAt?: number; subject?: 'mint' | 'account'} = {}
  ) => {
    reader.end()
    const target = await build.account(0, {
      id: subject,
      label: subject === 'mint' ? SOLANA_TEXTS.label.mint : LABELS.account,
    })
    const authority =
      authorityAt === undefined
        ? undefined
        : await build.account(authorityAt, {id: 'authority', label: SOLANA_TEXTS.label.authority, secondary: true})

    return finish({
      fields: [target.field, ...fields, authority?.field],
      intent: SOLANA_TEXTS.intent.configureToken,
      rest: authorityAt === undefined ? 'role' : 'signer',
      summary: text(SOLANA_TEXTS.summary.configureToken, {account: target.display}),
    })
  }

  switch (tag) {
    case 0:
    case 20:
      return initializeMint()
    case 1:
      return initializeAccount()
    case 16:
    case 18:
      return initializeAccount(reader.pubkey())
    case 2:
    case 19: {
      const required = reader.u8()
      reader.end()
      const account = await build.account(0, {id: 'account', label: LABELS.account})
      const first = tag === 2 ? 2 : 1
      const signers: Field[] = []

      for (let index = first; index < instruction.accounts.length; index++) {
        signers.push(
          (await build.account(index, {id: `signer-${index - first}`, label: SOLANA_TEXTS.label.signer})).field
        )
      }

      return finish({
        fields: [
          account.field,
          numberField({id: 'requiredSigners', label: SOLANA_TEXTS.label.requiredSigners, value: required}),
          listField({id: 'signers', items: signers, label: SOLANA_TEXTS.label.signers}),
        ],
        intent: SOLANA_TEXTS.intent.initializeMultisig,
        rest: 'role',
        summary: text(SOLANA_TEXTS.summary.initializeMultisig, {account: account.display, required}),
      })
    }
    case 3: {
      const value = reader.u64()
      reader.end()

      return transfer(false, value)
    }
    case 12: {
      const value = reader.u64()
      const decimals = reader.u8()
      reader.end()

      return transfer(true, value, decimals)
    }
    case 4: {
      const value = reader.u64()
      reader.end()

      return approve(false, value)
    }
    case 13: {
      const value = reader.u64()
      const decimals = reader.u8()
      reader.end()

      return approve(true, value, decimals)
    }
    case 5: {
      reader.end()
      const source = await build.account(0, {id: 'sourceAccount', label: SOLANA_TEXTS.label.sourceAccount})
      const owner = await build.account(1, {id: 'owner', label: LABELS.owner, secondary: true})

      return finish({
        fields: [source.field, owner.field],
        intent: INTENTS.revoke,
        summary: text(SOLANA_TEXTS.summary.revoke, {account: source.display}),
      })
    }
    case 6: {
      const type = authorityType(reader)
      const next = optionalPubkey(reader)
      reader.end()
      const account = await build.account(0, {
        id: 'account',
        label: type === 'accountOwner' || type === 'closeAccount' ? LABELS.account : SOLANA_TEXTS.label.mint,
      })
      const current = await build.account(1, {id: 'authority', label: SOLANA_TEXTS.label.authority, secondary: true})

      if (next === undefined) {
        return finish({
          fields: [account.field, typeField(type), current.field],
          intent: SOLANA_TEXTS.intent.removeAuthority,
          summary: text(SOLANA_TEXTS.summary.removeAuthority, {account: account.display, type}),
        })
      }

      const recipient = await build.address(next, {id: 'newAuthority', label: SOLANA_TEXTS.label.newAuthority})
      const handover = handoverWarning(scope, current, recipient, ['newAuthority', 'account'])

      return finish({
        fields: [recipient.field, account.field, typeField(type), current.field],
        intent: handover === undefined ? SOLANA_TEXTS.intent.setAuthority : INTENTS.transferOwnership,
        summary:
          handover === undefined
            ? text(SOLANA_TEXTS.summary.setAuthority, {account: account.display, authority: recipient.display, type})
            : text(SUMMARIES.transferOwnership, {asset: account.display, recipient: recipient.display}),
        warnings: [handover],
      })
    }
    case 7: {
      const value = reader.u64()
      reader.end()

      return mintTo(value)
    }
    case 14: {
      const value = reader.u64()
      const decimals = reader.u8()
      reader.end()

      return mintTo(value, decimals)
    }
    case 8: {
      const value = reader.u64()
      reader.end()

      return burn(value)
    }
    case 15: {
      const value = reader.u64()
      const decimals = reader.u8()
      reader.end()

      return burn(value, decimals)
    }
    case 9: {
      reader.end()
      const account = await build.account(0, {id: 'account', label: LABELS.account})
      const destination = await build.account(1, {id: 'recipient', label: LABELS.recipient})
      const owner = await build.account(2, {id: 'owner', label: LABELS.owner, secondary: true})
      const own = isUsers(destination) || (destination.address !== undefined && destination.address === owner.address)

      return finish({
        fields: [account.field, destination.field, owner.field],
        intent: SOLANA_TEXTS.intent.closeAccount,
        summary: text(SOLANA_TEXTS.summary.closeAccount, {account: account.display, recipient: destination.display}),
        warnings: [own ? undefined : warning(SOLANA_WARNINGS.CLOSE_TO_OTHER, {fields: ['recipient', 'owner']})],
      })
    }
    case 10:
    case 11: {
      reader.end()
      const account = await build.account(0, {id: 'account', label: LABELS.account})
      const mintRef = await build.account(1, {id: 'mint', label: SOLANA_TEXTS.label.mint, secondary: true})
      const authority = await build.account(2, {id: 'authority', label: SOLANA_TEXTS.label.authority, secondary: true})

      return finish({
        fields: [account.field, mintRef.field, authority.field],
        intent: tag === 10 ? SOLANA_TEXTS.intent.freezeAccount : SOLANA_TEXTS.intent.thawAccount,
        summary: text(tag === 10 ? SOLANA_TEXTS.summary.freezeAccount : SOLANA_TEXTS.summary.thawAccount, {
          account: account.display,
        }),
      })
    }
    case 17: {
      reader.end()
      const account = await build.account(0, {id: 'account', label: LABELS.account})

      return finish({
        fields: [account.field],
        intent: SOLANA_TEXTS.intent.syncNative,
        rest: 'role',
        summary: text(SOLANA_TEXTS.summary.syncNative, {account: account.display}),
      })
    }
    case 21:
    case 22:
    case 23:
    case 24: {
      // GetAccountDataSize (Token-2022: the extensions to size for), InitializeImmutableOwner, AmountToUiAmount,
      // UiAmountToAmount: they read or prepare, and move nothing.
      const fields: Field[] = []

      if (tag === 21) {
        const extensions: Field[] = []

        while (is2022 && reader.remaining() > 0) {
          extensions.push(
            numberField({
              id: `extension-${extensions.length}`,
              label: SOLANA_TEXTS.label.extensions,
              value: reader.u16(),
            })
          )
        }

        if (extensions.length > 0) {
          fields.push(listField({id: 'extensions', items: extensions, label: SOLANA_TEXTS.label.extensions}))
        }
      } else if (tag === 23) {
        fields.push(numberField({id: 'amount', label: LABELS.amount, value: reader.u64()}))
      } else if (tag === 24) {
        fields.push(textField({id: 'amount', label: LABELS.amount, value: reader.text(reader.remaining())}))
      }

      reader.end()
      const account = await build.account(0, {
        id: tag === 22 ? 'account' : 'mint',
        label: tag === 22 ? LABELS.account : SOLANA_TEXTS.label.mint,
      })

      return finish({
        fields: [account.field, ...fields],
        intent: tag === 22 ? SOLANA_TEXTS.intent.initializeTokenAccount : SOLANA_TEXTS.intent.readToken,
        rest: 'role',
      })
    }
    case 38: {
      reader.end()
      const source = await build.account(0, {id: 'account', label: LABELS.account})
      const destination = await build.account(1, {id: 'recipient', label: LABELS.recipient})
      const authority = await build.account(2, {id: 'authority', label: SOLANA_TEXTS.label.authority, secondary: true})

      return finish({
        fields: [source.field, destination.field, authority.field],
        intent: SOLANA_TEXTS.intent.withdrawExcessLamports,
        warnings: [destinationWarning(destination, ['recipient'])],
      })
    }
    case 45: {
      const some = reader.u8()
      const value = some === 1 ? reader.u64() : some === 0 ? undefined : malformed()
      reader.end()
      const source = await build.account(0, {id: 'sourceAccount', label: SOLANA_TEXTS.label.sourceAccount})
      const destination = await build.account(1, {id: 'recipient', label: LABELS.recipient})
      const authority = await build.account(2, {id: 'owner', label: LABELS.owner, secondary: true})
      // Without an amount, everything the wrapped SOL account holds.
      const amount = value === undefined ? undefined : solAmount({id: 'amount', label: LABELS.amount}, value)

      if (value !== undefined && authority.address === scope.wallet && !isUsers(destination)) {
        scope.ledger.lamports(scope.wallet, value)
      }

      return finish({
        fields: [destination.field, amount, source.field, authority.field],
        intent: SOLANA_TEXTS.intent.unwrapSol,
        summary:
          amount === undefined
            ? undefined
            : text(SOLANA_TEXTS.summary.unwrapSol, {amount: showAmount(amount), recipient: destination.display}),
        warnings: [destinationWarning(destination, ['recipient'])],
      })
    }
    case 255: {
      if (nested) {
        return malformed()
      }

      // The whole layout first: a batch the program refuses is shown raw, and counts nothing as sent.
      const inners: Instruction[] = []
      let first = 0

      while (reader.remaining() > 0) {
        const count = reader.u8()
        const data = reader.bytes(reader.u8())
        const accounts = instruction.accounts.slice(first, first + count)

        if (accounts.length !== count) {
          return malformed()
        }

        inners.push({...instruction, accounts, data})
        first += count
      }

      if (inners.length === 0 || first !== instruction.accounts.length) {
        return malformed()
      }

      const actions: ActionInput[] = []

      for (const inner of inners) {
        try {
          actions.push(await describe(inner, createActionBuilder(scope, inner, build.decoder), scope, true))
        } catch (error) {
          if (!(error instanceof MalformedData)) {
            throw error
          }

          actions.push(await unknownAction(scope, inner))
        }
      }

      return finish({
        actions,
        fields: [],
        intent: SOLANA_TEXTS.intent.tokenBatch,
        rest: 'none',
        summary: text(SOLANA_TEXTS.summary.tokenBatch, {count: actions.length}),
      })
    }
  }

  if (!is2022) {
    return malformed()
  }

  switch (tag) {
    case 25:
      return configure([
        await optionalAddress(build, optionalPubkey(reader), {
          id: 'closeAuthority',
          label: SOLANA_TEXTS.label.closeAuthority,
        }),
      ])
    case 26: {
      const sub = reader.u8()

      switch (sub) {
        case 0: {
          const configAuthority = optionalPubkey(reader)
          const withdrawAuthority = optionalPubkey(reader)
          const rate = reader.u16()
          const maximum = reader.u64()

          return configure([
            numberField({
              id: 'feeRate',
              label: SOLANA_TEXTS.label.feeRate,
              unit: SOLANA_TEXTS.unit.basisPoints,
              value: rate,
            }),
            numberField({id: 'maximumFee', label: LABELS.maxFee, value: maximum}),
            await optionalAddress(build, configAuthority, {id: 'configAuthority', label: SOLANA_TEXTS.label.authority}),
            await optionalAddress(build, withdrawAuthority, {
              id: 'withdrawAuthority',
              label: SOLANA_TEXTS.label.authority,
            }),
          ])
        }
        case 1: {
          const value = reader.u64()
          const decimals = reader.u8()
          const fee = reader.u64()
          reader.end()

          return transfer(true, value, decimals, fee)
        }
        case 2:
        case 3: {
          // From the mint, or (3) from token accounts, to the fee receiver.
          if (sub === 3) {
            reader.u8()
          }

          reader.end()
          const mintRef = await build.account(0, {id: 'mint', label: SOLANA_TEXTS.label.mint})
          const destination = await build.account(1, {id: 'recipient', label: LABELS.recipient})
          const authority = await build.account(2, {
            id: 'authority',
            label: SOLANA_TEXTS.label.authority,
            secondary: true,
          })

          return finish({
            fields: [mintRef.field, destination.field, authority.field],
            intent: SOLANA_TEXTS.intent.withdrawTokenFees,
            rest: 'role',
            warnings: [destinationWarning(destination, ['recipient'])],
          })
        }
        case 4: {
          reader.end()
          const mintRef = await build.account(0, {id: 'mint', label: SOLANA_TEXTS.label.mint})

          return finish({fields: [mintRef.field], intent: SOLANA_TEXTS.intent.withdrawTokenFees, rest: 'role'})
        }
        case 5: {
          const rate = reader.u16()
          const maximum = reader.u64()

          return configure(
            [
              numberField({
                id: 'feeRate',
                label: SOLANA_TEXTS.label.feeRate,
                unit: SOLANA_TEXTS.unit.basisPoints,
                value: rate,
              }),
              numberField({id: 'maximumFee', label: LABELS.maxFee, value: maximum}),
            ],
            {authorityAt: 1}
          )
        }
        default:
          return malformed()
      }
    }
    case 28: {
      const sub = reader.u8()
      const state = ACCOUNT_STATES[reader.u8()] ?? malformed()
      const field = textField({id: 'accountState', label: SOLANA_TEXTS.label.accountState, value: state})

      return sub === 0 ? configure([field]) : sub === 1 ? configure([field], {authorityAt: 1}) : malformed()
    }
    case 29: {
      const extensions: Field[] = []

      while (reader.remaining() > 0) {
        extensions.push(
          numberField({id: `extension-${extensions.length}`, label: SOLANA_TEXTS.label.extensions, value: reader.u16()})
        )
      }

      reader.end()
      const account = await build.account(0, {id: 'account', label: LABELS.account})
      const payer = await build.account(1, {id: 'from', label: LABELS.from, secondary: true})
      const owner = await build.account(3, {id: 'owner', label: LABELS.owner, secondary: true})

      return finish({
        fields: [
          account.field,
          listField({id: 'extensions', items: extensions, label: SOLANA_TEXTS.label.extensions}),
          payer.field,
          owner.field,
        ],
        intent: SOLANA_TEXTS.intent.configureToken,
        summary: text(SOLANA_TEXTS.summary.configureToken, {account: account.display}),
      })
    }
    case 30:
    case 34: {
      const sub = reader.u8()
      const enabled = sub === 0 ? true : sub === 1 ? false : malformed()

      return configure(
        [
          booleanField({
            id: tag === 30 ? 'memoRequired' : 'cpiGuard',
            label: tag === 30 ? SOLANA_TEXTS.label.memoRequired : SOLANA_TEXTS.label.cpiGuard,
            value: enabled,
          }),
        ],
        {
          authorityAt: 1,
          subject: 'account',
        }
      )
    }
    case 31: {
      reader.end()
      const payer = await build.account(0, {id: 'from', label: LABELS.from, secondary: true})
      const mintRef = await build.account(1, {id: 'mint', label: SOLANA_TEXTS.label.mint})

      return finish({fields: [mintRef.field, payer.field], intent: SOLANA_TEXTS.intent.initializeMint, rest: 'role'})
    }
    case 32:
      return configure([booleanField({id: 'nonTransferable', label: SOLANA_TEXTS.label.nonTransferable, value: true})])
    case 33: {
      const sub = reader.u8()

      if (sub === 0) {
        const authority = nonZeroPubkey(reader)
        const rate = reader.i16()

        return configure([
          numberField({id: 'rate', label: SOLANA_TEXTS.label.rate, unit: SOLANA_TEXTS.unit.basisPoints, value: rate}),
          await optionalAddress(build, authority, {id: 'rateAuthority', label: SOLANA_TEXTS.label.authority}),
        ])
      }

      return sub === 1
        ? configure(
            [
              numberField({
                id: 'rate',
                label: SOLANA_TEXTS.label.rate,
                unit: SOLANA_TEXTS.unit.basisPoints,
                value: reader.i16(),
              }),
            ],
            {
              authorityAt: 1,
            }
          )
        : malformed()
    }
    case 35:
      return configure([
        (await build.address(reader.pubkey(), {id: 'permanentDelegate', label: SOLANA_TEXTS.label.permanentDelegate}))
          .field,
      ])
    case 36:
    case 39:
    case 40:
    case 41: {
      // TransferHook, MetadataPointer, GroupPointer, GroupMemberPointer: an authority and an address, set or changed.
      const sub = reader.u8()
      const label = tag === 36 ? SOLANA_TEXTS.label.hookProgram : SOLANA_TEXTS.label.pointer

      if (sub === 0) {
        const authority = nonZeroPubkey(reader)
        const target = nonZeroPubkey(reader)

        return configure([
          await optionalAddress(build, target, {id: 'pointer', label}),
          await optionalAddress(build, authority, {id: 'pointerAuthority', label: SOLANA_TEXTS.label.authority}),
        ])
      }

      return sub === 1
        ? configure([await optionalAddress(build, nonZeroPubkey(reader), {id: 'pointer', label})], {authorityAt: 1})
        : malformed()
    }
    case 43: {
      const sub = reader.u8()

      if (sub === 0) {
        const authority = nonZeroPubkey(reader)
        const multiplier = reader.f64()

        return configure([
          Number.isFinite(multiplier)
            ? numberField({id: 'multiplier', label: SOLANA_TEXTS.label.multiplier, value: multiplier})
            : malformed(),
          await optionalAddress(build, authority, {id: 'multiplierAuthority', label: SOLANA_TEXTS.label.authority}),
        ])
      }

      if (sub !== 1) {
        return malformed()
      }

      const multiplier = reader.f64()
      const timestamp = reader.i64()

      return configure(
        [
          Number.isFinite(multiplier)
            ? numberField({id: 'multiplier', label: SOLANA_TEXTS.label.multiplier, value: multiplier})
            : malformed(),
          momentField(scope, {id: 'effectiveAt', label: SOLANA_TEXTS.label.effectiveAt}, timestamp, false),
        ],
        {authorityAt: 1}
      )
    }
    case 44: {
      const sub = reader.u8()

      if (sub === 0) {
        return configure([
          await optionalAddress(build, nonZeroPubkey(reader), {
            id: 'pauseAuthority',
            label: SOLANA_TEXTS.label.authority,
          }),
        ])
      }

      return sub === 1 || sub === 2
        ? configure([booleanField({id: 'paused', label: SOLANA_TEXTS.label.paused, value: sub === 1})], {
            authorityAt: 1,
          })
        : malformed()
    }
    case 46: {
      const sub = reader.u8()

      if (sub === 0) {
        return configure([
          (await build.address(reader.pubkey(), {id: 'burnAuthority', label: SOLANA_TEXTS.label.authority})).field,
        ])
      }

      if (sub !== 1 && sub !== 2) {
        return malformed()
      }

      const value = reader.u64()
      const decimals = sub === 2 ? reader.u8() : undefined
      reader.end()

      return burn(value, decimals, true)
    }
    default:
      return malformed()
  }
}

/** Token and Token-2022 instructions, as `describe` reads them. */
export const describeToken: Decoder = (instruction, build, scope) => describe(instruction, build, scope, false)

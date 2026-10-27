import {
  INTENTS,
  LABELS,
  numberField,
  SUMMARIES,
  text,
  textField,
  WARNINGS,
  type WarningInput,
  warning,
} from '@hzblj/crypto-clear-sign'

import {SOLANA_TEXTS} from '../catalogs'
import {SYSTEM_PROGRAM} from '../programs'
import {createReader, lengthU64, malformed, type Reader} from '../reader'
import {type AccountRef, isUsers, mayBeUsers, type Scope, showAmount, solAmount} from '../scope'
import type {Decoder} from './types'

/** The longest seed an address derived with a seed may have. */
const MAX_SEED_LENGTH = 32

/** bincode's `String`: a `u64` length, then UTF-8. Seeds are at most 32 bytes, as the program requires. */
const seed = (reader: Reader) => {
  const length = lengthU64(reader)

  return length > MAX_SEED_LENGTH ? malformed() : reader.text(length)
}

/** `UNKNOWN_DESTINATION` when lamports go to an account that is not the user's, a contact's or a known contract. */
export const destinationWarning = (ref: AccountRef, fields: readonly string[]): WarningInput | undefined =>
  ref.relation === undefined || ref.relation === 'unknown' ? warning(WARNINGS.UNKNOWN_DESTINATION, {fields}) : undefined

/** `ASSET_OWNERSHIP_TRANSFER` when control of something that may be the user's goes to someone who is not them. */
export const handoverWarning = (
  scope: Scope,
  subject: AccountRef | undefined,
  recipient: AccountRef,
  fields: readonly string[]
): WarningInput | undefined =>
  (subject === undefined || mayBeUsers(scope, subject)) && !isUsers(recipient)
    ? warning(WARNINGS.ASSET_OWNERSHIP_TRANSFER, {fields})
    : undefined

/**
 * The System Program: transfers, account creation, assignment and allocation, with or without a seed, and durable
 * nonce accounts. bincode, a `u32` tag first; every layout is read to its last byte.
 */
export const describeSystem: Decoder = async (instruction, build, scope) => {
  const reader = createReader(instruction.data)
  const tag = reader.u32()

  switch (tag) {
    case 0:
    case 13: {
      // CreateAccount: funding, new account. CreateAccountAllowPrefund: new account, payer.
      const lamports = reader.u64()
      const space = reader.u64()
      const owner = reader.pubkey()
      reader.end()
      const [fundingIndex, newIndex] = tag === 0 ? [0, 1] : [1, 0]
      const created = await build.account(newIndex, {id: 'newAccount', label: SOLANA_TEXTS.label.newAccount})
      const amount = solAmount({id: 'amount', label: LABELS.amount}, lamports)
      const program = await build.address(owner, {id: 'ownerProgram', label: SOLANA_TEXTS.label.ownerProgram})
      const funding = await build.account(fundingIndex, {id: 'from', label: LABELS.from})
      scope.ledger.lamports(funding.address, lamports)

      return build.finish({
        fields: [
          created.field,
          amount,
          program.field,
          numberField({id: 'space', label: SOLANA_TEXTS.label.space, unit: SOLANA_TEXTS.unit.bytes, value: space}),
          funding.field,
        ],
        intent: SOLANA_TEXTS.intent.createAccount,
        summary: text(SOLANA_TEXTS.summary.createAccount, {
          account: created.display,
          amount: showAmount(amount),
          program: program.display,
        }),
      })
    }
    case 1:
    case 10: {
      // Assign: account. AssignWithSeed: account (derived), base.
      const base = tag === 10 ? reader.pubkey() : undefined
      const fromSeed = tag === 10 ? seed(reader) : undefined
      const owner = reader.pubkey()
      reader.end()
      const account = await build.account(0, {id: 'account', label: LABELS.account})
      const program = await build.address(owner, {id: 'ownerProgram', label: SOLANA_TEXTS.label.ownerProgram})
      const baseRef =
        base === undefined ? undefined : await build.account(1, {id: 'base', label: SOLANA_TEXTS.label.base})
      // The account (or, for a derived one, its base) may be the user's: giving it to another program hands it over.
      const subject = baseRef ?? account

      return build.finish({
        fields: [
          account.field,
          program.field,
          baseRef?.field,
          fromSeed === undefined ? undefined : textField({id: 'seed', label: SOLANA_TEXTS.label.seed, value: fromSeed}),
        ],
        intent: SOLANA_TEXTS.intent.assign,
        summary: text(SOLANA_TEXTS.summary.assign, {account: account.display, program: program.display}),
        warnings: [
          owner !== SYSTEM_PROGRAM && mayBeUsers(scope, subject)
            ? warning(WARNINGS.ASSET_OWNERSHIP_TRANSFER, {fields: ['account', 'ownerProgram']})
            : undefined,
        ],
      })
    }
    case 2: {
      const lamports = reader.u64()
      reader.end()
      const from = await build.account(0, {id: 'from', label: LABELS.from})
      const to = await build.account(1, {id: 'recipient', label: LABELS.recipient})
      const amount = solAmount({id: 'amount', label: LABELS.amount}, lamports)
      scope.ledger.lamports(from.address, lamports)

      return build.finish({
        fields: [to.field, amount, from.field],
        intent: INTENTS.send,
        summary: text(SUMMARIES.send, {amount: showAmount(amount), recipient: to.display}),
        warnings: [destinationWarning(to, ['recipient'])],
      })
    }
    case 3: {
      const base = reader.pubkey()
      const fromSeed = seed(reader)
      const lamports = reader.u64()
      const space = reader.u64()
      const owner = reader.pubkey()
      reader.end()
      const created = await build.account(1, {id: 'newAccount', label: SOLANA_TEXTS.label.newAccount})
      const amount = solAmount({id: 'amount', label: LABELS.amount}, lamports)
      const program = await build.address(owner, {id: 'ownerProgram', label: SOLANA_TEXTS.label.ownerProgram})
      const funding = await build.account(0, {id: 'from', label: LABELS.from})
      const baseRef = await build.address(base, {id: 'base', label: SOLANA_TEXTS.label.base})
      // The base signs as the third account unless it is the funding account itself.
      const signer = await build.optionalAccount(2, {id: 'baseSigner', label: SOLANA_TEXTS.label.base, secondary: true})
      scope.ledger.lamports(funding.address, lamports)

      return build.finish({
        fields: [
          created.field,
          amount,
          program.field,
          numberField({id: 'space', label: SOLANA_TEXTS.label.space, unit: SOLANA_TEXTS.unit.bytes, value: space}),
          funding.field,
          baseRef.field,
          textField({id: 'seed', label: SOLANA_TEXTS.label.seed, value: fromSeed}),
          signer?.field,
        ],
        intent: SOLANA_TEXTS.intent.createAccount,
        summary: text(SOLANA_TEXTS.summary.createAccount, {
          account: created.display,
          amount: showAmount(amount),
          program: program.display,
        }),
      })
    }
    case 4: {
      reader.end()
      const nonce = await build.account(0, {id: 'nonceAccount', label: SOLANA_TEXTS.label.nonceAccount})
      const authority = await build.account(2, {id: 'nonceAuthority', label: SOLANA_TEXTS.label.nonceAuthority})

      return build.finish({
        fields: [nonce.field, authority.field],
        intent: SOLANA_TEXTS.intent.advanceNonce,
        summary: text(SOLANA_TEXTS.summary.advanceNonce, {account: nonce.display}),
      })
    }
    case 5: {
      const lamports = reader.u64()
      reader.end()
      const nonce = await build.account(0, {id: 'nonceAccount', label: SOLANA_TEXTS.label.nonceAccount})
      const to = await build.account(1, {id: 'recipient', label: LABELS.recipient})
      const authority = await build.account(4, {id: 'nonceAuthority', label: SOLANA_TEXTS.label.nonceAuthority})
      const amount = solAmount({id: 'amount', label: LABELS.amount}, lamports)

      return build.finish({
        fields: [to.field, amount, nonce.field, authority.field],
        intent: SOLANA_TEXTS.intent.withdrawNonce,
        summary: text(SOLANA_TEXTS.summary.withdraw, {
          account: nonce.display,
          amount: showAmount(amount),
          recipient: to.display,
        }),
        warnings: [destinationWarning(to, ['recipient'])],
      })
    }
    case 6:
    case 7: {
      const key = reader.pubkey()
      reader.end()
      const nonce = await build.account(0, {id: 'nonceAccount', label: SOLANA_TEXTS.label.nonceAccount})
      const authority = await build.address(key, {
        id: 'newAuthority',
        label: tag === 6 ? SOLANA_TEXTS.label.nonceAuthority : SOLANA_TEXTS.label.newAuthority,
      })

      if (tag === 6) {
        return build.finish({
          fields: [nonce.field, authority.field],
          intent: SOLANA_TEXTS.intent.initializeNonce,
          summary: text(SOLANA_TEXTS.summary.initializeNonce, {account: nonce.display, authority: authority.display}),
        })
      }

      const current = await build.account(1, {id: 'nonceAuthority', label: SOLANA_TEXTS.label.nonceAuthority})

      return build.finish({
        fields: [nonce.field, authority.field, current.field],
        intent: SOLANA_TEXTS.intent.authorizeNonce,
        summary: text(SOLANA_TEXTS.summary.authorizeNonce, {account: nonce.display, authority: authority.display}),
        warnings: [handoverWarning(scope, current, authority, ['newAuthority'])],
      })
    }
    case 8:
    case 9: {
      const base = tag === 9 ? reader.pubkey() : undefined
      const fromSeed = tag === 9 ? seed(reader) : undefined
      const space = reader.u64()
      const owner = tag === 9 ? reader.pubkey() : undefined
      reader.end()
      const account = await build.account(0, {id: 'account', label: LABELS.account})
      const baseRef =
        base === undefined ? undefined : await build.account(1, {id: 'base', label: SOLANA_TEXTS.label.base})
      const program =
        owner === undefined
          ? undefined
          : await build.address(owner, {id: 'ownerProgram', label: SOLANA_TEXTS.label.ownerProgram})

      return build.finish({
        fields: [
          account.field,
          numberField({id: 'space', label: SOLANA_TEXTS.label.space, unit: SOLANA_TEXTS.unit.bytes, value: space}),
          program?.field,
          baseRef?.field,
          fromSeed === undefined ? undefined : textField({id: 'seed', label: SOLANA_TEXTS.label.seed, value: fromSeed}),
        ],
        intent: SOLANA_TEXTS.intent.allocate,
        summary: text(SOLANA_TEXTS.summary.allocate, {account: account.display, space: String(space)}),
        warnings: [
          owner !== undefined && owner !== SYSTEM_PROGRAM && baseRef !== undefined && mayBeUsers(scope, baseRef)
            ? warning(WARNINGS.ASSET_OWNERSHIP_TRANSFER, {fields: ['account', 'ownerProgram']})
            : undefined,
        ],
      })
    }
    case 11: {
      const lamports = reader.u64()
      const fromSeed = seed(reader)
      const fromOwner = reader.pubkey()
      reader.end()
      const from = await build.account(0, {id: 'from', label: LABELS.from})
      const base = await build.account(1, {id: 'base', label: SOLANA_TEXTS.label.base})
      const to = await build.account(2, {id: 'recipient', label: LABELS.recipient})
      const program = await build.address(fromOwner, {
        id: 'ownerProgram',
        label: SOLANA_TEXTS.label.ownerProgram,
        secondary: true,
      })
      const amount = solAmount({id: 'amount', label: LABELS.amount}, lamports)
      // The lamports come from an account derived from the base: the base's, when the base is the wallet.
      scope.ledger.lamports(base.address, lamports)

      return build.finish({
        fields: [
          to.field,
          amount,
          from.field,
          base.field,
          textField({id: 'seed', label: SOLANA_TEXTS.label.seed, secondary: true, value: fromSeed}),
          program.field,
        ],
        intent: INTENTS.send,
        summary: text(SUMMARIES.send, {amount: showAmount(amount), recipient: to.display}),
        warnings: [destinationWarning(to, ['recipient'])],
      })
    }
    case 12: {
      reader.end()
      const nonce = await build.account(0, {id: 'nonceAccount', label: SOLANA_TEXTS.label.nonceAccount})

      return build.finish({
        fields: [nonce.field],
        intent: SOLANA_TEXTS.intent.upgradeNonce,
      })
    }
    default:
      return malformed()
  }
}

/** Whether an instruction is the System Program's `AdvanceNonceAccount`, as a durable nonce transaction starts. */
export const isAdvanceNonce = (programId: string, data: Uint8Array, accounts: number) =>
  programId === SYSTEM_PROGRAM &&
  data.length === 4 &&
  data[0] === 4 &&
  data[1] === 0 &&
  data[2] === 0 &&
  data[3] === 0 &&
  accounts >= 3

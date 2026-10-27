import {INTENTS, LABELS, numberField, text, textField} from '@hzblj/crypto-clear-sign'

import {SOLANA_TEXTS} from '../catalogs'
import {createReader, malformed, type Reader} from '../reader'
import {showAmount, solAmount} from '../scope'
import {destinationWarning, handoverWarning} from './system'
import {momentField} from './token'
import type {Decoder} from './types'

/** Which of a stake account's two authorities (`StakeAuthorize`, a `u32`). */
const STAKE_AUTHORITIES = ['staker', 'withdrawer'] as const

const stakeAuthority = (reader: Reader) => STAKE_AUTHORITIES[reader.u32()] ?? malformed()

/** The sysvars the program's older account layouts pass, which its newer ones leave out. */
const SYSVARS: ReadonlySet<string> = new Set([
  'StakeConfig11111111111111111111111111111111',
  'SysvarC1ock11111111111111111111111111111111',
  'SysvarRent111111111111111111111111111111111',
  'SysvarStakeHistory1111111111111111111111111',
])

/**
 * The Stake program: creating a stake account, delegating it to a validator, deactivating, withdrawing, splitting,
 * merging and moving stake, and handing its authorities over. bincode, a `u32` tag first. Accounts are read by role
 * with the sysvars (clock, rent, stake history, stake config) skipped: the program's older layouts pass them and its
 * newer ones do not, and both read the same.
 */
export const describeStake: Decoder = async (instruction, build, scope) => {
  const reader = createReader(instruction.data)
  const tag = reader.u32()
  const roles = instruction.accounts.flatMap((account, index) =>
    account.address !== undefined && SYSVARS.has(account.address) ? [] : [index]
  )
  const role = (at: number) => roles[at] ?? -1
  const stakeAccount = () => build.account(role(0), {id: 'stakeAccount', label: SOLANA_TEXTS.label.stakeAccount})

  switch (tag) {
    case 0: {
      // Initialize: the authorities and the lockup in the data.
      const staker = reader.pubkey()
      const withdrawer = reader.pubkey()
      const lockupTime = reader.i64()
      const lockupEpoch = reader.u64()
      const custodian = reader.pubkey()
      reader.end()
      const account = await stakeAccount()
      const stakerRef = await build.address(staker, {id: 'staker', label: SOLANA_TEXTS.label.staker})
      const withdrawerRef = await build.address(withdrawer, {id: 'withdrawer', label: SOLANA_TEXTS.label.withdrawer})
      const locked = lockupTime !== 0n || lockupEpoch !== 0n

      return build.finish({
        fields: [
          account.field,
          stakerRef.field,
          withdrawerRef.field,
          locked
            ? momentField(scope, {id: 'lockupTime', label: SOLANA_TEXTS.label.lockupTime}, lockupTime, true)
            : undefined,
          locked
            ? numberField({id: 'lockupEpoch', label: SOLANA_TEXTS.label.lockupEpoch, value: lockupEpoch})
            : undefined,
          locked
            ? (await build.address(custodian, {id: 'custodian', label: SOLANA_TEXTS.label.custodian})).field
            : undefined,
        ],
        intent: SOLANA_TEXTS.intent.initializeStake,
        summary: text(SOLANA_TEXTS.summary.initializeStake, {
          account: account.display,
          authority: withdrawerRef.display,
        }),
      })
    }
    case 9: {
      // InitializeChecked: the authorities are accounts, the withdrawer signs.
      reader.end()
      const account = await stakeAccount()
      const staker = await build.account(role(1), {id: 'staker', label: SOLANA_TEXTS.label.staker})
      const withdrawer = await build.account(role(2), {id: 'withdrawer', label: SOLANA_TEXTS.label.withdrawer})

      return build.finish({
        fields: [account.field, staker.field, withdrawer.field],
        intent: SOLANA_TEXTS.intent.initializeStake,
        summary: text(SOLANA_TEXTS.summary.initializeStake, {account: account.display, authority: withdrawer.display}),
      })
    }
    case 1:
    case 10: {
      // Authorize: the new authority in the data. AuthorizeChecked: the new authority signs, as the fourth account.
      const key = tag === 1 ? reader.pubkey() : undefined
      const type = stakeAuthority(reader)
      reader.end()
      const account = await stakeAccount()
      const current = await build.account(role(1), {
        id: 'authority',
        label: SOLANA_TEXTS.label.authority,
        secondary: true,
      })
      const next =
        key === undefined
          ? await build.account(role(2), {id: 'newAuthority', label: SOLANA_TEXTS.label.newAuthority})
          : await build.address(key, {id: 'newAuthority', label: SOLANA_TEXTS.label.newAuthority})
      const handover = handoverWarning(scope, current, next, ['newAuthority', 'stakeAccount'])

      return build.finish({
        fields: [
          next.field,
          account.field,
          textField({id: 'authorityType', label: SOLANA_TEXTS.label.authorityType, value: type}),
          current.field,
        ],
        intent: handover === undefined ? SOLANA_TEXTS.intent.authorizeStake : INTENTS.transferOwnership,
        summary: text(SOLANA_TEXTS.summary.setAuthority, {account: account.display, authority: next.display, type}),
        warnings: [handover],
      })
    }
    case 2: {
      reader.end()
      const account = await stakeAccount()
      const validator = await build.account(role(1), {id: 'validator', label: SOLANA_TEXTS.label.validator})
      const authority = await build.account(role(2), {
        id: 'authority',
        label: SOLANA_TEXTS.label.staker,
        secondary: true,
      })

      return build.finish({
        fields: [account.field, validator.field, authority.field],
        intent: SOLANA_TEXTS.intent.stake,
        summary: text(SOLANA_TEXTS.summary.stake, {account: account.display, validator: validator.display}),
      })
    }
    case 3:
    case 16:
    case 17: {
      // Split: stake to a new stake account. MoveStake and MoveLamports: between two stake accounts.
      const lamports = reader.u64()
      reader.end()
      const account = await stakeAccount()
      const destination = await build.account(role(1), {id: 'destination', label: SOLANA_TEXTS.label.stakeAccount})
      const authority = await build.account(role(2), {
        id: 'authority',
        label: SOLANA_TEXTS.label.staker,
        secondary: true,
      })
      const amount = solAmount({id: 'amount', label: LABELS.amount}, lamports)

      return build.finish({
        fields: [amount, account.field, destination.field, authority.field],
        intent: tag === 3 ? SOLANA_TEXTS.intent.splitStake : SOLANA_TEXTS.intent.moveStake,
        summary: text(tag === 3 ? SOLANA_TEXTS.summary.splitStake : SOLANA_TEXTS.summary.moveStake, {
          account: account.display,
          amount: showAmount(amount),
          destination: destination.display,
        }),
      })
    }
    case 4: {
      const lamports = reader.u64()
      reader.end()
      const account = await stakeAccount()
      const recipient = await build.account(role(1), {id: 'recipient', label: LABELS.recipient})
      const authority = await build.account(role(2), {
        id: 'authority',
        label: SOLANA_TEXTS.label.withdrawer,
        secondary: true,
      })
      const amount = solAmount({id: 'amount', label: LABELS.amount}, lamports)

      return build.finish({
        fields: [recipient.field, amount, account.field, authority.field],
        intent: SOLANA_TEXTS.intent.withdrawStake,
        summary: text(SOLANA_TEXTS.summary.withdraw, {
          account: account.display,
          amount: showAmount(amount),
          recipient: recipient.display,
        }),
        warnings: [destinationWarning(recipient, ['recipient'])],
      })
    }
    case 5: {
      reader.end()
      const account = await stakeAccount()
      const authority = await build.account(role(1), {
        id: 'authority',
        label: SOLANA_TEXTS.label.staker,
        secondary: true,
      })

      return build.finish({
        fields: [account.field, authority.field],
        intent: SOLANA_TEXTS.intent.unstake,
        summary: text(SOLANA_TEXTS.summary.unstake, {account: account.display}),
      })
    }
    case 7: {
      reader.end()
      const account = await stakeAccount()
      const source = await build.account(role(1), {id: 'source', label: SOLANA_TEXTS.label.stakeAccount})
      const authority = await build.account(role(2), {
        id: 'authority',
        label: SOLANA_TEXTS.label.staker,
        secondary: true,
      })

      return build.finish({
        fields: [account.field, source.field, authority.field],
        intent: SOLANA_TEXTS.intent.mergeStake,
        summary: text(SOLANA_TEXTS.summary.mergeStake, {account: account.display, source: source.display}),
      })
    }
    default:
      return malformed()
  }
}

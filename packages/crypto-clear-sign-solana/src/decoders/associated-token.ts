import {LABELS, text} from '@hzblj/crypto-clear-sign'

import {SOLANA_TEXTS} from '../catalogs'
import {malformed} from '../reader'
import type {Decoder} from './types'

/**
 * The Associated Token Account program: `Create` (no data, or 0), `CreateIdempotent` (1) and `RecoverNested` (2). An
 * associated token account is where a wallet holds a token; creating one costs its rent, paid by the payer.
 */
export const describeAssociatedToken: Decoder = async (instruction, build, scope) => {
  const {data} = instruction

  if (data.length > 1) {
    return malformed()
  }

  const tag = data[0] ?? 0

  if (tag === 0 || tag === 1) {
    const owner = await build.account(2, {id: 'owner', label: LABELS.owner})
    const mint = await build.account(3, {id: 'token', label: LABELS.token})
    const account = await build.account(1, {id: 'account', label: LABELS.account, secondary: true})
    const payer = await build.account(0, {id: 'from', label: LABELS.from, secondary: true})
    const known = mint.address === undefined ? undefined : await scope.context.token(mint.address)

    return build.finish({
      fields: [owner.field, mint.field, account.field, payer.field],
      intent: SOLANA_TEXTS.intent.createTokenAccount,
      summary: text(SOLANA_TEXTS.summary.createTokenAccount, {
        owner: owner.display,
        token: known?.symbol ?? mint.display,
      }),
    })
  }

  if (tag === 2) {
    const nested = await build.account(0, {id: 'account', label: LABELS.account})
    const mint = await build.account(1, {id: 'token', label: LABELS.token})
    const destination = await build.account(2, {id: 'destinationAccount', label: SOLANA_TEXTS.label.destinationAccount})
    const wallet = await build.account(5, {id: 'owner', label: LABELS.owner})

    return build.finish({
      fields: [nested.field, mint.field, destination.field, wallet.field],
      intent: SOLANA_TEXTS.intent.recoverNested,
      summary: text(SOLANA_TEXTS.summary.recoverNested, {owner: wallet.display}),
    })
  }

  return malformed()
}

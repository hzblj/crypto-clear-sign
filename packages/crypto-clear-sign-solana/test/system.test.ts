import assert from 'node:assert/strict'
import {describe, test} from 'node:test'

import type {Address} from '@solana/kit'
import {
  getAdvanceNonceAccountInstruction,
  getAllocateInstruction,
  getAllocateWithSeedInstruction,
  getAssignInstruction,
  getAssignWithSeedInstruction,
  getAuthorizeNonceAccountInstruction,
  getCreateAccountAllowPrefundInstruction,
  getCreateAccountInstruction,
  getCreateAccountWithSeedInstruction,
  getInitializeNonceAccountInstruction,
  getTransferSolInstruction,
  getTransferSolWithSeedInstruction,
  getUpgradeNonceAccountInstruction,
  getWithdrawNonceAccountInstruction,
} from '@solana-program/system'

import {
  addressOf,
  clear,
  codesAt,
  FRIEND,
  field,
  first,
  OTHER,
  raw,
  STRANGER,
  SYSTEM,
  signer,
  syncResolvers,
  WALLET,
  warningOf,
} from './support'

const as = (value: string) => value as Address
const PROGRAM = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin'

describe('System Program', () => {
  test('transfer: what @solana-program/system encodes, read back: recipient, lamports as SOL, the source', async () => {
    const result = await clear([
      getTransferSolInstruction({amount: 1_500_000_000n, destination: as(STRANGER), source: signer(WALLET)}),
    ])
    const action = first(result)
    const amount = field(action, 'amount', 'amount')

    assert.deepEqual(action.source, {decoder: 'system-program', kind: 'builtin'})
    assert.equal(action.intent.code, 'intent.send')
    assert.equal(action.summary?.code, 'summary.send')
    assert.equal(amount.value, 1_500_000_000n)
    assert.equal(amount.decimals, 9)
    assert.equal(amount.symbol, 'SOL')
    assert.equal(amount.baseUnit, 'lamports')
    assert.equal(addressOf(action, 'recipient').value, STRANGER)
    assert.equal(addressOf(action, 'from').relation, 'self')
    assert.equal(addressOf(action, 'program').name, 'System Program')
    assert.equal(result.intent.code, 'intent.send')
    assert.equal(result.summary?.text, action.summary?.text)
  })

  test('UNKNOWN_DESTINATION: SOL to an unknown address is low, on the recipient', async () => {
    const result = await clear([
      getTransferSolInstruction({amount: 1n, destination: as(STRANGER), source: signer(WALLET)}),
    ])
    const raised = warningOf(result, 'UNKNOWN_DESTINATION')

    assert.equal(raised.severity, 'low')
    assert.deepEqual(raised.action, [0])
    assert.deepEqual(raised.fields, ['recipient'])
    assert.equal(result.risk, 'low')
  })

  test('UNKNOWN_DESTINATION: not to a contact, the user`s own account, or a known contract', async () => {
    for (const destination of [FRIEND, OTHER, 'Vote111111111111111111111111111111111111111']) {
      const result = await clear(
        [getTransferSolInstruction({amount: 1n, destination: as(destination), source: signer(WALLET)})],
        {
          resolvers: syncResolvers,
        }
      )

      assert.deepEqual(codesAt(result, [0]), [])
      assert.equal(result.risk, 'none')
    }
  })

  test('createAccount: the new account, its funding as an outflow, its owner program and space', async () => {
    const result = await clear([
      getCreateAccountInstruction({
        lamports: 2_039_280n,
        newAccount: signer(STRANGER),
        payer: signer(WALLET),
        programAddress: as(PROGRAM),
        space: 165,
      }),
    ])
    const action = first(result)

    assert.equal(action.intent.code, 'solana.intent.createAccount')
    assert.equal(addressOf(action, 'newAccount').value, STRANGER)
    assert.equal(addressOf(action, 'ownerProgram').value, PROGRAM)
    assert.equal(field(action, 'amount', 'amount').value, 2_039_280n)
    assert.equal(field(action, 'space', 'number').value, 165n)
    assert.equal(field(result, 'sent', 'list').items[0]?.kind, 'amount')
  })

  test('createAccountAllowPrefund and createAccountWithSeed read the same, with their own account order', async () => {
    const prefund = first(
      await clear([
        getCreateAccountAllowPrefundInstruction({
          lamports: 7n,
          newAccount: signer(STRANGER),
          payer: signer(WALLET),
          programAddress: as(PROGRAM),
          space: 8,
        }),
      ])
    )
    assert.equal(addressOf(prefund, 'newAccount').value, STRANGER)
    assert.equal(addressOf(prefund, 'from').value, WALLET)

    const seeded = first(
      await clear([
        getCreateAccountWithSeedInstruction({
          amount: 9n,
          base: as(WALLET),
          baseAccount: signer(WALLET),
          newAccount: as(STRANGER),
          payer: signer(WALLET),
          programAddress: as(PROGRAM),
          seed: 'vault',
          space: 10,
        }),
      ])
    )
    assert.equal(field(seeded, 'seed', 'text').value, 'vault')
    assert.equal(field(seeded, 'amount', 'amount').value, 9n)
    assert.equal(addressOf(seeded, 'base').value, WALLET)
  })

  test('ASSET_OWNERSHIP_TRANSFER: assigning the signer`s account to a program is critical', async () => {
    const result = await clear([getAssignInstruction({account: signer(WALLET), programAddress: as(PROGRAM)})])
    const raised = warningOf(result, 'ASSET_OWNERSHIP_TRANSFER')

    assert.equal(first(result).intent.code, 'solana.intent.assign')
    assert.equal(raised.severity, 'critical')
    assert.deepEqual(raised.fields, ['account', 'ownerProgram'])
    assert.equal(result.risk, 'critical')
  })

  test('ASSET_OWNERSHIP_TRANSFER: not for a new account another key signs, nor back to the System Program', async () => {
    const fresh = await clear([getAssignInstruction({account: signer(STRANGER), programAddress: as(PROGRAM)})])
    assert.deepEqual(codesAt(fresh, [0]), [])

    const back = await clear([getAssignInstruction({account: signer(WALLET), programAddress: as(SYSTEM)})])
    assert.deepEqual(codesAt(back, [0]), [])
  })

  test('ASSET_OWNERSHIP_TRANSFER: without a signer, any signing account may be the user`s', async () => {
    const result = await clear([getAssignInstruction({account: signer(STRANGER), programAddress: as(PROGRAM)})], {
      signer: undefined,
    })

    assert.ok(codesAt(result, [0]).includes('ASSET_OWNERSHIP_TRANSFER'))
  })

  test('assignWithSeed and allocateWithSeed hand over an account derived from the signer', async () => {
    const assign = await clear([
      getAssignWithSeedInstruction({
        account: as(STRANGER),
        base: as(WALLET),
        baseAccount: signer(WALLET),
        programAddress: as(PROGRAM),
        seed: 'derived',
      }),
    ])
    assert.deepEqual(codesAt(assign, [0]), ['ASSET_OWNERSHIP_TRANSFER'])
    assert.equal(field(first(assign), 'seed', 'text').value, 'derived')

    const allocate = await clear([
      getAllocateWithSeedInstruction({
        base: as(WALLET),
        baseAccount: signer(WALLET),
        newAccount: as(STRANGER),
        programAddress: as(PROGRAM),
        seed: 'derived',
        space: 64,
      }),
    ])
    assert.deepEqual(codesAt(allocate, [0]), ['ASSET_OWNERSHIP_TRANSFER'])
    assert.equal(field(first(allocate), 'space', 'number').value, 64n)
  })

  test('allocate: the space, nothing handed over', async () => {
    const result = await clear([getAllocateInstruction({newAccount: signer(STRANGER), space: 200})])

    assert.equal(first(result).intent.code, 'solana.intent.allocate')
    assert.equal(field(first(result), 'space', 'number').value, 200n)
    assert.deepEqual(codesAt(result, [0]), [])
  })

  test('transferSolWithSeed: from an account derived from the signer, counted as sent', async () => {
    const result = await clear(
      [
        getTransferSolWithSeedInstruction({
          amount: 3n,
          baseAccount: signer(WALLET),
          destination: as(FRIEND),
          fromOwner: as(PROGRAM),
          fromSeed: 'pocket',
          source: as(STRANGER),
        }),
      ],
      {resolvers: syncResolvers}
    )
    const action = first(result)

    assert.equal(action.intent.code, 'intent.send')
    assert.equal(field(action, 'amount', 'amount').value, 3n)
    assert.equal(addressOf(action, 'recipient').relation, 'contact')
    assert.equal(field(result, 'sent', 'list').items.length, 1)
    assert.deepEqual(codesAt(result, [0]), [])
  })

  test('nonce accounts: initialize, advance, withdraw, upgrade', async () => {
    const initialize = first(
      await clear([getInitializeNonceAccountInstruction({nonceAccount: as(STRANGER), nonceAuthority: as(WALLET)})])
    )
    assert.equal(initialize.intent.code, 'solana.intent.initializeNonce')
    assert.equal(addressOf(initialize, 'newAuthority').relation, 'self')

    const withdraw = await clear([
      getWithdrawNonceAccountInstruction({
        nonceAccount: as(STRANGER),
        nonceAuthority: signer(WALLET),
        recipientAccount: as(STRANGER),
        withdrawAmount: 1_000n,
      }),
    ])
    assert.equal(first(withdraw).intent.code, 'solana.intent.withdrawNonce')
    assert.equal(field(first(withdraw), 'amount', 'amount').value, 1_000n)
    assert.deepEqual(codesAt(withdraw, [0]), ['UNKNOWN_DESTINATION'])

    const upgrade = first(await clear([getUpgradeNonceAccountInstruction({nonceAccount: as(STRANGER)})]))
    assert.equal(upgrade.intent.code, 'solana.intent.upgradeNonce')
  })

  test('authorizeNonceAccount: ASSET_OWNERSHIP_TRANSFER to a stranger, none to the user`s own account', async () => {
    const away = await clear([
      getAuthorizeNonceAccountInstruction({
        newNonceAuthority: as(STRANGER),
        nonceAccount: as(FRIEND),
        nonceAuthority: signer(WALLET),
      }),
    ])
    assert.deepEqual(codesAt(away, [0]), ['ASSET_OWNERSHIP_TRANSFER'])
    assert.deepEqual(warningOf(away, 'ASSET_OWNERSHIP_TRANSFER').fields, ['newAuthority'])

    const kept = await clear(
      [
        getAuthorizeNonceAccountInstruction({
          newNonceAuthority: as(OTHER),
          nonceAccount: as(FRIEND),
          nonceAuthority: signer(WALLET),
        }),
      ],
      {resolvers: syncResolvers}
    )
    assert.deepEqual(codesAt(kept, [0]), [])
  })

  test('an advance that is not the first instruction is an action, not a durable nonce', async () => {
    const result = await clear([
      getTransferSolInstruction({amount: 1n, destination: as(FRIEND), source: signer(WALLET)}),
      getAdvanceNonceAccountInstruction({nonceAccount: as(STRANGER), nonceAuthority: signer(WALLET)}),
    ])

    assert.equal(result.actions[1]?.intent.code, 'solana.intent.advanceNonce')
    assert.ok(!codesAt(result, []).includes('solana.DURABLE_NONCE'))
  })

  test('data the program would refuse is shown raw: a cut transfer, trailing bytes, an unknown tag, a long seed', async () => {
    const cut = raw(
      SYSTEM,
      [
        [WALLET, 'sw'],
        [STRANGER, 'w'],
      ],
      [2, 0, 0, 0, 1]
    )
    const long = raw(
      SYSTEM,
      [
        [WALLET, 'sw'],
        [STRANGER, 'w'],
      ],
      [2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 9]
    )
    const unknown = raw(SYSTEM, [[WALLET, 'sw']], [99, 0, 0, 0])
    const seed = getAssignWithSeedInstruction({
      account: as(STRANGER),
      base: as(WALLET),
      baseAccount: signer(WALLET),
      programAddress: as(PROGRAM),
      seed: 'x'.repeat(33),
    })

    for (const instruction of [cut, long, unknown, seed]) {
      const result = await clear([instruction])
      const action = first(result)

      assert.deepEqual(action.source, {kind: 'unknown'})
      assert.deepEqual(codesAt(result, [0]), ['UNKNOWN_CONTRACT_CALL'])
      assert.equal(field(action, 'data', 'raw').kind, 'raw')
    }
  })

  test('a transfer without its accounts is shown raw', async () => {
    const result = await clear([raw(SYSTEM, [[WALLET, 'sw']], [2, 0, 0, 0, ...new Array(8).fill(1)])])

    assert.deepEqual(first(result).source, {kind: 'unknown'})
  })
})

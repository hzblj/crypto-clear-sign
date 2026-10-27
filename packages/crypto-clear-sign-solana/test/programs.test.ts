import assert from 'node:assert/strict'
import {describe, test} from 'node:test'

import type {Address, ProgramDerivedAddressBump} from '@solana/kit'
import {
  getCloseLookupTableInstruction,
  getCreateLookupTableInstruction,
  getDeactivateLookupTableInstruction,
  getExtendLookupTableInstruction,
  getFreezeLookupTableInstruction,
} from '@solana-program/address-lookup-table'
import {
  getRequestHeapFrameInstruction,
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
  getSetLoadedAccountsDataSizeLimitInstruction,
} from '@solana-program/compute-budget'
import {
  getCloseInstruction,
  getDeployWithMaxDataLenInstruction,
  getExtendProgramInstruction,
  getInitializeBufferInstruction,
  getSetAuthorityCheckedInstruction,
  getSetAuthorityInstruction,
  getUpgradeInstruction,
  getWriteInstruction,
} from '@solana-program/loader-v3'
import {getAddMemoInstruction} from '@solana-program/memo'
import {
  getAuthorizeCheckedInstruction,
  getAuthorizeInstruction,
  getDeactivateInstruction,
  getDelegateStakeInstruction,
  getInitializeCheckedInstruction,
  getInitializeInstruction,
  getMergeInstruction,
  getMoveStakeInstruction,
  getSplitInstruction,
  getWithdrawInstruction,
  StakeAuthorize,
} from '@solana-program/stake'
import {getCreateAssociatedTokenInstruction, getRecoverNestedAssociatedTokenInstruction} from '@solana-program/token'

import {
  address,
  addressOf,
  chain,
  clear,
  codes,
  codesAt,
  field,
  first,
  OTHER,
  raw,
  STRANGER,
  signer,
  syncResolvers,
  USDC,
  WALLET,
  warningOf,
} from './support'

const as = (value: string) => value as Address
const STAKE = address(40)
const VOTE = address(41)
const TABLE = address(42)
const PROGRAM = address(43)
const PROGRAM_DATA = address(44)
const BUFFER = address(45)
const STAKE_PROGRAM = 'Stake11111111111111111111111111111111111111'
const CLOCK = 'SysvarC1ock11111111111111111111111111111111'
const HISTORY = 'SysvarStakeHistory1111111111111111111111111'
const CONFIG = 'StakeConfig11111111111111111111111111111111'

describe('Associated Token Account', () => {
  test('create and createIdempotent: the owner, the token, the account', async () => {
    const ata = chain.associatedTokenAddress({mint: USDC, owner: STRANGER})
    const result = await clear([
      getCreateAssociatedTokenInstruction({ata: as(ata), mint: as(USDC), owner: as(STRANGER), payer: signer(WALLET)}),
    ])
    const action = first(result)

    assert.deepEqual(action.source, {decoder: 'associated-token-account', kind: 'builtin'})
    assert.equal(action.intent.code, 'solana.intent.createTokenAccount')
    assert.equal(action.summary?.params?.token, 'USDC')
    assert.equal(addressOf(action, 'owner').value, STRANGER)
    assert.equal(addressOf(action, 'account').value, ata)
    assert.equal(result.risk, 'none')
  })

  test('recoverNested', async () => {
    const result = await clear([
      getRecoverNestedAssociatedTokenInstruction({
        destinationAssociatedAccountAddress: as(address(50)),
        nestedAssociatedAccountAddress: as(address(51)),
        nestedTokenMintAddress: as(USDC),
        ownerAssociatedAccountAddress: as(address(52)),
        ownerTokenMintAddress: as(USDC),
        walletAddress: signer(WALLET),
      }),
    ])

    assert.equal(first(result).intent.code, 'solana.intent.recoverNested')
    assert.equal(addressOf(first(result), 'owner').relation, 'self')
  })
})

describe('Compute Budget', () => {
  test('limit, price, heap and data size, as @solana-program/compute-budget encodes them; the priority fee at the root', async () => {
    const result = await clear([
      getSetComputeUnitLimitInstruction({units: 300_000}),
      getSetComputeUnitPriceInstruction({microLamports: 50_000n}),
      getRequestHeapFrameInstruction({bytes: 64 * 1024}),
      getSetLoadedAccountsDataSizeLimitInstruction({accountDataSizeLimit: 100_000}),
    ])

    assert.equal(field(result.actions[0] ?? first(result), 'computeUnitLimit', 'number').value, 300_000)
    assert.equal(result.actions[1] && field(result.actions[1], 'computeUnitPrice', 'number').value, 50_000n)
    assert.equal(result.actions[2] && field(result.actions[2], 'heapSize', 'number').value, 65_536)
    assert.equal(result.actions[3] && field(result.actions[3], 'dataSizeLimit', 'number').value, 100_000)
    assert.equal(field(result, 'computeUnitLimit', 'number').value, 300_000)
    // 50,000 micro-lamports for each of 300,000 units: 15,000 lamports.
    assert.equal(field(result, 'priorityFee', 'amount').value, 15_000n)
    assert.equal(result.risk, 'none')
  })

  test('without a limit, the runtime`s default: 200,000 units an instruction, 3,000 for a native program', async () => {
    const result = await clear([
      getSetComputeUnitPriceInstruction({microLamports: 1_000_000n}),
      raw(
        '11111111111111111111111111111111',
        [
          [WALLET, 'sw'],
          [OTHER, 'w'],
        ],
        [2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]
      ),
      raw(PROGRAM, [[WALLET, 'w']], [1]),
    ])

    assert.equal(field(result, 'computeUnitLimit', 'number').value, 203_000)
    assert.equal(field(result, 'priorityFee', 'amount').value, 203_000n)
  })

  test('HIGH_FEE: a priority fee above 0.01 SOL, or above the threshold given', async () => {
    const extreme = await clear([
      getSetComputeUnitLimitInstruction({units: 1_400_000}),
      getSetComputeUnitPriceInstruction({microLamports: 10_000_000n}),
    ])
    const raised = warningOf(extreme, 'HIGH_FEE')

    assert.equal(field(extreme, 'priorityFee', 'amount').value, 14_000_000n)
    assert.equal(raised.severity, 'medium')
    assert.deepEqual(raised.action, [])
    assert.deepEqual(raised.fields, ['priorityFee'])

    const busy = await clear([
      getSetComputeUnitLimitInstruction({units: 200_000}),
      getSetComputeUnitPriceInstruction({microLamports: 500_000n}),
    ])
    assert.ok(!codes(busy).includes('HIGH_FEE'))

    const strict = await clear(
      [
        getSetComputeUnitLimitInstruction({units: 200_000}),
        getSetComputeUnitPriceInstruction({microLamports: 500_000n}),
      ],
      {highPriorityFee: 50_000n}
    )
    assert.ok(codes(strict).includes('HIGH_FEE'))
  })

  test('a limit above the most a transaction may use is capped', async () => {
    const result = await clear([
      getSetComputeUnitLimitInstruction({units: 4_000_000}),
      getSetComputeUnitPriceInstruction({microLamports: 1n}),
    ])

    assert.equal(field(result, 'computeUnitLimit', 'number').value, 1_400_000)
  })
})

describe('Memo', () => {
  test('the note as text, its signers', async () => {
    const result = await clear([getAddMemoInstruction({memo: 'Invoice 42', signers: [signer(WALLET)]})])
    const action = first(result)

    assert.deepEqual(action.source, {decoder: 'memo', kind: 'builtin'})
    assert.equal(field(action, 'memo', 'text').value, 'Invoice 42')
    assert.equal(field(action, 'account-0', 'address').relation, 'self')
    assert.equal(result.risk, 'none')
  })

  test('HIDDEN_CHARACTERS: a note that hides text', async () => {
    const result = await clear([getAddMemoInstruction({memo: 'pay‮gnp.exe'})])
    const raised = warningOf(result, 'HIDDEN_CHARACTERS')

    assert.deepEqual(raised.fields, ['memo'])
    assert.deepEqual(raised.action, [0])
  })

  test('a note that is not UTF-8 is shown raw', async () => {
    const result = await clear([raw('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', [], [0xff, 0xfe])])

    assert.deepEqual(codesAt(result, [0]), ['UNKNOWN_CONTRACT_CALL'])
  })
})

describe('Stake', () => {
  test('delegate, deactivate, withdraw, split, merge, move: what @solana-program/stake encodes', async () => {
    const result = await clear([
      getInitializeInstruction({
        arg0: {staker: as(WALLET), withdrawer: as(WALLET)},
        arg1: {custodian: as(WALLET), epoch: 0n, unixTimestamp: 0n},
        stake: as(STAKE),
      }),
      getDelegateStakeInstruction({stake: as(STAKE), stakeAuthority: signer(WALLET), vote: as(VOTE)}),
      getDeactivateInstruction({stake: as(STAKE), stakeAuthority: signer(WALLET)}),
      getWithdrawInstruction({
        args: 5_000n,
        recipient: as(WALLET),
        stake: as(STAKE),
        withdrawAuthority: signer(WALLET),
      }),
      getSplitInstruction({args: 7n, splitStake: as(OTHER), stake: as(STAKE), stakeAuthority: signer(WALLET)}),
      getMergeInstruction({destinationStake: as(STAKE), sourceStake: as(OTHER), stakeAuthority: signer(WALLET)}),
      getMoveStakeInstruction({
        args: 9n,
        destinationStake: as(OTHER),
        sourceStake: as(STAKE),
        stakeAuthority: signer(WALLET),
      }),
      getInitializeCheckedInstruction({
        stake: as(STAKE),
        stakeAuthority: as(WALLET),
        withdrawAuthority: signer(WALLET),
      }),
    ])

    assert.deepEqual(
      result.actions.map(action => action.intent.code),
      [
        'solana.intent.initializeStake',
        'solana.intent.stake',
        'solana.intent.unstake',
        'solana.intent.withdrawStake',
        'solana.intent.splitStake',
        'solana.intent.mergeStake',
        'solana.intent.moveStake',
        'solana.intent.initializeStake',
      ]
    )
    assert.equal(result.actions[1] && addressOf(result.actions[1], 'validator').value, VOTE)
    assert.equal(result.actions[3] && field(result.actions[3], 'amount', 'amount').value, 5_000n)
    assert.equal(result.actions[4] && field(result.actions[4], 'amount', 'amount').value, 7n)
    assert.equal(result.actions[6] && field(result.actions[6], 'amount', 'amount').value, 9n)
    assert.equal(result.actions[7] && addressOf(result.actions[7], 'withdrawer').relation, 'self')
    assert.equal(result.risk, 'none')
  })

  test('the older account layout, with its sysvars, reads the same', async () => {
    const result = await clear([
      raw(
        STAKE_PROGRAM,
        [
          [STAKE, 'w'],
          [VOTE, ''],
          [CLOCK, ''],
          [HISTORY, ''],
          [CONFIG, ''],
          [WALLET, 's'],
        ],
        [2, 0, 0, 0]
      ),
      raw(
        STAKE_PROGRAM,
        [
          [STAKE, 'w'],
          [STRANGER, 'w'],
          [CLOCK, ''],
          [HISTORY, ''],
          [WALLET, 's'],
        ],
        [4, 0, 0, 0, ...new Array(8).fill(1)]
      ),
    ])

    assert.equal(addressOf(first(result), 'validator').value, VOTE)
    assert.equal(addressOf(first(result), 'authority').relation, 'self')
    assert.equal(field(first(result), 'account-2', 'address').value, CLOCK)
    assert.equal(result.actions[1] && addressOf(result.actions[1], 'recipient').value, STRANGER)
    assert.deepEqual(codesAt(result, [1]), ['UNKNOWN_DESTINATION'])
  })

  test('ASSET_OWNERSHIP_TRANSFER: authorize hands a stake authority to someone else', async () => {
    const result = await clear([
      getAuthorizeInstruction({
        arg0: as(STRANGER),
        arg1: StakeAuthorize.Withdrawer,
        authority: signer(WALLET),
        stake: as(STAKE),
      }),
    ])
    const raised = warningOf(result, 'ASSET_OWNERSHIP_TRANSFER')

    assert.equal(first(result).intent.code, 'intent.transferOwnership')
    assert.equal(field(first(result), 'authorityType', 'text').value, 'withdrawer')
    assert.equal(raised.severity, 'critical')
    assert.deepEqual(raised.fields, ['newAuthority', 'stakeAccount'])
  })

  test('authorize to the user`s own account, and authorizeChecked to the signer, hand nothing over', async () => {
    const own = await clear(
      [
        getAuthorizeInstruction({
          arg0: as(OTHER),
          arg1: StakeAuthorize.Staker,
          authority: signer(WALLET),
          stake: as(STAKE),
        }),
      ],
      {resolvers: syncResolvers}
    )
    assert.deepEqual(codesAt(own, [0]), [])
    assert.equal(first(own).intent.code, 'solana.intent.authorizeStake')

    const checked = await clear([
      getAuthorizeCheckedInstruction({
        authority: signer(OTHER),
        newAuthority: signer(WALLET),
        stake: as(STAKE),
        stakeAuthorize: StakeAuthorize.Staker,
      }),
    ])
    assert.deepEqual(codesAt(checked, [0]), [])
    assert.equal(addressOf(first(checked), 'newAuthority').relation, 'self')
  })
})

describe('Address Lookup Table', () => {
  test('create, extend, freeze, deactivate, close', async () => {
    const result = await clear([
      getCreateLookupTableInstruction({
        address: [as(TABLE), 254 as ProgramDerivedAddressBump],
        authority: signer(WALLET),
        payer: signer(WALLET),
        recentSlot: 123n,
      }),
      getExtendLookupTableInstruction({
        address: as(TABLE),
        addresses: [as(OTHER), as(STRANGER)],
        authority: signer(WALLET),
        payer: signer(WALLET),
      }),
      getFreezeLookupTableInstruction({address: as(TABLE), authority: signer(WALLET)}),
      getDeactivateLookupTableInstruction({address: as(TABLE), authority: signer(WALLET)}),
      getCloseLookupTableInstruction({address: as(TABLE), authority: signer(WALLET), recipient: as(WALLET)}),
    ])

    assert.deepEqual(
      result.actions.map(action => action.intent.code),
      [
        'solana.intent.createLookupTable',
        'solana.intent.extendLookupTable',
        'solana.intent.freezeLookupTable',
        'solana.intent.deactivateLookupTable',
        'solana.intent.closeLookupTable',
      ]
    )
    assert.equal(field(first(result), 'recentSlot', 'number').value, 123n)
    assert.equal(field(first(result), 'bump', 'number').value, 254)
    assert.equal(result.actions[1] && field(result.actions[1], 'addresses', 'list').items.length, 2)
    assert.equal(result.risk, 'none')
  })

  test('CLOSE_TO_OTHER: a table closed to a stranger; not to its authority', async () => {
    const result = await clear([
      getCloseLookupTableInstruction({address: as(TABLE), authority: signer(WALLET), recipient: as(STRANGER)}),
    ])

    assert.deepEqual(codesAt(result, [0]), ['solana.CLOSE_TO_OTHER'])
  })
})

describe('BPF Upgradeable Loader', () => {
  test('PROGRAM_UPGRADE: an upgrade replaces a program`s code, critical', async () => {
    const result = await clear([
      getUpgradeInstruction({
        authority: signer(WALLET),
        bufferAccount: as(BUFFER),
        programAccount: as(PROGRAM),
        programDataAccount: as(PROGRAM_DATA),
        spillAccount: as(WALLET),
      }),
    ])
    const raised = warningOf(result, 'solana.PROGRAM_UPGRADE')

    assert.deepEqual(first(result).source, {decoder: 'bpf-upgradeable-loader', kind: 'builtin'})
    assert.equal(first(result).intent.code, 'solana.intent.upgradeProgram')
    assert.equal(raised.severity, 'critical')
    assert.deepEqual(raised.fields, ['programAccount', 'buffer'])
  })

  test('setAuthority: ASSET_OWNERSHIP_TRANSFER to a stranger; none to the user`s own; immutable without one', async () => {
    const away = await clear([
      getSetAuthorityInstruction({
        bufferOrProgramDataAccount: as(PROGRAM_DATA),
        currentAuthority: signer(WALLET),
        newAuthority: as(STRANGER),
      }),
    ])
    assert.deepEqual(codesAt(away, [0]), ['ASSET_OWNERSHIP_TRANSFER'])
    assert.equal(first(away).intent.code, 'intent.transferOwnership')

    const checked = await clear(
      [
        getSetAuthorityCheckedInstruction({
          bufferOrProgramDataAccount: as(PROGRAM_DATA),
          currentAuthority: signer(WALLET),
          newAuthority: signer(OTHER),
        }),
      ],
      {resolvers: syncResolvers}
    )
    assert.deepEqual(codesAt(checked, [0]), [])

    const immutable = await clear([
      getSetAuthorityInstruction({bufferOrProgramDataAccount: as(PROGRAM_DATA), currentAuthority: signer(WALLET)}),
    ])
    assert.equal(first(immutable).intent.code, 'solana.intent.makeImmutable')
    assert.deepEqual(codesAt(immutable, [0]), [])
  })

  test('buffers, deployment, extension and closing', async () => {
    const result = await clear([
      getInitializeBufferInstruction({bufferAuthority: as(WALLET), sourceAccount: as(BUFFER)}),
      getWriteInstruction({
        bufferAccount: as(BUFFER),
        bufferAuthority: signer(WALLET),
        bytes: new Uint8Array([1, 2, 3]),
        offset: 16,
      }),
      getDeployWithMaxDataLenInstruction({
        authority: signer(WALLET),
        bufferAccount: as(BUFFER),
        maxDataLen: 4096n,
        payerAccount: signer(WALLET),
        programAccount: as(PROGRAM),
        programDataAccount: as(PROGRAM_DATA),
      }),
      getExtendProgramInstruction({
        additionalBytes: 1024,
        payer: signer(WALLET),
        programAccount: as(PROGRAM),
        programDataAccount: as(PROGRAM_DATA),
      }),
      getCloseInstruction({
        authority: signer(WALLET),
        bufferOrProgramDataAccount: as(BUFFER),
        destinationAccount: as(STRANGER),
      }),
    ])

    assert.deepEqual(
      result.actions.map(action => action.intent.code),
      [
        'solana.intent.createBuffer',
        'solana.intent.writeProgram',
        'intent.deploy',
        'solana.intent.extendProgram',
        'solana.intent.closeProgram',
      ]
    )
    assert.equal(result.actions[1] && field(result.actions[1], 'data', 'raw').value, '0x010203')
    assert.equal(result.actions[1] && field(result.actions[1], 'offset', 'number').value, 16)
    assert.equal(result.actions[2] && field(result.actions[2], 'maxDataLength', 'number').value, 4096n)
    assert.deepEqual(codesAt(result, [4]), ['solana.CLOSE_TO_OTHER'])
  })
})

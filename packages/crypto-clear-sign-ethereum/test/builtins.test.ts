import assert from 'node:assert/strict'
import {describe, test} from 'node:test'

import {maxUint, warningsAt} from '@hzblj/crypto-clear-sign'
import type {Hex} from '@hzblj/crypto-ethereum'
import {concat, encodeAbiParameters, numberToHex, pad, parseAbiParameters} from 'viem'

import {clearSignTransaction, MULTICALL3, PERMIT2} from '../src'
import {BUILTINS} from '../src/calls/builtins'
import {MAX_CALL_DEPTH} from '../src/calls/common'
import {registryResolver} from '../src/registry'
import {
  at,
  call,
  chainOf,
  codes,
  DAY,
  encode,
  fieldOf,
  inSeconds,
  mainnet,
  NFT,
  NOW,
  NOW_SECONDS,
  OTHER,
  options,
  request,
  SIGNER,
  shape,
  UNISWAP_ROUTER,
  UNKNOWN_TOKEN,
  USDC,
  WETH,
} from './helpers'

const MAX = maxUint(256)
const ETHER = 10n ** 18n
const ROUTER = UNISWAP_ROUTER
const UNISWAP = {
  resolvers: {
    names: {
      name: ({address}: {readonly address: string}) =>
        address.toLowerCase() === ROUTER.toLowerCase() ? {name: 'Uniswap', relation: 'contract' as const} : undefined,
    },
  },
}
const approve = (spender: string, amount: bigint) =>
  encode('approve(address spender,uint256 amount)', [spender, amount])
const unknownData = encode('stake(uint256 amount)', [5n])

describe('ERC-20', () => {
  test('transfer: recipient, amount, token; UNKNOWN_DESTINATION to a stranger, not to the signer', async () => {
    const result = await call(USDC, mainnet.erc20.transferData(OTHER, 1_500_000n))
    assert.deepEqual(result.source, {decoder: 'erc20', kind: 'builtin'})
    assert.equal(result.intent.code, 'intent.send')
    assert.equal(result.summary?.code, 'summary.send')
    assert.deepEqual(
      result.fields.slice(0, 3).map(entry => entry.id),
      ['recipient', 'amount', 'token']
    )
    const amount = fieldOf(result, 'amount', 'amount')
    assert.deepEqual([amount.value, amount.decimals, amount.symbol, amount.token], [1_500_000n, 6, 'USDC', USDC])
    assert.deepEqual(fieldOf(result, 'token', 'address').relation, 'token')
    assert.deepEqual(shape(result), ['UNKNOWN_DESTINATION low  recipient'])

    assert.deepEqual(codes(await call(USDC, mainnet.erc20.transferData(SIGNER, 1n))), [])
  })

  test('transferFrom: the owner too; an unknown token is UNKNOWN_TOKEN, in base units', async () => {
    const result = await call(
      UNKNOWN_TOKEN,
      encode('transferFrom(address from,address to,uint256 amount)', [OTHER, SIGNER, 7n])
    )
    assert.deepEqual(
      result.fields.slice(0, 4).map(entry => entry.id),
      ['from', 'recipient', 'amount', 'token']
    )
    assert.equal(fieldOf(result, 'from', 'address').value, OTHER)
    assert.equal(fieldOf(result, 'amount', 'amount').decimals, undefined)
    assert.deepEqual(shape(result), ['UNKNOWN_TOKEN medium  amount'])
  })

  test('approve: unlimited at max, near max and from 2^255, and at the narrower widths; finite below', async () => {
    const cases: readonly [string, bigint, boolean][] = [
      ['max', MAX, true],
      ['near max (max minus what was spent)', MAX - 1_000_000n * 10n ** 6n, true],
      ['2^255', 2n ** 255n, true],
      ['just below 2^255', 2n ** 255n - 1n, false],
      ['maxUint(128)', maxUint(128), true],
      ['maxUint(128) - 1', maxUint(128) - 1n, false],
      ['maxUint(96)', maxUint(96), true],
      ['a finite amount', 1_000n * 10n ** 6n, false],
    ]

    for (const [name, value, unlimited] of cases) {
      const result = await call(USDC, approve(ROUTER, value))
      assert.equal(result.intent.code, 'intent.approve', name)
      assert.equal(fieldOf(result, 'amount', 'amount').unlimited, unlimited, name)
      assert.equal(result.summary?.code, unlimited ? 'summary.approveUnlimited' : 'summary.approve', name)
      assert.deepEqual(
        shape(result),
        [
          ...(unlimited ? ['UNLIMITED_APPROVAL critical  amount,spender'] : []),
          'ethereum.UNKNOWN_SPENDER high  spender',
        ].sort(),
        name
      )
      assert.equal(result.risk, unlimited ? 'critical' : 'high', name)
    }
  })

  test('approve of 0 is a revoke, with no warning whoever the spender is', async () => {
    const result = await call(USDC, approve(ROUTER, 0n))
    assert.equal(result.intent.code, 'intent.revoke')
    assert.equal(result.summary?.code, 'summary.revoke')
    assert.deepEqual(codes(result), [])
  })

  test('a known spender is not UNKNOWN_SPENDER; an unknown one is', async () => {
    const known = await call(USDC, approve(ROUTER, MAX), UNISWAP)
    assert.deepEqual(
      [fieldOf(known, 'spender', 'address').name, fieldOf(known, 'spender', 'address').relation],
      ['Uniswap', 'contract']
    )
    assert.deepEqual(shape(known), ['UNLIMITED_APPROVAL critical  amount,spender'])

    for (const relation of ['own', 'contact'] as const) {
      const named = await call(USDC, approve(OTHER, 5n), {
        resolvers: {names: {name: () => ({name: 'Mine', relation})}},
      })
      assert.deepEqual(codes(named), [], relation)
    }

    assert.deepEqual(codes(await call(USDC, approve(SIGNER, 5n))), [])
    assert.deepEqual(codes(await call(USDC, approve(OTHER, 5n))), ['ethereum.UNKNOWN_SPENDER'])
  })

  test('increaseAllowance: unlimited at max, its own summary otherwise; decreaseAllowance is never unlimited', async () => {
    const increase = (value: bigint) => encode('increaseAllowance(address spender,uint256 addedValue)', [ROUTER, value])
    const decrease = (value: bigint) =>
      encode('decreaseAllowance(address spender,uint256 subtractedValue)', [ROUTER, value])

    const unlimited = await call(USDC, increase(MAX), UNISWAP)
    assert.deepEqual(shape(unlimited), ['UNLIMITED_APPROVAL critical  amount,spender'])
    const finite = await call(USDC, increase(5_000_000n), UNISWAP)
    assert.equal(finite.summary?.code, 'ethereum.summary.increaseAllowance')
    assert.deepEqual(codes(finite), [])

    const lower = await call(USDC, decrease(MAX))
    assert.equal(lower.intent.code, 'ethereum.intent.decreaseAllowance')
    assert.equal(lower.summary?.code, 'ethereum.summary.decreaseAllowance')
    assert.equal(fieldOf(lower, 'amount', 'amount').unlimited, false)
    // Lowering an allowance gives nothing away, even to a stranger.
    assert.deepEqual(codes(lower), [])
  })

  test('a call that names no ERC-20 function of the built-ins goes on to the descriptors', async () => {
    assert.ok(BUILTINS.length >= 30)
    const decoders = new Set(BUILTINS.map(builtin => builtin.decoder))
    assert.deepEqual([...decoders].sort(), [
      'erc1155',
      'erc20',
      'erc721',
      'multicall',
      'nft',
      'ownable',
      'permit2',
      'proxy',
      'safe-multisend',
      'smart-account',
      'weth',
    ])
  })
})

describe('NFTs', () => {
  test('setApprovalForAll(true): ASSET_OWNERSHIP_TRANSFER, and UNKNOWN_SPENDER for a stranger; (false) a revoke', async () => {
    const all = (approved: boolean) => encode('setApprovalForAll(address operator,bool approved)', [ROUTER, approved])
    const granted = await call(NFT, all(true))
    assert.deepEqual(granted.source, {decoder: 'nft', kind: 'builtin'})
    assert.equal(granted.summary?.code, 'ethereum.summary.approveAll')
    assert.equal(fieldOf(granted, 'approved', 'boolean').value, true)
    assert.deepEqual(shape(granted), [
      'ASSET_OWNERSHIP_TRANSFER critical  operator,approved',
      'ethereum.UNKNOWN_SPENDER high  operator',
    ])

    assert.deepEqual(shape(await call(NFT, all(true), UNISWAP)), [
      'ASSET_OWNERSHIP_TRANSFER critical  operator,approved',
    ])

    const revoked = await call(NFT, all(false))
    assert.equal(revoked.intent.code, 'intent.revoke')
    assert.equal(revoked.summary?.code, 'ethereum.summary.revokeAll')
    assert.deepEqual(codes(revoked), [])
  })

  test('ERC-721 safeTransferFrom, with and without data', async () => {
    const plain = await call(
      NFT,
      encode('safeTransferFrom(address from,address to,uint256 tokenId)', [SIGNER, OTHER, 42n])
    )
    assert.deepEqual(plain.source, {decoder: 'erc721', kind: 'builtin'})
    assert.equal(plain.summary?.code, 'ethereum.summary.sendNft')
    assert.deepEqual(
      plain.fields.slice(0, 4).map(entry => entry.id),
      ['from', 'recipient', 'tokenId', 'collection']
    )
    assert.equal(fieldOf(plain, 'tokenId', 'number').value, 42n)
    assert.deepEqual(plain.raw, [])
    assert.deepEqual(shape(plain), ['UNKNOWN_DESTINATION low  recipient'])

    const withData = await call(
      NFT,
      encode('safeTransferFrom(address from,address to,uint256 tokenId,bytes data)', [SIGNER, SIGNER, 42n, '0xbeef'])
    )
    assert.deepEqual(
      withData.raw.map(entry => [entry.id, entry.kind === 'raw' ? entry.value : undefined]),
      [['data', '0xbeef']]
    )
    assert.deepEqual(codes(withData), [])
  })

  test('ERC-1155 safeTransferFrom and safeBatchTransferFrom; a batch whose lists differ in length is not read', async () => {
    const single = await call(
      NFT,
      encode('safeTransferFrom(address from,address to,uint256 id,uint256 amount,bytes data)', [
        SIGNER,
        OTHER,
        1n,
        3n,
        '0x',
      ])
    )
    assert.deepEqual(single.source, {decoder: 'erc1155', kind: 'builtin'})
    assert.equal(fieldOf(single, 'amount', 'number').value, 3n)

    const batch = (ids: bigint[], amounts: bigint[]) =>
      encode('safeBatchTransferFrom(address from,address to,uint256[] ids,uint256[] amounts,bytes data)', [
        SIGNER,
        OTHER,
        ids,
        amounts,
        '0x',
      ])
    const result = await call(NFT, batch([1n, 2n], [10n, 20n]))
    assert.equal(result.summary?.code, 'ethereum.summary.sendNftBatch')
    assert.deepEqual(result.summary?.params?.count, 2)
    assert.deepEqual(
      fieldOf(result, 'item-1', 'list').items.map(item => [item.id, item.kind === 'number' ? item.value : undefined]),
      [
        ['tokenId-1', 2n],
        ['amount-1', 20n],
      ]
    )
    assert.deepEqual(shape(result), ['UNKNOWN_DESTINATION low  recipient'])

    const uneven = await call(NFT, batch([1n, 2n], [10n]))
    assert.deepEqual(uneven.source, {kind: 'unknown'})
    assert.deepEqual(codes(uneven), ['UNKNOWN_CONTRACT_CALL'])
  })
})

describe('WETH', () => {
  test('deposit wraps the ether sent; withdraw unwraps at 18 decimals; only at the WETH of the chain', async () => {
    const wrap = await call(WETH, encode('deposit()'), {}, {value: ETHER})
    assert.equal(wrap.intent.code, 'ethereum.intent.wrap')
    assert.deepEqual(wrap.source, {decoder: 'weth', kind: 'builtin'})
    assert.equal(fieldOf(wrap, 'amount', 'amount').value, ETHER)
    assert.equal(fieldOf(wrap, 'amount', 'amount').symbol, 'ETH')
    assert.deepEqual(codes(wrap), [])

    const unwrap = await call(WETH, encode('withdraw(uint256 amount)', [ETHER]))
    assert.equal(unwrap.intent.code, 'ethereum.intent.unwrap')
    const amount = fieldOf(unwrap, 'amount', 'amount')
    assert.deepEqual([amount.value, amount.decimals, amount.symbol, amount.token], [ETHER, 18, 'WETH', WETH])

    // The same call to another contract is nothing the package knows.
    assert.deepEqual(codes(await call(OTHER, encode('deposit()'), {}, {value: ETHER})), ['UNKNOWN_CONTRACT_CALL'])

    // Base's WETH, on Base.
    const base = await clearSignTransaction(
      chainOf(8453, 'Base'),
      request({data: encode('deposit()'), to: '0x4200000000000000000000000000000000000006', value: 1n}),
      options()
    )
    assert.deepEqual(base.source, {decoder: 'weth', kind: 'builtin'})
  })
})

describe('Permit2 calls', () => {
  const permit2 = (amount: bigint, expiration: bigint, token: string = USDC) =>
    encode('approve(address token,address spender,uint160 amount,uint48 expiration)', [
      token,
      ROUTER,
      amount,
      expiration,
    ])

  test('approve: unlimited from 2^159 (160 bits), finite below, 0 a revoke', async () => {
    const week = inSeconds(7n * DAY)

    for (const [value, unlimited] of [
      [maxUint(160), true],
      [2n ** 159n, true],
      [2n ** 159n - 1n, false],
      [5_000_000n, false],
    ] as const) {
      const result = await call(PERMIT2, permit2(value, week), UNISWAP)
      assert.deepEqual(result.source, {decoder: 'permit2', kind: 'builtin'})
      assert.equal(fieldOf(result, 'amount', 'amount').unlimited, unlimited, String(value))
      assert.deepEqual(shape(result), unlimited ? ['UNLIMITED_APPROVAL critical  amount,spender'] : [], String(value))
    }

    const revoke = await call(PERMIT2, permit2(0n, week))
    assert.equal(revoke.intent.code, 'intent.revoke')
    assert.deepEqual(codes(revoke), [])
  })

  test('expiration: 0 for this transaction only, a week fine, a year LONG_LIVED, never LONG_LIVED, past EXPIRED', async () => {
    const zero = await call(PERMIT2, permit2(5n, 0n), UNISWAP)
    assert.deepEqual(
      [fieldOf(zero, 'expiration', 'duration').value, fieldOf(zero, 'expiration', 'duration').label.code],
      [0, 'label.validFor']
    )
    assert.deepEqual(codes(zero), [])

    const week = await call(PERMIT2, permit2(5n, inSeconds(7n * DAY)), UNISWAP)
    assert.equal(fieldOf(week, 'expiration', 'datetime').expired, false)
    assert.deepEqual(codes(week), [])

    const year = await call(PERMIT2, permit2(5n, inSeconds(365n * DAY)), UNISWAP)
    assert.deepEqual(shape(year), ['LONG_LIVED medium  expiration'])

    const never = await call(PERMIT2, permit2(5n, maxUint(48)), UNISWAP)
    assert.equal(fieldOf(never, 'expiration', 'datetime').never, true)
    assert.deepEqual(shape(never), ['LONG_LIVED medium  expiration'])

    const past = await call(PERMIT2, permit2(5n, NOW_SECONDS - DAY), UNISWAP)
    assert.equal(fieldOf(past, 'expiration', 'datetime').expired, true)
    assert.deepEqual(shape(past), ['EXPIRED low  expiration'])
  })

  test('an unknown token and an unknown spender; the same call to another contract is not Permit2', async () => {
    const result = await call(PERMIT2, permit2(5n, inSeconds(DAY), UNKNOWN_TOKEN))
    assert.deepEqual(shape(result), ['UNKNOWN_TOKEN medium  amount', 'ethereum.UNKNOWN_SPENDER high  spender'])
    assert.deepEqual(codes(await call(OTHER, permit2(5n, inSeconds(DAY)))), ['UNKNOWN_CONTRACT_CALL'])
  })

  test('lockdown: every pair revoked, as lists', async () => {
    const result = await call(
      PERMIT2,
      encode('lockdown((address token,address spender)[] approvals)', [
        [
          {spender: ROUTER, token: USDC},
          {spender: OTHER, token: WETH},
        ],
      ])
    )
    assert.equal(result.intent.code, 'intent.revoke')
    assert.equal(result.summary?.code, 'ethereum.summary.lockdown')
    assert.deepEqual(
      fieldOf(result, 'approval-1', 'list').items.map(item => item.id),
      ['token-1', 'spender-1']
    )
    assert.deepEqual(codes(result), [])
  })
})

describe('batches', () => {
  test('multicall(bytes[]): one action per call, each with its own risk; the root the maximum', async () => {
    const result = await call(
      ROUTER,
      encode('multicall(bytes[] data)', [[unknownData, mainnet.erc20.transferData(SIGNER, 1n), approve(OTHER, 0n)]])
    )
    assert.deepEqual(result.source, {decoder: 'multicall', kind: 'builtin'})
    assert.equal(result.intent.code, 'intent.batch')
    assert.deepEqual(result.summary?.params, {count: 3})
    assert.deepEqual(
      result.actions.map(action => [action.path, action.intent.code, action.risk]),
      [
        [[0], 'intent.contractCall', 'high'],
        [[1], 'intent.send', 'medium'],
        [[2], 'intent.revoke', 'none'],
      ]
    )
    assert.equal(result.risk, 'high')
    assert.deepEqual(shape(result), ['UNKNOWN_CONTRACT_CALL high 0 contract', 'UNKNOWN_TOKEN medium 1 amount'])
    // multicall(bytes[]) calls the contract itself.
    assert.equal(fieldOf(at(result, [1]), 'token', 'address').value, ROUTER)
    assert.deepEqual(
      warningsAt(result, [0]).map(entry => entry.code),
      ['UNKNOWN_CONTRACT_CALL']
    )
  })

  test('the root says what the batch does: the one call, or the call its approvals are for', async () => {
    const one = await call(ROUTER, encode('multicall(bytes[] data)', [[unknownData]]))
    assert.equal(one.intent.code, 'intent.contractCall')

    const swap = await call(ROUTER, encode('multicall(bytes[] data)', [[approve(OTHER, 5n), unknownData]]))
    assert.equal(swap.intent.code, 'intent.contractCall')
    assert.equal(swap.actions.length, 2)

    const empty = await call(ROUTER, encode('multicall(bytes[] data)', [[]]))
    assert.equal(empty.intent.code, 'intent.batch')
    assert.deepEqual(empty.actions, [])
  })

  test('multicall with a deadline: EXPIRED once past, nothing when far or never (a transaction`s deadline)', async () => {
    const withDeadline = (deadline: bigint) =>
      call(ROUTER, encode('multicall(uint256 deadline,bytes[] data)', [deadline, [approve(OTHER, 0n)]]))

    const past = await withDeadline(NOW_SECONDS - 60n)
    assert.equal(fieldOf(past, 'deadline', 'datetime').expired, true)
    assert.deepEqual(shape(past), ['EXPIRED low  deadline'])

    // Near misses: now itself, a minute ahead, a year ahead, never.
    for (const deadline of [NOW_SECONDS, NOW_SECONDS + 60n, inSeconds(365n * DAY), MAX]) {
      const result = await withDeadline(deadline)
      assert.deepEqual(codes(result), [], String(deadline))
    }

    assert.equal(fieldOf(await withDeadline(MAX), 'deadline', 'datetime').never, true)
    assert.equal(fieldOf(await withDeadline(NOW_SECONDS + 60n), 'deadline', 'datetime').value, NOW + 60_000)
  })

  test('multicall with a previous block hash: the hash behind "More details"', async () => {
    const hash = `0x${'ab'.repeat(32)}` as Hex
    const result = await call(
      ROUTER,
      encode('multicall(bytes32 previousBlockhash,bytes[] data)', [hash, [unknownData]])
    )
    const blockhash = fieldOf(result, 'blockhash', 'raw')
    assert.deepEqual([blockhash.value, blockhash.secondary], [hash, true])
    assert.equal(result.actions.length, 1)
  })

  test('every Multicall3 form; calls with values; the calls are Multicall3`s', async () => {
    const target = {callData: mainnet.erc20.transferData(SIGNER, 1n), target: USDC}
    const forms: readonly [string, unknown[]][] = [
      ['aggregate((address target,bytes callData)[] calls)', [[target]]],
      ['tryAggregate(bool requireSuccess,(address target,bytes callData)[] calls)', [true, [target]]],
      ['blockAndAggregate((address target,bytes callData)[] calls)', [[target]]],
      ['tryBlockAndAggregate(bool requireSuccess,(address target,bytes callData)[] calls)', [false, [target]]],
      ['aggregate3((address target,bool allowFailure,bytes callData)[] calls)', [[{...target, allowFailure: true}]]],
      [
        'aggregate3Value((address target,bool allowFailure,uint256 value,bytes callData)[] calls)',
        [[{...target, allowFailure: false, value: 0n}]],
      ],
    ]

    for (const [signature, args] of forms) {
      const result = await call(MULTICALL3, encode(signature, args))
      assert.deepEqual(result.source, {decoder: 'multicall', kind: 'builtin'}, signature)
      assert.deepEqual(
        [fieldOf(result, 'contract', 'address').name, fieldOf(result, 'contract', 'address').relation],
        ['Multicall3', 'contract']
      )
      assert.deepEqual(at(result, [0]).source, {decoder: 'erc20', kind: 'builtin'}, signature)
    }

    const values = await call(
      MULTICALL3,
      encode('aggregate3Value((address target,bool allowFailure,uint256 value,bytes callData)[] calls)', [
        [
          {allowFailure: false, callData: '0x', target: OTHER, value: ETHER},
          {allowFailure: false, callData: mainnet.erc20.transferData(SIGNER, 1n), target: USDC, value: 1n},
        ],
      ]),
      {},
      {value: ETHER + 1n}
    )
    assert.deepEqual(at(values, [0]).source, {decoder: 'native-transfer', kind: 'builtin'})
    assert.equal(fieldOf(at(values, [0]), 'amount', 'amount').value, ETHER)
    assert.equal(fieldOf(at(values, [1]), 'value', 'amount').value, 1n)
    assert.deepEqual(shape(values), ['UNKNOWN_DESTINATION low 0 recipient', 'ethereum.UNEXPECTED_VALUE medium 1 value'])
  })

  test('Safe MultiSend: calls and delegate calls, a delegate call ASSET_OWNERSHIP_TRANSFER; malformed packing raw', async () => {
    const packed = (operation: number, to: Hex, value: bigint, data: Hex) =>
      concat([
        numberToHex(operation, {size: 1}),
        to,
        pad(numberToHex(value), {size: 32}),
        pad(numberToHex((data.length - 2) / 2), {size: 32}),
        data,
      ])
    const transactions = concat([
      packed(0, USDC, 0n, mainnet.erc20.transferData(SIGNER, 1n)),
      packed(1, OTHER, 0n, unknownData),
    ])
    const result = await call(OTHER, encode('multiSend(bytes transactions)', [transactions]))
    assert.deepEqual(result.source, {decoder: 'safe-multisend', kind: 'builtin'})
    assert.deepEqual(
      result.actions.map(action => [action.path, action.risk]),
      [
        [[0], 'none'],
        [[1], 'critical'],
      ]
    )
    assert.deepEqual(shape(result), ['ASSET_OWNERSHIP_TRANSFER critical 1 ', 'UNKNOWN_CONTRACT_CALL high 1 contract'])

    for (const bad of [
      packed(2, USDC, 0n, '0x'),
      packed(0, USDC, 0n, '0x1234').slice(0, -2) as Hex,
      concat([packed(0, USDC, 0n, '0x'), '0x00']),
    ]) {
      const raw = await call(OTHER, encode('multiSend(bytes transactions)', [bad]))
      assert.deepEqual(codes(raw), ['UNKNOWN_CONTRACT_CALL'])
    }
  })

  test('ERC-7821 / ERC-7579 execute: one call, a batch, a delegate call; an unknown mode is not read', async () => {
    const mode = (type: number) => pad(numberToHex(type, {size: 1}), {dir: 'right', size: 32})
    const execute = (type: number, data: Hex) => encode('execute(bytes32 mode,bytes executionData)', [mode(type), data])
    const transfer = mainnet.erc20.transferData(OTHER, 1n)

    const single = await call(SIGNER, execute(0, concat([USDC, pad(numberToHex(0n), {size: 32}), transfer])))
    assert.deepEqual(single.source, {decoder: 'smart-account', kind: 'builtin'})
    assert.equal(single.intent.code, 'intent.send')
    assert.deepEqual(at(single, [0]).source, {decoder: 'erc20', kind: 'builtin'})
    // An account calling its own code (EIP-7702): the contract is the signer.
    assert.equal(fieldOf(single, 'contract', 'address').relation, 'self')

    const calls = encodeAbiParameters(parseAbiParameters('(address target,uint256 value,bytes data)[]'), [
      [
        {data: transfer, target: USDC, value: 0n},
        {data: '0x', target: OTHER, value: ETHER},
      ],
    ])
    const batch = await call(SIGNER, execute(1, calls))
    assert.deepEqual(
      batch.actions.map(action => action.source),
      [
        {decoder: 'erc20', kind: 'builtin'},
        {decoder: 'native-transfer', kind: 'builtin'},
      ]
    )

    const delegate = await call(SIGNER, execute(0xff, concat([OTHER, unknownData])))
    assert.deepEqual(shape(delegate), ['ASSET_OWNERSHIP_TRANSFER critical 0 ', 'UNKNOWN_CONTRACT_CALL high 0 contract'])

    for (const [type, data] of [
      [2, calls],
      [0, '0x1234'],
      [0xff, '0x12'],
    ] as const) {
      assert.deepEqual(codes(await call(SIGNER, execute(type, data))), ['UNKNOWN_CONTRACT_CALL'], `${type} ${data}`)
    }

    const executeBatch = await call(
      OTHER,
      encode('executeBatch((address target,uint256 value,bytes data)[] calls)', [
        [{data: transfer, target: USDC, value: 0n}],
      ])
    )
    assert.deepEqual(executeBatch.source, {decoder: 'smart-account', kind: 'builtin'})
    assert.equal(executeBatch.actions.length, 1)

    const executeOne = await call(
      OTHER,
      encode('execute(address target,uint256 value,bytes data)', [USDC, 0n, transfer])
    )
    assert.deepEqual(executeOne.source, {decoder: 'smart-account', kind: 'builtin'})
    assert.deepEqual(at(executeOne, [0]).source, {decoder: 'erc20', kind: 'builtin'})
  })

  test('calls nest at most 4 deep; deeper ones are raw', async () => {
    let data: Hex = mainnet.erc20.transferData(SIGNER, 1n)

    for (let level = 0; level < MAX_CALL_DEPTH + 1; level++) {
      data = encode('multicall(bytes[] data)', [[data]])
    }

    // Five multicalls: the transaction's at depth 0, the fifth at depth 4, its transfer at depth 5.
    const result = await call(ROUTER, data)
    const deepest = at(result, [0, 0, 0, 0, 0])
    assert.deepEqual(deepest.source, {kind: 'unknown'})
    assert.deepEqual(at(result, [0, 0, 0, 0]).source, {decoder: 'multicall', kind: 'builtin'})
    assert.deepEqual(shape(result), ['UNKNOWN_CONTRACT_CALL high 0.0.0.0.0 contract'])

    // One level less, the transfer is read.
    const readable = await call(
      ROUTER,
      encode('multicall(bytes[] data)', [
        [
          encode('multicall(bytes[] data)', [
            [
              encode('multicall(bytes[] data)', [
                [encode('multicall(bytes[] data)', [[mainnet.erc20.transferData(SIGNER, 1n)]])],
              ]),
            ],
          ]),
        ],
      ])
    )
    assert.deepEqual(at(readable, [0, 0, 0, 0]).source, {decoder: 'erc20', kind: 'builtin'})
  })
})

describe('ownership and upgrades', () => {
  test('transferOwnership, renounceOwnership, changeAdmin: ASSET_OWNERSHIP_TRANSFER', async () => {
    const transfer = await call(OTHER, encode('transferOwnership(address newOwner)', [ROUTER]))
    assert.deepEqual(transfer.source, {decoder: 'ownable', kind: 'builtin'})
    assert.equal(transfer.intent.code, 'intent.transferOwnership')
    assert.deepEqual(shape(transfer), ['ASSET_OWNERSHIP_TRANSFER critical  newOwner,contract'])

    const renounce = await call(OTHER, encode('renounceOwnership()'))
    assert.equal(renounce.intent.code, 'ethereum.intent.renounceOwnership')
    assert.deepEqual(shape(renounce), ['ASSET_OWNERSHIP_TRANSFER critical  contract'])

    const admin = await call(OTHER, encode('changeAdmin(address newAdmin)', [ROUTER]))
    assert.deepEqual(admin.source, {decoder: 'proxy', kind: 'builtin'})
    assert.equal(admin.intent.code, 'intent.transferOwnership')
    assert.equal(fieldOf(admin, 'newOwner', 'address').value, ROUTER)
  })

  test('upgradeTo and upgradeToAndCall: the new code, and the call it runs as an action', async () => {
    const upgrade = await call(OTHER, encode('upgradeTo(address newImplementation)', [ROUTER]))
    assert.deepEqual(upgrade.source, {decoder: 'proxy', kind: 'builtin'})
    assert.equal(upgrade.intent.code, 'ethereum.intent.upgrade')
    assert.deepEqual(shape(upgrade), ['ASSET_OWNERSHIP_TRANSFER critical  implementation,contract'])
    assert.deepEqual(upgrade.actions, [])

    const andCall = await call(
      OTHER,
      encode('upgradeToAndCall(address newImplementation,bytes data)', [
        ROUTER,
        encode('initialize(address owner)', [OTHER]),
      ])
    )
    assert.deepEqual(
      andCall.actions.map(action => [action.path, action.source.kind]),
      [[[0], 'unknown']]
    )
    assert.deepEqual(shape(andCall), [
      'ASSET_OWNERSHIP_TRANSFER critical  implementation,contract',
      'UNKNOWN_CONTRACT_CALL high 0 contract',
    ])

    // upgradeToAndCall may take ether; upgradeTo may not.
    assert.ok(
      !codes(
        await call(
          OTHER,
          encode('upgradeToAndCall(address newImplementation,bytes data)', [ROUTER, '0x']),
          {},
          {value: 1n}
        )
      ).includes('ethereum.UNEXPECTED_VALUE')
    )
    assert.ok(
      codes(await call(OTHER, encode('upgradeTo(address newImplementation)', [ROUTER]), {}, {value: 1n})).includes(
        'ethereum.UNEXPECTED_VALUE'
      )
    )
  })
})

describe('a real-world call through the bundled descriptors', () => {
  // Uniswap's SwapRouter02 exactInputSingle on mainnet, 0xb25281abb3e6bbfe18c746187522c2e915aa02fdb8175082005340e00c1f0b30, unsigned:
  // 0.006471375668623977 WETH for at least 13.901216 USDT at the 0.3% pool.
  const SWAP =
    '0x02f9010c010d83989680843b9aca008304e2009468b3465833fb72a70ecdf485e0e4c7bd8665fc4580b8e404e45aaf000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec70000000000000000000000000000000000000000000000000000000000000bb8000000000000000000000000eced4025456b6c2987fac2e4c829889e681986a70000000000000000000000000000000000000000000000000016fdae8fefba690000000000000000000000000000000000000000000000000000000000d41da00000000000000000000000000000000000000000000000000000000000000000c0'
  const SENDER = '0xEceD4025456B6c2987faC2e4c829889e681986a7'
  const descriptors = registryResolver()

  test('Uniswap exactInputSingle: amounts in WETH and USDT, the fee as a percentage, the signer as beneficiary', async () => {
    const result = await clearSignTransaction(mainnet, SWAP, options({resolvers: {descriptors}, signer: SENDER}))
    assert.deepEqual(result.source, {
      format: 'erc7730',
      id: 'registry/uniswap/calldata-UniswapV3Router02.json',
      kind: 'descriptor',
      publisher: 'ERC-7730 registry',
    })
    assert.deepEqual([result.intent.code, result.intent.text], ['external', 'swap'])
    const sent = fieldOf(result, 'data.params.amountIn', 'amount')
    assert.deepEqual([sent.value, sent.decimals, sent.symbol], [6_471_375_668_623_977n, 18, 'WETH'])
    const received = fieldOf(result, 'data.params.amountOutMinimum', 'amount')
    assert.deepEqual([received.value, received.decimals, received.symbol], [13_901_216n, 6, 'USDT'])
    assert.equal(fieldOf(result, 'data.params.fee', 'percent').value, 0.3)
    assert.equal(fieldOf(result, 'data.params.recipient', 'address').relation, 'self')
    assert.deepEqual(
      [fieldOf(result, 'contract', 'address').name, fieldOf(result, 'contract', 'address').relation],
      ['Uniswap v3 Router 2', 'contract']
    )
    assert.deepEqual(codes(result), [])

    // As Uniswap's interface sends it: inside a multicall with a deadline, the swap an action of its own.
    const inner = `0x${SWAP.slice(SWAP.indexOf('04e45aaf'), -2)}` as Hex
    const wrapped = await call(
      ROUTER,
      encode('multicall(uint256 deadline,bytes[] data)', [inSeconds(1800n), [inner]]),
      {resolvers: {descriptors}, signer: SENDER}
    )
    assert.deepEqual(wrapped.source, {decoder: 'multicall', kind: 'builtin'})
    assert.equal(wrapped.intent.text, 'swap')
    assert.equal(at(wrapped, [0]).source.kind, 'descriptor')
    assert.equal(fieldOf(at(wrapped, [0]), 'data.params.amountIn', 'amount').symbol, 'WETH')
    assert.deepEqual(codes(wrapped), [])

    // Without the descriptors, the same bytes are an unknown call.
    assert.deepEqual(codes(await clearSignTransaction(mainnet, SWAP, options())), ['UNKNOWN_CONTRACT_CALL'])
  })
})

import assert from 'node:assert/strict'
import {describe, test} from 'node:test'

import {maxUint, plainText} from '@hzblj/crypto-clear-sign'
import type {TypedDataDefinition} from '@hzblj/crypto-ethereum'
import {hashTypedData as viemHash} from 'viem'

import {clearSignTypedData, type EthereumClearSignOptions, PERMIT2} from '../src'
import {
  codes,
  DAI,
  DAY,
  fieldOf,
  inSeconds,
  mainnet,
  NOW_SECONDS,
  OTHER,
  only,
  options,
  rejects,
  SIGNER,
  shape,
  UNISWAP_ROUTER,
  UNKNOWN_TOKEN,
  USDC,
  WETH,
} from './helpers'

const MAX = maxUint(256)
const ROUTER = UNISWAP_ROUTER
const UNISWAP: EthereumClearSignOptions = {
  resolvers: {
    names: {
      name: ({address}) =>
        address.toLowerCase() === ROUTER.toLowerCase() ? {name: 'Uniswap', relation: 'contract'} : undefined,
    },
  },
}
const read = (typed: TypedDataDefinition, extra: EthereumClearSignOptions = {}) =>
  clearSignTypedData(mainnet, typed, options(extra))

const PERMIT_TYPES = {
  Permit: [
    {name: 'owner', type: 'address'},
    {name: 'spender', type: 'address'},
    {name: 'value', type: 'uint256'},
    {name: 'nonce', type: 'uint256'},
    {name: 'deadline', type: 'uint256'},
  ],
}

const usdcPermit = (value: bigint, deadline: bigint, domain: Partial<TypedDataDefinition['domain'] & object> = {}) =>
  ({
    domain: {chainId: 1, name: 'USD Coin', verifyingContract: USDC, version: '2', ...domain},
    message: {deadline, nonce: 3n, owner: SIGNER, spender: ROUTER, value},
    primaryType: 'Permit',
    types: PERMIT_TYPES,
  }) as TypedDataDefinition

const daiPermit = (allowed: boolean, expiry: bigint): TypedDataDefinition => ({
  domain: {chainId: 1, name: 'Dai Stablecoin', verifyingContract: DAI, version: '1'},
  message: {allowed, expiry, holder: SIGNER, nonce: 0n, spender: ROUTER},
  primaryType: 'Permit',
  types: {
    Permit: [
      {name: 'holder', type: 'address'},
      {name: 'spender', type: 'address'},
      {name: 'nonce', type: 'uint256'},
      {name: 'expiry', type: 'uint256'},
      {name: 'allowed', type: 'bool'},
    ],
  },
})

const PERMIT2_DOMAIN = {chainId: 1, name: 'Permit2', verifyingContract: PERMIT2}
const PERMIT_DETAILS = [
  {name: 'token', type: 'address'},
  {name: 'amount', type: 'uint160'},
  {name: 'expiration', type: 'uint48'},
  {name: 'nonce', type: 'uint48'},
]
const TOKEN_PERMISSIONS = [
  {name: 'token', type: 'address'},
  {name: 'amount', type: 'uint256'},
]

const permitSingle = (amount: bigint, expiration: bigint, sigDeadline = inSeconds(1800n), domain = PERMIT2_DOMAIN) =>
  ({
    domain,
    message: {details: {amount, expiration, nonce: 0n, token: USDC}, sigDeadline, spender: ROUTER},
    primaryType: 'PermitSingle',
    types: {
      PermitDetails: PERMIT_DETAILS,
      PermitSingle: [
        {name: 'details', type: 'PermitDetails'},
        {name: 'spender', type: 'address'},
        {name: 'sigDeadline', type: 'uint256'},
      ],
    },
  }) as TypedDataDefinition

describe('EIP-2612 and DAI permits', () => {
  test('a USDC permit: the verifying contract is the token; unlimited at max; the domain as fields', async () => {
    const result = await read(usdcPermit(MAX, inSeconds(7n * DAY)))
    assert.equal(result.kind, 'typed-data')
    assert.deepEqual(result.source, {decoder: 'eip2612', kind: 'builtin'})
    assert.equal(result.intent.code, 'intent.approve')
    assert.equal(result.summary?.code, 'summary.approveUnlimited')
    assert.deepEqual(
      result.fields.map(field => field.id),
      ['owner', 'spender', 'amount', 'deadline', 'nonce', 'domain', 'contract', 'version']
    )
    const amount = fieldOf(result, 'amount', 'amount')
    assert.deepEqual([amount.symbol, amount.token, amount.unlimited], ['USDC', USDC, true])
    assert.equal(fieldOf(result, 'owner', 'address').relation, 'self')
    assert.equal(fieldOf(result, 'domain', 'text').value, 'USD Coin')
    assert.equal(fieldOf(result, 'version', 'text').secondary, true)
    assert.deepEqual(shape(result), [
      'UNLIMITED_APPROVAL critical  amount,spender',
      'ethereum.UNKNOWN_SPENDER high  spender',
    ])
  })

  test('the permit`s deadline: a week fine, a year or never LONG_LIVED, past EXPIRED; finite amounts; 0 a revoke', async () => {
    assert.deepEqual(codes(await read(usdcPermit(5_000_000n, inSeconds(7n * DAY)), UNISWAP)), [])
    assert.deepEqual(shape(await read(usdcPermit(5_000_000n, inSeconds(365n * DAY)), UNISWAP)), [
      'LONG_LIVED medium  deadline',
    ])
    const never = await read(usdcPermit(5_000_000n, MAX), UNISWAP)
    assert.equal(fieldOf(never, 'deadline', 'datetime').never, true)
    assert.deepEqual(shape(never), ['LONG_LIVED medium  deadline'])
    assert.deepEqual(shape(await read(usdcPermit(5_000_000n, NOW_SECONDS - 1n), UNISWAP)), ['EXPIRED low  deadline'])

    const revoke = await read(usdcPermit(0n, inSeconds(DAY)))
    assert.equal(revoke.intent.code, 'intent.revoke')
    assert.deepEqual(codes(revoke), [])
  })

  test('a permit on a token the list does not know: UNKNOWN_TOKEN', async () => {
    const result = await read(
      usdcPermit(5n, inSeconds(DAY), {name: 'Token', verifyingContract: UNKNOWN_TOKEN}),
      UNISWAP
    )
    assert.deepEqual(shape(result), ['UNKNOWN_TOKEN medium  amount'])
  })

  test('the DAI permit: all or nothing, an expiry of 0 never ends', async () => {
    const all = await read(daiPermit(true, 0n))
    assert.deepEqual(all.source, {decoder: 'dai-permit', kind: 'builtin'})
    const deadline = fieldOf(all, 'deadline', 'datetime')
    assert.deepEqual([deadline.never, deadline.label.code], [true, 'label.expiry'])
    assert.equal(fieldOf(all, 'amount', 'amount').unlimited, true)
    assert.equal(fieldOf(all, 'owner', 'address').relation, 'self')
    assert.deepEqual(shape(all), [
      'LONG_LIVED medium  deadline',
      'UNLIMITED_APPROVAL critical  amount,spender',
      'ethereum.UNKNOWN_SPENDER high  spender',
    ])

    // Near miss: an expiry in a week.
    assert.deepEqual(shape(await read(daiPermit(true, inSeconds(7n * DAY)), UNISWAP)), [
      'UNLIMITED_APPROVAL critical  amount,spender',
    ])

    const revoke = await read(daiPermit(false, 0n))
    assert.equal(revoke.intent.code, 'intent.revoke')
    assert.deepEqual(codes(revoke), [])
  })
})

describe('Permit2 signatures', () => {
  test('PermitSingle: 160-bit amounts, its expiration and its signature deadline', async () => {
    const result = await read(permitSingle(maxUint(160), inSeconds(7n * DAY)))
    assert.deepEqual(result.source, {decoder: 'permit2', kind: 'builtin'})
    assert.deepEqual(
      result.fields.map(field => field.id),
      ['spender', 'token', 'amount', 'expiration', 'sigDeadline', 'domain', 'contract']
    )
    assert.equal(fieldOf(result, 'contract', 'address').name, 'Permit2')
    assert.deepEqual(shape(result), [
      'UNLIMITED_APPROVAL critical  amount,spender',
      'ethereum.UNKNOWN_SPENDER high  spender',
    ])

    // 2^159 - 1 is finite; an expiration of 0 lasts for the transaction; a year is LONG_LIVED; a past one EXPIRED.
    assert.deepEqual(codes(await read(permitSingle(2n ** 159n - 1n, inSeconds(DAY)), UNISWAP)), [])
    const zero = await read(permitSingle(5n, 0n), UNISWAP)
    assert.deepEqual([fieldOf(zero, 'expiration', 'duration').value, codes(zero)], [0, []])
    assert.deepEqual(shape(await read(permitSingle(5n, inSeconds(365n * DAY)), UNISWAP)), [
      'LONG_LIVED medium  expiration',
    ])
    assert.deepEqual(shape(await read(permitSingle(5n, NOW_SECONDS - DAY), UNISWAP)), ['EXPIRED low  expiration'])
    assert.deepEqual(shape(await read(permitSingle(5n, inSeconds(DAY), NOW_SECONDS - 1n), UNISWAP)), [
      'EXPIRED low  sigDeadline',
    ])
  })

  test('PermitBatch: a list per token, unlimited by item', async () => {
    const result = await read(
      {
        domain: PERMIT2_DOMAIN,
        message: {
          details: [
            {amount: 5_000_000n, expiration: inSeconds(DAY), nonce: 0n, token: USDC},
            {amount: maxUint(160), expiration: inSeconds(DAY), nonce: 0n, token: WETH},
          ],
          sigDeadline: inSeconds(1800n),
          spender: ROUTER,
        },
        primaryType: 'PermitBatch',
        types: {
          PermitBatch: [
            {name: 'details', type: 'PermitDetails[]'},
            {name: 'spender', type: 'address'},
            {name: 'sigDeadline', type: 'uint256'},
          ],
          PermitDetails: PERMIT_DETAILS,
        },
      },
      UNISWAP
    )
    assert.equal(result.summary?.code, 'ethereum.summary.permitBatch')
    assert.deepEqual(
      fieldOf(result, 'permit-1', 'list').items.map(item => item.id),
      ['token-1', 'amount-1', 'expiration-1']
    )
    assert.deepEqual(shape(result), ['UNLIMITED_APPROVAL critical  amount-1,spender'])
  })

  test('PermitTransferFrom and PermitBatchTransferFrom: one transfer each, unlimited from 2^255', async () => {
    const single = (amount: bigint) =>
      ({
        domain: PERMIT2_DOMAIN,
        message: {deadline: inSeconds(1800n), nonce: 9n, permitted: {amount, token: USDC}, spender: ROUTER},
        primaryType: 'PermitTransferFrom',
        types: {
          PermitTransferFrom: [
            {name: 'permitted', type: 'TokenPermissions'},
            {name: 'spender', type: 'address'},
            {name: 'nonce', type: 'uint256'},
            {name: 'deadline', type: 'uint256'},
          ],
          TokenPermissions: TOKEN_PERMISSIONS,
        },
      }) as TypedDataDefinition

    const result = await read(single(5_000_000n), UNISWAP)
    assert.equal(result.summary?.code, 'ethereum.summary.permitTransfer')
    assert.deepEqual(
      result.fields.map(field => field.id),
      ['spender', 'amount', 'deadline', 'nonce', 'domain', 'contract']
    )
    assert.deepEqual(codes(result), [])
    assert.deepEqual(shape(await read(single(2n ** 255n), UNISWAP)), ['UNLIMITED_APPROVAL critical  amount,spender'])

    const batch = await read(
      {
        domain: PERMIT2_DOMAIN,
        message: {
          deadline: inSeconds(1800n),
          nonce: 9n,
          permitted: [
            {amount: 1n, token: USDC},
            {amount: 2n, token: UNKNOWN_TOKEN},
          ],
          spender: ROUTER,
        },
        primaryType: 'PermitBatchTransferFrom',
        types: {
          PermitBatchTransferFrom: [
            {name: 'permitted', type: 'TokenPermissions[]'},
            {name: 'spender', type: 'address'},
            {name: 'nonce', type: 'uint256'},
            {name: 'deadline', type: 'uint256'},
          ],
          TokenPermissions: TOKEN_PERMISSIONS,
        },
      },
      UNISWAP
    )
    assert.deepEqual(
      fieldOf(batch, 'permit-1', 'list').items.map(item => item.id),
      ['token-1', 'amount-1']
    )
    assert.deepEqual(shape(batch), ['UNKNOWN_TOKEN medium  amount-1'])
  })

  test('PermitWitnessTransferFrom with a UniswapX order as its witness: every member shown', async () => {
    const order: TypedDataDefinition = {
      domain: PERMIT2_DOMAIN,
      message: {
        deadline: inSeconds(600n),
        nonce: 1993349n,
        permitted: {amount: 1_000_000_000n, token: USDC},
        spender: '0x00000011F84B9aa48e5f8aA8B9897600006289Be',
        witness: {
          decayEndTime: inSeconds(120n),
          decayStartTime: inSeconds(60n),
          exclusiveFiller: OTHER,
          exclusivityOverrideBps: 100n,
          info: {
            additionalValidationContract: '0x0000000000000000000000000000000000000000',
            additionalValidationData: '0x',
            deadline: inSeconds(600n),
            nonce: 1993349n,
            reactor: '0x00000011F84B9aa48e5f8aA8B9897600006289Be',
            swapper: SIGNER,
          },
          inputEndAmount: 1_000_000_000n,
          inputStartAmount: 1_000_000_000n,
          inputToken: USDC,
          outputs: [{endAmount: 10n ** 17n, recipient: SIGNER, startAmount: 2n * 10n ** 17n, token: WETH}],
        },
      },
      primaryType: 'PermitWitnessTransferFrom',
      types: {
        DutchOutput: [
          {name: 'token', type: 'address'},
          {name: 'startAmount', type: 'uint256'},
          {name: 'endAmount', type: 'uint256'},
          {name: 'recipient', type: 'address'},
        ],
        ExclusiveDutchOrder: [
          {name: 'info', type: 'OrderInfo'},
          {name: 'decayStartTime', type: 'uint256'},
          {name: 'decayEndTime', type: 'uint256'},
          {name: 'exclusiveFiller', type: 'address'},
          {name: 'exclusivityOverrideBps', type: 'uint256'},
          {name: 'inputToken', type: 'address'},
          {name: 'inputStartAmount', type: 'uint256'},
          {name: 'inputEndAmount', type: 'uint256'},
          {name: 'outputs', type: 'DutchOutput[]'},
        ],
        OrderInfo: [
          {name: 'reactor', type: 'address'},
          {name: 'swapper', type: 'address'},
          {name: 'nonce', type: 'uint256'},
          {name: 'deadline', type: 'uint256'},
          {name: 'additionalValidationContract', type: 'address'},
          {name: 'additionalValidationData', type: 'bytes'},
        ],
        PermitWitnessTransferFrom: [
          {name: 'permitted', type: 'TokenPermissions'},
          {name: 'spender', type: 'address'},
          {name: 'nonce', type: 'uint256'},
          {name: 'deadline', type: 'uint256'},
          {name: 'witness', type: 'ExclusiveDutchOrder'},
        ],
        TokenPermissions: TOKEN_PERMISSIONS,
      },
    }
    const result = await read(order, {
      resolvers: {
        names: {
          name: ({address}) =>
            address.toLowerCase() === '0x00000011f84b9aa48e5f8aa8b9897600006289be'
              ? {name: 'UniswapX', relation: 'contract'}
              : undefined,
        },
      },
    })
    assert.deepEqual(result.source, {decoder: 'permit2', kind: 'builtin'})
    assert.equal(result.summary?.code, 'ethereum.summary.permitTransfer')
    const witness = fieldOf(result, 'witness', 'list')
    assert.deepEqual(
      witness.items.map(item => item.id),
      [
        'witness.info',
        'witness.decayStartTime',
        'witness.decayEndTime',
        'witness.exclusiveFiller',
        'witness.exclusivityOverrideBps',
        'witness.inputToken',
        'witness.inputStartAmount',
        'witness.inputEndAmount',
        'witness.outputs',
      ]
    )
    assert.equal(fieldOf(result, 'witness.info.swapper', 'address').relation, 'self')
    assert.equal(fieldOf(result, 'witness.outputs.0.recipient', 'address').relation, 'self')
    assert.deepEqual(codes(result), [])

    // The batch witness form reads the same way; a witness that is not the fifth member is not Permit2's.
    const batch = await read({
      ...order,
      message: {...order.message, permitted: [{amount: 1n, token: USDC}]},
      primaryType: 'PermitBatchWitnessTransferFrom',
      types: {
        ...order.types,
        PermitBatchWitnessTransferFrom: [
          {name: 'permitted', type: 'TokenPermissions[]'},
          {name: 'spender', type: 'address'},
          {name: 'nonce', type: 'uint256'},
          {name: 'deadline', type: 'uint256'},
          {name: 'witness', type: 'ExclusiveDutchOrder'},
        ],
      },
    })
    assert.deepEqual(batch.source, {decoder: 'permit2', kind: 'builtin'})
    assert.equal(fieldOf(batch, 'permit-0', 'list').items.length, 2)

    const renamed = await read({
      ...order,
      message: {...order.message, order: order.message.witness},
      types: {
        ...order.types,
        PermitWitnessTransferFrom: [
          ...(order.types.PermitWitnessTransferFrom ?? []).slice(0, 4),
          {name: 'order', type: 'ExclusiveDutchOrder'},
        ],
      },
    } as TypedDataDefinition)
    assert.deepEqual(renamed.source, {kind: 'unknown'})
    assert.ok(codes(renamed).includes('BLIND_SIGNING'))
  })

  test("Permit2's types on another contract are not Permit2's: shown as they are, BLIND_SIGNING", async () => {
    const elsewhere = await read(
      permitSingle(maxUint(160), inSeconds(DAY), inSeconds(1800n), {...PERMIT2_DOMAIN, verifyingContract: OTHER})
    )
    assert.deepEqual(elsewhere.source, {kind: 'unknown'})
    assert.equal(elsewhere.intent.code, 'ethereum.intent.signTypedData')
    assert.deepEqual(shape(elsewhere), ['BLIND_SIGNING high  '])
    assert.equal(fieldOf(elsewhere, 'message.details.amount', 'number').value, maxUint(160))
  })
})

describe('typed data nothing reads', () => {
  test('a Seaport order: every member it declares, with BLIND_SIGNING', async () => {
    const seaport: TypedDataDefinition = {
      domain: {
        chainId: 1,
        name: 'Seaport',
        verifyingContract: '0x0000000000000068F116a894984e2DB1123eB395',
        version: '1.6',
      },
      message: {
        conduitKey: `0x${'00'.repeat(32)}`,
        consideration: [
          {
            endAmount: 975n * 10n ** 15n,
            identifierOrCriteria: 0n,
            itemType: 0,
            recipient: SIGNER,
            startAmount: 975n * 10n ** 15n,
            token: '0x0000000000000000000000000000000000000000',
          },
        ],
        counter: 0n,
        endTime: inSeconds(30n * DAY),
        offer: [
          {
            endAmount: 1n,
            identifierOrCriteria: 1234n,
            itemType: 2,
            startAmount: 1n,
            token: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D',
          },
        ],
        offerer: SIGNER,
        orderType: 0,
        salt: 1n,
        startTime: NOW_SECONDS,
        totalOriginalConsiderationItems: 1n,
        zone: '0x0000000000000000000000000000000000000000',
        zoneHash: `0x${'00'.repeat(32)}`,
      },
      primaryType: 'OrderComponents',
      types: {
        ConsiderationItem: [
          {name: 'itemType', type: 'uint8'},
          {name: 'token', type: 'address'},
          {name: 'identifierOrCriteria', type: 'uint256'},
          {name: 'startAmount', type: 'uint256'},
          {name: 'endAmount', type: 'uint256'},
          {name: 'recipient', type: 'address'},
        ],
        OfferItem: [
          {name: 'itemType', type: 'uint8'},
          {name: 'token', type: 'address'},
          {name: 'identifierOrCriteria', type: 'uint256'},
          {name: 'startAmount', type: 'uint256'},
          {name: 'endAmount', type: 'uint256'},
        ],
        OrderComponents: [
          {name: 'offerer', type: 'address'},
          {name: 'zone', type: 'address'},
          {name: 'offer', type: 'OfferItem[]'},
          {name: 'consideration', type: 'ConsiderationItem[]'},
          {name: 'orderType', type: 'uint8'},
          {name: 'startTime', type: 'uint256'},
          {name: 'endTime', type: 'uint256'},
          {name: 'zoneHash', type: 'bytes32'},
          {name: 'salt', type: 'uint256'},
          {name: 'conduitKey', type: 'bytes32'},
          {name: 'counter', type: 'uint256'},
        ],
      },
    }
    const result = await read(seaport)
    assert.deepEqual(result.source, {kind: 'unknown'})
    assert.equal(result.intent.code, 'ethereum.intent.signTypedData')
    assert.deepEqual(result.summary?.params, {domain: 'Seaport', primaryType: 'OrderComponents'})
    assert.deepEqual(result.fields.map(field => field.id).slice(0, 11), [
      'message.offerer',
      'message.zone',
      'message.offer',
      'message.consideration',
      'message.orderType',
      'message.startTime',
      'message.endTime',
      'message.zoneHash',
      'message.salt',
      'message.conduitKey',
      'message.counter',
    ])
    assert.equal(fieldOf(result, 'message.offerer', 'address').relation, 'self')
    assert.equal(fieldOf(result, 'message.offer.0.identifierOrCriteria', 'number').value, 1234n)
    assert.equal(fieldOf(result, 'message.zoneHash', 'raw').value, `0x${'00'.repeat(32)}`)
    assert.deepEqual(shape(result), ['BLIND_SIGNING high  '])
    // The digest the adapter checked is the one viem computes: what is described is what is signed.
    assert.deepEqual(
      `0x${Buffer.from(mainnet.hashTypedData(seaport)).toString('hex')}`,
      viemHash(seaport as Parameters<typeof viemHash>[0])
    )
  })

  test('the domain alone (primary type EIP712Domain): BLIND_SIGNING', async () => {
    const result = await read({
      domain: {chainId: 1, name: 'Example', verifyingContract: OTHER},
      message: {},
      primaryType: 'EIP712Domain',
      types: {},
    } as unknown as TypedDataDefinition)
    assert.deepEqual(codes(result), ['BLIND_SIGNING'])
  })
})

describe('the domain', () => {
  test('without a chain id: ALL_CHAINS (high), even on a permit read in full', async () => {
    const result = await read(usdcPermit(5n, inSeconds(DAY), {chainId: undefined}), UNISWAP)
    assert.deepEqual(result.source, {decoder: 'eip2612', kind: 'builtin'})
    assert.deepEqual(shape(result), ['ALL_CHAINS high  '])

    // Near miss: this chain's id.
    assert.deepEqual(codes(await read(usdcPermit(5n, inSeconds(DAY)), UNISWAP)), [])
  })

  test('another chain`s id: CHAIN_MISMATCH; types the adapter refuses: INVALID_INPUT', async () => {
    await rejects(() => read(usdcPermit(5n, inSeconds(DAY), {chainId: 10})), 'CHAIN_MISMATCH')

    const permit = usdcPermit(5n, inSeconds(DAY))
    const refused: readonly TypedDataDefinition[] = [
      {...permit, primaryType: 'Missing'},
      {...permit, types: {Permit: [...PERMIT_TYPES.Permit, {name: 'extra', type: 'Undefined'}]}},
      {...permit, message: {...permit.message, spender: '0x68B3465833fb72A70ecDF485E0e4C7bD8665Fc45'}},
      {...permit, message: {...permit.message, value: -1n}},
      {...permit, types: {Permit: [{name: 'owner', type: 'uint7'}]}},
    ]

    for (const entry of refused) {
      await rejects(() => read(entry), 'INVALID_INPUT')
    }
  })

  test('hidden characters in the domain`s name or version, and in the strings of a message', async () => {
    const name = await read(usdcPermit(5n, inSeconds(DAY), {name: 'USD Coin‮'}), UNISWAP)
    assert.deepEqual(shape(name), ['HIDDEN_CHARACTERS medium  domain'])
    const version = await read(usdcPermit(5n, inSeconds(DAY), {version: '2​'}), UNISWAP)
    assert.deepEqual(shape(version), ['HIDDEN_CHARACTERS medium  version'])

    const mail = await read({
      domain: {chainId: 1, name: 'Ether Mail', verifyingContract: OTHER, version: '1'},
      message: {contents: 'Hello⁦, Bob', from: {name: 'Cow', wallet: SIGNER}},
      primaryType: 'Mail',
      types: {
        Mail: [
          {name: 'from', type: 'Person'},
          {name: 'contents', type: 'string'},
        ],
        Person: [
          {name: 'name', type: 'string'},
          {name: 'wallet', type: 'address'},
        ],
      },
    })
    assert.deepEqual(shape(mail), ['BLIND_SIGNING high  ', 'HIDDEN_CHARACTERS medium  message.contents'])
    assert.equal(only(mail, 'HIDDEN_CHARACTERS').severity, 'medium')
  })
})

describe('clearSignTypedData: plainText', () => {
  test('a USDC permit to a known spender reads as a person would say it', async () => {
    const result = await read(usdcPermit(5_000_000n, inSeconds(7n * DAY)), UNISWAP)
    assert.equal(
      plainText(result),
      [
        'Approve: Allow Uniswap to spend 5 USDC',
        'Typed data on Ethereum. Risk: none.',
        'Owner: 0x1111111111111111111111111111111111111111, this account',
        'Spender: Uniswap (0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45), known contract',
        'Amount: 5 USDC',
        'Deadline: 2026-11-03T12:00:00Z',
        'Nonce: 3',
        'Domain: USD Coin',
        'Contract: USD Coin (0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48), token',
        'Version: 2',
        'Understood by: built-in decoder (eip2612)',
      ].join('\n')
    )
  })
})

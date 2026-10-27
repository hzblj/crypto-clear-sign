import assert from 'node:assert/strict'
import {describe, test} from 'node:test'

import {type ClearSigning, findField, formatField} from '@hzblj/crypto-clear-sign'
import type {Hex, TypedDataDefinition} from '@hzblj/crypto-ethereum'
import {concat, pad} from 'viem'

import {
  clearSignTypedData,
  createDescriptorResolver,
  type Erc7730Descriptor,
  type EthereumClearSignOptions,
  type EthereumDescriptorQuery,
  PERMIT2,
} from '../src'
import {registryResolver} from '../src/registry'
import {
  at,
  call,
  codes,
  DAY,
  encode,
  field,
  fieldOf,
  inSeconds,
  mainnet,
  NFT,
  NOW,
  NOW_SECONDS,
  OTHER,
  options,
  SIGNER,
  shape,
  UNISWAP_ROUTER,
  UNKNOWN_TOKEN,
  USDC,
  WETH,
} from './helpers'

const VAULT = '0x7777777777777777777777777777777777777777'
const MAX = 2n ** 256n - 1n

/** A descriptor for VAULT on mainnet with `formats`, metadata merged. */
const vault = (
  formats: Record<string, unknown>,
  metadata: Record<string, unknown> = {},
  display: Record<string, unknown> = {}
): Erc7730Descriptor => ({
  context: {contract: {deployments: [{address: VAULT, chainId: 1}]}},
  display: {formats, ...display},
  metadata: {owner: 'Vault', ...metadata},
})

/** One format of one function, its fields as given. */
const one = (signature: string, fields: unknown[], extra: Record<string, unknown> = {}) =>
  vault({[signature]: {fields, intent: 'Act', ...extra}})

/** A call to VAULT, read with `descriptor` (and `extra`'s resolvers beside it). */
const read = (
  descriptor: Erc7730Descriptor,
  data: Hex,
  extra: EthereumClearSignOptions = {},
  value = 0n
): Promise<ClearSigning> =>
  call(
    VAULT,
    data,
    {
      ...extra,
      resolvers: {descriptors: createDescriptorResolver([{descriptor, path: 'app/vault.json'}]), ...extra.resolvers},
    },
    {value}
  )

/** A descriptor resolver that answers `descriptor` whatever it is asked: the package must check the binding. */
const always = (descriptor: unknown) => ({
  descriptor: (_query: EthereumDescriptorQuery) => ({content: descriptor as Erc7730Descriptor, id: 'app/always.json'}),
})

const described = (result: ClearSigning) => {
  assert.equal(result.source.kind, 'descriptor', `read by the descriptor: ${codes(result).join(', ')}`)

  return result
}

describe('ERC-7730 field formats', () => {
  const SIGNATURE =
    'act(address token,uint256 amount,address recipient,uint256 deadline,uint256 period,uint256 fee,uint8 kind,uint256 chain,uint256 nftId,bytes interop,uint256 blocks,bytes data)'
  const interop = concat(['0x0001', '0x0000', '0x01', '0x01', '0x14', OTHER])
  const args = [USDC, 1_500_000n, OTHER, NOW_SECONDS - DAY, 7n * DAY, 30n, 2, 8453n, 42n, interop, 100n, '0xbeef']
  const descriptor = one(
    SIGNATURE,
    [
      {format: 'tokenTicker', label: 'Token', path: 'token'},
      {format: 'tokenAmount', label: 'Amount', params: {tokenPath: 'token'}, path: 'amount'},
      {format: 'addressName', label: 'To', path: 'recipient'},
      {format: 'date', label: 'Started', params: {encoding: 'timestamp'}, path: 'deadline'},
      {format: 'duration', label: 'Lock', path: 'period'},
      {format: 'unit', label: 'Fee', params: {base: '%', decimals: 2}, path: 'fee'},
      {format: 'enum', label: 'Kind', params: {$ref: '$.metadata.enums.kind'}, path: 'kind'},
      {format: 'chainId', label: 'Chain', path: 'chain'},
      {format: 'nftName', label: 'NFT', params: {collection: NFT}, path: 'nftId'},
      {format: 'interoperableAddressName', label: 'Destination', path: 'interop'},
      {format: 'date', label: 'Wait', params: {encoding: 'blockheight'}, path: 'blocks'},
      {format: 'raw', label: 'Data', path: 'data'},
      {format: 'amount', label: 'Sent', path: '@.value'},
    ],
    {interpolatedIntent: 'Act on {amount} for {kind}'}
  )
  const withEnums = {
    ...descriptor,
    metadata: {...descriptor.metadata, enums: {kind: {'1': 'Deposit', '2': 'Withdraw'}}},
  }

  test('every format, each as the field kind it means', async () => {
    const result = described(await read(withEnums, encode(SIGNATURE, args), {}, 10n ** 18n))
    assert.deepEqual(result.source, {format: 'erc7730', id: 'app/vault.json', kind: 'descriptor'})
    assert.deepEqual([result.intent.code, result.intent.text], ['external', 'Act'])
    assert.deepEqual([result.summary?.code, result.summary?.text], ['external', 'Act on 1.5 USDC for Withdraw'])

    assert.equal(fieldOf(result, 'data.token', 'text').value, 'USDC')
    const amount = fieldOf(result, 'data.amount', 'amount')
    assert.deepEqual([amount.value, amount.symbol, amount.decimals, amount.token], [1_500_000n, 'USDC', 6, USDC])
    assert.equal(fieldOf(result, 'data.recipient', 'address').value, OTHER)
    // A descriptor's date is never marked expired: what it means is not known.
    const started = fieldOf(result, 'data.deadline', 'datetime')
    assert.deepEqual([started.value, started.expired], [NOW - 86_400_000, false])
    assert.equal(fieldOf(result, 'data.period', 'duration').value, 7 * 86_400_000)
    assert.equal(fieldOf(result, 'data.fee', 'percent').value, 0.3)
    assert.equal(fieldOf(result, 'data.kind', 'text').value, 'Withdraw')
    assert.equal(fieldOf(result, 'data.chain', 'text').value, 'Base')
    assert.deepEqual(
      fieldOf(result, 'data.nftId', 'list').items.map(item => [item.id, item.kind]),
      [
        ['data.nftId.collection', 'address'],
        ['data.nftId.tokenId', 'number'],
      ]
    )
    assert.equal(fieldOf(result, 'data.interop', 'address').value, OTHER)
    const blocks = fieldOf(result, 'data.blocks', 'number')
    assert.deepEqual([blocks.value, blocks.unit?.code], [100n, 'ethereum.unit.blocks'])
    assert.equal(fieldOf(result, 'data.data', 'raw').value, '0xbeef')
    const sent = fieldOf(result, 'container.value', 'amount')
    assert.deepEqual([sent.value, sent.symbol], [10n ** 18n, 'ETH'])
    // The contract, named by the descriptor's owner.
    assert.deepEqual(
      [fieldOf(result, 'contract', 'address').name, fieldOf(result, 'contract', 'address').relation],
      ['Vault', 'contract']
    )
    // Labels are the descriptor's words: external, never translated.
    assert.deepEqual(field(result, 'data.amount').label, {code: 'external', text: 'Amount'})
    assert.deepEqual(codes(result), [])
  })

  test('formats that cannot read their value: the value raw, ethereum.UNREADABLE_FIELD on it', async () => {
    const cases: readonly [string, Record<string, unknown>, unknown[]][] = [
      ['an unknown format', {format: 'holographic', label: 'X', path: 'amount'}, []],
      ['an encrypted value', {encryption: {scheme: 'fhe'}, format: 'tokenAmount', label: 'X', path: 'amount'}, []],
      [
        'an enum without the key',
        {format: 'enum', label: 'X', params: {$ref: '$.metadata.enums.kind'}, path: 'kind'},
        [],
      ],
      [
        'an enum without a table',
        {format: 'enum', label: 'X', params: {$ref: '$.metadata.enums.none'}, path: 'kind'},
        [],
      ],
      ['a unit with no base', {format: 'unit', label: 'X', path: 'amount'}, []],
      [
        'a unit with decimals past 77',
        {format: 'unit', label: 'X', params: {base: 'X', decimals: 78}, path: 'amount'},
        [],
      ],
      ['an address that is not one', {format: 'addressName', label: 'X', path: 'amount'}, []],
      ['a token ticker of a number past 160 bits', {format: 'tokenTicker', label: 'X', path: 'amount'}, []],
      ['a malformed ERC-7930 address', {format: 'interoperableAddressName', label: 'X', path: 'data'}, []],
      ['call data without a callee', {format: 'calldata', label: 'X', path: 'data'}, []],
      ['a date of text', {format: 'date', label: 'X', path: 'note'}, []],
      ['an amount of text', {format: 'tokenAmount', label: 'X', path: 'note'}, []],
    ]
    const signature = 'act(uint256 amount,uint8 kind,bytes data,string note)'
    const data = encode(signature, [MAX, 9, '0x0001000001', 'soon'])

    for (const [why, node] of cases) {
      const result = described(await read(one(signature, [node], {}), data))
      const id = `data.${String(node.path)}`
      assert.deepEqual(shape(result), [`ethereum.UNREADABLE_FIELD medium  ${id}`], why)
      assert.ok(findField(result, id), why)
    }
  })

  test('units: percentages, SI prefixes and decimals', async () => {
    const signature = 'act(uint256 amount)'
    const unit = async (params: Record<string, unknown>, value: bigint) =>
      formatField(
        field(
          described(
            await read(
              one(signature, [{format: 'unit', label: 'X', params, path: 'amount'}]),
              encode(signature, [value])
            )
          ),
          'data.amount'
        )
      )

    assert.equal(await unit({base: '%', decimals: 4}, 125n), '0.0125%')
    assert.equal(await unit({base: 'Wh', prefix: true}, 1_500_000n), '1.5MWh')
    assert.equal(await unit({base: 'h', decimals: 1}, 15n), '1.5h')
    assert.equal(await unit({base: 'x'}, 3n), '3x')
    assert.equal(await unit({base: 'B', prefix: true}, 999n), '999B')
  })

  test('chain ids, durations and dates at their edges', async () => {
    const signature = 'act(uint256 chain,uint256 period,int256 when)'
    const descriptor = one(signature, [
      {format: 'chainId', label: 'Chain', path: 'chain'},
      {format: 'duration', label: 'Lock', path: 'period'},
      {format: 'date', label: 'When', path: 'when'},
    ])
    const result = described(await read(descriptor, encode(signature, [999_999_999n, MAX, -5n])))
    assert.equal(fieldOf(result, 'data.chain', 'text').value, 'eip155:999999999')
    assert.equal(fieldOf(result, 'data.period', 'duration').never, true)
    // A date before 1970 cannot be a chain's timestamp: the value raw.
    assert.deepEqual(shape(result), ['ethereum.UNREADABLE_FIELD medium  data.when'])

    const never = described(await read(descriptor, encode(signature, [1n, 0n, MAX >> 1n])))
    assert.equal(fieldOf(never, 'data.when', 'datetime').never, true)
    assert.equal(fieldOf(never, 'data.chain', 'text').value, 'Ethereum')
  })
})

describe('ERC-7730 addresses and amounts', () => {
  test('addressName: an address from a word or an integer; the sender`s placeholder is the sender', async () => {
    const signature = 'swap(address recipient,bytes32 word,uint256 number)'
    const descriptor = one(signature, [
      {
        format: 'addressName',
        label: 'To',
        params: {senderAddress: ['0x0000000000000000000000000000000000000001']},
        path: 'recipient',
      },
      {format: 'addressName', label: 'Word', path: 'word'},
      {format: 'addressName', label: 'Number', path: 'number'},
    ])
    const result = described(
      await read(
        descriptor,
        encode(signature, ['0x0000000000000000000000000000000000000001', pad(OTHER), BigInt(USDC)])
      )
    )
    assert.deepEqual(
      [fieldOf(result, 'data.recipient', 'address').value, fieldOf(result, 'data.recipient', 'address').relation],
      [SIGNER, 'self']
    )
    assert.equal(fieldOf(result, 'data.word', 'address').value, OTHER)
    assert.deepEqual(
      [fieldOf(result, 'data.number', 'address').value, fieldOf(result, 'data.number', 'address').relation],
      [USDC, 'token']
    )
    // Near miss: another address is itself.
    const other = described(await read(descriptor, encode(signature, [OTHER, pad(OTHER), 0n])))
    assert.equal(fieldOf(other, 'data.recipient', 'address').relation, 'unknown')
  })

  test('tokenAmount: a token by path, constant, descriptor constant or map; the chain`s native address; unknown tokens', async () => {
    const signature = 'act(address token,uint256 amount,uint8 kind)'
    const amountWith = async (params: Record<string, unknown>, token = USDC, kind = 1) => {
      const result = described(
        await read(
          vault(
            {[signature]: {fields: [{format: 'tokenAmount', label: 'Amount', params, path: 'amount'}], intent: 'Act'}},
            {
              constants: {usdc: USDC},
              maps: {tokens: {keyType: 'uint8', values: {'1': USDC, '2': WETH}}},
            }
          ),
          encode(signature, [token, 5n * 10n ** 18n, kind])
        )
      )

      return {amount: fieldOf(result, 'data.amount', 'amount'), result}
    }

    assert.equal((await amountWith({tokenPath: 'token'})).amount.symbol, 'USDC')
    assert.equal((await amountWith({token: USDC}, OTHER)).amount.symbol, 'USDC')
    assert.equal((await amountWith({token: '$.metadata.constants.usdc'}, OTHER)).amount.symbol, 'USDC')
    assert.equal(
      (await amountWith({token: {keyPath: 'kind', map: '$.metadata.maps.tokens'}}, OTHER, 2)).amount.symbol,
      'WETH'
    )
    const native = await amountWith(
      {
        nativeCurrencyAddress: ['0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'],
        tokenPath: 'token',
      },
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
    )
    assert.deepEqual([native.amount.symbol, native.amount.token, native.amount.baseUnit], ['ETH', undefined, 'wei'])

    const unknown = await amountWith({tokenPath: 'token'}, UNKNOWN_TOKEN)
    assert.deepEqual(shape(unknown.result), ['UNKNOWN_TOKEN medium  data.amount'])
    const none = await amountWith({})
    assert.equal(none.amount.token, undefined)
    assert.deepEqual(shape(none.result), ['UNKNOWN_TOKEN medium  data.amount'])

    // A map without an entry for the key: the descriptor does not apply.
    const unmapped = await read(
      vault(
        {
          [signature]: {
            fields: [
              {
                format: 'tokenAmount',
                label: 'A',
                params: {token: {keyPath: 'kind', map: '$.metadata.maps.tokens'}},
                path: 'amount',
              },
            ],
            intent: 'Act',
          },
        },
        {maps: {tokens: {values: {'1': USDC}}}}
      ),
      encode(signature, [USDC, 1n, 3])
    )
    assert.deepEqual(codes(unmapped).sort(), ['UNKNOWN_CONTRACT_CALL', 'ethereum.INVALID_DESCRIPTOR'])
  })

  test('a threshold: ethereum.UNLIMITED_AMOUNT and unlimited at or past it, not below', async () => {
    const signature = 'act(address token,uint256 amount)'
    const descriptor = one(signature, [
      {
        format: 'tokenAmount',
        label: 'Amount',
        params: {threshold: '0x8000000000000000000000000000000000000000000000000000000000000000', tokenPath: 'token'},
        path: 'amount',
      },
    ])
    const unlimited = described(await read(descriptor, encode(signature, [USDC, MAX])))
    assert.equal(fieldOf(unlimited, 'data.amount', 'amount').unlimited, true)
    assert.deepEqual(shape(unlimited), ['ethereum.UNLIMITED_AMOUNT medium  data.amount'])

    const below = described(await read(descriptor, encode(signature, [USDC, 2n ** 255n - 1n])))
    assert.equal(fieldOf(below, 'data.amount', 'amount').unlimited, false)
    assert.deepEqual(codes(below), [])
  })

  test('the descriptor`s own token stands for the contract itself, when no list has it; never for another token', async () => {
    const signature = 'deposit(address token,uint256 assets)'
    const descriptor = vault(
      {
        [signature]: {
          fields: [{format: 'tokenAmount', label: 'Assets', params: {tokenPath: 'token'}, path: 'assets'}],
          intent: 'Deposit',
        },
      },
      {token: {decimals: 6, name: 'Vault share', ticker: 'vUSD'}}
    )
    const own = described(await read(descriptor, encode(signature, [VAULT, 5_000_000n])))
    assert.deepEqual(
      [fieldOf(own, 'data.assets', 'amount').symbol, fieldOf(own, 'data.assets', 'amount').decimals],
      ['vUSD', 6]
    )
    assert.deepEqual(codes(own), [])

    const another = described(await read(descriptor, encode(signature, [UNKNOWN_TOKEN, 5_000_000n])))
    assert.deepEqual(shape(another), ['UNKNOWN_TOKEN medium  data.assets'])
  })

  test('a token on another chain is asked of that chain; failures on any chain are one RESOLVER_FAILED', async () => {
    const signature = 'bridge(address token,uint256 amount,uint256 destination)'
    const descriptor = one(signature, [
      {
        format: 'tokenAmount',
        label: 'Amount',
        params: {chainIdPath: 'destination', tokenPath: 'token'},
        path: 'amount',
      },
      {format: 'tokenAmount', label: 'Here', params: {tokenPath: 'token'}, path: 'amount'},
    ])
    const asked: string[] = []
    const result = described(
      await read(descriptor, encode(signature, [UNKNOWN_TOKEN, 1n, 10n]), {
        resolvers: {
          tokens: {
            token: ({chain}) => {
              asked.push(chain.id)
              throw new Error('offline')
            },
          },
        },
      })
    )
    assert.deepEqual([...new Set(asked)].sort(), ['eip155:1', 'eip155:10'])
    const failed = result.warnings.filter(entry => entry.code === 'RESOLVER_FAILED')
    assert.deepEqual(
      failed.map(entry => entry.params),
      [{resolvers: 'tokens'}]
    )
  })

  test('calldata: the call inside described as an action of its own, one level deeper', async () => {
    const signature = 'relay(address callee,uint256 amount,bytes data,address spender)'
    const descriptor = one(signature, [
      {
        format: 'calldata',
        label: 'Call',
        params: {amountPath: 'amount', calleePath: 'callee', spenderPath: 'spender'},
        path: 'data',
      },
    ])
    const inner = mainnet.erc20.transferData(OTHER, 1_000_000n)
    const result = described(await read(descriptor, encode(signature, [USDC, 0n, inner, SIGNER])))
    assert.deepEqual(at(result, [0]).source, {decoder: 'erc20', kind: 'builtin'})
    assert.equal(at(result, [0]).intent.code, 'intent.send')
    assert.deepEqual(shape(result), ['UNKNOWN_DESTINATION low 0 recipient'])
    // Nothing of the call data is left uncovered.
    assert.ok(!result.fields.some(entry => entry.id?.startsWith('data.')))

    // Ether sent along with a call that takes none.
    const withValue = described(await read(descriptor, encode(signature, [USDC, 5n, inner, SIGNER])))
    assert.ok(codes(withValue).includes('ethereum.UNEXPECTED_VALUE'))

    // A selector given apart from the arguments.
    const split = one('relay(address callee,bytes args)', [
      {format: 'calldata', label: 'Call', params: {calleePath: 'callee', selector: '0xa9059cbb'}, path: 'args'},
    ])
    const args = `0x${inner.slice(10)}` as Hex
    const splitResult = described(await read(split, encode('relay(address callee,bytes args)', [USDC, args])))
    assert.deepEqual(at(splitResult, [0]).source, {decoder: 'erc20', kind: 'builtin'})

    // A call for another chain cannot be read with this chain's knowledge: raw.
    const elsewhere = one(signature, [
      {format: 'calldata', label: 'Call', params: {calleePath: 'callee', chainId: 10}, path: 'data'},
    ])
    const raw = described(await read(elsewhere, encode(signature, [USDC, 0n, inner, SIGNER])))
    assert.deepEqual(raw.actions, [])
    assert.ok(codes(raw).includes('ethereum.UNREADABLE_FIELD'))
  })

  test('calldata calling the same descriptor again nests at most 4 deep', async () => {
    const signature = 'relay(address callee,bytes data)'
    const descriptor = one(signature, [
      {format: 'calldata', label: 'Call', params: {calleePath: 'callee'}, path: 'data'},
    ])
    let data: Hex = mainnet.erc20.transferData(OTHER, 1n)

    for (let level = 0; level < 5; level++) {
      data = encode(signature, [VAULT, data])
    }

    // Five relays: the transaction's at depth 0, the fifth at depth 4, its transfer at depth 5.
    const result = described(await read(descriptor, data))
    assert.equal(at(result, [0, 0, 0, 0]).source.kind, 'descriptor')
    assert.equal(at(result, [0, 0, 0, 0, 0]).source.kind, 'unknown')
    assert.deepEqual(shape(result), ['UNKNOWN_CONTRACT_CALL high 0.0.0.0.0 contract'])
  })
})

describe('ERC-7730 visibility, groups and paths', () => {
  test('always, optional, never, ifNotIn, mustMatch; what nothing mentions is shown behind "More details"', async () => {
    const signature = 'act(uint256 a,uint256 b,uint256 c,uint256 d,uint256 e,uint256 f)'
    const descriptor = one(signature, [
      {label: 'A', path: 'a'},
      {label: 'B', path: 'b', visible: 'optional'},
      {label: 'C', path: 'c', visible: 'never'},
      {label: 'D', path: 'd', visible: {ifNotIn: ['0', 0]}},
      {label: 'E', path: 'e', visible: {mustMatch: [7]}},
    ])
    const result = described(await read(descriptor, encode(signature, [1n, 2n, 3n, 0n, 7n, 6n])))
    assert.deepEqual(
      result.fields.map(entry => [entry.id, entry.secondary ?? false]),
      [
        ['data.a', false],
        ['data.b', true],
        ['data.f', true],
        ['contract', false],
        ['maxFee', false],
        ['gasLimit', true],
        ['maxFeePerGas', true],
        ['maxPriorityFeePerGas', true],
        ['nonce', true],
        ['transactionType', true],
      ]
    )
    assert.deepEqual(field(result, 'data.f').label, {code: 'external', text: 'f'})

    // ifNotIn shows a value outside the list.
    assert.ok(findField(described(await read(descriptor, encode(signature, [1n, 2n, 3n, 4n, 7n, 6n]))), 'data.d'))
    // mustMatch fails the whole descriptor when the value differs.
    assert.deepEqual(codes(await read(descriptor, encode(signature, [1n, 2n, 3n, 0n, 8n, 6n]))).sort(), [
      'UNKNOWN_CONTRACT_CALL',
      'ethereum.INVALID_DESCRIPTOR',
    ])
  })

  test('version 1: required paths a field must show, excluded paths none may', async () => {
    const signature = 'act(uint256 a,uint256 b)'
    const v1 = (format: Record<string, unknown>): Erc7730Descriptor => ({
      $schema: 'https://github.com/LedgerHQ/clear-signing-erc7730-registry/specs/erc7730-v1.schema.json',
      context: {contract: {deployments: [{address: VAULT, chainId: 1}]}},
      display: {formats: {[signature]: {intent: 'Act', ...format}}},
      metadata: {owner: 'Vault'},
    })

    const required = described(
      await read(v1({fields: [{label: 'A', path: 'a'}], required: ['a', 'b']}), encode(signature, [1n, 2n]))
    )
    assert.deepEqual(shape(required), ['ethereum.UNREADABLE_FIELD medium  '])

    const excluded = described(
      await read(
        v1({
          excluded: ['b'],
          fields: [
            {label: 'A', path: 'a'},
            {label: 'B', path: 'b'},
          ],
        }),
        encode(signature, [1n, 2n])
      )
    )
    assert.ok(!findField(excluded, 'data.b'))
    assert.deepEqual(codes(excluded), [])
  })

  test('groups: sequential under a path with a label, bundled element by element', async () => {
    const signature = 'place((address token,uint256 amount)[] orders,address owner)'
    const orders = [
      {amount: 1_000_000n, token: USDC},
      {amount: 10n ** 18n, token: WETH},
    ]
    const data = encode(signature, [orders, SIGNER])

    const sequential = described(
      await read(
        one(signature, [
          {
            fields: [
              {format: 'tokenTicker', label: 'Token', path: 'token'},
              {format: 'tokenAmount', label: 'Amount', params: {tokenPath: 'token'}, path: 'amount'},
            ],
            label: 'Orders',
            path: 'orders.[]',
          },
          {format: 'addressName', label: 'Owner', path: '#.owner'},
        ]),
        data
      )
    )
    const group = fieldOf(sequential, 'group.orders.all', 'list')
    assert.deepEqual(group.label, {code: 'external', text: 'Orders'})
    assert.deepEqual(
      group.items.map(item => item.id),
      ['data.orders.token.all', 'data.orders.amount.all']
    )
    // Each amount with its own order's token.
    assert.deepEqual(
      fieldOf(sequential, 'data.orders.amount.all', 'list').items.map(item =>
        item.kind === 'amount' ? item.symbol : ''
      ),
      ['USDC', 'WETH']
    )
    assert.equal(fieldOf(sequential, 'data.owner', 'address').relation, 'self')

    const bundled = described(
      await read(
        one(signature, [
          {
            fields: [
              {format: 'tokenTicker', label: 'Token', path: 'token'},
              {format: 'tokenAmount', label: 'Amount', params: {tokenPath: 'token'}, path: 'amount'},
            ],
            iteration: 'bundled',
            label: 'Order',
            path: 'orders.[]',
          },
          {label: 'Owner', path: 'owner'},
        ]),
        data
      )
    )
    assert.deepEqual(
      bundled.fields
        .slice(0, 2)
        .map(entry => [entry.id, entry.kind === 'list' ? entry.items.map(item => item.id) : []]),
      [
        ['group.orders.0', ['data.orders.0.token', 'data.orders.0.amount']],
        ['group.orders.1', ['data.orders.1.token', 'data.orders.1.amount']],
      ]
    )
    assert.equal(fieldOf(bundled, 'data.orders.1.amount', 'amount').symbol, 'WETH')
  })

  test('slices and indexes of arrays and bytes; parameters aligned item by item', async () => {
    const signature = 'split(address[] tokens,uint256[] amounts,bytes data)'
    const descriptor = one(signature, [
      {format: 'tokenAmount', label: 'Amounts', params: {tokenPath: 'tokens.[]'}, path: 'amounts.[]'},
      {label: 'Middle', path: 'amounts.[1:3]'},
      {label: 'Last', path: 'amounts.[-1]'},
      {label: 'Selector', path: 'data.[0:4]'},
    ])
    const tokens = [USDC, WETH, USDC]
    const result = described(
      await read(
        descriptor,
        encode(signature, [tokens, [1_000_000n, 10n ** 18n, 2_000_000n], mainnet.erc20.transferData(OTHER, 1n)])
      )
    )
    assert.deepEqual(
      fieldOf(result, 'data.amounts.all', 'list').items.map(item =>
        item.kind === 'amount' ? [item.id, item.symbol, item.value] : []
      ),
      [
        ['data.amounts.0', 'USDC', 1_000_000n],
        ['data.amounts.1', 'WETH', 10n ** 18n],
        ['data.amounts.2', 'USDC', 2_000_000n],
      ]
    )
    assert.deepEqual(
      fieldOf(result, 'data.amounts.all-2', 'list').items.map(item => (item.kind === 'number' ? item.value : 0n)),
      [10n ** 18n, 2_000_000n]
    )
    assert.equal(fieldOf(result, 'data.amounts.2-2', 'number').value, 2_000_000n)
    assert.equal(fieldOf(result, 'data.data', 'raw').value, '0xa9059cbb')

    // Tokens and amounts of different lengths: no token is guessed.
    const misaligned = described(await read(descriptor, encode(signature, [[USDC, WETH], [1n, 2n, 3n], '0x12345678'])))
    assert.deepEqual(
      fieldOf(misaligned, 'data.amounts.all', 'list').items.map(item => (item.kind === 'amount' ? item.symbol : 'x')),
      [undefined, undefined, undefined]
    )
    assert.ok(codes(misaligned).includes('UNKNOWN_TOKEN'))
  })
})

describe('ERC-7730 words', () => {
  test('interpolated intents: every placeholder read, or no summary at all; {{ and }} escape', async () => {
    const signature = 'send(address to,uint256 amount,address[] path)'
    const data = encode(signature, [OTHER, 1_500_000n, [USDC, WETH]])
    const summary = async (template: string) =>
      described(
        await read(
          one(
            signature,
            [
              {format: 'addressName', label: 'To', path: 'to'},
              {format: 'tokenAmount', label: 'Amount', params: {token: USDC}, path: 'amount'},
              {label: 'Path', path: 'path'},
              {format: 'amount', label: 'Value', path: '@.value'},
            ],
            {interpolatedIntent: template}
          ),
          data
        )
      ).summary

    assert.deepEqual(await summary('Send {amount} to {to}'), {
      code: 'external',
      text: `Send 1.5 USDC to ${OTHER}`,
    })
    assert.equal((await summary('Send {#.amount} ({@.value})'))?.text, 'Send 1.5 USDC (0 ETH)')
    assert.equal((await summary('{{literal}} {amount} }}'))?.text, '{literal} 1.5 USDC }')
    assert.equal((await summary('{ amount }'))?.text, '1.5 USDC')

    for (const broken of ['Send {missing}', 'Send } {amount}', 'Send {amount', 'Via {path}']) {
      assert.equal(await summary(broken), undefined, broken)
    }
  })

  test('hidden characters in a descriptor`s words: HIDDEN_CHARACTERS where they are', async () => {
    const signature = 'act(uint8 kind,uint256 amount,string note)'
    const data = encode(signature, [1, 5n, 'plain'])
    const result = described(
      await read(
        vault(
          {
            [signature]: {
              fields: [
                {format: 'enum', label: 'Kind', params: {$ref: '$.metadata.enums.kind'}, path: 'kind'},
                {label: 'Amo‮unt', path: 'amount'},
                {fields: [{label: 'Note', path: 'note'}], label: 'Det​ails'},
              ],
              intent: 'Sta⁦ke',
            },
          },
          {enums: {kind: {'1': 'Dep‭osit'}}, owner: 'Vau‮lt'}
        ),
        data
      )
    )
    assert.deepEqual(shape(result), [
      'HIDDEN_CHARACTERS medium  ',
      'HIDDEN_CHARACTERS medium  data.amount',
      'HIDDEN_CHARACTERS medium  data.kind',
      'HIDDEN_CHARACTERS medium  group.fields',
    ])
    // An owner with hidden characters does not name the contract.
    assert.equal(fieldOf(result, 'contract', 'address').relation, 'unknown')

    // Text in the call data itself, shown by a descriptor.
    const note = described(
      await read(
        vault({[signature]: {fields: [{label: 'Note', path: 'note'}], intent: 'Act'}}),
        encode(signature, [1, 5n, 'pay ‮me'])
      )
    )
    assert.ok(shape(note).includes('HIDDEN_CHARACTERS medium  data.note'))
  })
})

describe('ERC-7730 binding', () => {
  const signature = 'stake(uint256 amount)'
  const data = encode(signature, [5n])
  const invalid = (result: ClearSigning) =>
    assert.deepEqual(shape(result), ['UNKNOWN_CONTRACT_CALL high  contract', 'ethereum.INVALID_DESCRIPTOR low  '])

  test('a descriptor the resolver answers but that does not bind is not believed', async () => {
    const elsewhere = (deployments: unknown[]) => ({
      ...one(signature, [{label: 'Amount', path: 'amount'}]),
      context: {contract: {deployments}},
    })

    for (const descriptor of [
      elsewhere([{address: OTHER, chainId: 1}]),
      elsewhere([{address: VAULT, chainId: 10}]),
      elsewhere([]),
      one('unstake(uint256 amount)', [{label: 'Amount', path: 'amount'}]),
      {context: {eip712: {deployments: [{address: VAULT, chainId: 1}]}}, display: {formats: {}}},
      'not a descriptor',
      one(signature, [{label: 'Amount', path: 'amountt'}]),
    ]) {
      invalid(await call(VAULT, data, {resolvers: {descriptors: always(descriptor)}}))
    }
  })

  test('call data that does not decode as the descriptor`s function is not read by it', async () => {
    const descriptor = one(signature, [{label: 'Amount', path: 'amount'}])
    invalid(await read(descriptor, data.slice(0, -2) as Hex))
    // A bool word of 2 is not a bool.
    const flag = one('act(bool flag)', [{label: 'Flag', path: 'flag'}])
    invalid(await read(flag, `${encode('act(bool flag)', [true]).slice(0, -2)}02` as Hex))
    assert.equal(described(await read(flag, encode('act(bool flag)', [true]))).fields[0]?.kind, 'boolean')
  })

  test('a descriptor labelling USDC`s approve "Claim reward" is never asked: the built-in reads it', async () => {
    let asked = 0
    const lie: Erc7730Descriptor = {
      context: {contract: {deployments: [{address: USDC, chainId: 1}]}},
      display: {formats: {'approve(address spender,uint256 value)': {fields: [], intent: 'Claim reward'}}},
      metadata: {owner: 'Circle'},
    }
    const resolver = createDescriptorResolver([{descriptor: lie, path: 'app/lie.json'}])
    const result = await call(USDC, encode('approve(address spender,uint256 amount)', [UNISWAP_ROUTER, MAX]), {
      resolvers: {
        descriptors: {
          descriptor: query => {
            asked++

            return resolver.descriptor(query)
          },
        },
      },
    })
    assert.equal(asked, 0)
    assert.deepEqual(result.source, {decoder: 'erc20', kind: 'builtin'})
    assert.equal(result.intent.code, 'intent.approve')
    assert.ok(codes(result).includes('UNLIMITED_APPROVAL'))

    // The registry's own stETH descriptor has an approve format too: the built-in still reads it.
    const steth = await call(
      '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
      encode('approve(address spender,uint256 amount)', [UNISWAP_ROUTER, MAX]),
      {resolvers: {descriptors: registryResolver()}}
    )
    assert.deepEqual(steth.source, {decoder: 'erc20', kind: 'builtin'})
  })

  test('version 1: a call read by a format named by function name or selector, its parameters named by the ABI', async () => {
    const abi = [
      {
        inputs: [
          {name: 'amount', type: 'uint256'},
          {name: 'beneficiary', type: 'address'},
        ],
        name: 'deposit',
        type: 'function',
      },
      {inputs: [{name: 'shares', type: 'uint256'}], name: 'redeem', type: 'function'},
    ]
    const v1: Erc7730Descriptor = {
      $schema: 'https://github.com/LedgerHQ/clear-signing-erc7730-registry/specs/erc7730-v1.schema.json',
      context: {contract: {abi, deployments: [{address: VAULT, chainId: 1}]}},
      display: {
        formats: {
          '0xdb006a75': {fields: [{label: 'Shares', path: 'shares'}], intent: 'Redeem'},
          deposit: {
            fields: [
              {format: 'tokenAmount', label: 'Amount', params: {token: USDC}, path: 'amount'},
              {format: 'addressName', label: 'For', path: 'beneficiary'},
            ],
            intent: 'Deposit',
          },
        },
      },
      metadata: {owner: 'Vault'},
    }
    const deposit = described(await read(v1, encode('deposit(uint256,address)', [1_000_000n, SIGNER])))
    assert.deepEqual([deposit.intent.text, fieldOf(deposit, 'data.amount', 'amount').symbol], ['Deposit', 'USDC'])
    assert.equal(fieldOf(deposit, 'data.beneficiary', 'address').relation, 'self')
    const redeem = described(await read(v1, encode('redeem(uint256)', [7n])))
    assert.deepEqual([redeem.intent.text, fieldOf(redeem, 'data.shares', 'number').value], ['Redeem', 7n])
  })

  test('typed data: bound by deployments, by domain, by domain separator, and by version 1 schemas', async () => {
    const order: TypedDataDefinition = {
      domain: {chainId: 1, name: 'Orders', verifyingContract: VAULT, version: '1'},
      message: {amount: 5n, maker: SIGNER},
      primaryType: 'Order',
      types: {
        Order: [
          {name: 'maker', type: 'address'},
          {name: 'amount', type: 'uint256'},
        ],
      },
    }
    const format = {'Order(address maker,uint256 amount)': {fields: [{label: 'Maker', path: 'maker'}], intent: 'Order'}}
    const sign = (context: Record<string, unknown>, formats: Record<string, unknown> = format, typed = order) =>
      clearSignTypedData(
        mainnet,
        typed,
        options({resolvers: {descriptors: always({context: {eip712: context}, display: {formats}})}})
      )
    const separator = `0x${Buffer.from(mainnet.hashDomain({domain: order.domain ?? {}})).toString('hex')}`

    for (const context of [
      {deployments: [{address: VAULT, chainId: 1}]},
      {domain: {name: 'Orders', verifyingContract: VAULT.toUpperCase().replace('0X', '0x')}},
      {domain: {chainId: '1', version: '1'}},
      {domainSeparator: separator},
    ]) {
      const result = await sign(context)
      assert.equal(result.source.kind, 'descriptor', JSON.stringify(context))
      assert.equal(fieldOf(result, 'data.maker', 'address').relation, 'self')
      // The uncovered member is still shown.
      assert.equal(fieldOf(result, 'data.amount', 'number').secondary, true)
    }

    for (const context of [
      {deployments: [{address: OTHER, chainId: 1}]},
      {domain: {name: 'Other'}},
      {domain: {salt: '0x01'}},
      {domainSeparator: `0x${'00'.repeat(32)}`},
      {},
    ]) {
      const result = await sign(context)
      assert.deepEqual(
        shape(result),
        ['BLIND_SIGNING high  ', 'ethereum.INVALID_DESCRIPTOR low  '],
        JSON.stringify(context)
      )
    }

    const v1 = await clearSignTypedData(
      mainnet,
      order,
      options({
        resolvers: {
          descriptors: always({
            $schema: 'erc7730-v1.schema.json',
            context: {
              eip712: {
                deployments: [{address: VAULT, chainId: 1}],
                schemas: [{primaryType: 'Order', types: {EIP712Domain: [], Order: order.types.Order}}],
              },
            },
            display: {formats: {Order: {fields: [{label: 'Maker', path: 'maker'}], intent: 'Order'}}},
          }),
        },
      })
    )
    assert.equal(v1.source.kind, 'descriptor')

    // A schema of other members does not bind.
    const otherSchema = await clearSignTypedData(
      mainnet,
      order,
      options({
        resolvers: {
          descriptors: always({
            $schema: 'erc7730-v1.schema.json',
            context: {
              eip712: {
                deployments: [{address: VAULT, chainId: 1}],
                schemas: [{primaryType: 'Order', types: {Order: [{name: 'maker', type: 'address'}]}}],
              },
            },
            display: {formats: {Order: {intent: 'Order'}}},
          }),
        },
      })
    )
    assert.ok(codes(otherSchema).includes('ethereum.INVALID_DESCRIPTOR'))
  })

  test('Permit2`s typed data is read by the built-in even with the registry`s Permit2 descriptor at hand', async () => {
    const result = await clearSignTypedData(
      mainnet,
      {
        domain: {chainId: 1, name: 'Permit2', verifyingContract: PERMIT2},
        message: {
          details: {amount: 2n ** 160n - 1n, expiration: inSeconds(DAY), nonce: 0n, token: USDC},
          sigDeadline: inSeconds(1800n),
          spender: UNISWAP_ROUTER,
        },
        primaryType: 'PermitSingle',
        types: {
          PermitDetails: [
            {name: 'token', type: 'address'},
            {name: 'amount', type: 'uint160'},
            {name: 'expiration', type: 'uint48'},
            {name: 'nonce', type: 'uint48'},
          ],
          PermitSingle: [
            {name: 'details', type: 'PermitDetails'},
            {name: 'spender', type: 'address'},
            {name: 'sigDeadline', type: 'uint256'},
          ],
        },
      },
      options({resolvers: {descriptors: registryResolver()}})
    )
    assert.deepEqual(result.source, {decoder: 'permit2', kind: 'builtin'})
    assert.ok(codes(result).includes('UNLIMITED_APPROVAL'))
  })

  test('a descriptor`s source names it and its publisher', async () => {
    const result = await call(VAULT, data, {
      resolvers: {
        descriptors: createDescriptorResolver(
          [{descriptor: one(signature, [{label: 'Amount', path: 'amount'}]), path: 'app/vault.json'}],
          {publisher: 'Vault Labs'}
        ),
      },
    })
    assert.deepEqual(result.source, {
      format: 'erc7730',
      id: 'app/vault.json',
      kind: 'descriptor',
      publisher: 'Vault Labs',
    })
  })
})

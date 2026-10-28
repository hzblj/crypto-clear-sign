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
  clock,
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
  names,
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
  assert.equal(
    result.source.kind,
    'descriptor',
    `read by the descriptor: ${result.warnings.map(entry => `${entry.code} ${JSON.stringify(entry.params ?? {})}`).join(', ')}`
  )

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

  test('formats that cannot read their value: the value raw, ethereum.UNREADABLE_FIELD on it with the reason', async () => {
    const cases: readonly [string, Record<string, unknown>, string | undefined][] = [
      ['an unknown format', {format: 'holographic', label: 'X', path: 'amount'}, undefined],
      [
        'an encrypted value',
        {
          encryption: {fallbackLabel: 'Hidden', plaintextType: 'uint256', scheme: 'fhevm'},
          format: 'tokenAmount',
          label: 'X',
          path: 'amount',
        },
        'DECRYPTION_FAILED',
      ],
      [
        'an enum without the key',
        {format: 'enum', label: 'X', params: {$ref: '$.metadata.enums.kind'}, path: 'kind'},
        'FORMAT_PARAM_RESOLUTION_ERROR',
      ],
      ['an address that is text', {format: 'addressName', label: 'X', path: 'note'}, 'ARGUMENT_TYPE_MISMATCH'],
      ['a token ticker of text', {format: 'tokenTicker', label: 'X', path: 'note'}, 'ARGUMENT_TYPE_MISMATCH'],
      ['a malformed ERC-7930 address', {format: 'interoperableAddressName', label: 'X', path: 'data'}, undefined],
      ['call data without a callee', {format: 'calldata', label: 'X', path: 'data'}, 'FORMAT_PARAM_RESOLUTION_ERROR'],
      [
        'a date of text',
        {format: 'date', label: 'X', params: {encoding: 'timestamp'}, path: 'note'},
        'ARGUMENT_TYPE_MISMATCH',
      ],
      ['a date without an encoding', {format: 'date', label: 'X', path: 'amount'}, 'UNKNOWN_ENCODING'],
      ['an amount of text', {format: 'tokenAmount', label: 'X', path: 'note'}, 'ARGUMENT_TYPE_MISMATCH'],
    ]
    const signature = 'act(uint256 amount,uint8 kind,bytes data,string note)'
    const data = encode(signature, [MAX, 9, '0x0001000001', 'soon'])

    for (const [why, node, reason] of cases) {
      const result = described(
        await read(vault({[signature]: {fields: [node], intent: 'Act'}}, {enums: {kind: {'1': 'One'}}}), data)
      )
      const id = `data.${String(node.path)}`
      assert.deepEqual(
        result.warnings.map(entry => [entry.code, entry.severity, entry.fields, entry.params?.code]),
        [['ethereum.UNREADABLE_FIELD', 'medium', [id], reason]],
        why
      )
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
      {format: 'date', label: 'When', params: {encoding: 'timestamp'}, path: 'when'},
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
  test('addressName: an address from a slice or an integer; the sender`s placeholder is the sender', async () => {
    const signature = 'swap(address recipient,bytes32 word,uint256 number)'
    const descriptor = one(signature, [
      {
        format: 'addressName',
        label: 'To',
        params: {senderAddress: ['0x0000000000000000000000000000000000000001']},
        path: 'recipient',
      },
      {format: 'addressName', label: 'Word', path: 'word.[-20:]'},
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
    assert.equal(fieldOf(result, 'data.word.-20', 'address').value, OTHER)
    assert.deepEqual(
      [fieldOf(result, 'data.number', 'address').value, fieldOf(result, 'data.number', 'address').relation],
      [USDC, 'token']
    )
    assert.deepEqual(codes(result), [])
    // Near miss: another address is itself.
    const other = described(await read(descriptor, encode(signature, [OTHER, pad(OTHER), 0n])))
    assert.equal(fieldOf(other, 'data.recipient', 'address').relation, 'unknown')
    // A whole word is not an address: the reference reads one from a slice of it.
    const word = described(
      await read(
        one(signature, [{format: 'addressName', label: 'Word', path: 'word'}]),
        encode(signature, [OTHER, pad(OTHER), 0n])
      )
    )
    assert.equal(only(word, 'ethereum.UNREADABLE_FIELD').params?.code, 'ARGUMENT_TYPE_MISMATCH')
  })

  test('addressName types: ethereum.ADDRESS_TYPE_MISMATCH when the names resolver contradicts them', async () => {
    const signature = 'pay(address to)'
    const descriptor = one(signature, [{format: 'addressName', label: 'To', params: {types: ['eoa']}, path: 'to'}])
    const known = {resolvers: {names: names({[OTHER.toLowerCase()]: {name: 'Some router', relation: 'contract'}})}}
    const result = described(await read(descriptor, encode(signature, [OTHER]), known))
    assert.deepEqual(shape(result), ['ethereum.ADDRESS_TYPE_MISMATCH medium  data.to'])
    assert.equal(fieldOf(result, 'data.to', 'address').name, 'Some router')
    // Near misses: a contract where a contract may be, an address nobody names.
    const contract = one(signature, [
      {format: 'addressName', label: 'To', params: {types: ['eoa', 'contract']}, path: 'to'},
    ])
    assert.deepEqual(codes(described(await read(contract, encode(signature, [OTHER]), known))), [])
    assert.deepEqual(codes(described(await read(descriptor, encode(signature, [OTHER])))), [])
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
    assert.equal(unknown.amount.token, UNKNOWN_TOKEN)
    // No token named at all: the amount in base units, unreadable as the descriptor says.
    const none = await amountWith({})
    assert.equal(none.amount.token, undefined)
    assert.deepEqual(shape(none.result), ['ethereum.UNREADABLE_FIELD medium  data.amount'])

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
    assert.equal(only(unmapped, 'ethereum.INVALID_DESCRIPTOR').params?.code, 'INVALID_DESCRIPTOR')
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

  test('the descriptor`s own token: by $.metadata.token, or for the contract itself when no list has it', async () => {
    const signature = 'deposit(address token,uint256 assets)'
    const descriptor = (params: Record<string, unknown>) =>
      vault(
        {
          [signature]: {
            fields: [{format: 'tokenAmount', label: 'Assets', params, path: 'assets'}],
            intent: 'Deposit',
          },
        },
        {token: {decimals: 6, name: 'Vault share', ticker: 'vUSD'}}
      )

    for (const params of [{token: '$.metadata.token'}, {tokenPath: 'token'}]) {
      const own = described(await read(descriptor(params), encode(signature, [VAULT, 5_000_000n])))
      const assets = fieldOf(own, 'data.assets', 'amount')
      assert.deepEqual([assets.symbol, assets.decimals, assets.token], ['vUSD', 6, VAULT], JSON.stringify(params))
      assert.deepEqual(codes(own), [])
    }

    const another = described(
      await read(descriptor({tokenPath: 'token'}), encode(signature, [UNKNOWN_TOKEN, 5_000_000n]))
    )
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
  test('always, optional (behind "More details"), never, ifNotIn, mustMatch', async () => {
    const signature = 'act(uint256 a,uint256 b,uint256 c,uint256 d,uint256 e)'
    const descriptor = one(signature, [
      {format: 'raw', label: 'A', path: 'a'},
      {format: 'raw', label: 'B', path: 'b', visible: 'optional'},
      {format: 'raw', label: 'C', path: 'c', visible: 'never'},
      {format: 'raw', label: 'D', path: 'd', visible: {ifNotIn: ['0', 0]}},
      {format: 'raw', label: 'E', path: 'e', visible: {mustMatch: [7]}},
    ])
    const result = described(await read(descriptor, encode(signature, [1n, 2n, 3n, 0n, 7n])))
    assert.deepEqual(
      result.fields.map(entry => [entry.id, entry.secondary ?? false]),
      [
        ['data.a', false],
        ['data.b', true],
        ['contract', false],
        ['maxFee', false],
        ['gasLimit', true],
        ['maxFeePerGas', true],
        ['maxPriorityFeePerGas', true],
        ['nonce', true],
        ['transactionType', true],
      ]
    )

    // ifNotIn shows a value outside the list.
    assert.ok(findField(described(await read(descriptor, encode(signature, [1n, 2n, 3n, 4n, 7n]))), 'data.d'))
    // mustMatch fails the whole descriptor when the value differs.
    const mismatch = await read(descriptor, encode(signature, [1n, 2n, 3n, 0n, 8n]))
    assert.deepEqual(codes(mismatch).sort(), ['UNKNOWN_CONTRACT_CALL', 'ethereum.INVALID_DESCRIPTOR'])
    assert.equal(only(mismatch, 'ethereum.INVALID_DESCRIPTOR').params?.code, 'MUSTMATCH_VIOLATION')
  })

  test('version 1 descriptors (an ABI, formats by name or selector) are not read: the reference reads version 2', async () => {
    const v1: Erc7730Descriptor = {
      $schema: 'https://github.com/LedgerHQ/clear-signing-erc7730-registry/specs/erc7730-v1.schema.json',
      context: {
        contract: {
          abi: [{inputs: [{name: 'shares', type: 'uint256'}], name: 'redeem', type: 'function'}],
          deployments: [{address: VAULT, chainId: 1}],
        },
      },
      display: {formats: {'0xdb006a75': {fields: [{label: 'Shares', path: 'shares'}], intent: 'Redeem'}}},
      metadata: {owner: 'Vault'},
    }
    assert.deepEqual(createDescriptorResolver([{descriptor: v1, path: 'app/v1.json'}]).rejected, [
      {path: 'app/v1.json', reason: 'A format of a contract is keyed by a function signature.'},
    ])
    const result = await call(VAULT, encode('redeem(uint256)', [7n]), {resolvers: {descriptors: always(v1)}})
    assert.deepEqual(shape(result), ['UNKNOWN_CONTRACT_CALL high  contract', 'ethereum.INVALID_DESCRIPTOR low  '])
    assert.equal(only(result, 'ethereum.INVALID_DESCRIPTOR').params?.code, 'INVALID_DESCRIPTOR')
  })

  test('groups: under a path with a label, element by element; bundled arrays paired by index', async () => {
    const signature = 'place((address token,uint256 amount)[] orders,address owner)'
    const orders = [
      {amount: 1_000_000n, token: USDC},
      {amount: 10n ** 18n, token: WETH},
    ]
    const data = encode(signature, [orders, SIGNER])
    const pairs = (result: ClearSigning) =>
      fieldOf(result, 'group.0', 'list').items.map(item => [item.id, item.kind === 'amount' ? item.symbol : item.kind])

    const byElement = described(
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
    assert.deepEqual(fieldOf(byElement, 'group.0', 'list').label, {code: 'external', text: 'Orders'})
    // Each amount with its own order's token.
    assert.deepEqual(pairs(byElement), [
      ['data.orders.0.token', 'text'],
      ['data.orders.0.amount', 'USDC'],
      ['data.orders.1.token', 'text'],
      ['data.orders.1.amount', 'WETH'],
    ])
    assert.equal(fieldOf(byElement, 'data.owner', 'address').relation, 'self')

    const bundled = described(
      await read(
        one(signature, [
          {
            fields: [
              {format: 'tokenTicker', label: 'Token', path: 'orders.[].token'},
              {
                format: 'tokenAmount',
                label: 'Amount',
                params: {tokenPath: 'orders.[].token'},
                path: 'orders.[].amount',
              },
            ],
            iteration: 'bundled',
            label: 'Order',
          },
          {format: 'raw', label: 'Owner', path: 'owner'},
        ]),
        data
      )
    )
    assert.deepEqual(pairs(bundled), pairs(byElement))

    // A field of every element, without a group: one list, an item per element.
    const amounts = described(
      await read(
        one(signature, [
          {format: 'tokenAmount', label: 'Amounts', params: {tokenPath: 'orders.[].token'}, path: 'orders.[].amount'},
        ]),
        data
      )
    )
    const list = fieldOf(amounts, 'data.orders.amount.all', 'list')
    assert.deepEqual(list.label, {code: 'external', text: 'Amounts'})
    assert.deepEqual(
      list.items.map(item => [item.id, item.label.text, item.kind === 'amount' ? item.value : 0n]),
      [
        ['data.orders.0.amount', 'Item 1', 1_000_000n],
        ['data.orders.1.amount', 'Item 2', 10n ** 18n],
      ]
    )

    // Groups inside groups are not in the reference's reading of the standard: the descriptor is not used.
    const nested = await read(
      one(signature, [{fields: [{fields: [{format: 'raw', label: 'Owner', path: 'owner'}]}], label: 'Outer'}]),
      data
    )
    assert.equal(only(nested, 'ethereum.INVALID_DESCRIPTOR').params?.code, 'UNSUPPORTED_NESTED_FIELD_GROUP')
  })

  test('slices of bytes, indexes of arrays; parameters aligned item by item, or the descriptor is not used', async () => {
    const signature = 'split(address[] tokens,uint256[] amounts,bytes data)'
    const descriptor = one(signature, [
      {format: 'tokenAmount', label: 'Amounts', params: {tokenPath: 'tokens.[]'}, path: 'amounts.[]'},
      {format: 'raw', label: 'Last', path: 'amounts.[-1]'},
      {format: 'raw', label: 'Selector', path: 'data.[0:4]'},
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
    assert.equal(fieldOf(result, 'data.amounts.-1', 'number').value, 2_000_000n)
    assert.equal(fieldOf(result, 'data.data.0-4', 'raw').value, '0xa9059cbb')

    // Tokens and amounts of different lengths: no token is guessed, the descriptor is not used.
    const misaligned = await read(descriptor, encode(signature, [[USDC, WETH], [1n, 2n, 3n], '0x12345678']))
    assert.equal(only(misaligned, 'ethereum.INVALID_DESCRIPTOR').params?.code, 'PARAM_ARRAY_SIZE_MISMATCH')
  })
})

describe('ERC-7730 words', () => {
  test('interpolated intents: every placeholder read, or no summary at all; {{ and }} escape; arrays joined', async () => {
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
              {format: 'raw', label: 'Path', path: 'path.[]'},
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
    assert.equal((await summary('Via {path}'))?.text, `Via ${USDC} and ${WETH}`)

    for (const broken of ['Send {missing}', 'Send {amount', 'Send {}']) {
      assert.equal(await summary(broken), undefined, broken)
    }
  })

  test('hidden characters in a descriptor`s words and in the data it shows: HIDDEN_CHARACTERS where they are', async () => {
    const signature = 'act(uint8 kind,uint256 amount,string note)'
    const data = encode(signature, [1, 5n, 'plain'])
    const result = described(
      await read(
        vault(
          {
            [signature]: {
              fields: [
                {format: 'enum', label: 'Kind', params: {$ref: '$.metadata.enums.kind'}, path: 'kind'},
                {format: 'raw', label: 'Amo\u202eunt', path: 'amount'},
                {fields: [{format: 'raw', label: 'Note', path: 'note'}], label: 'Det\u200bails'},
              ],
              intent: 'Sta\u2066ke',
            },
          },
          {enums: {kind: {'1': 'Dep\u202dosit'}}, owner: 'Vau\u202elt'}
        ),
        data
      )
    )
    assert.deepEqual(shape(result), [
      'HIDDEN_CHARACTERS medium  ',
      'HIDDEN_CHARACTERS medium  data.amount',
      'HIDDEN_CHARACTERS medium  data.kind',
      'HIDDEN_CHARACTERS medium  group.2',
    ])
    // An owner with hidden characters does not name the contract.
    assert.equal(fieldOf(result, 'contract', 'address').relation, 'unknown')

    // Text in the call data itself, shown by a descriptor: decoded as UTF-8, as it was signed.
    const shown = async (note: string) =>
      described(
        await read(
          vault({[signature]: {fields: [{format: 'raw', label: 'Note', path: 'note'}], intent: 'Act'}}),
          encode(signature, [1, 5n, note])
        )
      )
    const hidden = await shown('pay \u202eme')
    assert.equal(fieldOf(hidden, 'data.note', 'text').value, 'pay \u202eme')
    assert.deepEqual(shape(hidden), ['HIDDEN_CHARACTERS medium  data.note'])
    assert.equal(fieldOf(await shown('Zaplaťte 5 €'), 'data.note', 'text').value, 'Zaplaťte 5 €')
  })
})

describe('ERC-7730 binding', () => {
  const signature = 'stake(uint256 amount)'
  const data = encode(signature, [5n])
  const invalid = (result: ClearSigning) =>
    assert.deepEqual(shape(result), ['UNKNOWN_CONTRACT_CALL high  contract', 'ethereum.INVALID_DESCRIPTOR low  '])

  test('a descriptor the resolver answers but that does not bind is not believed', async () => {
    const elsewhere = (deployments: unknown[]) => ({
      ...one(signature, [{format: 'raw', label: 'Amount', path: 'amount'}]),
      context: {contract: {deployments}},
    })

    for (const [descriptor, reason] of [
      [elsewhere([{address: OTHER, chainId: 1}]), 'DEPLOYMENT_MISMATCH'],
      [elsewhere([{address: VAULT, chainId: 10}]), 'DEPLOYMENT_MISMATCH'],
      [elsewhere([]), 'DEPLOYMENT_MISMATCH'],
      [one('unstake(uint256 amount)', [{format: 'raw', label: 'Amount', path: 'amount'}]), 'NO_FORMAT_MATCH'],
      [
        {context: {eip712: {deployments: [{address: VAULT, chainId: 1}]}}, display: {formats: {}}},
        'DEPLOYMENT_MISMATCH',
      ],
      ['not a descriptor', 'INVALID_DESCRIPTOR'],
      [{...one(signature, []), includes: 'common.json'}, 'INVALID_DESCRIPTOR'],
      [one(signature, [{format: 'raw', label: 'Amount', path: 'amountt'}]), 'INVALID_DESCRIPTOR'],
      [one(signature, [{label: 'Amount', path: 'amount'}]), 'INVALID_DESCRIPTOR'],
    ] as const) {
      const result = await call(VAULT, data, {resolvers: {descriptors: always(descriptor)}})
      invalid(result)
      assert.equal(only(result, 'ethereum.INVALID_DESCRIPTOR').params?.code, reason, JSON.stringify(descriptor))
    }
  })

  test('call data that does not decode as the descriptor`s function is not read by it', async () => {
    const descriptor = one(signature, [{format: 'raw', label: 'Amount', path: 'amount'}])
    invalid(await read(descriptor, data.slice(0, -2) as Hex))
    // A bool word of 2 is not a bool: the package's strict decoder refuses it before the reference sees it.
    const flag = one('act(bool flag)', [{format: 'raw', label: 'Flag', path: 'flag'}])
    const two = await read(flag, `${encode('act(bool flag)', [true]).slice(0, -2)}02` as Hex)
    invalid(two)
    assert.equal(only(two, 'ethereum.INVALID_DESCRIPTOR').params?.code, 'CALLDATA_DECODE_ERROR')
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

  test('typed data: bound by deployments, by domain, by domain separator; a verifying contract needed', async () => {
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
    const format = {
      'Order(address maker, uint256 amount)': {
        fields: [
          {format: 'addressName', label: 'Maker', path: 'maker'},
          {format: 'raw', label: 'Amount', path: 'amount', visible: 'optional'},
        ],
        intent: 'Order',
      },
    }
    const sign = (context: Record<string, unknown>, typed = order) =>
      clearSignTypedData(
        mainnet,
        typed,
        options({resolvers: {descriptors: always({context: {eip712: context}, display: {formats: format}})}})
      )
    const separator = `0x${Buffer.from(mainnet.hashDomain({domain: order.domain ?? {}})).toString('hex')}`

    for (const context of [
      {deployments: [{address: VAULT, chainId: 1}]},
      {domain: {name: 'Orders', verifyingContract: VAULT}},
      {domain: {chainId: '1', version: '1'}},
      {domainSeparator: separator},
    ]) {
      const result = await sign(context)
      assert.equal(result.source.kind, 'descriptor', JSON.stringify(context))
      assert.equal(fieldOf(result, 'data.maker', 'address').relation, 'self')
      // A key spaced otherwise is the same type; optional is behind "More details".
      assert.deepEqual(
        [fieldOf(result, 'data.amount', 'number').value, field(result, 'data.amount').secondary],
        [5n, true]
      )
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

    // Without a verifying contract, the reference cannot read it.
    const anywhere = await sign({domain: {name: 'Orders'}}, {...order, domain: {chainId: 1, name: 'Orders'}})
    assert.equal(only(anywhere, 'ethereum.INVALID_DESCRIPTOR').params?.code, 'UNSUPPORTED_DOMAIN')

    // Without a signer, a field that shows the signer cannot be read: the descriptor is not used.
    const sender = {Order: {fields: [{format: 'raw', label: 'From', path: '@.from'}], intent: 'Order'}}
    const unsigned = await clearSignTypedData(mainnet, order, {
      resolvers: {
        clock,
        descriptors: always({
          context: {eip712: {deployments: [{address: VAULT, chainId: 1}]}},
          display: {formats: {[`Order(address maker,uint256 amount)`]: sender.Order}},
        }),
      },
    })
    assert.equal(only(unsigned, 'ethereum.INVALID_DESCRIPTOR').params?.code, 'CONTAINER_MISSING_REQUIRED_PATH')
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
          [{descriptor: one(signature, [{format: 'raw', label: 'Amount', path: 'amount'}]), path: 'app/vault.json'}],
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

describe('ERC-7730 online, opted into', () => {
  const PATH = 'registry/vault/calldata-vault.json'
  const URL_BASE = 'https://raw.githubusercontent.com/ethereum/clear-signing-erc7730-registry/master/'
  const AUDITOR = '0x3846c3A30E62075Fa916216b35EF04B8F53931f6'
  const signature = 'stake(uint256 amount)'
  const data = encode(signature, [5n])
  const index = {calldataIndex: {[`eip155:1:${VAULT.toLowerCase()}`]: PATH}, typedDataIndex: {}}
  const served = one(signature, [{format: 'raw', label: 'Amount', path: 'amount'}])

  /** Runs `body` with `fetch` answering from `files` (404 otherwise), and the URLs it was asked for. */
  const offline = async (files: Readonly<Record<string, unknown>>, body: () => Promise<void>, fail = false) => {
    const asked: string[] = []
    const original = globalThis.fetch
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input)
      asked.push(url)

      if (fail) {
        throw new TypeError('offline')
      }

      const file = files[url.replace(URL_BASE, '')]

      return file === undefined
        ? new Response('Not found', {status: 404})
        : new Response(JSON.stringify(file), {headers: {'content-type': 'application/json'}, status: 200})
    }) as typeof fetch

    try {
      await body()
    } finally {
      globalThis.fetch = original
    }

    return asked
  }

  test('the registry on GitHub, through its index, when the app`s resolver has nothing; nothing fetched before', async () => {
    let result: ClearSigning | undefined
    let builtin: ClearSigning | undefined
    let app: ClearSigning | undefined
    const asked = await offline({[PATH]: served}, async () => {
      result = await call(VAULT, data, {sourcify: {registry: {index}}})
      builtin = await call(USDC, mainnet.erc20.transferData(OTHER, 1n), {sourcify: {registry: {index}}})
      app = await call(VAULT, data, {
        resolvers: {descriptors: createDescriptorResolver([{descriptor: served, path: 'app/vault.json'}])},
        sourcify: {registry: {index}},
      })
    })
    assert.deepEqual(asked, [`${URL_BASE}${PATH}`])
    assert.deepEqual(result?.source, {
      format: 'erc7730',
      id: PATH,
      kind: 'descriptor',
      publisher: 'ethereum/clear-signing-erc7730-registry',
    })
    assert.equal(result === undefined ? 0n : fieldOf(result, 'data.amount', 'number').value, 5n)
    assert.deepEqual(builtin?.source, {decoder: 'erc20', kind: 'builtin'})
    assert.deepEqual(app?.source, {format: 'erc7730', id: 'app/vault.json', kind: 'descriptor'})
  })

  test('the attestation policy: a descriptor no trusted auditor attests is ethereum.UNTRUSTED_DESCRIPTOR', async () => {
    let result: ClearSigning | undefined
    const reads: string[] = []
    const asked = await offline({[PATH]: served}, async () => {
      result = await call(VAULT, data, {
        sourcify: {
          attestations: {trustedAttesters: [AUDITOR]},
          chainClient: {
            call: async (_, request) => {
              reads.push(request.to)

              return `0x${'00'.repeat(32)}`
            },
          },
          registry: {index},
        },
      })
    })
    assert.deepEqual(asked, [
      `${URL_BASE}${PATH}`,
      `${URL_BASE}registry/vault/sigs/calldata-vault.eip155-1-${AUDITOR}.json`,
    ])
    assert.ok(result)
    assert.deepEqual(shape(result), ['UNKNOWN_CONTRACT_CALL high  contract', 'ethereum.UNTRUSTED_DESCRIPTOR medium  '])
    assert.equal(only(result, 'ethereum.UNTRUSTED_DESCRIPTOR').params?.code, 'NO_TRUSTED_ATTESTATION')
    assert.deepEqual(reads, [])
  })

  test('a registry that cannot be reached is RESOLVER_FAILED, and the call is shown raw', async () => {
    let result: ClearSigning | undefined
    await offline(
      {},
      async () => {
        result = await call(VAULT, data, {sourcify: {registry: {index}}})
      },
      true
    )
    assert.ok(result)
    assert.deepEqual(shape(result), ['RESOLVER_FAILED info  ', 'UNKNOWN_CONTRACT_CALL high  contract'])
    assert.deepEqual(only(result, 'RESOLVER_FAILED').params, {resolvers: 'descriptors'})
  })

  test('trusted tokens: the reference`s templates, never fetched; the built-ins still read their calls first', async () => {
    let transfer: ClearSigning | undefined
    let other: ClearSigning | undefined
    const asked = await offline({}, async () => {
      const sourcify = {trustedTokens: {1: {[VAULT]: 'erc20' as const}}}
      transfer = await call(VAULT, mainnet.erc20.transferData(OTHER, 1n), {sourcify})
      other = await call(VAULT, data, {sourcify})
    })
    assert.deepEqual(asked, [])
    assert.deepEqual(transfer?.source, {decoder: 'erc20', kind: 'builtin'})
    // The template has no format for this function: nothing describes it, and nothing is wrong with the template.
    assert.ok(other)
    assert.deepEqual(shape(other), ['UNKNOWN_CONTRACT_CALL high  contract'])
  })

  test('the online options are checked: an attestation policy needs a chain client', async () => {
    for (const sourcify of [
      {attestations: {trustedAttesters: [AUDITOR]}},
      {attestations: {trustedAttesters: ['nope']}, chainClient: {call: async () => '0x'}},
      {registry: 'github'},
      {registry: {index: {calldataIndex: {}}}},
      {trustedTokens: []},
      'github',
    ]) {
      await rejects(() => call(VAULT, data, {sourcify: sourcify as never}), 'INVALID_ARGUMENT')
    }
  })
})

import assert from 'node:assert/strict'
import {describe, test} from 'node:test'

import type {ClearSigning, NameInfo, Resolvers, TokenInfo} from '@hzblj/crypto-clear-sign'
import type {TypedDataDefinition} from '@hzblj/crypto-ethereum'

import {
  clearSignAuthorization,
  clearSignMessage,
  clearSignTransaction,
  clearSignTypedData,
  createDescriptorResolver,
  type Erc7730Descriptor,
  type EthereumClearSignOptions,
  type EthereumDescriptorQuery,
} from '../src'
import {
  codes,
  DAY,
  encode,
  fieldOf,
  inSeconds,
  mainnet,
  OTHER,
  options,
  request,
  SIGNER,
  UNISWAP_ROUTER,
  UNKNOWN_TOKEN,
  USDC,
} from './helpers'

const STAKING = '0x5555555555555555555555555555555555555555'
const ORDERS = '0x6666666666666666666666666666666666666666'
const DELEGATE = '0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B'

const stakeDescriptor: Erc7730Descriptor = {
  context: {contract: {deployments: [{address: STAKING, chainId: 1}]}},
  display: {
    formats: {
      'stake(uint256 amount,address to)': {
        fields: [
          {format: 'tokenAmount', label: 'Amount', params: {token: UNKNOWN_TOKEN}, path: 'amount'},
          {format: 'addressName', label: 'Beneficiary', path: 'to'},
        ],
        intent: 'Stake',
      },
    },
  },
  metadata: {owner: 'Staking Inc'},
}

const orderDescriptor: Erc7730Descriptor = {
  context: {eip712: {deployments: [{address: ORDERS, chainId: 1}]}},
  display: {
    formats: {
      'Order(address maker,uint256 amount,address token)': {
        fields: [
          {format: 'addressName', label: 'Maker', path: 'maker'},
          {format: 'tokenAmount', label: 'Amount', params: {tokenPath: 'token'}, path: 'amount'},
        ],
        intent: 'Place order',
      },
    },
  },
  metadata: {owner: 'Orders'},
}

const files = createDescriptorResolver([
  {descriptor: stakeDescriptor, path: 'app/calldata-stake.json'},
  {descriptor: orderDescriptor, path: 'app/eip712-order.json'},
])

const NAMES: Readonly<Record<string, NameInfo>> = {
  [DELEGATE.toLowerCase()]: {name: 'Smart account', relation: 'contract'},
  [SIGNER.toLowerCase()]: {name: 'Main', relation: 'own'},
  [UNISWAP_ROUTER.toLowerCase()]: {name: 'Uniswap', relation: 'contract'},
}
const TOKENS: Readonly<Record<string, TokenInfo>> = {[UNKNOWN_TOKEN.toLowerCase()]: {decimals: 18, symbol: 'TKN'}}

type Mode = 'offline' | 'sync' | 'async' | 'throwing' | 'nonsense'

const resolversFor = (mode: Mode): Resolvers<EthereumDescriptorQuery, Erc7730Descriptor> => {
  const answer = <Value>(value: Value) => (mode === 'async' ? Promise.resolve(value) : value)

  switch (mode) {
    case 'offline':
      return {}
    case 'sync':
    case 'async':
      return {
        descriptors: {descriptor: query => answer(files.descriptor(query))},
        names: {name: ({address}) => answer(NAMES[address.toLowerCase()])},
        tokens: {token: ({address}) => answer(TOKENS[address.toLowerCase()])},
      }
    case 'throwing':
      return {
        descriptors: {
          descriptor: () => {
            throw new Error('offline')
          },
        },
        names: {
          name: () => {
            throw new Error('offline')
          },
        },
        tokens: {token: () => Promise.reject(new Error('timeout'))},
      }
    case 'nonsense':
      return {
        descriptors: {descriptor: () => ({content: undefined, id: ''}) as never},
        names: {name: () => ({name: '', relation: 'friend'}) as unknown as NameInfo},
        tokens: {token: () => Promise.resolve({decimals: 300, symbol: ''})},
      }
  }
}

const SIGN_IN = [
  'app.example.com wants you to sign in with your Ethereum account:',
  SIGNER,
  '',
  'URI: https://app.example.com/login',
  'Version: 1',
  'Chain ID: 1',
  'Nonce: 32891756',
  'Issued At: 2026-10-27T11:00:00Z',
].join('\n')

const permit = (token: string): TypedDataDefinition => ({
  domain: {chainId: 1, name: 'Token', verifyingContract: token, version: '1'},
  message: {deadline: inSeconds(7n * DAY), nonce: 0n, owner: SIGNER, spender: UNISWAP_ROUTER, value: 2n ** 256n - 1n},
  primaryType: 'Permit',
  types: {
    Permit: [
      {name: 'owner', type: 'address'},
      {name: 'spender', type: 'address'},
      {name: 'value', type: 'uint256'},
      {name: 'nonce', type: 'uint256'},
      {name: 'deadline', type: 'uint256'},
    ],
  },
})

const order: TypedDataDefinition = {
  domain: {chainId: 1, name: 'Orders', verifyingContract: ORDERS},
  message: {amount: 10n ** 18n, maker: SIGNER, token: UNKNOWN_TOKEN},
  primaryType: 'Order',
  types: {
    Order: [
      {name: 'maker', type: 'address'},
      {name: 'amount', type: 'uint256'},
      {name: 'token', type: 'address'},
    ],
  },
}

/** Every export, with what the resolvers can change about it and the resolvers it asks. */
const EXPORTS: readonly {
  readonly name: string
  readonly run: (options: EthereumClearSignOptions) => Promise<ClearSigning>
  readonly asks: string
  readonly known: (result: ClearSigning) => void
}[] = [
  {
    asks: 'tokens, names',
    known: result => {
      assert.equal(fieldOf(result, 'spender', 'address').name, 'Uniswap')
      assert.equal(fieldOf(result, 'amount', 'amount').symbol, 'TKN')
      assert.deepEqual(codes(result), ['UNLIMITED_APPROVAL'])
    },
    name: 'clearSignTransaction (a built-in call)',
    run: entry =>
      clearSignTransaction(
        mainnet,
        request({data: encode('approve(address,uint256)', [UNISWAP_ROUTER, 2n ** 256n - 1n]), to: UNKNOWN_TOKEN}),
        entry
      ),
  },
  {
    asks: 'tokens, names, descriptors',
    known: result => {
      assert.deepEqual(result.source, {
        format: 'erc7730',
        id: 'app/calldata-stake.json',
        kind: 'descriptor',
      })
      assert.equal(result.intent.text, 'Stake')
      assert.equal(fieldOf(result, 'data.amount', 'amount').symbol, 'TKN')
      assert.deepEqual(codes(result), [])
    },
    name: 'clearSignTransaction (a call a descriptor reads)',
    run: entry =>
      clearSignTransaction(
        mainnet,
        request({data: encode('stake(uint256 amount,address to)', [10n ** 18n, OTHER]), to: STAKING}),
        entry
      ),
  },
  {
    asks: 'tokens, names',
    known: result => {
      assert.equal(fieldOf(result, 'spender', 'address').relation, 'contract')
      assert.equal(fieldOf(result, 'amount', 'amount').symbol, 'TKN')
      assert.equal(fieldOf(result, 'owner', 'address').name, 'Main')
      assert.deepEqual(codes(result), ['UNLIMITED_APPROVAL'])
    },
    name: 'clearSignTypedData (a permit)',
    run: entry => clearSignTypedData(mainnet, permit(UNKNOWN_TOKEN), entry),
  },
  {
    asks: 'tokens, names, descriptors',
    known: result => {
      assert.equal(result.source.kind, 'descriptor')
      assert.equal(fieldOf(result, 'data.amount', 'amount').symbol, 'TKN')
      assert.deepEqual(codes(result), [])
    },
    name: 'clearSignTypedData (typed data a descriptor reads)',
    run: entry => clearSignTypedData(mainnet, order, entry),
  },
  {
    asks: 'names',
    known: result => {
      assert.deepEqual(
        [fieldOf(result, 'account', 'address').relation, fieldOf(result, 'account', 'address').name],
        ['self', 'Main']
      )
      assert.deepEqual(codes(result), [])
    },
    name: 'clearSignMessage (a sign-in)',
    run: entry => clearSignMessage(mainnet, SIGN_IN, {...entry, origin: 'app.example.com'}),
  },
  {
    asks: 'tokens, names',
    known: result => {
      assert.equal(fieldOf(result, 'delegate', 'address').name, 'Smart account')
      assert.deepEqual(
        result.warnings.map(entry => [entry.code, entry.severity]),
        [['ASSET_OWNERSHIP_TRANSFER', 'high']]
      )
    },
    name: 'clearSignAuthorization',
    run: entry => clearSignAuthorization(mainnet, {address: DELEGATE, nonce: 1n}, entry),
  },
]

describe('resolvers, for every export', () => {
  for (const entry of EXPORTS) {
    test(entry.name, async () => {
      const results = Object.fromEntries(
        await Promise.all(
          (['offline', 'sync', 'async', 'throwing', 'nonsense'] as const).map(
            async mode => [mode, await entry.run(options({resolvers: resolversFor(mode)}))] as const
          )
        )
      ) as Record<Mode, ClearSigning>

      // Offline: what the package reads alone, without RESOLVER_FAILED.
      assert.ok(!codes(results.offline).includes('RESOLVER_FAILED'))

      // Sync or async, the same answer is the same result, and it is what the resolvers know.
      assert.deepEqual(results.async, results.sync)
      entry.known(results.sync)

      // A resolver that throws or rejects: the result still comes, as offline, with RESOLVER_FAILED naming which.
      const failed = results.throwing.warnings.find(warning => warning.code === 'RESOLVER_FAILED')
      assert.deepEqual([failed?.severity, failed?.action, failed?.params], ['info', [], {resolvers: entry.asks}])
      assert.deepEqual(codes(results.throwing).sort(), [...codes(results.offline), 'RESOLVER_FAILED'].sort())
      assert.equal(results.throwing.intent.code, results.offline.intent.code)

      // Nonsense counts as no answer, exactly as a throw does.
      assert.deepEqual(results.nonsense, results.throwing)
    })
  }

  test('a failing app resolver: the built-in list stands in, whether it threw or answered nonsense', async () => {
    const data = mainnet.erc20.transferData(OTHER, 1_500_000n)

    for (const token of [
      () => {
        throw new Error('offline')
      },
      () => ({decimals: 999, symbol: ''}),
      () => ({decimals: 6, symbol: 'US​DC'}),
    ]) {
      const result = await clearSignTransaction(
        mainnet,
        request({data, to: USDC}),
        options({resolvers: {tokens: {token: token as never}}})
      )
      assert.deepEqual(
        [fieldOf(result, 'amount', 'amount').symbol, fieldOf(result, 'amount', 'amount').decimals],
        ['USDC', 6]
      )
      assert.deepEqual(codes(result).sort(), ['RESOLVER_FAILED', 'UNKNOWN_DESTINATION'])
      assert.deepEqual(result.warnings.find(warning => warning.code === 'RESOLVER_FAILED')?.params, {
        resolvers: 'tokens',
      })
    }

    // Without the built-ins, the same failure leaves the token unknown.
    const alone = await clearSignTransaction(
      mainnet,
      request({data, to: USDC}),
      options({builtins: false, resolvers: {tokens: {token: () => ({decimals: 999, symbol: ''}) as never}}})
    )
    assert.deepEqual(codes(alone).sort(), ['RESOLVER_FAILED', 'UNKNOWN_DESTINATION', 'UNKNOWN_TOKEN'])
  })

  test('lookups are cached per address within a call, however it is spelled', async () => {
    let asked = 0
    const data = encode('multicall(bytes[] data)', [
      [mainnet.erc20.transferData(OTHER, 1n), mainnet.erc20.transferData(OTHER.toUpperCase().replace('0X', '0x'), 2n)],
    ])
    await clearSignTransaction(
      mainnet,
      request({data, to: USDC}),
      options({
        resolvers: {
          names: {
            name: ({address}) => {
              asked += address.toLowerCase() === OTHER ? 1 : 0

              return undefined
            },
          },
        },
      })
    )
    assert.equal(asked, 1)
  })

  test('the clock is read once per call: a clock that answers nonsense is the caller`s mistake', async () => {
    let reads = 0
    const permitted = await clearSignTypedData(
      mainnet,
      permit(USDC),
      options({
        resolvers: {
          clock: {
            now: () => {
              reads++

              return Date.UTC(2026, 9, 27, 12)
            },
          },
        },
      })
    )
    assert.equal(permitted.intent.code, 'intent.approve')
    assert.equal(reads, 1)

    await assert.rejects(
      () => clearSignMessage(mainnet, 'Hello', {resolvers: {clock: {now: () => Number.NaN}}}),
      error => (error as {code?: string}).code === 'INVALID_ARGUMENT'
    )
  })
})

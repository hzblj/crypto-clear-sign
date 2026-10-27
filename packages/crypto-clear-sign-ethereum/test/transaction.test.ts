import assert from 'node:assert/strict'
import {describe, test} from 'node:test'

import {isClearSignError, plainText} from '@hzblj/crypto-clear-sign'
import type {EthereumTransactionRequest, Hex} from '@hzblj/crypto-ethereum'
import {serializeTransaction as viemSerialize} from 'viem'

import {clearSignTransaction, type EthereumClearSignOptions} from '../src'
import {
  call,
  chainOf,
  codes,
  encode,
  fieldOf,
  mainnet,
  OTHER,
  only,
  options,
  rejects,
  request,
  SIGNER,
  sepolia,
  shape,
  UNISWAP_ROUTER,
  USDC,
  WETH,
} from './helpers'

const ETHER = 10n ** 18n
const GWEI = 10n ** 9n
// The helper's request: 100,000 gas at 20 gwei, so the most it can cost is 0.002 ETH.
const MAX_FEE = 100_000n * 20n * GWEI

const transfer = mainnet.erc20.transferData(OTHER, 1_500_000n)
const typed = {
  eip1559: request({data: transfer, to: USDC}),
  eip2930: {
    accessList: [{address: USDC, storageKeys: [`0x${'00'.repeat(31)}01` as Hex]}],
    data: transfer,
    gas: 100_000n,
    gasPrice: 20n * GWEI,
    nonce: 7,
    to: USDC,
    type: 'eip2930',
  },
  legacy: {data: transfer, gas: 100_000n, gasPrice: 20n * GWEI, nonce: 7, to: USDC, type: 'legacy'},
} satisfies Record<string, EthereumTransactionRequest>

describe('clearSignTransaction: types and fees', () => {
  test('legacy and EIP-2930: a gas price; EIP-1559: max fees per gas; each with its type and the call read the same', async () => {
    const legacy = await clearSignTransaction(mainnet, typed.legacy, options())
    const eip2930 = await clearSignTransaction(mainnet, typed.eip2930, options())
    const eip1559 = await clearSignTransaction(mainnet, typed.eip1559, options())

    for (const result of [legacy, eip2930, eip1559]) {
      assert.equal(result.kind, 'transaction')
      assert.deepEqual(result.chain, {family: 'ethereum', id: 'eip155:1', name: 'Ethereum'})
      assert.equal(result.intent.code, 'intent.send')
      assert.deepEqual(result.source, {decoder: 'erc20', kind: 'builtin'})
      assert.equal(fieldOf(result, 'maxFee', 'amount').value, MAX_FEE)
      assert.equal(fieldOf(result, 'maxFee', 'amount').secondary, undefined)
      assert.deepEqual(
        [fieldOf(result, 'gasLimit', 'number').value, fieldOf(result, 'gasLimit', 'number').unit?.code],
        [100_000n, 'ethereum.unit.gas']
      )
      assert.equal(fieldOf(result, 'nonce', 'number').value, 7n)
      assert.deepEqual(codes(result), ['UNKNOWN_DESTINATION'])
    }

    assert.deepEqual(
      result_ids(legacy),
      ['recipient', 'amount', 'token', 'maxFee', 'gasLimit', 'gasPrice', 'nonce', 'transactionType'],
      'legacy'
    )
    assert.equal(fieldOf(legacy, 'gasPrice', 'amount').value, 20n * GWEI)
    assert.equal(fieldOf(legacy, 'transactionType', 'text').value, 'Legacy')

    assert.equal(fieldOf(eip2930, 'transactionType', 'text').value, 'EIP-2930')
    const list = fieldOf(eip2930, 'accessList', 'list')
    assert.equal(list.secondary, true)
    assert.deepEqual(
      list.items.map(item => item.id),
      ['access-0']
    )

    assert.deepEqual(result_ids(eip1559), [
      'recipient',
      'amount',
      'token',
      'maxFee',
      'gasLimit',
      'maxFeePerGas',
      'maxPriorityFeePerGas',
      'nonce',
      'transactionType',
    ])
    assert.equal(fieldOf(eip1559, 'maxFeePerGas', 'amount').value, 20n * GWEI)
    assert.equal(fieldOf(eip1559, 'maxPriorityFeePerGas', 'amount').value, GWEI)
    assert.equal(fieldOf(eip1559, 'transactionType', 'text').value, 'EIP-1559')
    // The fee's parts are behind "More details".
    for (const id of ['gasLimit', 'maxFeePerGas', 'maxPriorityFeePerGas', 'nonce', 'transactionType']) {
      assert.equal(
        fieldOf(
          eip1559,
          id,
          id === 'gasLimit' || id === 'nonce' ? 'number' : id === 'transactionType' ? 'text' : 'amount'
        ).secondary,
        true,
        id
      )
    }
  })

  test('type 4 (EIP-7702): max fees per gas, its authorizations as actions before its call', async () => {
    const authorization = {
      address: OTHER,
      chainId: 1,
      nonce: 8n,
      signature: `0x${'11'.repeat(32)}${'22'.repeat(32)}1b` as Hex,
    }
    const result = await clearSignTransaction(
      mainnet,
      {
        ...request({data: transfer, to: USDC}),
        authorizationList: [authorization],
        type: 'eip7702',
      } as EthereumTransactionRequest,
      options()
    )
    assert.equal(fieldOf(result, 'transactionType', 'text').value, 'EIP-7702')
    assert.equal(fieldOf(result, 'maxFee', 'amount').value, MAX_FEE)
    assert.deepEqual(
      result.actions.map(action => [action.source, action.path]),
      [
        [{decoder: 'eip7702', kind: 'builtin'}, [0]],
        [{decoder: 'erc20', kind: 'builtin'}, [1]],
      ]
    )
    assert.deepEqual(result.source, {decoder: 'eip7702', kind: 'builtin'})
  })

  test('bytes, hex and a request give the same result, and the bytes are what viem serializes', async () => {
    const bytes = mainnet.serializeTransaction(typed.eip1559)
    assert.equal(
      bytes,
      viemSerialize({
        chainId: 1,
        data: transfer,
        gas: 100_000n,
        maxFeePerGas: 20n * GWEI,
        maxPriorityFeePerGas: GWEI,
        nonce: 7,
        to: USDC,
        type: 'eip1559',
      })
    )
    const fromRequest = await clearSignTransaction(mainnet, typed.eip1559, options())
    const fromHex = await clearSignTransaction(mainnet, bytes, options())
    const fromBytes = await clearSignTransaction(
      mainnet,
      Uint8Array.from(Buffer.from(bytes.slice(2), 'hex')),
      options()
    )
    assert.deepEqual(fromHex, fromRequest)
    assert.deepEqual(fromBytes, fromRequest)
  })

  test('a native transfer: recipient and amount, UNKNOWN_DESTINATION to a stranger, nothing to a known address', async () => {
    const result = await call(OTHER, '0x', {}, {value: ETHER})
    assert.equal(result.intent.code, 'intent.send')
    assert.deepEqual(result.source, {decoder: 'native-transfer', kind: 'builtin'})
    assert.deepEqual(
      [fieldOf(result, 'amount', 'amount').value, fieldOf(result, 'amount', 'amount').symbol],
      [ETHER, 'ETH']
    )
    assert.equal(fieldOf(result, 'amount', 'amount').baseUnit, 'wei')
    assert.equal(fieldOf(result, 'amount', 'amount').decimals, 18)
    assert.deepEqual(shape(result), ['UNKNOWN_DESTINATION low  recipient'])
    assert.equal(result.risk, 'low')

    const toSelf = await call(SIGNER, '0x', {}, {value: ETHER})
    assert.equal(fieldOf(toSelf, 'recipient', 'address').relation, 'self')
    assert.deepEqual(codes(toSelf), [])

    const contact = await call(
      OTHER,
      '0x',
      {resolvers: {names: {name: () => ({name: 'Alice', relation: 'contact'})}}},
      {value: ETHER}
    )
    assert.deepEqual(
      [fieldOf(contact, 'recipient', 'address').relation, fieldOf(contact, 'recipient', 'address').name],
      ['contact', 'Alice']
    )
    assert.deepEqual(codes(contact), [])
    assert.equal(contact.risk, 'none')

    // Nothing sent and nothing called is still a transfer, of nothing.
    const empty = await call(OTHER, '0x')
    assert.equal(fieldOf(empty, 'amount', 'amount').value, 0n)
  })
})

/** The ids of the root's fields, in order. */
const result_ids = (result: {readonly fields: readonly {readonly id?: string}[]}) =>
  result.fields.map(field => field.id)

describe('clearSignTransaction: HIGH_FEE', () => {
  test('by ratio: more than the ether it sends (1 by default), never when it sends none', async () => {
    const raised = await call(OTHER, '0x', {}, {value: MAX_FEE - 1n})
    assert.deepEqual(
      [only(raised, 'HIGH_FEE').severity, only(raised, 'HIGH_FEE').fields, only(raised, 'HIGH_FEE').action],
      ['medium', ['maxFee'], []]
    )
    // Near miss: a fee equal to what is sent.
    assert.ok(!codes(await call(OTHER, '0x', {}, {value: MAX_FEE})).includes('HIGH_FEE'))
    // A call that sends nothing has no ratio.
    assert.ok(!codes(await call(USDC, transfer)).includes('HIGH_FEE'))

    // ratio 0.5: the fee may be half of what is sent.
    const half = {highFee: {ratio: 0.5}}
    assert.ok(codes(await call(OTHER, '0x', half, {value: 2n * MAX_FEE - 1n})).includes('HIGH_FEE'))
    assert.ok(!codes(await call(OTHER, '0x', half, {value: 2n * MAX_FEE})).includes('HIGH_FEE'))
  })

  test('by absolute value: above `above` wei, whatever is sent', async () => {
    assert.ok(codes(await call(USDC, transfer, {highFee: {above: MAX_FEE - 1n}})).includes('HIGH_FEE'))
    // Near miss: exactly the limit.
    assert.ok(!codes(await call(USDC, transfer, {highFee: {above: MAX_FEE}})).includes('HIGH_FEE'))
    // Both limits: either raises it, once.
    const both = await call(OTHER, '0x', {highFee: {above: 0n, ratio: 1}}, {value: 1n})
    only(both, 'HIGH_FEE')
  })
})

describe('clearSignTransaction: what is not a plain call', () => {
  test('contract creation: deploy, the init code raw, ethereum.CONTRACT_CREATION (info), the value a field', async () => {
    const init = '0x6080604052348015600f57600080fd5b50' as Hex
    const result = await clearSignTransaction(mainnet, request({data: init, to: null}), options())
    assert.equal(result.intent.code, 'intent.deploy')
    assert.deepEqual(result.source, {decoder: 'contract-creation', kind: 'builtin'})
    assert.deepEqual(
      result.raw.map(field => [field.id, field.kind === 'raw' ? field.value : undefined]),
      [['data', init]]
    )
    assert.deepEqual(shape(result), ['ethereum.CONTRACT_CREATION info  '])
    assert.equal(result.risk, 'info')

    const funded = await clearSignTransaction(mainnet, request({data: init, to: null, value: ETHER}), options())
    assert.equal(fieldOf(funded, 'value', 'amount').value, ETHER)
    assert.deepEqual(shape(funded), ['ethereum.CONTRACT_CREATION info  value'])
  })

  test('ether with a call that takes none: ethereum.UNEXPECTED_VALUE; with a payable or unknown one: only the value', async () => {
    const token = await call(USDC, transfer, {}, {value: ETHER})
    assert.equal(fieldOf(token, 'value', 'amount').value, ETHER)
    assert.deepEqual(
      [only(token, 'ethereum.UNEXPECTED_VALUE').severity, only(token, 'ethereum.UNEXPECTED_VALUE').fields],
      ['medium', ['value']]
    )

    // Near misses: WETH's deposit takes ether (and shows it as its amount), a multicall may, an unknown call may.
    const wrap = await call(WETH, encode('deposit()'), {}, {value: ETHER})
    assert.ok(!codes(wrap).includes('ethereum.UNEXPECTED_VALUE'))
    assert.equal(wrap.fields.filter(field => field.kind === 'amount' && field.value === ETHER).length, 1)
    const multicall = await call(UNISWAP_ROUTER, encode('multicall(bytes[] data)', [[]]), {}, {value: ETHER})
    assert.ok(!codes(multicall).includes('ethereum.UNEXPECTED_VALUE'))
    assert.equal(fieldOf(multicall, 'value', 'amount').value, ETHER)
    const unknown = await call(OTHER, '0x12345678', {}, {value: ETHER})
    assert.deepEqual(codes(unknown).sort(), ['UNKNOWN_CONTRACT_CALL'])
    assert.equal(fieldOf(unknown, 'value', 'amount').value, ETHER)
  })

  test('an unknown call: its contract, value and call data raw, UNKNOWN_CONTRACT_CALL (high)', async () => {
    const data = encode('stake(uint256 amount,address to)', [5n, OTHER])
    const result = await call(UNISWAP_ROUTER, data)
    assert.equal(result.intent.code, 'intent.contractCall')
    assert.deepEqual(result.source, {kind: 'unknown'})
    assert.deepEqual(
      result.raw.map(field => [field.id, field.kind === 'raw' ? field.value : undefined]),
      [['data', data]]
    )
    assert.equal(fieldOf(result, 'contract', 'address').value, UNISWAP_ROUTER)
    assert.deepEqual(shape(result), ['UNKNOWN_CONTRACT_CALL high  contract'])
    assert.equal(result.risk, 'high')
  })

  test('call data shorter than a selector is an unknown call, not a transfer and not an error', async () => {
    for (const data of ['0x00', '0x1234', '0xa9059c'] as const) {
      const result = await call(USDC, data)
      assert.equal(result.intent.code, 'intent.contractCall', data)
      assert.deepEqual(codes(result), ['UNKNOWN_CONTRACT_CALL'])
      assert.deepEqual(
        result.raw.map(field => (field.kind === 'raw' ? field.value : undefined)),
        [data]
      )
    }
  })

  test('a selector a built-in knows with arguments that do not decode falls through to the raw call', async () => {
    // transfer(address,uint256) with a dirty address word, and with the amount cut short.
    const dirty = `0xa9059cbb${'ff'.repeat(12)}${'22'.repeat(20)}${'00'.repeat(31)}01` as Hex
    const short = transfer.slice(0, -2) as Hex

    for (const data of [dirty, short]) {
      const result = await call(USDC, data)
      assert.deepEqual(result.source, {kind: 'unknown'})
      assert.deepEqual(codes(result), ['UNKNOWN_CONTRACT_CALL'])
    }
  })
})

describe('clearSignTransaction: errors and options', () => {
  test('bytes the adapter refuses: INVALID_INPUT, with its error as the cause and nothing of the payload quoted', async () => {
    for (const bytes of ['0x02ff', '0x', '0xf86c', `${mainnet.serializeTransaction(typed.eip1559)}00`] as const) {
      await assert.rejects(
        () => clearSignTransaction(mainnet, bytes, options()),
        error =>
          isClearSignError(error, 'INVALID_INPUT') &&
          (error.cause as {code?: string} | undefined)?.code !== undefined &&
          (bytes.length < 6 || !error.message.includes(bytes.slice(2, 10))),
        bytes
      )
    }
  })

  test('another chain: CHAIN_MISMATCH, from bytes and from a request', async () => {
    await rejects(
      () => clearSignTransaction(mainnet, sepolia.serializeTransaction(typed.eip1559), options()),
      'CHAIN_MISMATCH'
    )
    await rejects(() => clearSignTransaction(mainnet, {...typed.eip1559, chainId: 5}, options()), 'CHAIN_MISMATCH')
    await rejects(
      () => clearSignTransaction(mainnet, sepolia.serializeTransaction(typed.legacy), options()),
      'CHAIN_MISMATCH'
    )
    // The same transaction on its own chain reads.
    assert.equal((await clearSignTransaction(sepolia, typed.legacy, options())).chain.id, 'eip155:11155111')
  })

  test('a blob transaction or an unknown type: UNSUPPORTED', async () => {
    await rejects(() => clearSignTransaction(mainnet, '0x03c0', options()), 'UNSUPPORTED')
    await rejects(() => clearSignTransaction(mainnet, '0x05c0', options()), 'UNSUPPORTED')
  })

  test('options out of range: INVALID_ARGUMENT, before anything is read', async () => {
    const bad: EthereumClearSignOptions[] = [
      {nativeCurrency: {decimals: 18, symbol: ''}},
      {nativeCurrency: {decimals: 18, symbol: 'E‮TH'}},
      {nativeCurrency: {decimals: 18, symbol: 'X'.repeat(33)}},
      {nativeCurrency: {decimals: 256, symbol: 'ETH'}},
      {nativeCurrency: {decimals: 1.5, symbol: 'ETH'}},
      {highFee: {ratio: 0}},
      {highFee: {ratio: -1}},
      {highFee: {ratio: Number.NaN}},
      {highFee: {ratio: Number.POSITIVE_INFINITY}},
      {highFee: {above: -1n}},
      {highFee: {above: 5 as unknown as bigint}},
      {signer: 'alice.eth'},
      {signer: `0x${'1'.repeat(39)}`},
      {origin: 'a'.repeat(254)},
      {origin: 42 as unknown as string},
      null as unknown as EthereumClearSignOptions,
    ]

    for (const entry of bad) {
      await assert.rejects(
        () => clearSignTransaction(mainnet, '0xnot-even-hex' as Hex, entry),
        error => isClearSignError(error, 'INVALID_ARGUMENT'),
        JSON.stringify(entry, (_key, value) => (typeof value === 'bigint' ? `${value}n` : value))
      )
    }
  })
})

describe('clearSignTransaction: the native currency and the built-ins', () => {
  test('nativeCurrency names the chain`s asset in every native amount', async () => {
    const polygon = chainOf(137, 'Polygon')
    const result = await clearSignTransaction(
      polygon,
      request({to: OTHER, value: 2n * ETHER}),
      options({nativeCurrency: {decimals: 18, symbol: 'POL'}})
    )
    assert.deepEqual(result.chain, {family: 'ethereum', id: 'eip155:137', name: 'Polygon'})
    assert.deepEqual(
      [fieldOf(result, 'amount', 'amount').symbol, fieldOf(result, 'maxFee', 'amount').symbol],
      ['POL', 'POL']
    )

    // Six decimals: what the field says, exactly.
    const six = await call(OTHER, '0x', {nativeCurrency: {decimals: 6, symbol: 'USDG'}}, {value: 1_500_000n})
    assert.deepEqual(
      [fieldOf(six, 'amount', 'amount').decimals, fieldOf(six, 'amount', 'amount').value],
      [6, 1_500_000n]
    )
  })

  test('builtins: false leaves the token list and contract names to the app', async () => {
    const withBuiltins = await call(USDC, transfer)
    assert.equal(fieldOf(withBuiltins, 'amount', 'amount').symbol, 'USDC')
    assert.ok(!codes(withBuiltins).includes('UNKNOWN_TOKEN'))

    const without = await call(USDC, transfer, {builtins: false})
    assert.equal(fieldOf(without, 'amount', 'amount').symbol, undefined)
    assert.equal(fieldOf(without, 'token', 'address').relation, 'unknown')
    assert.ok(codes(without).includes('UNKNOWN_TOKEN'))

    // The app's own answer still counts.
    const app = await call(USDC, transfer, {
      builtins: false,
      resolvers: {tokens: {token: () => ({decimals: 6, symbol: 'USDC'})}},
    })
    assert.equal(fieldOf(app, 'amount', 'amount').symbol, 'USDC')

    // Permit2 and Multicall3 are named by the package unless told not to.
    const lockdown = encode('lockdown((address token,address spender)[] approvals)', [[]])
    const permit2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
    assert.equal(
      fieldOf(await call(OTHER, encode('multicall(bytes[] data)', [[]])), 'contract', 'address').relation,
      'unknown'
    )
    assert.equal(
      fieldOf(await call(WETH, encode('withdraw(uint256 amount)', [1n])), 'token', 'address').name,
      'Wrapped Ether'
    )
    assert.equal((await call(permit2, lockdown)).source.kind, 'builtin')
    assert.equal(
      fieldOf(await call(WETH, encode('withdraw(uint256 amount)', [1n]), {builtins: false}), 'token', 'address')
        .relation,
      'unknown'
    )
  })
})

describe('clearSignTransaction: plainText', () => {
  test('an unlimited USDC approval to a stranger reads as a person would say it', async () => {
    const result = await call(
      USDC,
      encode('approve(address spender,uint256 amount)', [UNISWAP_ROUTER, 2n ** 256n - 1n]),
      {},
      {nonce: 12}
    )
    assert.equal(
      plainText(result),
      [
        'Approve: Allow 0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45 to spend an unlimited amount of USDC',
        'Transaction on Ethereum. Risk: critical.',
        'Spender: 0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45, unknown address',
        'Amount: Unlimited USDC',
        'Token: USD Coin (0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48), token',
        'Max fee: 0.002 ETH',
        'Gas limit: 100000 gas',
        'Max fee per gas: 0.00000002 ETH',
        'Max priority fee per gas: 0.000000001 ETH',
        'Nonce: 12',
        'Transaction type: EIP-1559',
        'Understood by: built-in decoder (erc20)',
        'Warnings:',
        '  - critical: The spender can take all of this token you hold, now or later, without asking again. (UNLIMITED_APPROVAL, about Amount, Spender)',
        '  - high: The spender is not a contract or an account the wallet knows. Most thefts start with such an approval. (ethereum.UNKNOWN_SPENDER, about Spender)',
      ].join('\n')
    )
  })
})

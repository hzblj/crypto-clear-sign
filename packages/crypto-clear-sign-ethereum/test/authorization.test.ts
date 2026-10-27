import assert from 'node:assert/strict'
import {describe, test} from 'node:test'

import {type NameInfo, plainText, warningsAt} from '@hzblj/crypto-clear-sign'
import type {EthereumAuthorization, EthereumTransactionRequest, Hex} from '@hzblj/crypto-ethereum'
import {concat, encodeAbiParameters, numberToHex, pad, parseAbiParameters, serializeTransaction} from 'viem'
import {privateKeyToAddress, signAuthorization} from 'viem/accounts'

import {clearSignAuthorization, clearSignTransaction, type EthereumClearSignOptions} from '../src'
import {at, codes, encode, fieldOf, mainnet, options, rejects, request, shape, UNISWAP_ROUTER, USDC} from './helpers'

// Anvil's well-known development keys: never hold anything with them.
const ACCOUNT_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const SPONSOR_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
const ACCOUNT = privateKeyToAddress(ACCOUNT_KEY)
const SPONSOR = privateKeyToAddress(SPONSOR_KEY)
// MetaMask's EIP7702StatelessDeleGator.
const DELEGATE = '0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B'
const ZERO = '0x0000000000000000000000000000000000000000'

const named = (relation: NameInfo['relation']): EthereumClearSignOptions => ({
  resolvers: {
    names: {
      name: ({address}) =>
        address.toLowerCase() === DELEGATE.toLowerCase() ? {name: 'MetaMask smart account', relation} : undefined,
    },
  },
})

/** An authorization signed by viem, as a transaction's list carries it (65 bytes, v as the y parity). */
const signed = async (key: Hex, address: string, nonce: number, chainId = 1): Promise<EthereumAuthorization> => {
  const signature = await signAuthorization({address: address as Hex, chainId, nonce, privateKey: key})

  return {
    address,
    chainId,
    nonce: BigInt(nonce),
    signature: concat([
      pad(signature.r, {size: 32}),
      pad(signature.s, {size: 32}),
      numberToHex(signature.yParity ?? 0, {size: 1}),
    ]),
  }
}

describe('clearSignAuthorization', () => {
  test('an unknown delegate: ASSET_OWNERSHIP_TRANSFER, critical', async () => {
    const result = await clearSignAuthorization(mainnet, {address: DELEGATE, nonce: 7n}, options())
    assert.equal(result.kind, 'authorization')
    assert.deepEqual(result.source, {decoder: 'eip7702', kind: 'builtin'})
    assert.equal(result.intent.code, 'intent.delegate')
    assert.equal(result.summary?.code, 'summary.delegate')
    assert.deepEqual(
      result.fields.map(field => field.id),
      ['authority', 'delegate', 'chainId', 'nonce']
    )
    assert.equal(fieldOf(result, 'authority', 'address').relation, 'self')
    assert.equal(fieldOf(result, 'chainId', 'number').value, 1)
    assert.equal(fieldOf(result, 'nonce', 'number').value, 7n)
    assert.deepEqual(shape(result), ['ASSET_OWNERSHIP_TRANSFER critical  delegate'])
    assert.equal(result.risk, 'critical')
  })

  test('a delegate the names resolver knows as a contract or the user`s own: high; as a contact: still critical', async () => {
    for (const relation of ['contract', 'own'] as const) {
      const result = await clearSignAuthorization(mainnet, {address: DELEGATE, nonce: 7n}, options(named(relation)))
      assert.equal(fieldOf(result, 'delegate', 'address').name, 'MetaMask smart account')
      assert.deepEqual(shape(result), ['ASSET_OWNERSHIP_TRANSFER high  delegate'], relation)
    }

    const contact = await clearSignAuthorization(mainnet, {address: DELEGATE, nonce: 7n}, options(named('contact')))
    assert.deepEqual(shape(contact), ['ASSET_OWNERSHIP_TRANSFER critical  delegate'])
  })

  test('the zero address clears a delegation: no delegate, no warning', async () => {
    const result = await clearSignAuthorization(mainnet, {address: ZERO, nonce: 7n}, options())
    assert.equal(result.intent.code, 'ethereum.intent.undelegate')
    assert.equal(result.summary?.code, 'ethereum.summary.undelegate')
    assert.deepEqual(
      result.fields.map(field => field.id),
      ['authority', 'chainId', 'nonce']
    )
    assert.deepEqual(codes(result), [])
  })

  test('chain 0: ALL_CHAINS, critical for a delegation and high for clearing one', async () => {
    const all = await clearSignAuthorization(mainnet, {address: DELEGATE, chainId: 0, nonce: 7n}, options())
    assert.equal(fieldOf(all, 'chainId', 'number').value, 0)
    assert.deepEqual(shape(all), ['ALL_CHAINS critical  chainId', 'ASSET_OWNERSHIP_TRANSFER critical  delegate'])

    const clear = await clearSignAuthorization(mainnet, {address: ZERO, chainId: 0n, nonce: 7n}, options())
    assert.deepEqual(shape(clear), ['ALL_CHAINS high  chainId'])

    // Near miss: this chain's id, given.
    assert.deepEqual(
      codes(await clearSignAuthorization(mainnet, {address: ZERO, chainId: 1, nonce: 7n}, options())),
      []
    )
  })

  test('another chain: CHAIN_MISMATCH; an address or nonce the adapter refuses: INVALID_INPUT', async () => {
    await rejects(
      () => clearSignAuthorization(mainnet, {address: DELEGATE, chainId: 10, nonce: 7n}, options()),
      'CHAIN_MISMATCH'
    )

    for (const bad of [
      {address: 'nope', nonce: 1n},
      {address: '0x63C0c19a282a1B52b07dD5a65b58948A07DAE32B', nonce: 1n},
      {address: DELEGATE, nonce: -1n},
      {address: DELEGATE, nonce: 2n ** 64n},
    ]) {
      await rejects(() => clearSignAuthorization(mainnet, bad, options()), 'INVALID_INPUT')
    }
  })

  test('without a signer, there is no authority to show', async () => {
    const result = await clearSignAuthorization(mainnet, {address: DELEGATE, nonce: 7n}, {resolvers: {}})
    assert.ok(!result.fields.some(field => field.id === 'authority'))
    assert.deepEqual(codes(result), ['ASSET_OWNERSHIP_TRANSFER'])
  })

  test('plainText: a delegation reads as a person would say it', async () => {
    const result = await clearSignAuthorization(mainnet, {address: DELEGATE, nonce: 7n}, options(named('contract')))
    assert.equal(
      plainText(result),
      [
        'Delegate account: Let MetaMask smart account run code as your account',
        'Authorization on Ethereum. Risk: high.',
        'Authorizing account: 0x1111111111111111111111111111111111111111, this account',
        'Delegate: MetaMask smart account (0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B), known contract',
        'Chain: 1',
        'Nonce: 7',
        'Understood by: built-in decoder (eip7702)',
        'Warnings:',
        '  - high: This hands control of assets, or of the account itself, to someone else, who needs no further signature to use it. (ASSET_OWNERSHIP_TRANSFER, about Delegate)',
      ].join('\n')
    )
  })
})

describe('EIP-7702 transactions', () => {
  const batch = encode('execute(bytes32 mode,bytes executionData)', [
    pad('0x01', {dir: 'right', size: 32}),
    encodeAbiParameters(parseAbiParameters('(address target,uint256 value,bytes data)[]'), [
      [
        {
          data: encode('approve(address spender,uint256 amount)', [UNISWAP_ROUTER, 5_000_000n]),
          target: USDC,
          value: 0n,
        },
        {data: encode('swap(uint256 amount)', [5_000_000n]), target: UNISWAP_ROUTER, value: 0n},
      ],
    ]),
  ])

  const type4 = (authorizationList: readonly EthereumAuthorization[], to: string, data: Hex, nonce = 7) =>
    ({...request({data, nonce, to}), authorizationList, type: 'eip7702'}) as EthereumTransactionRequest

  test('a really signed batch delegation: the delegation, then the batch it runs, each with its own risk', async () => {
    // The account sends it itself: the authorization's nonce is the transaction's plus one.
    const authorization = await signed(ACCOUNT_KEY, DELEGATE, 8)
    const transaction = type4([authorization], ACCOUNT, batch)
    const bytes = mainnet.serializeTransaction(transaction)

    // The adapter's bytes are viem's, for the same unsigned transaction.
    const viemSigned = await signAuthorization({address: DELEGATE, chainId: 1, nonce: 8, privateKey: ACCOUNT_KEY})
    assert.equal(
      bytes,
      serializeTransaction({
        authorizationList: [viemSigned],
        chainId: 1,
        data: batch,
        gas: 100_000n,
        maxFeePerGas: 20_000_000_000n,
        maxPriorityFeePerGas: 1_000_000_000n,
        nonce: 7,
        to: ACCOUNT,
        type: 'eip7702',
      })
    )

    const result = await clearSignTransaction(mainnet, bytes, options({signer: ACCOUNT}))
    assert.deepEqual(result.source, {decoder: 'eip7702', kind: 'builtin'})
    // The delegation is the headline: it is what hands the account over.
    assert.deepEqual([result.intent.code, result.summary?.code], ['intent.delegate', 'summary.delegate'])
    assert.deepEqual(
      result.actions.map(action => [action.path, action.source]),
      [
        [[0], {decoder: 'eip7702', kind: 'builtin'}],
        [[1], {decoder: 'smart-account', kind: 'builtin'}],
      ]
    )
    // The authority is recovered from the signature: the signer.
    const authority = fieldOf(at(result, [0]), 'authority', 'address')
    assert.deepEqual([authority.value, authority.relation], [ACCOUNT, 'self'])
    assert.equal(fieldOf(at(result, [1]), 'contract', 'address').relation, 'self')
    assert.deepEqual(
      at(result, [1]).actions.map(action => [action.path, action.intent.code, action.risk]),
      [
        [[1, 0], 'intent.approve', 'high'],
        [[1, 1], 'intent.contractCall', 'high'],
      ]
    )
    assert.deepEqual(shape(result), [
      'ASSET_OWNERSHIP_TRANSFER critical 0 delegate',
      'UNKNOWN_CONTRACT_CALL high 1.1 contract',
      'ethereum.UNKNOWN_SPENDER high 1.0 spender',
    ])
    assert.equal(result.risk, 'critical')
    assert.deepEqual(
      result.fields.map(field => field.id),
      ['maxFee', 'gasLimit', 'maxFeePerGas', 'maxPriorityFeePerGas', 'nonce', 'transactionType']
    )
  })

  test('a sponsored authorization (another account`s, in the signer`s transaction) puts nothing of the signer`s at risk', async () => {
    const authorization = await signed(ACCOUNT_KEY, DELEGATE, 0)
    const result = await clearSignTransaction(
      mainnet,
      type4([authorization], ACCOUNT, batch),
      options({signer: SPONSOR})
    )
    const sponsored = at(result, [0])
    assert.deepEqual(
      [fieldOf(sponsored, 'authority', 'address').value, fieldOf(sponsored, 'authority', 'address').relation],
      [ACCOUNT, 'unknown']
    )
    assert.deepEqual(warningsAt(result, [0]), [])
    assert.ok(!codes(result).includes('ASSET_OWNERSHIP_TRANSFER'))
    // Its summary, and the root's, name the account it delegates: it is not the signer's.
    assert.deepEqual(
      [sponsored.summary?.code, sponsored.summary?.params],
      ['ethereum.summary.delegateAccount', {account: ACCOUNT, delegate: DELEGATE}]
    )
    assert.equal(result.summary?.code, 'ethereum.summary.delegateAccount')
    const clearing = await clearSignTransaction(
      mainnet,
      type4([await signed(ACCOUNT_KEY, ZERO, 0)], ACCOUNT, batch),
      options({signer: SPONSOR})
    )
    assert.deepEqual(
      [at(clearing, [0]).summary?.code, at(clearing, [0]).summary?.params],
      ['ethereum.summary.undelegateAccount', {account: ACCOUNT}]
    )
    // The batch is the account's, not the sponsor's.
    assert.equal(fieldOf(at(result, [1]), 'contract', 'address').relation, 'unknown')

    // Near miss: the sponsor's own authorization in the same list is the sponsor's risk.
    const both = await clearSignTransaction(
      mainnet,
      type4([authorization, await signed(SPONSOR_KEY, DELEGATE, 8)], ACCOUNT, batch),
      options({signer: SPONSOR})
    )
    assert.deepEqual(warningsAt(both, [0]), [])
    assert.deepEqual(
      warningsAt(both, [1]).map(entry => entry.code),
      ['ASSET_OWNERSHIP_TRANSFER']
    )
    assert.equal(at(both, [1]).summary?.code, 'summary.delegate')
  })

  test('a delegation alone (no call, no value): only the authorizations; a chain 0 one is ALL_CHAINS', async () => {
    const result = await clearSignTransaction(
      mainnet,
      type4([await signed(ACCOUNT_KEY, DELEGATE, 8), await signed(ACCOUNT_KEY, ZERO, 9, 0)], ACCOUNT, '0x'),
      options({signer: ACCOUNT})
    )
    assert.equal(result.actions.length, 2)
    assert.equal(result.intent.code, 'intent.batch')
    assert.deepEqual(result.summary?.params, {count: 2})
    assert.equal(at(result, [1]).intent.code, 'ethereum.intent.undelegate')
    assert.deepEqual(shape(result), ['ALL_CHAINS high 1 chainId', 'ASSET_OWNERSHIP_TRANSFER critical 0 delegate'])

    const one = await clearSignTransaction(
      mainnet,
      type4([await signed(ACCOUNT_KEY, DELEGATE, 8)], ACCOUNT, '0x'),
      options({signer: ACCOUNT})
    )
    assert.equal(one.intent.code, 'intent.delegate')
  })

  test('an authorization for another chain in the list: the adapter refuses the transaction', async () => {
    await rejects(
      () => clearSignTransaction(mainnet, type4([{...OTHER_CHAIN}], ACCOUNT, '0x'), options()),
      'CHAIN_MISMATCH'
    )
  })
})

const OTHER_CHAIN: EthereumAuthorization = {
  address: DELEGATE,
  chainId: 10,
  nonce: 1n,
  signature: `0x${'11'.repeat(32)}${'22'.repeat(32)}01`,
}

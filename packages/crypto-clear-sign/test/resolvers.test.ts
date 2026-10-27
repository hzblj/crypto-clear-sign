import assert from 'node:assert/strict'
import {describe, test} from 'node:test'

import {
  type Clock,
  createResolverContext,
  type Descriptor,
  isClearSignError,
  LABELS,
  type NameInfo,
  RESOLVER_NAMES,
  type Resolvers,
  type TokenInfo,
} from '../src'

const ETHEREUM = {family: 'ethereum', id: 'eip155:1', name: 'Ethereum'} as const
const SIGNER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const SAVINGS = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const ROUTER = '0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af'
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const STRANGER = '0x1111111111111111111111111111111111111111'
const NOW = Date.UTC(2026, 9, 27, 12)
const clock: Clock = {now: () => NOW}
const lower = (address: string) => address.toLowerCase()

type Query = {readonly address: string; readonly selector: string}

const TOKENS: Readonly<Record<string, TokenInfo>> = {[lower(USDC)]: {decimals: 6, name: 'USD Coin', symbol: 'USDC'}}
const NAMES: Readonly<Record<string, NameInfo>> = {
  [lower(ROUTER)]: {name: 'Uniswap', relation: 'contract'},
  [lower(SAVINGS)]: {name: 'Savings', relation: 'own'},
  [lower(SIGNER)]: {name: 'Main', relation: 'own'},
}

/** Resolvers over the tables above, answering at once or with a promise; each call is counted. */
const resolvers = (async: boolean) => {
  const calls = {descriptors: 0, names: 0, tokens: 0}
  const answer = <Value>(value: Value) => (async ? Promise.resolve(value) : value)
  const set: Resolvers<Query, {readonly intent: string}> = {
    clock,
    descriptors: {
      descriptor: query => {
        calls.descriptors++

        return answer(
          lower(query.address) === lower(ROUTER)
            ? {content: {intent: 'Swap'}, id: 'registry/uniswap.json', publisher: 'Uniswap'}
            : undefined
        )
      },
    },
    names: {
      name: ({address, chain}) => {
        calls.names++
        assert.equal(chain.id, 'eip155:1')

        return answer(NAMES[lower(address)])
      },
    },
    tokens: {
      token: ({address}) => {
        calls.tokens++

        return answer(TOKENS[lower(address)])
      },
    },
  }

  return {calls, set}
}

describe('createResolverContext', () => {
  for (const async of [false, true]) {
    test(`relations: self, then names, then tokens, then unknown (${async ? 'async' : 'sync'} resolvers)`, async () => {
      const {calls, set} = resolvers(async)
      const context = createResolverContext({chain: ETHEREUM, normalize: lower, resolvers: set, signer: SIGNER})

      const self = await context.address({id: 'from', label: LABELS.from, value: SIGNER.toLowerCase()})
      assert.deepEqual({name: self.name, relation: self.relation}, {name: 'Main', relation: 'self'})
      const own = await context.address({label: LABELS.recipient, value: SAVINGS})
      assert.deepEqual({name: own.name, relation: own.relation}, {name: 'Savings', relation: 'own'})
      const router = await context.address({label: LABELS.spender, value: ROUTER})
      assert.deepEqual({name: router.name, relation: router.relation}, {name: 'Uniswap', relation: 'contract'})
      const token = await context.address({label: LABELS.token, value: USDC})
      assert.deepEqual({name: token.name, relation: token.relation}, {name: 'USD Coin', relation: 'token'})
      const stranger = await context.address({label: LABELS.recipient, secondary: true, value: STRANGER})
      assert.deepEqual(stranger, {
        kind: 'address',
        label: LABELS.recipient,
        relation: 'unknown',
        secondary: true,
        value: STRANGER,
      })

      const amount = await context.amount({id: 'amount', label: LABELS.amount, token: USDC, value: 1_500_000n})
      assert.deepEqual(
        {decimals: amount.decimals, symbol: amount.symbol, token: amount.token, unlimited: amount.unlimited},
        {decimals: 6, symbol: 'USDC', token: USDC, unlimited: false}
      )
      const unknown = await context.amount({label: LABELS.amount, token: STRANGER, unlimited: true, value: 1n})
      assert.equal(unknown.decimals, undefined)
      assert.equal(unknown.symbol, undefined)
      assert.equal(unknown.unlimited, true)

      // Cached by the normalized address: one question per address, however it is spelled.
      await context.token(USDC.toLowerCase())
      await context.name(ROUTER.toUpperCase().replace('0X', '0x'))
      assert.equal(calls.tokens, 2)
      assert.equal(calls.names, 5)

      const descriptor = await context.descriptor({address: ROUTER, selector: '0x3593564c'})
      assert.deepEqual(descriptor, {content: {intent: 'Swap'}, id: 'registry/uniswap.json', publisher: 'Uniswap'})
      assert.equal(await context.descriptor({address: STRANGER, selector: '0x'}), undefined)

      assert.equal(context.now, NOW)
      assert.deepEqual(context.failures(), [])
      assert.deepEqual(context.warnings(), [])
    })
  }

  test('offline: no resolvers, nothing asked, nothing failed', async () => {
    const context = createResolverContext({chain: ETHEREUM})
    assert.equal(await context.token(USDC), undefined)
    assert.equal(await context.name(ROUTER), undefined)
    assert.equal(await context.descriptor(undefined as never), undefined)
    assert.equal((await context.address({label: LABELS.to, value: ROUTER})).relation, 'unknown')
    assert.equal(context.isSigner(ROUTER), false)
    assert.ok(!('signer' in context))
    assert.ok(Math.abs(context.now - Date.now()) < 5000)
    assert.deepEqual(context.warnings(), [])
  })

  test('the signer compares by the chain`s normalization: exact unless told', () => {
    assert.ok(!createResolverContext({chain: ETHEREUM, signer: SIGNER}).isSigner(SIGNER.toLowerCase()))
    assert.ok(createResolverContext({chain: ETHEREUM, normalize: lower, signer: SIGNER}).isSigner(lower(SIGNER)))
  })

  test('a resolver that throws, rejects or answers nonsense counts as no answer, and is reported', async () => {
    const malformed: readonly unknown[] = [
      {decimals: 256, symbol: 'USDC'},
      {decimals: 6, symbol: ''},
      {decimals: 6, symbol: 'USDC‮'},
      {decimals: 6, symbol: 'X'.repeat(33)},
      {decimals: 1.5, symbol: 'USDC'},
      {decimals: 6, name: '', symbol: 'USDC'},
      'USDC',
      null,
    ]

    for (const answer of malformed) {
      const context = createResolverContext({chain: ETHEREUM, resolvers: {tokens: {token: () => answer as TokenInfo}}})
      assert.equal(await context.token(USDC), undefined, JSON.stringify(answer))
      assert.deepEqual(context.failures(), ['tokens'])
    }

    const names = createResolverContext({
      chain: ETHEREUM,
      resolvers: {
        names: {
          name: ({address}) => {
            if (address === ROUTER) {
              throw new Error('offline')
            }

            return {name: 'Friend', relation: 'friend'} as unknown as NameInfo
          },
        },
        tokens: {token: () => Promise.reject(new Error('timeout'))},
      },
    })
    const router = await names.address({label: LABELS.spender, value: ROUTER})
    assert.equal(router.relation, 'unknown')
    assert.equal((await names.address({label: LABELS.to, value: STRANGER})).relation, 'unknown')
    // In the order of RESOLVER_NAMES, whichever failed first.
    assert.deepEqual(RESOLVER_NAMES, ['tokens', 'names', 'descriptors'])
    assert.deepEqual(names.failures(), ['tokens', 'names'])
    assert.deepEqual(names.warnings(), [
      {
        code: 'RESOLVER_FAILED',
        message: 'A lookup failed, so some names, tokens or descriptions may be missing.',
        params: {resolvers: 'tokens, names'},
        severity: 'info',
      },
    ])

    const descriptors = createResolverContext<Query, unknown>({
      chain: ETHEREUM,
      resolvers: {
        descriptors: {
          descriptor: query =>
            (query.selector === '0x01'
              ? {content: undefined, id: 'x'}
              : {content: {}, id: 'x', publisher: '​fake'}) as Descriptor<unknown>,
        },
      },
    })
    assert.equal(await descriptors.descriptor({address: ROUTER, selector: '0x01'}), undefined)
    assert.equal(await descriptors.descriptor({address: ROUTER, selector: '0x02'}), undefined)
    assert.deepEqual(descriptors.failures(), ['descriptors'])
  })

  test('a clock that answers nonsense is the caller`s mistake', () => {
    assert.throws(
      () => createResolverContext({chain: ETHEREUM, resolvers: {clock: {now: () => Number.NaN}}}),
      error => isClearSignError(error, 'INVALID_ARGUMENT')
    )
  })
})

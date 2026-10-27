import assert from 'node:assert/strict'
import {describe, test} from 'node:test'

import {formatAmount, isClearSignError, MAX_DECIMALS, maxUint, UNLIMITED_TEXT} from '../src'

const throwsInvalid = (run: () => unknown) => assert.throws(run, error => isClearSignError(error, 'INVALID_ARGUMENT'))

describe('formatAmount', () => {
  test('exact decimal text, every digit, trailing zeros dropped', () => {
    assert.equal(formatAmount({decimals: 6, value: 1_500_000n}), '1.5')
    assert.equal(formatAmount({decimals: 6, value: 1_000_000n}), '1')
    assert.equal(formatAmount({decimals: 6, value: 1n}), '0.000001')
    assert.equal(formatAmount({decimals: 18, value: 1n}), '0.000000000000000001')
    assert.equal(formatAmount({decimals: 18, value: 123_456_789_000_000_000_000n}), '123.456789')
    assert.equal(formatAmount({decimals: 0, value: 42n}), '42')
    assert.equal(formatAmount({decimals: 8, value: 0n}), '0')
    assert.equal(formatAmount({decimals: 2, value: -150n}), '-1.5')
    // No rounding, however long: a wei more is a wei more.
    assert.equal(formatAmount({decimals: 18, value: 10n ** 30n + 1n}), '1000000000000.000000000000000001')
    assert.equal(formatAmount({decimals: MAX_DECIMALS, value: 1n}), `0.${'0'.repeat(254)}1`)
  })

  test('symbols, grouping and the unlimited sentinel', () => {
    assert.equal(formatAmount({decimals: 6, symbol: 'USDC', value: 1_500_000n}), '1.5 USDC')
    assert.equal(formatAmount({decimals: 6, symbol: 'USDC', value: 1_500_000n}, {symbol: false}), '1.5')
    assert.equal(formatAmount({decimals: 6, symbol: '', value: 1n}), '0.000001')
    assert.equal(formatAmount({decimals: 2, value: 123_456_789n}, {grouping: true}), '1,234,567.89')
    assert.equal(formatAmount({decimals: 0, value: -1_000n}, {grouping: true}), '-1,000')
    assert.equal(formatAmount({decimals: 0, value: 100n}, {grouping: true}), '100')

    assert.equal(UNLIMITED_TEXT, 'Unlimited')
    assert.equal(formatAmount({decimals: 6, symbol: 'USDC', unlimited: true, value: maxUint(256)}), 'Unlimited USDC')
    assert.equal(formatAmount({unlimited: true, value: maxUint(256)}), 'Unlimited')
    assert.equal(
      formatAmount({decimals: 6, symbol: 'USDC', unlimited: true, value: maxUint(256)}, {unlimited: 'Neomezeně'}),
      'Neomezeně USDC'
    )
    // `unlimited: false` is the number, even at the largest one.
    assert.equal(formatAmount({decimals: 0, unlimited: false, value: maxUint(8)}), '255')
  })

  test('without decimals: the integer of base units', () => {
    assert.equal(formatAmount({value: 1_500_000n}), '1500000')
    assert.equal(formatAmount({value: 1_500_000n}, {grouping: true}), '1,500,000')
  })

  test('refuses what is not an amount', () => {
    throwsInvalid(() => formatAmount({decimals: 6, value: 1 as unknown as bigint}))
    throwsInvalid(() => formatAmount({decimals: -1, value: 1n}))
    throwsInvalid(() => formatAmount({decimals: 1.5, value: 1n}))
    throwsInvalid(() => formatAmount({decimals: 256, value: 1n}))
  })
})

describe('maxUint', () => {
  test('2 ** bits - 1, for the widths protocols use as unlimited', () => {
    assert.equal(maxUint(8), 255n)
    assert.equal(maxUint(64), 18_446_744_073_709_551_615n)
    assert.equal(maxUint(160), 2n ** 160n - 1n)
    assert.equal(maxUint(256), 2n ** 256n - 1n)
    assert.equal(maxUint(256).toString(16), 'f'.repeat(64))
  })

  test('refuses widths that are not whole bits', () => {
    for (const bits of [0, -8, 1.5, 1025, Number.NaN]) {
      throwsInvalid(() => maxUint(bits))
    }
  })
})

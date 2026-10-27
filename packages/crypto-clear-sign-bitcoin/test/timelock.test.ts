import assert from 'node:assert/strict'
import {describe, test} from 'node:test'

import {findField, LABELS} from '@hzblj/crypto-clear-sign'

import {BITCOIN_TEXTS, clearSignPsbt} from '../src'
import {btcSignerPsbt, chain, clock, field, has, NOW, only, setup} from './support'

const DAY = 86_400

describe('lock times and sequences', async () => {
  const {accounts, xpubAccounts} = await setup()
  const {change, other, segwit} = accounts

  const read = (
    {lockTime = 0, sequence, version}: {lockTime?: number; sequence?: number; version?: number},
    options = {}
  ) =>
    clearSignPsbt(
      chain,
      btcSignerPsbt(
        [{account: segwit, previous: true, sequence, value: 100_000n}],
        [
          {account: other, noOrigin: true, value: 50_000n},
          {account: change, value: 49_000n},
        ],
        {lockTime, version}
      ),
      {accounts: [...xpubAccounts], resolvers: {clock}, ...options}
    )

  test('replaceable by fee when a sequence is below 0xfffffffe', async () => {
    const replaceable = field(await read({sequence: 0xfffffffd}), 'replaceable')
    assert.ok(replaceable.kind === 'boolean' && replaceable.value && replaceable.secondary)

    const final = field(await read({sequence: 0xfffffffe}), 'replaceable')
    assert.ok(final.kind === 'boolean' && !final.value)
  })

  test('a lock time with every sequence final binds nothing, and is not shown', async () => {
    const result = await read({lockTime: 900_000, sequence: 0xffffffff}, {tipHeight: 800_000})
    assert.equal(findField(result, 'lockTime'), undefined)
    assert.equal(has(result, 'bitcoin.TIMELOCKED'), false)
  })

  test('a lock time by height: shown, and judged against the tip when the tip is known', async () => {
    const past = await read({lockTime: 870_000, sequence: 0xfffffffd}, {tipHeight: 870_000})
    const height = field(past, 'lockTime')
    assert.ok(height.kind === 'number')
    assert.deepEqual([height.value, height.label.code], [870_000, BITCOIN_TEXTS.label.notBeforeBlock.code])
    assert.equal(has(past, 'bitcoin.TIMELOCKED'), false)

    const soon = await read({lockTime: 870_010, sequence: 0xfffffffd}, {tipHeight: 870_000})
    const timelocked = only(soon, 'bitcoin.TIMELOCKED')
    assert.deepEqual([timelocked.severity, timelocked.fields], ['info', ['lockTime']])
    assert.equal(has(soon, 'bitcoin.FAR_FUTURE_LOCKTIME'), false)

    // 4,320 blocks is 30 days; one more is past it.
    const month = await read({lockTime: 874_320, sequence: 0xfffffffd}, {tipHeight: 870_000})
    assert.equal(has(month, 'bitcoin.FAR_FUTURE_LOCKTIME'), false)
    const far = await read({lockTime: 874_321, sequence: 0xfffffffd}, {tipHeight: 870_000})
    const warning = only(far, 'bitcoin.FAR_FUTURE_LOCKTIME')
    assert.deepEqual([warning.severity, warning.fields], ['medium', ['lockTime']])
    assert.equal(has(far, 'bitcoin.TIMELOCKED'), false)

    const unknownTip = await read({lockTime: 999_999, sequence: 0xfffffffd})
    assert.ok(findField(unknownTip, 'lockTime'))
    assert.equal(has(unknownTip, 'bitcoin.TIMELOCKED') || has(unknownTip, 'bitcoin.FAR_FUTURE_LOCKTIME'), false)
  })

  test('a lock time by time: a moment, judged by the clock', async () => {
    const now = Math.floor(NOW / 1000)

    const past = await read({lockTime: now - DAY, sequence: 0xfffffffe})
    const moment = field(past, 'lockTime')
    assert.ok(moment.kind === 'datetime')
    assert.deepEqual([moment.value, moment.expired, moment.label.code], [NOW - DAY * 1000, true, LABELS.notBefore.code])
    assert.equal(has(past, 'bitcoin.TIMELOCKED'), false)

    const tomorrow = await read({lockTime: now + DAY, sequence: 0xfffffffe})
    assert.equal(only(tomorrow, 'bitcoin.TIMELOCKED').severity, 'info')

    const months = await read({lockTime: now + 60 * DAY, sequence: 0xfffffffe})
    assert.equal(only(months, 'bitcoin.FAR_FUTURE_LOCKTIME').severity, 'medium')
    assert.equal(months.risk, 'medium')
  })

  test('relative locks (BIP-68): blocks, or multiples of 512 seconds, in version 2 only', async () => {
    const blocks = field(await read({sequence: 144}), 'input-0-relativeLock')
    assert.ok(blocks.kind === 'number')
    assert.deepEqual([blocks.value, blocks.unit?.code], [144, BITCOIN_TEXTS.unit.blocks.code])

    const time = field(await read({sequence: (1 << 22) | 3}), 'input-0-relativeLock')
    assert.ok(time.kind === 'duration')
    assert.equal(time.value, 3 * 512 * 1000)

    assert.equal(findField(await read({sequence: 144, version: 1}), 'input-0-relativeLock'), undefined)
    assert.equal(findField(await read({sequence: 0xfffffffd}), 'input-0-relativeLock'), undefined)
    assert.equal(findField(await read({sequence: 0}), 'input-0-relativeLock'), undefined)
  })
})

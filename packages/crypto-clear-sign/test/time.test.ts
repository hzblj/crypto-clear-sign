import assert from 'node:assert/strict'
import {describe, test} from 'node:test'

import {
  checkDeadline,
  checkDuration,
  formatDateTime,
  formatDuration,
  fromUnixSeconds,
  isClearSignError,
  LONG_LIVED_AFTER,
  MAX_TIME,
  maxUint,
  systemClock,
} from '../src'

const throwsInvalid = (run: () => unknown) => assert.throws(run, error => isClearSignError(error, 'INVALID_ARGUMENT'))

const NOW = Date.UTC(2026, 9, 27, 12)
const DAY = 86_400_000

describe('time', () => {
  test('the system clock is Date.now', () => {
    const before = Date.now()
    const now = systemClock.now()
    assert.ok(now >= before && now <= Date.now())
    assert.ok(Object.isFrozen(systemClock))
  })

  test('fromUnixSeconds: milliseconds, or never past what a Date holds', () => {
    assert.equal(fromUnixSeconds(1_800_000_000), 1_800_000_000_000)
    assert.equal(fromUnixSeconds(1_800_000_000n), 1_800_000_000_000)
    assert.equal(fromUnixSeconds(0), 0)
    assert.equal(fromUnixSeconds(-86_400), -86_400_000)
    assert.equal(fromUnixSeconds(MAX_TIME / 1000), MAX_TIME)
    assert.equal(fromUnixSeconds(MAX_TIME / 1000 + 1), 'never')
    assert.equal(fromUnixSeconds(maxUint(256)), 'never')
    assert.equal(fromUnixSeconds(maxUint(48)), 'never')
    throwsInvalid(() => fromUnixSeconds(1.5))
    throwsInvalid(() => fromUnixSeconds(-maxUint(64)))
  })

  test('checkDeadline: expired once past, long-lived when far or never, else nothing', () => {
    assert.equal(checkDeadline({never: false, value: NOW - 1}, {now: NOW}), 'EXPIRED')
    assert.equal(checkDeadline({never: false, value: NOW}, {now: NOW}), undefined)
    assert.equal(checkDeadline({never: false, value: NOW + 30 * 60_000}, {now: NOW}), undefined)
    assert.equal(checkDeadline({never: false, value: NOW + LONG_LIVED_AFTER}, {now: NOW}), undefined)
    assert.equal(checkDeadline({never: false, value: NOW + LONG_LIVED_AFTER + 1}, {now: NOW}), 'LONG_LIVED')
    assert.equal(checkDeadline({never: true}, {now: NOW}), 'LONG_LIVED')
    assert.equal(checkDeadline({never: false, value: NOW + 2 * DAY}, {longLivedAfter: DAY, now: NOW}), 'LONG_LIVED')
    throwsInvalid(() => checkDeadline({never: false}, {now: NOW}))
    throwsInvalid(() => checkDeadline({never: false, value: NOW}, {now: Number.NaN}))
  })

  test('checkDuration: long-lived past the threshold or forever', () => {
    assert.equal(LONG_LIVED_AFTER, 30 * DAY)
    assert.equal(checkDuration({never: false, value: DAY}), undefined)
    assert.equal(checkDuration({never: false, value: 31 * DAY}), 'LONG_LIVED')
    assert.equal(checkDuration({never: true}), 'LONG_LIVED')
    assert.equal(checkDuration({never: false, value: 2 * DAY}, {longLivedAfter: DAY}), 'LONG_LIVED')
    throwsInvalid(() => checkDuration({never: false, value: -1}))
    throwsInvalid(() => checkDuration({never: false}))
  })

  test('formatDateTime: ISO 8601 in UTC, milliseconds only when there are some', () => {
    assert.equal(formatDateTime(NOW), '2026-10-27T12:00:00Z')
    assert.equal(formatDateTime(NOW + 5), '2026-10-27T12:00:00.005Z')
    assert.equal(formatDateTime(0), '1970-01-01T00:00:00Z')
    throwsInvalid(() => formatDateTime(MAX_TIME + 1))
    throwsInvalid(() => formatDateTime(Number.POSITIVE_INFINITY))
  })

  test('formatDuration: exact English units', () => {
    assert.equal(formatDuration(0), '0 seconds')
    assert.equal(formatDuration(1000), '1 second')
    assert.equal(formatDuration(30 * DAY), '30 days')
    assert.equal(formatDuration(DAY + 2 * 3_600_000 + 5000), '1 day 2 hours 5 seconds')
    assert.equal(formatDuration(90_061_001), '1 day 1 hour 1 minute 1 second 1 millisecond')
    assert.equal(formatDuration(1.4), '1 millisecond')
    throwsInvalid(() => formatDuration(-1))
    throwsInvalid(() => formatDuration(Number.NaN))
  })
})

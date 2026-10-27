import assert from 'node:assert/strict'
import {describe, test} from 'node:test'

import {
  ADDRESS_RELATIONS,
  addressField,
  amountField,
  booleanField,
  dateTimeField,
  defineTexts,
  durationField,
  externalText,
  FIELD_KINDS,
  type Field,
  formatField,
  isClearSignError,
  isField,
  isFieldKind,
  LABELS,
  listField,
  maxUint,
  numberField,
  percentField,
  rawField,
  textField,
} from '../src'

const throwsInvalid = (run: () => unknown) => assert.throws(run, error => isClearSignError(error, 'INVALID_ARGUMENT'))

const NOW = Date.UTC(2026, 9, 27, 12)
const UNISWAP = '0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af'
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const UNITS = defineTexts('test', {unit: {gas: 'gas'}}).unit

describe('field constructors', () => {
  test('amounts: unlimited false unless given, absent is absent, frozen', () => {
    const amount = amountField({
      decimals: 6,
      id: 'amount',
      label: LABELS.amount,
      symbol: 'USDC',
      token: USDC,
      value: 5n,
    })
    assert.deepEqual(amount, {
      decimals: 6,
      id: 'amount',
      kind: 'amount',
      label: {code: 'label.amount', text: 'Amount'},
      symbol: 'USDC',
      token: USDC,
      unlimited: false,
      value: 5n,
    })
    assert.ok(Object.isFrozen(amount) && Object.isFrozen(amount.label))

    const unknown = amountField({label: LABELS.amount, token: USDC, value: 5n})
    assert.deepEqual(Object.keys(unknown).sort(), ['kind', 'label', 'token', 'unlimited', 'value'])

    const native = amountField({baseUnit: 'wei', decimals: 18, label: LABELS.amount, symbol: 'ETH', value: 10n ** 18n})
    assert.equal(native.baseUnit, 'wei')
    assert.equal(native.token, undefined)

    throwsInvalid(() => amountField({decimals: 256, label: LABELS.amount, value: 1n}))
    throwsInvalid(() => amountField({label: LABELS.amount, value: 1 as unknown as bigint}))
    throwsInvalid(() => amountField({label: {code: 'Amount', text: 'Amount'}, value: 1n}))
  })

  test('addresses: unknown unless a relation is given', () => {
    assert.equal(addressField({label: LABELS.to, value: UNISWAP}).relation, 'unknown')
    const spender = addressField({label: LABELS.spender, name: 'Uniswap', relation: 'contract', value: UNISWAP})
    assert.equal(spender.name, 'Uniswap')
    assert.deepEqual(ADDRESS_RELATIONS, ['self', 'own', 'contact', 'contract', 'token', 'unknown'])
    throwsInvalid(() => addressField({label: LABELS.to, value: ''}))
    throwsInvalid(() => addressField({label: LABELS.to, relation: 'friend' as 'own', value: UNISWAP}))
  })

  test('moments: expired by now, never without a value', () => {
    const deadline = dateTimeField({label: LABELS.deadline, now: NOW, value: NOW + 60_000})
    assert.deepEqual(
      {expired: deadline.expired, never: deadline.never, value: deadline.value},
      {expired: false, never: false, value: NOW + 60_000}
    )
    assert.equal(dateTimeField({label: LABELS.deadline, now: NOW, value: NOW - 1}).expired, true)
    assert.equal(dateTimeField({label: LABELS.deadline, now: NOW, value: NOW}).expired, false)

    const never = dateTimeField({label: LABELS.expiry, now: NOW, value: 'never'})
    assert.deepEqual(
      {expired: never.expired, never: never.never, value: never.value},
      {
        expired: false,
        never: true,
        value: undefined,
      }
    )
    assert.ok(!('value' in never))

    throwsInvalid(() => dateTimeField({label: LABELS.deadline, now: Number.NaN, value: NOW}))
    throwsInvalid(() => dateTimeField({label: LABELS.deadline, now: NOW, value: Number.POSITIVE_INFINITY}))
    throwsInvalid(() => dateTimeField({label: LABELS.deadline, value: NOW} as never))
  })

  test('moments that are not deadlines: past without having expired, with or without now', () => {
    const issued = dateTimeField({deadline: false, id: 'issuedAt', label: LABELS.issuedAt, value: NOW - 86_400_000})
    assert.deepEqual(issued, {
      expired: false,
      id: 'issuedAt',
      kind: 'datetime',
      label: LABELS.issuedAt,
      never: false,
      value: NOW - 86_400_000,
    })
    assert.ok(Object.isFrozen(issued))
    // The same moment as a deadline has passed; as a start it has not expired, whatever now says.
    assert.equal(dateTimeField({label: LABELS.deadline, now: NOW, value: NOW - 86_400_000}).expired, true)
    assert.equal(dateTimeField({deadline: false, label: LABELS.notBefore, now: NOW, value: 0}).expired, false)
    assert.equal(dateTimeField({deadline: true, label: LABELS.deadline, now: NOW, value: NOW - 1}).expired, true)
    assert.equal(dateTimeField({deadline: false, label: LABELS.notBefore, value: 'never'}).never, true)
    assert.equal(
      formatField(dateTimeField({deadline: false, label: LABELS.issuedAt, value: NOW - 1000})),
      '2026-10-27T11:59:59Z'
    )

    // now is checked when given, deadline is a boolean.
    throwsInvalid(() => dateTimeField({deadline: false, label: LABELS.issuedAt, now: Number.NaN, value: NOW}))
    throwsInvalid(() => dateTimeField({deadline: 'no' as unknown as false, label: LABELS.issuedAt, value: NOW}))
    throwsInvalid(() => dateTimeField({deadline: false, label: LABELS.issuedAt, value: Number.NaN}))
  })

  test('durations, raw bytes, percentages, numbers, booleans', () => {
    assert.deepEqual(durationField({label: LABELS.validFor, value: 'never'}).never, true)
    assert.equal(durationField({label: LABELS.validFor, value: 60_000}).value, 60_000)
    throwsInvalid(() => durationField({label: LABELS.validFor, value: -1}))

    assert.equal(rawField({label: LABELS.data, value: Uint8Array.of(0x09, 0x5e, 0xa7, 0xb3)}).value, '0x095ea7b3')
    assert.equal(rawField({label: LABELS.data, value: '0x095EA7B3'}).value, '0x095ea7b3')
    assert.equal(rawField({label: LABELS.data, value: new Uint8Array()}).value, '0x')
    throwsInvalid(() => rawField({label: LABELS.data, value: '095ea7b3'}))
    throwsInvalid(() => rawField({label: LABELS.data, value: '0x095'}))

    assert.equal(percentField({label: externalText('Slippage'), value: 0.5}).value, 0.5)
    throwsInvalid(() => percentField({label: externalText('Slippage'), value: Number.NaN}))

    assert.equal(numberField({label: LABELS.nonce, value: 7n}).value, 7n)
    assert.deepEqual(numberField({label: externalText('Gas'), unit: UNITS.gas, value: 21_000}).unit, {
      code: 'test.unit.gas',
      text: 'gas',
    })
    throwsInvalid(() => numberField({label: LABELS.nonce, value: Number.POSITIVE_INFINITY}))

    assert.equal(booleanField({label: externalText('Partial fill'), value: true}).value, true)
    throwsInvalid(() => booleanField({label: externalText('Partial fill'), value: 'yes' as unknown as boolean}))
  })

  test('lists: fields in order, ids unique across the list', () => {
    const recipient = listField({
      id: 'recipient-0',
      items: [
        addressField({id: 'to-0', label: LABELS.recipient, value: UNISWAP}),
        amountField({decimals: 6, id: 'amount-0', label: LABELS.amount, symbol: 'USDC', value: 1n}),
      ],
      label: LABELS.recipient,
    })
    assert.equal(recipient.items.length, 2)
    assert.ok(Object.isFrozen(recipient.items))
    throwsInvalid(() =>
      listField({
        id: 'twice',
        items: [textField({id: 'twice', label: LABELS.message, value: 'x'})],
        label: LABELS.recipient,
      })
    )
  })

  test('ids are letters, digits and a few separators', () => {
    assert.equal(
      textField({id: 'outputs/0:address.1_a-b', label: LABELS.message, value: 'x'}).id,
      'outputs/0:address.1_a-b'
    )
    throwsInvalid(() => textField({id: '', label: LABELS.message, value: 'x'}))
    throwsInvalid(() => textField({id: 'with space', label: LABELS.message, value: 'x'}))
  })
})

describe('field guards', () => {
  test('isFieldKind and isField, with and without a kind', () => {
    assert.ok(FIELD_KINDS.every(isFieldKind))
    assert.ok(!isFieldKind('token'))

    const amount: unknown = amountField({decimals: 6, label: LABELS.amount, value: 1n})
    assert.ok(isField(amount))
    assert.ok(isField(amount, 'amount'))
    assert.ok(!isField(amount, 'address'))
    if (isField(amount, 'amount')) {
      assert.equal(amount.decimals, 6)
    }

    // A literal that follows the model is a field; one that breaks it, or a class instance, is not.
    assert.ok(isField({kind: 'text', label: {code: 'label.message', text: 'Message'}, value: 'Hello'}, 'text'))
    assert.ok(!isField({kind: 'text', label: {code: 'label.message', text: 'Message'}, value: 1}))
    assert.ok(!isField({kind: 'text', label: {code: 'message', text: 'Message'}, value: 'Hello'}))
    assert.ok(!isField({decimals: 300, kind: 'amount', label: LABELS.amount, value: 1n}))
    assert.ok(!isField(new (class Instance {})()))
    assert.ok(!isField(null))
    assert.ok(!isField('amount'))
  })
})

describe('formatField', () => {
  const format = (field: Field) => formatField(field)

  test('every kind, in exact English', () => {
    assert.equal(
      format(amountField({decimals: 6, label: LABELS.amount, symbol: 'USDC', value: 1_500_000n})),
      '1.5 USDC'
    )
    assert.equal(
      format(amountField({decimals: 6, label: LABELS.amount, symbol: 'USDC', unlimited: true, value: maxUint(256)})),
      'Unlimited USDC'
    )
    assert.equal(format(amountField({label: LABELS.amount, token: USDC, value: 1_500_000n})), '1500000 base units')
    assert.equal(format(amountField({label: LABELS.amount, symbol: 'XYZ', value: 15n})), '15 base units of XYZ')
    assert.equal(format(addressField({label: LABELS.to, value: UNISWAP})), UNISWAP)
    assert.equal(format(addressField({label: LABELS.to, name: 'Uniswap', value: UNISWAP})), `Uniswap (${UNISWAP})`)
    assert.equal(format(textField({label: LABELS.message, value: 'Hello'})), 'Hello')
    assert.equal(format(dateTimeField({label: LABELS.deadline, now: NOW, value: NOW})), '2026-10-27T12:00:00Z')
    assert.equal(
      format(dateTimeField({label: LABELS.deadline, now: NOW + 1000, value: NOW})),
      '2026-10-27T12:00:00Z (expired)'
    )
    assert.equal(format(dateTimeField({label: LABELS.expiry, now: NOW, value: 'never'})), 'Never')
    assert.equal(format(durationField({label: LABELS.validFor, value: 30 * 86_400_000})), '30 days')
    assert.equal(format(durationField({label: LABELS.validFor, value: 'never'})), 'Forever')
    assert.equal(format(rawField({label: LABELS.data, value: '0x095ea7b3'})), '0x095ea7b3')
    assert.equal(format(percentField({label: externalText('Slippage'), value: 0.5})), '0.5%')
    assert.equal(format(numberField({label: LABELS.nonce, value: 7n})), '7')
    assert.equal(format(numberField({label: externalText('Gas'), unit: UNITS.gas, value: 21_000})), '21000 gas')
    assert.equal(format(booleanField({label: externalText('Partial fill'), value: false})), 'No')
    assert.equal(format(booleanField({label: externalText('Partial fill'), value: true})), 'Yes')
    assert.equal(
      format(
        listField({
          items: [
            addressField({label: LABELS.recipient, value: UNISWAP}),
            amountField({decimals: 6, label: LABELS.amount, symbol: 'USDC', value: 2_000_000n}),
          ],
          label: LABELS.recipient,
        })
      ),
      `Recipient: ${UNISWAP}; Amount: 2 USDC`
    )
  })

  test('options: grouping, the unlimited word, translations for units and list labels', () => {
    const amount = amountField({decimals: 0, label: LABELS.amount, symbol: 'SAT', value: 1_234_567n})
    assert.equal(formatField(amount, {grouping: true}), '1,234,567 SAT')
    assert.equal(
      formatField(amountField({label: LABELS.amount, symbol: 'USDC', unlimited: true, value: 1n}), {unlimited: 'Vše'}),
      'Vše USDC'
    )
    assert.equal(
      formatField(numberField({label: externalText('Gas'), unit: UNITS.gas, value: 21_000}), {
        translations: {'test.unit.gas': 'plynu'},
      }),
      '21000 plynu'
    )
    assert.equal(
      formatField(listField({items: [amount], label: LABELS.recipient}), {translations: {'label.amount': 'Částka'}}),
      'Částka: 1234567 SAT'
    )
  })
})

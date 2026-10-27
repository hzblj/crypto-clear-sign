import assert from 'node:assert/strict'
import {describe, test} from 'node:test'

import {
  type ActionInput,
  actionAt,
  addressField,
  amountField,
  type ClearSigningInput,
  createClearSigning,
  dateTimeField,
  defineWarnings,
  findField,
  hasWarning,
  INTENTS,
  isClearSignError,
  isSigningKind,
  jsonReplacer,
  LABELS,
  listField,
  MAX_ACTION_DEPTH,
  maxUint,
  rawField,
  SIGNING_KINDS,
  SUMMARIES,
  text,
  textField,
  WARNINGS,
  warning,
  warningsAt,
} from '../src'

const throwsInvalid = (run: () => unknown, pattern?: RegExp) =>
  assert.throws(
    run,
    error => isClearSignError(error, 'INVALID_ARGUMENT') && (pattern === undefined || pattern.test(error.message))
  )

const NOW = Date.UTC(2026, 9, 27, 12)
const ETHEREUM = {family: 'ethereum', id: 'eip155:1', name: 'Ethereum'} as const
const ROUTER = '0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af'
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const SIGNER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const TEST_WARNINGS = defineWarnings('ethereum', {
  DELEGATION: {message: 'This lets a contract run code as your account.', severity: 'critical'},
})

/** "Allow Uniswap to spend an unlimited amount of USDC", as the Ethereum package would describe it. */
const approval = (): ActionInput => ({
  fields: [
    addressField({id: 'spender', label: LABELS.spender, name: 'Uniswap', relation: 'contract', value: ROUTER}),
    amountField({
      decimals: 6,
      id: 'amount',
      label: LABELS.amount,
      symbol: 'USDC',
      token: USDC,
      unlimited: true,
      value: maxUint(256),
    }),
    addressField({id: 'token', label: LABELS.token, name: 'USD Coin', relation: 'token', value: USDC}),
  ],
  intent: INTENTS.approve,
  raw: [rawField({id: 'data', label: LABELS.data, value: `0x095ea7b3${'00'.repeat(64)}`})],
  source: {decoder: 'erc20', kind: 'builtin'},
  summary: text(SUMMARIES.approveUnlimited, {spender: 'Uniswap', token: 'USDC'}),
  warnings: [warning(WARNINGS.UNLIMITED_APPROVAL, {fields: ['amount', 'spender']})],
})

const result = (input: Partial<ClearSigningInput> = {}) =>
  createClearSigning({...approval(), chain: ETHEREUM, kind: 'transaction', ...input})

describe('createClearSigning', () => {
  test('one action: checked, its warnings placed, its risk their maximum', () => {
    const approved = result()

    assert.equal(approved.kind, 'transaction')
    assert.deepEqual(approved.chain, ETHEREUM)
    assert.deepEqual(approved.intent, {code: 'intent.approve', text: 'Approve'})
    assert.equal(approved.summary?.text, 'Allow Uniswap to spend an unlimited amount of USDC')
    assert.deepEqual(approved.path, [])
    assert.deepEqual(approved.actions, [])
    assert.equal(approved.risk, 'critical')
    assert.deepEqual(approved.warnings, [
      {
        action: [],
        code: 'UNLIMITED_APPROVAL',
        fields: ['amount', 'spender'],
        message: WARNINGS.UNLIMITED_APPROVAL.message,
        severity: 'critical',
      },
    ])
    assert.deepEqual(
      approved.fields.map(field => field.id),
      ['spender', 'amount', 'token']
    )
    assert.equal(approved.raw[0]?.kind, 'raw')
  })

  test('nothing to warn about: risk none, and the optional parts absent', () => {
    const plain = createClearSigning({
      chain: ETHEREUM,
      intent: INTENTS.signMessage,
      kind: 'message',
      source: {decoder: 'eip191', kind: 'builtin'},
    })

    assert.equal(plain.risk, 'none')
    assert.deepEqual(plain.warnings, [])
    assert.deepEqual(plain.fields, [])
    assert.deepEqual(plain.raw, [])
    assert.ok(!('summary' in plain))
  })

  test('nested actions: warnings gathered at the root with their paths, most serious first; risk per action', () => {
    const batch = createClearSigning({
      actions: [
        {
          fields: [
            addressField({
              id: 'recipient',
              label: LABELS.recipient,
              value: '0x1111111111111111111111111111111111111111',
            }),
          ],
          intent: INTENTS.send,
          source: {decoder: 'erc20', kind: 'builtin'},
          warnings: [warning(WARNINGS.UNKNOWN_DESTINATION, {fields: ['recipient']})],
        },
        {
          actions: [approval()],
          fields: [addressField({id: 'contract', label: LABELS.contract, value: ROUTER})],
          intent: INTENTS.contractCall,
          raw: [rawField({id: 'data', label: LABELS.data, value: '0x12345678'})],
          source: {kind: 'unknown'},
          warnings: [warning(WARNINGS.UNKNOWN_CONTRACT_CALL, {fields: ['data']})],
        },
      ],
      chain: ETHEREUM,
      fields: [addressField({id: 'from', label: LABELS.from, relation: 'self', value: SIGNER})],
      intent: INTENTS.batch,
      kind: 'transaction',
      source: {decoder: 'multicall3', kind: 'builtin'},
      summary: text(SUMMARIES.batch, {count: 2}),
      warnings: [warning(TEST_WARNINGS.DELEGATION), warning(WARNINGS.RESOLVER_FAILED)],
    })

    assert.equal(batch.risk, 'critical')
    assert.equal(batch.actions[0]?.risk, 'low')
    assert.equal(batch.actions[1]?.risk, 'critical')
    assert.equal(batch.actions[1]?.actions[0]?.risk, 'critical')
    assert.deepEqual(batch.actions[1]?.actions[0]?.path, [1, 0])
    assert.equal(batch.summary?.text, '2 actions in one signature')

    // Most serious first; ties in tree order (the root before its actions, then depth first).
    assert.deepEqual(
      batch.warnings.map(entry => [entry.code, entry.action]),
      [
        ['ethereum.DELEGATION', []],
        ['UNLIMITED_APPROVAL', [1, 0]],
        ['UNKNOWN_CONTRACT_CALL', [1]],
        ['UNKNOWN_DESTINATION', [0]],
        ['RESOLVER_FAILED', []],
      ]
    )

    assert.equal(actionAt(batch, []), batch)
    assert.equal(actionAt(batch, [1, 0])?.intent.code, 'intent.approve')
    assert.equal(actionAt(batch, [2]), undefined)
    assert.equal(actionAt(batch, [0, 3]), undefined)

    assert.deepEqual(
      warningsAt(batch, [1]).map(entry => entry.code),
      ['UNLIMITED_APPROVAL', 'UNKNOWN_CONTRACT_CALL']
    )
    assert.deepEqual(
      warningsAt(batch, [1], {below: false}).map(entry => entry.code),
      ['UNKNOWN_CONTRACT_CALL']
    )
    assert.equal(warningsAt(batch, []).length, 5)
    assert.deepEqual(
      warningsAt(batch, [], {below: false}).map(entry => entry.code),
      ['ethereum.DELEGATION', 'RESOLVER_FAILED']
    )

    assert.ok(hasWarning(batch, 'UNLIMITED_APPROVAL'))
    assert.ok(hasWarning(batch, 'ethereum.DELEGATION'))
    assert.ok(!hasWarning(batch, 'BLIND_SIGNING'))
  })

  test('fields are found by id, in lists and raw data too', () => {
    const listed = result({
      fields: [
        listField({
          id: 'output-0',
          items: [addressField({id: 'output-0-address', label: LABELS.recipient, value: ROUTER})],
          label: LABELS.recipient,
        }),
      ],
      warnings: [warning(WARNINGS.UNKNOWN_DESTINATION, {fields: ['output-0-address']})],
    })

    assert.equal(findField(listed, 'output-0')?.kind, 'list')
    assert.equal(findField(listed, 'output-0-address')?.kind, 'address')
    assert.equal(findField(listed, 'data')?.kind, 'raw')
    assert.equal(findField(listed, 'nothing'), undefined)
  })

  test('the result is plain, deeply frozen data, and the input is left alone', () => {
    const input = {...approval(), chain: ETHEREUM, kind: 'transaction' as const}
    const approved = createClearSigning(input)

    const frozen = (value: unknown, where: string): void => {
      if (typeof value === 'object' && value !== null) {
        assert.ok(Object.isFrozen(value), where)
        assert.ok([Object.prototype, Array.prototype].includes(Object.getPrototypeOf(value)), where)

        for (const [key, entry] of Object.entries(value)) {
          frozen(entry, `${where}.${key}`)
        }
      }
    }

    frozen(approved, 'result')
    assert.ok(!Object.isFrozen(input))
    assert.ok(!Object.isFrozen(input.warnings))
    assert.throws(() => {
      ;(approved.fields as unknown[]).push(1)
    }, TypeError)
  })

  test('JSON: bigints as decimal strings with jsonReplacer', () => {
    const json = JSON.parse(JSON.stringify(result(), jsonReplacer))
    assert.equal(json.fields[1].value, maxUint(256).toString())
    assert.equal(json.risk, 'critical')
    assert.throws(() => JSON.stringify(result()), TypeError)
  })

  test('refuses what breaks the model, saying where', () => {
    throwsInvalid(() => result({chain: {...ETHEREUM, id: 'ethereum'}}), /CAIP-2/)
    throwsInvalid(() => result({chain: {...ETHEREUM, family: ''}}))
    throwsInvalid(() => result({kind: 'signature' as 'message'}), /signing kind/)
    throwsInvalid(() => result({intent: {code: 'Approve', text: 'Approve'}}), /result\.intent/)
    throwsInvalid(
      () => result({summary: {code: 'summary.approve', params: {spender: 1n as never}, text: 'x'}}),
      /params/
    )
    throwsInvalid(() => result({source: {decoder: '', kind: 'builtin'}}), /source/)
    throwsInvalid(() => result({source: {format: 'erc7730', id: '', kind: 'descriptor'}}), /source/)
    throwsInvalid(() => result({source: {kind: 'guess'} as never}), /source/)
    throwsInvalid(() => result({fields: 'spender' as never}), /fields is an array/)
    throwsInvalid(
      () => result({fields: [{kind: 'amount', label: LABELS.amount, value: 1}] as never}),
      /fields\[0\]\.value/
    )

    // Field ids are unique across an action's fields, raw fields and lists.
    throwsInvalid(
      () => result({raw: [rawField({id: 'amount', label: LABELS.data, value: '0x'})]}),
      /raw\[0\]\.id is not unique/
    )

    // A warning names fields of its own action, and has a known kind of code.
    throwsInvalid(
      () => result({warnings: [warning(WARNINGS.UNLIMITED_APPROVAL, {fields: ['allowance']})]}),
      /warnings\[0\]\.fields/
    )
    throwsInvalid(() => result({warnings: [{...warning(WARNINGS.EXPIRED), code: 'MADE_UP' as 'EXPIRED'}]}), /code/)
    throwsInvalid(() => result({warnings: [{...warning(WARNINGS.EXPIRED), severity: 'severe' as 'low'}]}))
    throwsInvalid(
      () =>
        result({
          actions: [{...approval(), warnings: [warning(WARNINGS.EXPIRED, {fields: ['missing']})]}],
        }),
      /result\.actions\[0\]\.warnings\[0\]\.fields/
    )

    // Class instances are not plain data.
    class Amount {
      readonly kind = 'amount'
      readonly label = LABELS.amount
      readonly value = 1n
    }
    throwsInvalid(() => result({fields: [new Amount()] as never}), /object literal/)
    throwsInvalid(() => createClearSigning(null as never))
  })

  test('actions nest at most MAX_ACTION_DEPTH deep', () => {
    const nest = (depth: number): ActionInput =>
      depth === 0
        ? {intent: INTENTS.unknown, source: {kind: 'unknown'}}
        : {actions: [nest(depth - 1)], intent: INTENTS.batch, source: {decoder: 'batch', kind: 'builtin'}}

    assert.equal(
      actionAt(result(nest(MAX_ACTION_DEPTH)), Array(MAX_ACTION_DEPTH).fill(0))?.intent.code,
      'intent.unknown'
    )
    throwsInvalid(() => result(nest(MAX_ACTION_DEPTH + 1)), /nest/)
  })

  test('descriptor sources keep their id and publisher', () => {
    const described = result({
      source: {format: 'erc7730', id: 'registry/uniswap/calldata.json', kind: 'descriptor', publisher: 'Uniswap'},
    })
    assert.deepEqual(described.source, {
      format: 'erc7730',
      id: 'registry/uniswap/calldata.json',
      kind: 'descriptor',
      publisher: 'Uniswap',
    })
  })

  test('deadlines: a field and the warning that goes with it', () => {
    const expired = result({
      fields: [dateTimeField({id: 'deadline', label: LABELS.deadline, now: NOW, value: NOW - 1000})],
      warnings: [warning(WARNINGS.EXPIRED, {fields: ['deadline']})],
    })
    assert.equal(expired.risk, 'low')
    assert.equal(findField(expired, 'deadline')?.kind, 'datetime')

    const message = textField({id: 'message', label: LABELS.message, value: 'Hello'})
    assert.equal(result({fields: [message], warnings: []}).risk, 'none')
  })
})

describe('signing kinds', () => {
  test('isSigningKind', () => {
    assert.deepEqual(SIGNING_KINDS, [
      'transaction',
      'typed-data',
      'message',
      'offchain-message',
      'psbt',
      'authorization',
    ])
    assert.ok(SIGNING_KINDS.every(isSigningKind))
    assert.ok(!isSigningKind('signature'))
    assert.ok(!isSigningKind(undefined))
  })
})

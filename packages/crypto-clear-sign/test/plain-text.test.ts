import assert from 'node:assert/strict'
import {describe, test} from 'node:test'

import {
  addressField,
  amountField,
  createClearSigning,
  dateTimeField,
  externalText,
  INTENTS,
  LABELS,
  listField,
  maxUint,
  plainText,
  rawField,
  SUMMARIES,
  text,
  textField,
  WARNINGS,
  warning,
} from '../src'

const NOW = Date.UTC(2026, 9, 27, 12)
const ETHEREUM = {family: 'ethereum', id: 'eip155:1', name: 'Ethereum'} as const
const ROUTER = '0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af'
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const SIGNER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

const approve = {
  fields: [
    addressField({id: 'spender', label: LABELS.spender, name: 'Uniswap', relation: 'contract' as const, value: ROUTER}),
    amountField({
      decimals: 6,
      id: 'amount',
      label: LABELS.amount,
      symbol: 'USDC',
      token: USDC,
      unlimited: true,
      value: maxUint(256),
    }),
  ],
  intent: INTENTS.approve,
  raw: [rawField({id: 'data', label: LABELS.data, value: '0x095ea7b3'})],
  source: {decoder: 'erc20', kind: 'builtin' as const},
  summary: text(SUMMARIES.approveUnlimited, {spender: 'Uniswap', token: 'USDC'}),
  warnings: [warning(WARNINGS.UNLIMITED_APPROVAL, {fields: ['amount']})],
}

describe('plainText', () => {
  test('one action: heading, what and where, fields, source, warnings', () => {
    assert.equal(
      plainText(createClearSigning({...approve, chain: ETHEREUM, kind: 'transaction'})),
      [
        'Approve: Allow Uniswap to spend an unlimited amount of USDC',
        'Transaction on Ethereum. Risk: critical.',
        `Spender: Uniswap (${ROUTER}), known contract`,
        'Amount: Unlimited USDC',
        'Understood by: built-in decoder (erc20)',
        'Warnings:',
        `  - critical: ${WARNINGS.UNLIMITED_APPROVAL.message} (UNLIMITED_APPROVAL, about Amount)`,
      ].join('\n')
    )
  })

  test('nested actions are numbered and indented, warnings say where; raw data on request', () => {
    const batch = createClearSigning({
      actions: [
        {
          fields: [
            listField({
              items: [
                addressField({id: 'to', label: LABELS.recipient, relation: 'own', value: SIGNER}),
                amountField({baseUnit: 'wei', decimals: 18, label: LABELS.amount, symbol: 'ETH', value: 10n ** 17n}),
              ],
              label: LABELS.recipient,
            }),
            dateTimeField({label: LABELS.deadline, now: NOW, value: NOW - 1000}),
          ],
          intent: INTENTS.send,
          source: {decoder: 'native', kind: 'builtin'},
        },
        {...approve, actions: [{intent: externalText('Execute'), source: {kind: 'unknown'}}]},
      ],
      chain: ETHEREUM,
      intent: INTENTS.batch,
      kind: 'transaction',
      source: {format: 'erc7730', id: 'multicall.json', kind: 'descriptor', publisher: 'Example'},
      summary: text(SUMMARIES.batch, {count: 2}),
    })

    assert.equal(
      plainText(batch, {raw: true}),
      [
        'Batch: 2 actions in one signature',
        'Transaction on Ethereum. Risk: critical.',
        'Understood by: erc7730 descriptor multicall.json by Example',
        'Actions:',
        '  1. Send (risk: none)',
        '     Recipient:',
        `       Recipient: ${SIGNER}, your account`,
        '       Amount: 0.1 ETH',
        '     Deadline: 2026-10-27T11:59:59Z (expired)',
        '     Understood by: built-in decoder (native)',
        '  2. Approve: Allow Uniswap to spend an unlimited amount of USDC (risk: critical)',
        `     Spender: Uniswap (${ROUTER}), known contract`,
        '     Amount: Unlimited USDC',
        '     Raw data:',
        '       Data: 0x095ea7b3',
        '     Understood by: built-in decoder (erc20)',
        '     Actions:',
        '       2.1. Execute (risk: none)',
        '            Understood by: nothing, shown raw',
        'Warnings:',
        `  - critical: ${WARNINGS.UNLIMITED_APPROVAL.message} (UNLIMITED_APPROVAL, in action 2, about Amount)`,
      ].join('\n')
    )
    assert.ok(!plainText(batch).includes('Raw data'))
  })

  test('translations for codes; hidden characters and carriage returns escaped; lines of text indented', () => {
    const message = createClearSigning({
      chain: ETHEREUM,
      fields: [textField({id: 'message', label: LABELS.message, value: 'Sign in\nNonce: 1\r\ninvoice_‮fdp.exe\rX'})],
      intent: INTENTS.signMessage,
      kind: 'message',
      source: {decoder: 'eip191', kind: 'builtin'},
      warnings: [warning(WARNINGS.HIDDEN_CHARACTERS, {fields: ['message']})],
    })

    assert.equal(
      plainText(message, {
        translations: {
          HIDDEN_CHARACTERS: 'Skryté znaky.',
          'intent.signMessage': 'Podepsat',
          'label.message': 'Zpráva',
        },
      }),
      [
        'Podepsat',
        'Message on Ethereum. Risk: medium.',
        'Zpráva: Sign in',
        '  Nonce: 1',
        '  invoice_\\u{202E}fdp.exe\\u{D}X',
        'Understood by: built-in decoder (eip191)',
        'Warnings:',
        '  - medium: Skryté znaky. (HIDDEN_CHARACTERS, about Zpráva)',
      ].join('\n')
    )
  })
})

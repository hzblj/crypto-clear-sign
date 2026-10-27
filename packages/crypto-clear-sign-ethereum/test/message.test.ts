import assert from 'node:assert/strict'
import {describe, test} from 'node:test'

import {plainText} from '@hzblj/crypto-clear-sign'
import type {SignableMessage} from '@hzblj/crypto-ethereum'
import {createSiweMessage} from 'viem/siwe'

import {clearSignMessage, type EthereumClearSignOptions} from '../src'
import {codes, fieldOf, mainnet, NOW, OTHER, options, rejects, SIGNER, shape} from './helpers'

const sign = (message: SignableMessage, extra: EthereumClearSignOptions = {}) =>
  clearSignMessage(mainnet, message, options(extra))
const utf8 = (text: string) => new TextEncoder().encode(text)
const iso = (time: number) => new Date(time).toISOString().replace('.000Z', 'Z')
const HOUR = 3_600_000

/** A sign-in request written by viem's ERC-4361 writer (an independent implementation), for `SIGNER` on mainnet. */
const signIn = (fields: Partial<Parameters<typeof createSiweMessage>[0]> = {}) =>
  createSiweMessage({
    address: SIGNER,
    chainId: 1,
    domain: 'app.example.com',
    issuedAt: new Date(NOW - HOUR),
    nonce: 'a1b2c3d4e5f6',
    uri: 'https://app.example.com/login',
    version: '1',
    ...fields,
  })

describe('text messages', () => {
  test('text is a message field, read by eip191, with no warning', async () => {
    for (const text of ['Hello, world', 'Line one\nLine two\twith a tab', 'Grüße 👋', '']) {
      const result = await sign(text)
      assert.equal(result.kind, 'message')
      assert.deepEqual(result.source, {decoder: 'eip191', kind: 'builtin'})
      assert.equal(result.intent.code, 'intent.signMessage')
      assert.equal(result.summary?.code, 'summary.signMessage')
      assert.equal(fieldOf(result, 'message', 'text').value, text)
      assert.deepEqual(result.raw, [])
      assert.deepEqual(codes(result), [], JSON.stringify(text))
    }
  })

  test('hidden characters: HIDDEN_CHARACTERS on the message', async () => {
    for (const text of ['Pay to ‮evil', 'zero​width', 'bell\u0007']) {
      assert.deepEqual(shape(await sign(text)), ['HIDDEN_CHARACTERS medium  message'], JSON.stringify(text))
    }
  })

  test('text that is hex or a bare 32-byte hash: BLIND_SIGNING, the text still shown', async () => {
    const hash = 'a'.repeat(64)

    for (const text of ['0xdeadbeef', ` 0x${hash} `, hash, `0x${'AB'.repeat(32)}`]) {
      const result = await sign(text)
      assert.equal(result.summary?.code, 'summary.blind', text)
      assert.equal(fieldOf(result, 'message', 'text').value, text)
      assert.deepEqual(shape(result), ['BLIND_SIGNING high  message'], text)
    }

    // Near misses: short hex without 0x, a hash one character short, hex inside a sentence.
    for (const text of ['deadbeef', 'a'.repeat(63), 'Nonce: 0xdeadbeef', '0x']) {
      assert.deepEqual(codes(await sign(text)), [], text)
    }
  })
})

describe('byte messages', () => {
  test('valid UTF-8 bytes read as the text they are', async () => {
    const result = await sign(utf8('Grüße 👋\nfrom bytes'))
    assert.deepEqual(result.source, {decoder: 'eip191', kind: 'builtin'})
    assert.equal(fieldOf(result, 'message', 'text').value, 'Grüße 👋\nfrom bytes')
    assert.deepEqual(codes(result), [])
  })

  test('bytes that are not text: BLIND_SIGNING, the bytes raw', async () => {
    for (const bytes of [
      Uint8Array.of(0x00, 0xff, 0x10),
      Uint8Array.of(0xc3, 0x28),
      Uint8Array.of(0x68, 0x69, 0x07),
      Uint8Array.from({length: 32}, (_, index) => index * 7),
    ]) {
      const result = await sign(bytes)
      assert.deepEqual(result.source, {kind: 'unknown'})
      assert.equal(result.summary?.code, 'summary.blind')
      assert.deepEqual(result.fields, [])
      assert.deepEqual(
        result.raw.map(field => [field.id, field.kind === 'raw' ? field.value : undefined]),
        [['data', `0x${Buffer.from(bytes).toString('hex')}`]]
      )
      assert.deepEqual(shape(result), ['BLIND_SIGNING high  '])
    }
  })

  test('what is neither text nor bytes is INVALID_INPUT', async () => {
    for (const bad of [42, null, undefined, {raw: '0x00'}, ['a']]) {
      await rejects(() => sign(bad as unknown as SignableMessage), 'INVALID_INPUT')
    }
  })
})

describe('Sign-In with Ethereum (ERC-4361)', () => {
  test('a full request: every field, checked against the signer, the chain, the URI and the site', async () => {
    const message = signIn({
      expirationTime: new Date(NOW + HOUR),
      notBefore: new Date(NOW - HOUR),
      requestId: 'request-7',
      resources: ['ipfs://bafybeiemxf5abjwjbikoz4mc3a3dla6ual3jsgpdr4cjr3oz3evfyavhwq', 'https://example.com/terms'],
      statement: 'I accept the Terms of Service.',
    })
    const result = await sign(message, {origin: 'app.example.com'})
    assert.deepEqual(result.source, {decoder: 'siwe', kind: 'builtin'})
    assert.equal(result.intent.code, 'intent.signIn')
    assert.deepEqual([result.summary?.code, result.summary?.params], ['summary.signIn', {domain: 'app.example.com'}])
    assert.deepEqual(
      result.fields.map(field => field.id),
      [
        'domain',
        'account',
        'statement',
        'uri',
        'chainId',
        'issuedAt',
        'expiry',
        'notBefore',
        'nonce',
        'version',
        'requestId',
        'resources',
      ]
    )
    assert.equal(fieldOf(result, 'account', 'address').relation, 'self')
    assert.equal(fieldOf(result, 'chainId', 'number').value, 1)
    assert.deepEqual(
      fieldOf(result, 'resources', 'list').items.map(item => item.id),
      ['resource-0', 'resource-1']
    )
    // Moments that are not deadlines are past without having expired.
    assert.deepEqual(
      [fieldOf(result, 'issuedAt', 'datetime').value, fieldOf(result, 'issuedAt', 'datetime').expired],
      [NOW - HOUR, false]
    )
    assert.equal(fieldOf(result, 'notBefore', 'datetime').expired, false)
    assert.equal(fieldOf(result, 'expiry', 'datetime').expired, false)
    assert.deepEqual(codes(result), [])
  })

  test('another account than the signer: ethereum.SIGN_IN_ACCOUNT_MISMATCH (high); the signer in any case is fine', async () => {
    assert.deepEqual(shape(await sign(signIn(), {signer: OTHER})), ['ethereum.SIGN_IN_ACCOUNT_MISMATCH high  account'])
    assert.deepEqual(codes(await sign(signIn(), {signer: SIGNER.toUpperCase().replace('0X', '0x')})), [])
    // No signer given: nothing to compare.
    assert.deepEqual(codes(await clearSignMessage(mainnet, signIn(), {resolvers: {clock: {now: () => NOW}}})), [])
  })

  test('another chain: ethereum.SIGN_IN_CHAIN_MISMATCH (medium)', async () => {
    assert.deepEqual(shape(await sign(signIn({chainId: 10}))), ['ethereum.SIGN_IN_CHAIN_MISMATCH medium  chainId'])
  })

  test('another site than the one asking: ethereum.SIGN_IN_DOMAIN_MISMATCH (high); its scheme, port or case is fine', async () => {
    assert.deepEqual(shape(await sign(signIn(), {origin: 'app.example.co'})), [
      'ethereum.SIGN_IN_DOMAIN_MISMATCH high  domain',
    ])
    assert.deepEqual(shape(await sign(signIn(), {origin: 'example.com'})), [
      'ethereum.SIGN_IN_DOMAIN_MISMATCH high  domain',
    ])

    for (const origin of ['app.example.com', 'APP.Example.com', 'https://app.example.com', 'app.example.com:443']) {
      assert.deepEqual(codes(await sign(signIn(), {origin})), [], origin)
    }

    const withScheme = await sign(signIn({scheme: 'https'}), {origin: 'app.example.com'})
    assert.equal(fieldOf(withScheme, 'domain', 'text').value, 'https://app.example.com')
    assert.deepEqual(codes(withScheme), [])
  })

  test('a URI off the domain: ethereum.SIGN_IN_URI_MISMATCH (medium); a port, a path or a URI without a host is fine', async () => {
    assert.deepEqual(shape(await sign(signIn({uri: 'https://evil.example/login'}))), [
      'ethereum.SIGN_IN_URI_MISMATCH medium  uri',
    ])

    for (const uri of ['https://app.example.com:8443/x?y=1', 'https://user@app.example.com', 'did:key:z6Mkabc']) {
      assert.deepEqual(codes(await sign(signIn({uri}))), [], uri)
    }
  })

  test('an expiration past: EXPIRED (low); a minute ahead: nothing', async () => {
    const expired = await sign(signIn({expirationTime: new Date(NOW - 1000)}))
    assert.equal(fieldOf(expired, 'expiry', 'datetime').expired, true)
    assert.deepEqual(shape(expired), ['EXPIRED low  expiry'])
    assert.deepEqual(codes(await sign(signIn({expirationTime: new Date(NOW + 60_000)}))), [])
  })

  test('hidden characters in a sign-in`s words: HIDDEN_CHARACTERS on that field', async () => {
    const hidden = await sign(signIn({statement: 'Sign in ‮to claim'}))
    assert.equal(hidden.intent.code, 'intent.signIn')
    assert.deepEqual(shape(hidden), ['HIDDEN_CHARACTERS medium  statement'])
  })

  test('a request that opens as a sign-in but breaks the format: ethereum.MALFORMED_SIGN_IN, shown as text', async () => {
    const good = signIn()
    const broken = [
      good.replace('Version: 1', 'Version: 2'),
      good.replace('Nonce: a1b2c3d4e5f6', 'Nonce: short'),
      good.replace(`\n${SIGNER}\n`, '\n0x1234\n'),
      good.replace(/Issued At: .*/, 'Issued At: yesterday'),
      good.replace('Chain ID: 1', 'Chain ID: 01'),
      `${good}\nTrailing: line`,
      good.replace('URI: ', 'URL: '),
    ]

    for (const text of broken) {
      const result = await sign(text)
      assert.deepEqual(result.source, {decoder: 'eip191', kind: 'builtin'}, text)
      assert.equal(result.intent.code, 'intent.signMessage')
      assert.equal(fieldOf(result, 'message', 'text').value, text)
      assert.deepEqual(shape(result), ['ethereum.MALFORMED_SIGN_IN medium  message'], text)
    }

    // The same request as bytes reads the same.
    assert.equal((await sign(utf8(good))).intent.code, 'intent.signIn')
  })

  test('plainText: a sign-in reads as a person would say it', async () => {
    const result = await sign(signIn({statement: 'I accept the Terms of Service.'}), {origin: 'app.example.com'})
    assert.equal(
      plainText(result),
      [
        'Sign in: Sign in to app.example.com',
        'Message on Ethereum. Risk: none.',
        'Domain: app.example.com',
        'Account: 0x1111111111111111111111111111111111111111, this account',
        'Statement: I accept the Terms of Service.',
        'URI: https://app.example.com/login',
        'Chain: 1',
        `Issued at: ${iso(NOW - HOUR)}`,
        'Nonce: a1b2c3d4e5f6',
        'Version: 1',
        'Understood by: built-in decoder (siwe)',
      ].join('\n')
    )
  })
})

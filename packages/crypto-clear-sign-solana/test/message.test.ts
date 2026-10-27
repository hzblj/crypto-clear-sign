import assert from 'node:assert/strict'
import {describe, test} from 'node:test'

import {findField, isClearSignError, plainText} from '@hzblj/crypto-clear-sign'
import {isCryptoError, utf8} from '@hzblj/nitro-crypto/adapter'
import type {Address} from '@solana/kit'
import {getTransferSolInstruction} from '@solana-program/system'

import {clearSignMessage, type SolanaClearSignOptions} from '../src'
import {
  address,
  addressOf,
  asyncResolvers,
  chain,
  clock,
  codes,
  compile,
  devnet,
  field,
  NOW,
  OTHER,
  STRANGER,
  signer,
  syncResolvers,
  throwingResolvers,
  WALLET,
  warningOf,
} from './support'

const sign = (message: Uint8Array | string, options: SolanaClearSignOptions = {}) =>
  clearSignMessage(chain, message, {signer: WALLET, ...options, resolvers: {clock, ...options.resolvers}})

const DAY = 24 * 60 * 60 * 1000
const iso = (time: number) => new Date(time).toISOString()

/** A Sign In With Solana message, laid out as the wallet standard's `createSignInMessageText` writes it. */
const signIn = (input: {
  domain?: string
  address?: string
  statement?: string
  uri?: string
  version?: string
  chainId?: string
  nonce?: string
  issuedAt?: string
  expirationTime?: string
  notBefore?: string
  requestId?: string
  resources?: string[]
}) => {
  let message = `${input.domain ?? 'example.com'} wants you to sign in with your Solana account:\n${input.address ?? WALLET}`

  if (input.statement) {
    message += `\n\n${input.statement}`
  }

  const fields: string[] = []
  const add = (label: string, value: string | undefined) => value !== undefined && fields.push(`${label}: ${value}`)
  add('URI', input.uri)
  add('Version', input.version)
  add('Chain ID', input.chainId)
  add('Nonce', input.nonce)
  add('Issued At', input.issuedAt)
  add('Expiration Time', input.expirationTime)
  add('Not Before', input.notBefore)
  add('Request ID', input.requestId)

  if (input.resources) {
    fields.push('Resources:', ...input.resources.map(resource => `- ${resource}`))
  }

  return fields.length > 0 ? `${message}\n\n${fields.join('\n')}` : message
}

const FULL = {
  chainId: 'mainnet',
  expirationTime: iso(NOW + DAY),
  issuedAt: iso(NOW - 60_000),
  nonce: 'oBbLoEldZs',
  notBefore: iso(NOW - 60_000),
  requestId: 'request-1',
  resources: ['https://example.com/terms', 'ipfs://bafy'],
  statement: 'Sign in to manage your vaults.',
  uri: 'https://example.com/login',
  version: '1',
}

describe('clearSignMessage: text and bytes', () => {
  test('text: the message as it is, its UTF-8 bytes read the same', async () => {
    const result = await sign('Hello from Expo')

    assert.equal(result.kind, 'message')
    assert.equal(result.intent.code, 'intent.signMessage')
    assert.deepEqual(result.source, {decoder: 'text', kind: 'builtin'})
    assert.equal(field(result, 'message', 'text').value, 'Hello from Expo')
    assert.equal(result.risk, 'none')
    assert.deepEqual(await sign(utf8.encode('Hello from Expo')), result)
  })

  test('HIDDEN_CHARACTERS: text that reorders or hides, medium on the message; not for line breaks and emoji', async () => {
    const result = await sign('Approve‮dlrow')
    const raised = warningOf(result, 'HIDDEN_CHARACTERS')

    assert.equal(raised.severity, 'medium')
    assert.deepEqual(raised.fields, ['message'])
    assert.deepEqual(codes(await sign('Line one\nLine two 👋🏽')), [])
  })

  test('BLIND_SIGNING: bytes that are not text are raw, high', async () => {
    const result = await sign(Uint8Array.from([0xde, 0xad, 0xbe, 0xef, 0xff]))
    const raised = warningOf(result, 'BLIND_SIGNING')

    assert.equal(raised.severity, 'high')
    assert.deepEqual(raised.fields, ['data'])
    assert.deepEqual(result.source, {kind: 'unknown'})
    assert.equal(result.summary?.code, 'summary.blind')
    assert.equal(field(result, 'data', 'raw').value, '0xdeadbeefff')
    assert.ok(!codes(await sign('text')).includes('BLIND_SIGNING'))
  })

  test('MESSAGE_IS_TRANSACTION: bytes a transaction of the signer`s would sign are critical', async () => {
    const message = compile([
      getTransferSolInstruction({amount: 1n, destination: STRANGER as Address, source: signer(WALLET)}),
    ])
    const result = await sign(message)
    const raised = warningOf(result, 'solana.MESSAGE_IS_TRANSACTION')

    assert.equal(raised.severity, 'critical')
    assert.deepEqual(raised.fields, ['data'])
    assert.equal(result.risk, 'critical')

    const without = await clearSignMessage(chain, message)
    assert.ok(codes(without).includes('solana.MESSAGE_IS_TRANSACTION'))
  })

  test('MESSAGE_IS_TRANSACTION: not for a transaction the signer is not a signer of', async () => {
    const message = compile(
      [getTransferSolInstruction({amount: 1n, destination: STRANGER as Address, source: signer(OTHER)})],
      {
        feePayer: OTHER,
      }
    )
    const result = await sign(message)

    assert.deepEqual(codes(result), ['BLIND_SIGNING'])
  })

  test('errors: a message that is neither text nor bytes, an option out of range', async () => {
    await assert.rejects(
      () => clearSignMessage(chain, 42 as never),
      error => isClearSignError(error, 'INVALID_ARGUMENT')
    )
    await assert.rejects(
      () => clearSignMessage(chain, 'hi', {origin: ''}),
      error => isClearSignError(error, 'INVALID_ARGUMENT')
    )
    await assert.rejects(
      () => clearSignMessage(chain, 'hi', {signer: 'x'}),
      error => isClearSignError(error, 'INVALID_ARGUMENT')
    )
  })

  test('empty bytes and empty text are an empty message: nothing hidden, nothing blind', async () => {
    for (const empty of [new Uint8Array(), '']) {
      const result = await sign(empty)

      assert.equal(result.kind, 'message')
      assert.deepEqual(result.source, {decoder: 'text', kind: 'builtin'})
      assert.equal(result.intent.code, 'intent.signMessage')
      assert.equal(field(result, 'message', 'text').value, '')
      assert.deepEqual(codes(result), [])
      assert.equal(result.risk, 'none')
    }
  })

  test('plainText reads it', async () => {
    assert.match(
      plainText(await sign('Hello')),
      /^Sign message: Sign a message\nMessage on Solana\. Risk: none\.\nMessage: Hello/
    )
  })
})

describe('clearSignMessage: Sign In With Solana', () => {
  test('every field of the message, the account resolved', async () => {
    const result = await sign(signIn(FULL), {origin: 'https://example.com'})

    assert.equal(result.kind, 'message')
    assert.equal(result.intent.code, 'intent.signIn')
    assert.deepEqual(result.summary, {
      code: 'summary.signIn',
      params: {domain: 'example.com'},
      text: 'Sign in to example.com',
    })
    assert.deepEqual(result.source, {decoder: 'siws', kind: 'builtin'})
    assert.equal(field(result, 'domain', 'text').value, 'example.com')
    assert.equal(addressOf(result, 'account').relation, 'self')
    assert.equal(field(result, 'statement', 'text').value, FULL.statement)
    assert.equal(field(result, 'uri', 'text').value, FULL.uri)
    assert.equal(field(result, 'network', 'text').value, 'mainnet')
    assert.equal(field(result, 'nonce', 'text').value, FULL.nonce)
    assert.equal(field(result, 'issuedAt', 'datetime').value, NOW - 60_000)
    assert.equal(field(result, 'issuedAt', 'datetime').expired, false)
    assert.equal(field(result, 'notBefore', 'datetime').expired, false)
    assert.equal(field(result, 'expiry', 'datetime').value, NOW + DAY)
    assert.equal(field(result, 'requestId', 'text').value, 'request-1')
    assert.equal(field(result, 'version', 'text').value, '1')
    assert.deepEqual(
      field(result, 'resources', 'list').items.map(item => item.kind === 'text' && item.value),
      FULL.resources
    )
    assert.deepEqual(codes(result), [])
  })

  test('the smallest one: a domain and an address', async () => {
    const result = await sign(signIn({}))

    assert.equal(result.intent.code, 'intent.signIn')
    assert.deepEqual(
      result.fields.map(entry => entry.id),
      ['domain', 'account']
    )
  })

  test('SIGN_IN_DOMAIN_MISMATCH: another site than the one asking, high; not the same host, by origin or host', async () => {
    const phished = await sign(signIn(FULL), {origin: 'https://examp1e.com'})
    const raised = warningOf(phished, 'solana.SIGN_IN_DOMAIN_MISMATCH')

    assert.equal(raised.severity, 'high')
    assert.deepEqual(raised.fields, ['domain'])

    for (const origin of ['https://example.com', 'https://EXAMPLE.com:443', 'example.com']) {
      assert.deepEqual(codes(await sign(signIn(FULL), {origin})), [], origin)
    }

    assert.ok(
      codes(await sign(signIn({domain: 'example.com:8080'}), {origin: 'https://example.com'})).includes(
        'solana.SIGN_IN_DOMAIN_MISMATCH'
      )
    )
    assert.deepEqual(codes(await sign(signIn({domain: 'localhost:3000'}), {origin: 'http://localhost:3000'})), [])
  })

  test('an origin with user info is compared by its host; user info in front of another host is that host', async () => {
    for (const origin of ['https://alice@example.com', 'https://alice:secret@example.com:443', 'alice@example.com']) {
      assert.deepEqual(codes(await sign(signIn(FULL), {origin})), [], origin)
    }

    const phished = await sign(signIn(FULL), {origin: 'https://example.com@evil.example'})
    assert.deepEqual(warningOf(phished, 'solana.SIGN_IN_DOMAIN_MISMATCH').fields, ['domain'])
  })

  test('a domain with user info is no sign-in message: it would show one site and be another`s', async () => {
    const result = await sign(signIn({...FULL, domain: 'example.com@evil.example'}), {origin: 'https://evil.example'})

    assert.equal(result.intent.code, 'intent.signMessage')
    assert.deepEqual(result.source, {decoder: 'text', kind: 'builtin'})
    assert.deepEqual(warningOf(result, 'solana.SIGN_IN_MALFORMED').fields, ['message'])
  })

  test('HIDDEN_CHARACTERS in a resource, on that resource; none in plain ones', async () => {
    const result = await sign(signIn({...FULL, resources: ['https://example.com/terms', 'https://example.com/​pay']}))
    const raised = warningOf(result, 'HIDDEN_CHARACTERS')

    assert.equal(result.intent.code, 'intent.signIn')
    assert.deepEqual(raised.fields, ['resource-1'])
    assert.equal(raised.severity, 'medium')
    assert.deepEqual(
      field(result, 'resources', 'list').items.map(item => item.id),
      ['resource-0', 'resource-1']
    )
    assert.deepEqual(codes(await sign(signIn(FULL))), [])
  })

  test('SIGN_IN_ADDRESS_MISMATCH: another account than the one signing; not without a signer', async () => {
    const result = await sign(signIn({address: STRANGER}))
    const raised = warningOf(result, 'solana.SIGN_IN_ADDRESS_MISMATCH')

    assert.equal(raised.severity, 'high')
    assert.deepEqual(raised.fields, ['account'])
    assert.deepEqual(codes(await clearSignMessage(chain, signIn({address: STRANGER}))), [])
  })

  test('SIGN_IN_CHAIN_MISMATCH: another cluster, by any of its names; not this one', async () => {
    for (const chainId of [
      'devnet',
      'solana:devnet',
      'solana:EtWTRABZaYq6iMfeYKouRu166VL2xqa1',
      'localnet',
      'eip155:1',
    ]) {
      const result = await sign(signIn({chainId}))
      assert.equal(warningOf(result, 'solana.SIGN_IN_CHAIN_MISMATCH').severity, 'medium', chainId)
    }

    for (const chainId of ['mainnet', 'solana:mainnet', 'mainnet-beta', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp']) {
      assert.deepEqual(codes(await sign(signIn({chainId}))), [], chainId)
    }

    const onDevnet = await clearSignMessage(devnet, signIn({chainId: 'devnet'}), {resolvers: {clock}})
    assert.deepEqual(codes(onDevnet), [])
  })

  test('EXPIRED and LONG_LIVED by the expiration time; neither for a week', async () => {
    const expired = await sign(signIn({expirationTime: iso(NOW - 1000)}))
    assert.equal(warningOf(expired, 'EXPIRED').severity, 'low')
    assert.deepEqual(warningOf(expired, 'EXPIRED').fields, ['expiry'])
    assert.equal(field(expired, 'expiry', 'datetime').expired, true)

    const forever = await sign(signIn({expirationTime: iso(NOW + 365 * DAY)}))
    assert.equal(warningOf(forever, 'LONG_LIVED').severity, 'medium')

    assert.deepEqual(codes(await sign(signIn({expirationTime: iso(NOW + 7 * DAY)}))), [])
  })

  test('HIDDEN_CHARACTERS in a field of the message', async () => {
    const result = await sign(signIn({statement: 'Sign in​ to claim'}))

    assert.deepEqual(warningOf(result, 'HIDDEN_CHARACTERS').fields, ['statement'])
  })

  test('SIGN_IN_MALFORMED: text that starts as one and breaks the format is plain text, medium', async () => {
    const header = `example.com wants you to sign in with your Solana account:\n${WALLET}`

    for (const text of [
      signIn({...FULL, version: '2'}),
      signIn({issuedAt: 'yesterday'}),
      signIn({uri: 'not a uri'}),
      `${header}\n\nNonce: 1\nURI: https://example.com`,
      `${header}\n\nURI: https://a\nURI: https://b`,
      `${header}\nStatement without a blank line`,
      `${header}\n\nStatement\nsecond line`,
      `${header}\n\nURI: https://example.com\ngarbage`,
      `${header}\n\nResources:\nhttps://no-dash`,
      `${header}\n\nURI: `,
      ` wants you to sign in with your Solana account:\n${WALLET}`,
      'example.com wants you to sign in with your Solana account:',
      `example.com wants you to sign in with your Solana account:\nnot-an-address`,
    ]) {
      const result = await sign(text)

      assert.equal(result.intent.code, 'intent.signMessage', text)
      assert.deepEqual(warningOf(result, 'solana.SIGN_IN_MALFORMED').fields, ['message'])
    }
  })

  test('trailing line breaks are allowed, as the format`s parser allows them', async () => {
    assert.equal((await sign(`${signIn(FULL)}\n\n`)).intent.code, 'intent.signIn')
  })
})

describe('clearSignMessage: off-chain messages', () => {
  test('version 0: the text, the signers, the application and the format', async () => {
    const applicationDomain = address(80)
    const message = chain.encodeOffchainMessage({applicationDomain, signers: [WALLET], text: 'Approve', version: 0})
    const result = await sign(message)

    assert.equal(result.kind, 'offchain-message')
    assert.deepEqual(result.source, {decoder: 'offchain-message', kind: 'builtin'})
    assert.equal(field(result, 'message', 'text').value, 'Approve')
    assert.equal(addressOf(result, 'applicationDomain').value, applicationDomain)
    assert.equal(field(result, 'format', 'text').value, 'restricted-ascii')
    assert.equal(field(result, 'offchainVersion', 'number').value, 0)
    assert.equal(field(result, 'signers', 'list').items.length, 1)
    assert.deepEqual(codes(result), [])
  })

  test('version 0 in extended UTF-8: text past what a hardware wallet shows, its hidden characters warned about', async () => {
    const applicationDomain = address(80)
    const long = `${'Terms. '.repeat(200)}Ünïcödé`
    const plain = await sign(
      chain.encodeOffchainMessage({applicationDomain, signers: [WALLET], text: long, version: 0})
    )

    assert.equal(plain.kind, 'offchain-message')
    assert.equal(field(plain, 'format', 'text').value, 'extended-utf8')
    assert.equal(field(plain, 'message', 'text').value, long)
    assert.equal(addressOf(plain, 'applicationDomain').value, applicationDomain)
    assert.deepEqual(codes(plain), [])

    const hiding = `${long}‮gnp.exe`
    const hidden = await sign(
      chain.encodeOffchainMessage({applicationDomain, signers: [WALLET], text: hiding, version: 0})
    )
    const raised = warningOf(hidden, 'HIDDEN_CHARACTERS')

    assert.equal(field(hidden, 'format', 'text').value, 'extended-utf8')
    assert.deepEqual(raised.fields, ['message'])
    assert.equal(hidden.risk, 'medium')
  })

  test('version 1, and OTHER_SIGNERS when others must sign too', async () => {
    const message = chain.encodeOffchainMessage({signers: [WALLET, OTHER], text: 'Joint statement', version: 1})
    const result = await sign(message)
    const raised = warningOf(result, 'solana.OTHER_SIGNERS')

    assert.equal(field(result, 'offchainVersion', 'number').value, 1)
    assert.equal(findField(result, 'applicationDomain'), undefined)
    assert.equal(raised.severity, 'low')
    assert.deepEqual(raised.fields, ['signers'])

    const alone = await clearSignMessage(
      chain,
      chain.encodeOffchainMessage({signers: [WALLET], text: 'Mine', version: 1})
    )
    assert.deepEqual(codes(alone), [])
  })

  test('a Sign In With Solana message inside one is a sign-in', async () => {
    const message = chain.encodeOffchainMessage({signers: [WALLET], text: signIn(FULL), version: 1})
    const result = await sign(message, {origin: 'https://evil.example'})

    assert.equal(result.kind, 'offchain-message')
    assert.equal(result.intent.code, 'intent.signIn')
    assert.ok(codes(result).includes('solana.SIGN_IN_DOMAIN_MISMATCH'))
  })

  test('errors: one the adapter refuses is INVALID_INPUT; a signer it does not name is INVALID_ARGUMENT', async () => {
    const message = chain.encodeOffchainMessage({signers: [WALLET], text: 'Mine', version: 1})

    await assert.rejects(
      () => sign(message.subarray(0, 20)),
      error => isClearSignError(error, 'INVALID_INPUT') && isCryptoError((error as Error).cause)
    )
    await assert.rejects(
      () => clearSignMessage(chain, message, {signer: STRANGER}),
      error => isClearSignError(error, 'INVALID_ARGUMENT')
    )
  })
})

describe('clearSignMessage: resolvers', () => {
  test('offline, sync, async and failing resolvers', async () => {
    const text = signIn({address: OTHER})
    const offline = await clearSignMessage(chain, text, {resolvers: {clock}})
    const sync = await clearSignMessage(chain, text, {resolvers: syncResolvers})
    const later = await clearSignMessage(chain, text, {resolvers: asyncResolvers})
    const failing = await clearSignMessage(chain, text, {resolvers: throwingResolvers})

    assert.equal(addressOf(offline, 'account').relation, 'unknown')
    assert.equal(addressOf(sync, 'account').name, 'Savings')
    assert.deepEqual(later, sync)
    assert.equal(warningOf(failing, 'RESOLVER_FAILED').params?.resolvers, 'tokens, names')
    assert.equal(addressOf(failing, 'account').relation, 'unknown')
  })
})

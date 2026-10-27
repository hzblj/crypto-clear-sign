import assert from 'node:assert/strict'
import {describe, test} from 'node:test'

import {findField, INTENTS, LABELS, plainText, SUMMARIES} from '@hzblj/crypto-clear-sign'

import {BITCOIN_CHAIN_IDS, BITCOIN_TEXTS, clearSignMessage} from '../src'
import {asyncResolvers, chain, clock, codes, crypto, field, has, NOW, only, rejectsWith, setup} from './support'

describe('clearSignMessage: text', async () => {
  const {accounts} = await setup()
  const {other, segwit, taproot} = accounts

  test('the text, the account it is signed for, and the format', async () => {
    const result = await clearSignMessage(chain, 'Hello from Expo', {address: segwit.address})

    assert.equal(result.kind, 'message')
    assert.equal(result.chain.id, BITCOIN_CHAIN_IDS.mainnet)
    assert.equal(result.intent.code, INTENTS.signMessage.code)
    assert.equal(result.summary?.code, SUMMARIES.signMessage.code)
    assert.deepEqual(result.source, {decoder: 'bip322', kind: 'builtin'})
    const message = field(result, 'message')
    assert.ok(message.kind === 'text' && message.value === 'Hello from Expo')
    const signer = field(result, 'signer')
    assert.ok(signer.kind === 'address')
    assert.deepEqual([signer.value, signer.relation, signer.label.code], [segwit.address, 'self', LABELS.account.code])
    const format = field(result, 'format')
    assert.ok(format.kind === 'text' && format.value === 'BIP-322' && format.secondary)
    assert.deepEqual(codes(result), [])
    assert.equal(result.risk, 'none')

    const legacy = await clearSignMessage(chain, 'Hello from Expo', {format: 'legacy', signer: segwit.address})
    assert.deepEqual(legacy.source, {decoder: 'bip137', kind: 'builtin'})
    const legacyFormat = field(legacy, 'format')
    assert.ok(legacyFormat.kind === 'text' && legacyFormat.value === 'BIP-137 (legacy)')
    const self = field(legacy, 'signer')
    assert.ok(self.kind === 'address' && self.relation === 'self')
  })

  test('UTF-8 bytes read as their text; without an address there is no account field', async () => {
    const result = await clearSignMessage(chain, new TextEncoder().encode('Příliš žluťoučký kůň 🐎'))
    const message = field(result, 'message')
    assert.ok(message.kind === 'text' && message.value === 'Příliš žluťoučký kůň 🐎')
    assert.equal(findField(result, 'signer'), undefined)
    assert.deepEqual(codes(result), [])
  })

  test('hidden characters are flagged, plain text is not', async () => {
    const hidden = await clearSignMessage(chain, 'Pay to gpj.exe‮', {address: taproot.address})
    const warning = only(hidden, 'HIDDEN_CHARACTERS')
    assert.deepEqual([warning.severity, warning.fields], ['medium', ['message']])
    assert.match(plainText(hidden), /\\u\{202E\}/)

    const plain = await clearSignMessage(chain, 'Pay to gpj.exe\nand\ttabs', {address: taproot.address})
    assert.equal(has(plain, 'HIDDEN_CHARACTERS'), false)
  })

  test('bytes that are not text, and text that is only hex, are signed blind', async () => {
    const binary = await clearSignMessage(chain, Uint8Array.of(0xff, 0xfe, 0x00, 0x80), {address: segwit.address})
    assert.equal(binary.summary?.code, SUMMARIES.blind.code)
    assert.deepEqual(binary.source, {kind: 'unknown'})
    const raw = field(binary, 'message')
    assert.ok(raw.kind === 'raw' && raw.value === '0xfffe0080')
    const blind = only(binary, 'BLIND_SIGNING')
    assert.deepEqual([blind.severity, blind.fields], ['high', ['message']])

    const hash = await clearSignMessage(chain, `0x${'ab'.repeat(32)}`)
    assert.deepEqual(only(hash, 'BLIND_SIGNING').fields, ['message'])
    const bare = await clearSignMessage(chain, 'AB'.repeat(16))
    assert.equal(has(bare, 'BLIND_SIGNING'), true)

    const short = await clearSignMessage(chain, 'deadbeef')
    assert.equal(has(short, 'BLIND_SIGNING'), false)
    const words = await clearSignMessage(chain, `nonce ${'ab'.repeat(32)}`)
    assert.equal(has(words, 'BLIND_SIGNING'), false)
  })

  test('resolvers: a name for the account, sync or async, and RESOLVER_FAILED when they fail', async () => {
    const names = {name: () => ({name: 'Treasury', relation: 'own' as const})}

    for (const resolvers of [{names}, asyncResolvers({names})]) {
      const result = await clearSignMessage(chain, 'hi', {address: other.address, resolvers, signer: segwit.address})
      const account = field(result, 'signer')
      assert.ok(account.kind === 'address')
      assert.deepEqual([account.name, account.relation], ['Treasury', 'own'])
    }

    const failed = await clearSignMessage(chain, 'hi', {
      address: other.address,
      resolvers: {
        names: {
          name: () => {
            throw new Error('offline')
          },
        },
      },
      signer: segwit.address,
    })
    assert.deepEqual(only(failed, 'RESOLVER_FAILED').params, {resolvers: 'names'})
    const account = field(failed, 'signer')
    assert.ok(account.kind === 'address' && account.relation === 'unknown')
  })

  test('plain text', async () => {
    const text = plainText(await clearSignMessage(chain, 'Hello from Expo', {address: segwit.address}))
    assert.match(text, /^Sign message: Sign a message\nMessage on Bitcoin\. Risk: none\./)
    assert.match(text, /Message: Hello from Expo/)
    assert.match(text, /Account: bc1q.+, this account/)
  })
})

describe('clearSignMessage: sign-in (CAIP-122)', async () => {
  const {accounts} = await setup()
  const {other, segwit} = accounts

  const signIn = ({
    address = segwit.address,
    chainId = '000000000019d6689c085ae165831e93',
    expiration = '2026-10-28T12:00:00Z',
    statement = 'I accept the Terms of Service: https://example.com/tos',
  }: {
    address?: string
    chainId?: string
    expiration?: string
    statement?: string
  } = {}) =>
    [
      'example.com wants you to sign in with your Bitcoin account:',
      address,
      '',
      ...(statement === '' ? [''] : [statement, '']),
      'URI: https://example.com/login',
      'Version: 1',
      `Chain ID: ${chainId}`,
      'Nonce: 32891756',
      'Issued At: 2026-10-27T11:00:00Z',
      `Expiration Time: ${expiration}`,
      'Resources:',
      '- ipfs://bafybeiemxf5abjwjbikoz4mc3a3dla6ual3jsgpdr4cjr3oz3evfyavhwq',
      '- https://example.com/my-web2-claim.json',
    ].join('\n')

  test('read into its fields: domain, account, statement, URI, network, nonce, times, resources', async () => {
    const result = await clearSignMessage(chain, signIn(), {address: segwit.address, resolvers: {clock}})

    assert.equal(result.intent.code, INTENTS.signIn.code)
    assert.deepEqual(result.summary?.params, {domain: 'example.com'})
    assert.deepEqual(result.source, {decoder: 'caip122', kind: 'builtin'})
    const domain = field(result, 'domain')
    assert.ok(domain.kind === 'text' && domain.value === 'example.com')
    const account = field(result, 'account')
    assert.ok(account.kind === 'address' && account.relation === 'self' && account.value === segwit.address)
    const statement = field(result, 'statement')
    assert.ok(statement.kind === 'text' && statement.value.startsWith('I accept'))
    const uri = field(result, 'uri')
    assert.ok(uri.kind === 'text' && uri.value === 'https://example.com/login')
    const nonce = field(result, 'nonce')
    assert.ok(nonce.kind === 'text' && nonce.value === '32891756')
    const issued = field(result, 'issuedAt')
    assert.ok(issued.kind === 'datetime' && issued.value === NOW - 3_600_000)
    const expiry = field(result, 'expiry')
    assert.ok(expiry.kind === 'datetime' && !expiry.expired)
    const resources = field(result, 'resources')
    assert.ok(resources.kind === 'list' && resources.items.length === 2)
    const whole = field(result, 'message')
    assert.ok(whole.kind === 'text' && whole.secondary && whole.value === signIn())
    assert.deepEqual(codes(result), [])
    assert.match(plainText(result), /^Sign in: Sign in to example\.com/)
  })

  test('without a statement, too', async () => {
    const result = await clearSignMessage(chain, signIn({statement: ''}), {address: segwit.address})
    assert.equal(result.intent.code, INTENTS.signIn.code)
    assert.equal(findField(result, 'statement'), undefined)
  })

  test('another account than the one signing: flagged', async () => {
    const result = await clearSignMessage(chain, signIn({address: other.address}), {
      address: segwit.address,
      resolvers: {clock},
    })
    const mismatch = only(result, 'bitcoin.SIGN_IN_MISMATCH')
    assert.deepEqual([mismatch.severity, mismatch.fields], ['high', ['account']])
    const account = field(result, 'account')
    assert.ok(account.kind === 'address' && account.relation === 'unknown')
  })

  test('past its expiry: EXPIRED', async () => {
    const result = await clearSignMessage(chain, signIn({expiration: '2026-10-27T11:30:00Z'}), {
      address: segwit.address,
      resolvers: {clock},
    })
    const expired = only(result, 'EXPIRED')
    assert.deepEqual([expired.severity, expired.fields], ['low', ['expiry']])
  })

  test('for another chain: CHAIN_MISMATCH; the full CAIP-2 id reads too', async () => {
    await rejectsWith(
      clearSignMessage(chain, signIn({chainId: '000000000933ea01ad0ee984209779ba'}), {address: segwit.address}),
      'CHAIN_MISMATCH'
    )
    const full = await clearSignMessage(chain, signIn({chainId: BITCOIN_CHAIN_IDS.mainnet}), {address: segwit.address})
    assert.equal(full.intent.code, INTENTS.signIn.code)
  })

  test('text that only starts like one is a plain message', async () => {
    for (const message of [
      'example.com wants you to sign in with your Bitcoin account:',
      'example.com wants you to sign in with your Bitcoin account:\nbc1q\n\nno URI here',
      'example.com wants you to sign in with your Bitcoin account:\nbc1q\n\nURI: x\nUnknown: field',
      'example.com wants you to sign in with your Ethereum account:\n0x\n\nURI: x',
    ]) {
      const result = await clearSignMessage(chain, message)
      assert.equal(result.intent.code, INTENTS.signMessage.code, message)
    }
  })

  test('hidden characters in a sign-in message are flagged on the fields that carry them', async () => {
    const result = await clearSignMessage(chain, signIn({statement: 'Accept​ the terms'}), {
      address: segwit.address,
      resolvers: {clock},
    })
    assert.deepEqual(only(result, 'HIDDEN_CHARACTERS').fields, ['message', 'statement'])
  })
})

describe('clearSignMessage: what it refuses', async () => {
  const {accounts} = await setup()

  test('an address of another network: CHAIN_MISMATCH; not an address: INVALID_ARGUMENT', async () => {
    const testnet = await (await crypto.createEphemeralWallet()).deriveAccount({chain: 'bitcoin-testnet'})
    await rejectsWith(clearSignMessage(chain, 'hi', {address: testnet.address}), 'CHAIN_MISMATCH')
    await rejectsWith(clearSignMessage(chain, 'hi', {signer: testnet.address}), 'CHAIN_MISMATCH')
    await rejectsWith(
      clearSignMessage(crypto.chains['bitcoin-testnet'], 'hi', {address: accounts.segwit.address}),
      'CHAIN_MISMATCH'
    )
    await rejectsWith(clearSignMessage(chain, 'hi', {address: 'not an address'}), 'INVALID_ARGUMENT')
  })

  test('options out of range, and a message that is neither text nor bytes', async () => {
    await rejectsWith(clearSignMessage(chain, 'hi', {format: 'bip137' as never}), 'INVALID_ARGUMENT')
    await rejectsWith(clearSignMessage(chain, 'hi', {testnet: 'testnet2' as never}), 'INVALID_ARGUMENT')
    await rejectsWith(clearSignMessage(chain, 42 as never), 'INVALID_INPUT')
  })

  test('the testnet option names the chain', async () => {
    const result = await clearSignMessage(crypto.chains['bitcoin-testnet'], 'hi', {testnet: 'testnet3'})
    assert.equal(result.chain.id, 'bip122:000000000933ea01ad0ee984209779ba')
    assert.equal(BITCOIN_TEXTS.label.format.code, 'bitcoin.label.format')
  })
})

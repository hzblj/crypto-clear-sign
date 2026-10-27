// Hostile input, seeded so a failure replays: malformed PSBTs, runestones and messages never crash. Each either
// reads (a result the core's checks accepted) or is refused with a ClearSignError, never anything else.

import assert from 'node:assert/strict'
import {describe, test} from 'node:test'

import {type ClearSigning, isClearSignError} from '@hzblj/crypto-clear-sign'

import {clearSignMessage, clearSignPsbt} from '../src'
import {decipher} from '../src/runes'
import {btcSignerPsbt, chain, runestoneScript, setup, utxo} from './support'

/** mulberry32: the same "random" cases on every run. */
const seeded = (seed: number) => {
  let state = seed
  const next = () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  return {
    bytes: (length: number) => Uint8Array.from({length}, () => Math.floor(next() * 256)),
    integer: (below: number) => Math.floor(next() * below),
    next,
  }
}

/** Reads or is refused as it should be: anything else fails the test. */
const settles = async (run: () => Promise<ClearSigning>): Promise<'read' | 'refused'> => {
  try {
    const result = await run()
    assert.ok(Object.isFrozen(result))

    return 'read'
  } catch (error) {
    assert.ok(
      isClearSignError(error, 'INVALID_INPUT') || isClearSignError(error, 'UNSUPPORTED'),
      `unexpected ${String(error)}`
    )
    // Messages name what is wrong, never the bytes.
    assert.doesNotMatch((error as Error).message, /[0-9a-f]{16}/)

    return 'refused'
  }
}

const mutate = (random: ReturnType<typeof seeded>, psbt: Uint8Array): Uint8Array => {
  const out = psbt.slice()

  switch (random.integer(4)) {
    case 0: {
      // Flip a few bytes.
      for (let flips = 1 + random.integer(4); flips > 0; flips--) {
        const at = random.integer(out.length)
        out[at] = (out[at] ?? 0) ^ (1 << random.integer(8))
      }

      return out
    }
    case 1:
      return out.subarray(0, random.integer(out.length))
    case 2: {
      const at = random.integer(out.length)

      return Uint8Array.from([...out.subarray(0, at), ...random.bytes(1 + random.integer(8)), ...out.subarray(at)])
    }
    default: {
      const at = random.integer(out.length)
      out.set(random.bytes(Math.min(8, out.length - at)), at)

      return out
    }
  }
}

describe('hostile PSBTs', async () => {
  const {accounts, xpubAccounts} = await setup()
  const {change, other, segwit, taproot} = accounts
  const options = {accounts: [...xpubAccounts]}
  const valid = [
    segwit.createPsbt(
      segwit.createTransaction({amount: 25_000n, feeRate: 2, to: other.address, utxos: [utxo('aa', 100_000)]})
    ),
    taproot.createPsbt(
      taproot.createTransaction({amount: 25_000n, feeRate: 2, to: other.address, utxos: [utxo('bb', 100_000)]})
    ),
    btcSignerPsbt(
      [
        {account: segwit, previous: true, sighashType: 0x83, value: 40_000n},
        {account: taproot, sighashType: 0x81, value: 60_000n},
      ],
      [
        {script: runestoneScript([2n, 3n, 4n, 99n, 8n, 10n, 10n, 1n, 0n, 840000n, 3n, 7n, 2n]), value: 0n},
        {account: other, noOrigin: true, value: 50_000n},
        {account: change, value: 49_000n},
      ],
      {lockTime: 900_000}
    ),
  ]

  test('random bytes, with and without the magic, are refused or read, never crash', async () => {
    const random = seeded(1)
    const outcomes = {read: 0, refused: 0}

    for (let round = 0; round < 300; round++) {
      const body = random.bytes(random.integer(300))
      const payload = round % 2 === 0 ? Uint8Array.from([0x70, 0x73, 0x62, 0x74, 0xff, ...body]) : body
      outcomes[await settles(() => clearSignPsbt(chain, payload, options))]++
    }

    assert.equal(outcomes.refused, 300)
  })

  test('mutations of real PSBTs are refused or read, never crash', async () => {
    const random = seeded(2)
    const outcomes = {read: 0, refused: 0}

    for (let round = 0; round < 900; round++) {
      const psbt = mutate(random, valid[round % valid.length] ?? new Uint8Array())
      outcomes[await settles(() => clearSignPsbt(chain, psbt, options))]++
    }

    // Some mutations land in values, keys or scripts the adapter accepts: both outcomes happen.
    assert.ok(outcomes.read > 0 && outcomes.refused > 0, JSON.stringify(outcomes))
  })

  test('text that is not Base64, or Base64 of garbage', async () => {
    const random = seeded(3)

    for (let round = 0; round < 100; round++) {
      const text = Buffer.from(random.bytes(random.integer(80))).toString(round % 2 === 0 ? 'base64' : 'latin1')
      assert.equal(await settles(() => clearSignPsbt(chain, text, options)), 'refused')
    }
  })

  test('any signature hash type, sequence and lock time reads', async () => {
    const random = seeded(4)

    for (let round = 0; round < 60; round++) {
      const psbt = btcSignerPsbt(
        [
          {
            account: segwit,
            previous: true,
            sequence: random.integer(2 ** 32),
            sighashType: random.integer(2 ** 32),
            value: 50_000n,
          },
        ],
        [{account: other, noOrigin: true, value: 49_000n}],
        {lockTime: random.integer(2 ** 32), version: 1 + random.integer(3)}
      )
      assert.equal(await settles(() => clearSignPsbt(chain, psbt, {...options, tipHeight: 870_000})), 'read')
    }
  })

  test('any OP_RETURN, runestone or not, reads', async () => {
    const random = seeded(5)

    for (let round = 0; round < 150; round++) {
      const tail = random.bytes(random.integer(80))
      const script = Uint8Array.from(round % 3 === 0 ? [0x6a, ...tail] : [0x6a, 0x5d, ...tail])
      const psbt = btcSignerPsbt(
        [{account: taproot, value: 50_000n}],
        [
          {script, value: BigInt(random.integer(2))},
          {account: other, noOrigin: true, value: 49_000n},
        ]
      )
      assert.equal(
        await settles(() =>
          clearSignPsbt(chain, psbt, {...options, assets: {assets: () => ({inscriptions: [{}], runes: [{}]})}})
        ),
        'read'
      )
    }
  })
})

describe('hostile runestones', () => {
  test('random payloads decipher to a runestone or a cenotaph, never throw', () => {
    const random = seeded(6)
    const kinds = new Set<string>()

    for (let round = 0; round < 3000; round++) {
      const script = Uint8Array.from([0x6a, 0x5d, ...random.bytes(random.integer(120))])
      const artifact = decipher([script, Uint8Array.of(0x51)])
      assert.ok(artifact !== undefined)
      kinds.add(artifact.kind)
    }

    assert.deepEqual([...kinds].sort(), ['cenotaph', 'runestone'])
  })

  test('random integers, as runestone messages, never throw', () => {
    const random = seeded(7)
    const tags = [0n, 1n, 2n, 3n, 4n, 5n, 6n, 8n, 10n, 12n, 14n, 16n, 18n, 20n, 22n, 126n, 127n]
    const kinds = new Set<string>()

    for (let round = 0; round < 3000; round++) {
      const integers = Array.from({length: random.integer(24)}, () => {
        const pick = random.integer(4)

        return pick === 0
          ? (tags[random.integer(tags.length)] ?? 0n)
          : pick === 1
            ? BigInt(random.integer(4))
            : pick === 2
              ? (1n << BigInt(random.integer(129))) - BigInt(random.integer(2))
              : BigInt(random.integer(2 ** 31))
      })
      const artifact = decipher([runestoneScript(integers), Uint8Array.of(0x51), Uint8Array.of(0x6a)])
      assert.ok(artifact !== undefined)
      kinds.add(artifact.kind)
    }

    assert.deepEqual([...kinds].sort(), ['cenotaph', 'runestone'])
  })
})

describe('hostile messages', async () => {
  const {accounts} = await setup()

  test('random bytes and text read as messages, never crash', async () => {
    const random = seeded(8)

    for (let round = 0; round < 300; round++) {
      const bytes = random.bytes(random.integer(200))
      const message = round % 2 === 0 ? bytes : String.fromCodePoint(...Array.from(bytes, byte => byte * 37))
      assert.equal(await settles(() => clearSignMessage(chain, message, {address: accounts.segwit.address})), 'read')
    }
  })

  test('sign-in messages cut short or padded anywhere read too', async () => {
    const random = seeded(9)
    const message = [
      'example.com wants you to sign in with your Bitcoin account:',
      accounts.segwit.address,
      '',
      'URI: https://example.com',
      'Version: 1',
      'Nonce: 1',
      'Issued At: not a date',
      'Expiration Time: 2026-13-45T99:99:99Z',
    ].join('\n')

    for (let round = 0; round < 200; round++) {
      const at = random.integer(message.length)
      const cut = round % 2 === 0 ? message.slice(0, at) : `${message.slice(0, at)}\n${message.slice(at)}`
      assert.equal(await settles(() => clearSignMessage(chain, cut)), 'read')
    }
  })
})

// The Runes decoder against ord's own tests (crates/ordinals/src/runestone.rs, varint.rs, rune.rs and
// spaced_rune.rs): each case below is one of theirs, with the transaction ord's `decipher` helper builds (a single
// output, the runestone), so an edict may name output 0 or 1 (1 splits) and a pointer only 0.

import assert from 'node:assert/strict'
import {describe, test} from 'node:test'

import {actionAt, plainText, WARNINGS} from '@hzblj/crypto-clear-sign'

import {BITCOIN_TEXTS, clearSignPsbt} from '../src'
import {decipher, decodeVarint, runeDestinations, runeName} from '../src/runes'
import {btcSignerPsbt, chain, codes, field, has, only, opReturn, push, runestoneScript, setup, varint} from './support'

const U128_MAX = (1n << 128n) - 1n
const U64_MAX = (1n << 64n) - 1n
const U32_MAX = (1n << 32n) - 1n

const TAG = {
  amount: 10n,
  body: 0n,
  cap: 8n,
  cenotaph: 126n,
  divisibility: 1n,
  flags: 2n,
  mint: 20n,
  nop: 127n,
  offsetEnd: 18n,
  pointer: 22n,
  premine: 6n,
  rune: 4n,
  spacers: 3n,
  symbol: 5n,
}

const ETCHING = 1n
const TERMS = 2n
const TURBO = 4n

/** ord's test helper: a transaction whose one output is the runestone of these integers. */
const read = (integers: readonly bigint[]) => decipher([runestoneScript(integers)])

/** A rune's number from its name: ord's `Rune::from_str`. */
const runeOf = (name: string) =>
  [...name].reduce((value, character) => value * 26n + BigInt(character.charCodeAt(0) - 64), 0n) - 1n

const EDICT = [TAG.body, 1n, 1n, 2n, 0n]
const edict = {amount: 2n, id: {block: 1n, tx: 1n}, output: 0}
const runestone = (rest: Record<string, unknown> = {}) => ({edicts: [edict], kind: 'runestone', output: 0, ...rest})
const cenotaph = (flaw: string, rest: Record<string, unknown> = {}) => ({flaw, kind: 'cenotaph', output: 0, ...rest})

describe('runestones: what is one, and what is not', () => {
  test('no OP_RETURN OP_13 output: no runestone', () => {
    assert.equal(decipher([]), undefined)
    assert.equal(decipher([Uint8Array.of(3, 0x46, 0x4f, 0x4f)]), undefined)
    assert.equal(decipher([Uint8Array.of(0x6a)]), undefined)
    assert.equal(decipher([opReturn([0x46, 0x4f, 0x4f, 0x4f])]), undefined)
    // A malformed first opcode, not OP_RETURN.
    assert.equal(decipher([Uint8Array.of(0x04)]), undefined)
  })

  test('the first runestone output counts, wherever it is', () => {
    const script = runestoneScript(EDICT)
    assert.deepEqual(decipher([Uint8Array.of(), script]), {...runestone(), output: 1})
    assert.deepEqual(decipher([opReturn([0x46, 0x4f, 0x4f]), script]), {...runestone(), output: 1})
    assert.deepEqual(decipher([script, runestoneScript([TAG.cenotaph, 0n])])?.kind, 'runestone')
  })

  test('an empty runestone is a runestone', () => {
    assert.deepEqual(decipher([Uint8Array.of(0x6a, 0x5d)]), {edicts: [], kind: 'runestone', output: 0})
  })

  test('a push running past the script is invalid-script; any opcode is opcode', () => {
    assert.deepEqual(decipher([Uint8Array.of(0x6a, 0x5d, 0x04)]), cenotaph('invalid-script'))
    assert.deepEqual(decipher([Uint8Array.of(0x6a, 0x5d, 0x69, ...push([0]), ...push([1]))]), cenotaph('opcode'))

    for (let opcode = 0x4f; opcode <= 0xff; opcode++) {
      assert.deepEqual(decipher([Uint8Array.of(0x6a, 0x5d, opcode)]), cenotaph('opcode'), `opcode ${opcode}`)
    }
  })

  test('every push form is data, and pushes are concatenated', () => {
    const payload = [TAG.flags, ETCHING, TAG.divisibility, 5n, ...EDICT].flatMap(varint)
    const pushes = Uint8Array.of(0x6a, 0x5d, ...payload.flatMap(byte => [...push([byte])]))
    assert.deepEqual(decipher([pushes]), runestone({etching: {divisibility: 5, turbo: false}}))

    const [first, second, third, ...rest] = EDICT.flatMap(varint)
    const forms = Uint8Array.of(
      0x6a,
      0x5d,
      0x4c,
      1,
      first ?? 0,
      0x4d,
      1,
      0,
      second ?? 0,
      0x4e,
      1,
      0,
      0,
      0,
      third ?? 0,
      ...push(rest)
    )
    assert.deepEqual(decipher([forms]), runestone())
  })

  test('a truncated LEB128 integer is varint', () => {
    assert.deepEqual(decipher([Uint8Array.of(0x6a, 0x5d, ...push([128]))]), cenotaph('varint'))
  })
})

describe('runestones: ord`s message cases', () => {
  test('an edict', () => {
    assert.deepEqual(read(EDICT), runestone())
  })

  test('etchings: the flag, a rune, terms, every tag', () => {
    assert.deepEqual(read([TAG.flags, ETCHING, ...EDICT]), runestone({etching: {turbo: false}}))
    assert.deepEqual(read([TAG.flags, ETCHING, TAG.rune, 4n, ...EDICT]), runestone({etching: {rune: 4n, turbo: false}}))
    assert.deepEqual(
      read([TAG.flags, ETCHING | TERMS, TAG.offsetEnd, 4n, ...EDICT]),
      runestone({etching: {terms: {offsetEnd: 4n}, turbo: false}})
    )
    assert.deepEqual(
      read([TAG.flags, ETCHING | TERMS, TAG.amount, 4n, ...EDICT]),
      runestone({etching: {terms: {amount: 4n}, turbo: false}})
    )
    assert.deepEqual(
      read([
        TAG.flags,
        ETCHING | TERMS | TURBO,
        TAG.rune,
        4n,
        TAG.divisibility,
        1n,
        TAG.spacers,
        5n,
        TAG.symbol,
        97n,
        TAG.offsetEnd,
        2n,
        TAG.amount,
        3n,
        TAG.premine,
        8n,
        TAG.cap,
        9n,
        TAG.pointer,
        0n,
        TAG.mint,
        1n,
        TAG.mint,
        1n,
        ...EDICT,
      ]),
      runestone({
        etching: {
          divisibility: 1,
          premine: 8n,
          rune: 4n,
          spacers: 5,
          symbol: 'a',
          terms: {amount: 3n, cap: 9n, offsetEnd: 2n},
          turbo: true,
        },
        mint: {block: 1n, tx: 1n},
        pointer: 0,
      })
    )
  })

  test('tag values are not read as tags', () => {
    assert.deepEqual(
      read([TAG.flags, ETCHING, TAG.divisibility, TAG.body, ...EDICT]),
      runestone({etching: {divisibility: 0, turbo: false}})
    )
  })

  test('several edicts: ids as deltas', () => {
    assert.deepEqual(read([TAG.body, 1n, 1n, 2n, 0n, 0n, 3n, 5n, 0n]), {
      edicts: [edict, {amount: 5n, id: {block: 1n, tx: 4n}, output: 0}],
      kind: 'runestone',
      output: 0,
    })
  })

  test('odd tags are ignored when unknown or repeated, and when their value is out of range', () => {
    assert.deepEqual(read([TAG.nop, 100n, ...EDICT]), runestone())
    assert.deepEqual(
      read([TAG.flags, ETCHING, TAG.divisibility, 4n, TAG.divisibility, 5n, ...EDICT]),
      runestone({etching: {divisibility: 4, turbo: false}})
    )
    assert.deepEqual(
      read([TAG.flags, ETCHING, TAG.rune, 4n, TAG.divisibility, 39n, ...EDICT]),
      runestone({etching: {rune: 4n, turbo: false}})
    )
    assert.deepEqual(read([TAG.flags, ETCHING, TAG.symbol, 0x110000n, ...EDICT]), runestone({etching: {turbo: false}}))
    assert.deepEqual(read([TAG.flags, ETCHING, TAG.symbol, 0xd800n, ...EDICT]), runestone({etching: {turbo: false}}))
    assert.deepEqual(read([TAG.divisibility, U128_MAX]), {edicts: [], kind: 'runestone', output: 0})
    assert.deepEqual(read([TAG.spacers, U128_MAX]), {edicts: [], kind: 'runestone', output: 0})
    assert.deepEqual(read([TAG.symbol, U128_MAX]), {edicts: [], kind: 'runestone', output: 0})
  })

  test('the smallest and largest runes are not cenotaphs', () => {
    assert.deepEqual(read([TAG.flags, ETCHING, TAG.rune, 0n]), {
      edicts: [],
      etching: {rune: 0n, turbo: false},
      kind: 'runestone',
      output: 0,
    })
    assert.deepEqual(read([TAG.flags, ETCHING, TAG.rune, U128_MAX]), {
      edicts: [],
      etching: {rune: U128_MAX, turbo: false},
      kind: 'runestone',
      output: 0,
    })
  })
})

describe('runestones: ord`s cenotaph cases', () => {
  test('even tags left over: unknown, repeated, outside an etching, or out of range', () => {
    assert.deepEqual(read([TAG.cenotaph, 0n, ...EDICT]), cenotaph('unrecognized-even-tag'))
    assert.deepEqual(read([TAG.premine, 0n, TAG.body, 0n, 0n, 0n, 0n]), cenotaph('unrecognized-even-tag'))
    assert.deepEqual(read([TAG.rune, 4n]), cenotaph('unrecognized-even-tag'))
    assert.deepEqual(
      read([TAG.flags, ETCHING, TAG.rune, 4n, TAG.rune, 5n, ...EDICT]),
      cenotaph('unrecognized-even-tag', {etching: 4n})
    )
    assert.deepEqual(read([TAG.flags, ETCHING, TAG.offsetEnd, U64_MAX + 1n]), cenotaph('unrecognized-even-tag'))
    assert.deepEqual(read([TAG.offsetEnd, U128_MAX]), cenotaph('unrecognized-even-tag'))
    assert.deepEqual(read([TAG.mint, 1n]), cenotaph('unrecognized-even-tag'))
    assert.deepEqual(read([TAG.mint, 0n, TAG.mint, 1n]), cenotaph('unrecognized-even-tag'))
    assert.deepEqual(read([TAG.pointer, 1n]), cenotaph('unrecognized-even-tag'))
    assert.deepEqual(read([TAG.pointer, U128_MAX]), cenotaph('unrecognized-even-tag'))
  })

  test('flags it does not know, or terms without an etching', () => {
    assert.deepEqual(read([TAG.flags, TERMS, TAG.body, 0n, 0n, 0n, 0n]), cenotaph('unrecognized-flag'))
    assert.deepEqual(read([TAG.flags, 1n << 127n, ...EDICT]), cenotaph('unrecognized-flag'))
  })

  test('edicts: a rune id that cannot be, an output past the last, integers left over', () => {
    assert.deepEqual(read([TAG.body, 0n, 1n, 2n, 0n]), cenotaph('edict-rune-id'))
    assert.deepEqual(read([TAG.body, 1n, 0n, 0n, 0n, U64_MAX, 0n, 0n, 0n]), cenotaph('edict-rune-id'))
    assert.deepEqual(read([TAG.body, 1n, 1n, 0n, 0n, 0n, U32_MAX, 0n, 0n]), cenotaph('edict-rune-id'))
    assert.deepEqual(read([...EDICT, U128_MAX, 1n, 0n, 0n]), cenotaph('edict-rune-id'))
    assert.deepEqual(read([...EDICT, 1n, U128_MAX, 0n, 0n]), cenotaph('edict-rune-id'))
    assert.deepEqual(read([TAG.body, 1n, 1n, 2n, 2n]), cenotaph('edict-output'))
    assert.deepEqual(read([TAG.body, 1n, 1n, 1n, U32_MAX + 1n]), cenotaph('edict-output'))
    // The number of outputs is fine: it splits among them.
    assert.deepEqual(read([TAG.body, 1n, 1n, 2n, 1n]), {...runestone(), edicts: [{...edict, output: 1}]})

    for (const extra of [1, 2, 3]) {
      assert.deepEqual(read([...EDICT, ...Array.from({length: extra}, () => 0n)]), cenotaph('trailing-integers'))
    }
  })

  test('a tag without its value', () => {
    assert.deepEqual(read([TAG.flags, 1n, TAG.flags]), cenotaph('truncated-field'))
  })

  test('a supply past 128 bits', () => {
    assert.deepEqual(
      read([TAG.flags, ETCHING | TERMS, TAG.cap, 2n, TAG.amount, 1n << 127n]),
      cenotaph('supply-overflow')
    )
    assert.deepEqual(
      read([TAG.flags, ETCHING | TERMS, TAG.premine, 1n, TAG.cap, 1n, TAG.amount, U128_MAX]),
      cenotaph('supply-overflow')
    )
    assert.equal(read([TAG.flags, ETCHING | TERMS, TAG.premine, U128_MAX])?.kind, 'runestone')
  })
})

describe('LEB128 integers (ord`s varint.rs)', () => {
  test('the BIP vectors', () => {
    for (const [value, bytes] of [
      [0n, [0x00]],
      [1n, [0x01]],
      [127n, [0x7f]],
      [128n, [0x80, 0x01]],
      [255n, [0xff, 0x01]],
      [256n, [0x80, 0x02]],
      [16383n, [0xff, 0x7f]],
      [16384n, [0x80, 0x80, 0x01]],
      [2097151n, [0xff, 0xff, 0x7f]],
      [2097152n, [0x80, 0x80, 0x80, 0x01]],
      [268435455n, [0xff, 0xff, 0xff, 0x7f]],
      [268435456n, [0x80, 0x80, 0x80, 0x80, 0x01]],
    ] as const) {
      assert.deepEqual(varint(value), [...bytes])
      assert.deepEqual(decodeVarint(Uint8Array.from(bytes)), {length: bytes.length, value})
    }
  })

  test('round trips up to 2^128 - 1', () => {
    for (let bits = 0n; bits < 128n; bits++) {
      for (const value of [1n << bits, (1n << bits) - 1n]) {
        assert.equal(decodeVarint(Uint8Array.from(varint(value)))?.value, value)
      }
    }

    assert.equal(decodeVarint(Uint8Array.from(varint(U128_MAX)))?.value, U128_MAX)
  })

  test('at most 19 bytes, and no more than 128 bits', () => {
    const continued = (count: number) => Array.from({length: count}, () => 128)
    assert.deepEqual(decodeVarint(Uint8Array.from([...continued(18), 0])), {length: 19, value: 0n})
    assert.equal(decodeVarint(Uint8Array.from([...continued(19), 0])), undefined)

    for (const last of [64, 32, 16, 8, 4]) {
      assert.equal(decodeVarint(Uint8Array.from([...continued(18), last])), undefined)
    }

    assert.deepEqual(decodeVarint(Uint8Array.from([...continued(18), 2])), {length: 19, value: 1n << 127n})
    assert.equal(decodeVarint(Uint8Array.of(0x80)), undefined)
  })
})

describe('rune names (ord`s rune.rs and spaced_rune.rs)', () => {
  test('modified base-26', () => {
    for (const [rune, name] of [
      [0n, 'A'],
      [1n, 'B'],
      [25n, 'Z'],
      [26n, 'AA'],
      [27n, 'AB'],
      [51n, 'AZ'],
      [52n, 'BA'],
      [U128_MAX - 2n, 'BCGDENLQRQWDSLRUGSNLBTMFIJAT'],
      [U128_MAX - 1n, 'BCGDENLQRQWDSLRUGSNLBTMFIJAU'],
      [U128_MAX, 'BCGDENLQRQWDSLRUGSNLBTMFIJAV'],
    ] as const) {
      assert.equal(runeName(rune), name)
    }
  })

  test('spacers: a dot after each character whose bit is set, never after the last', () => {
    assert.equal(runeName(runeOf('AB'), 0b1), 'A•B')
    assert.equal(runeName(runeOf('ABC'), 0b11), 'A•B•C')
    assert.equal(runeName(runeOf('ABC'), 0b10), 'AB•C')
    assert.equal(runeName(runeOf('AB'), 0b10), 'AB')

    for (const name of ['A', 'Z', 'AA', 'UNCOMMONGOODS', 'DOGGOTOTHEMOON', 'BCGDENLQRQWDSLRUGSNLBTMFIJAU']) {
      assert.equal(runeName(runeOf(name)), name)
    }
  })
})

describe('where runes go', () => {
  const pay = Uint8Array.of(0x00, 20, ...new Uint8Array(20))

  test('no runestone: to the first output that is not OP_RETURN', () => {
    assert.deepEqual(runeDestinations(undefined, [opReturn([1]), pay, pay]), {burned: false, outputs: new Set([1])})
    assert.deepEqual(runeDestinations(undefined, [opReturn([1])]), {burned: true, outputs: new Set()})
  })

  test('by edict (all of them, or the runes asked about), then the pointer, and a cenotaph burns', () => {
    const scripts = [runestoneScript([]), pay, pay, pay]
    const artifact = decipher([
      runestoneScript([TAG.pointer, 3n, TAG.body, 840000n, 3n, 10n, 2n, 0n, 1n, 5n, 4n]),
      pay,
      pay,
      pay,
    ])
    assert.ok(artifact?.kind === 'runestone')
    assert.deepEqual(runeDestinations(artifact, scripts), {burned: false, outputs: new Set([2, 1, 3])})
    assert.deepEqual(runeDestinations(artifact, scripts, new Set(['840000:3'])), {
      burned: false,
      outputs: new Set([2, 3]),
    })
    assert.deepEqual(runeDestinations(artifact, scripts, new Set(['1:1'])), {burned: false, outputs: new Set([3])})
    assert.deepEqual(runeDestinations({flaw: 'varint', kind: 'cenotaph', output: 0}, scripts), {
      burned: true,
      outputs: new Set(),
    })
  })
})

describe('clearSignPsbt: runestones', async () => {
  const {accounts, xpubAccounts} = await setup()
  const {change, other, segwit} = accounts

  const read = (script: Uint8Array, outputs: Parameters<typeof btcSignerPsbt>[1] = [], options = {}) =>
    clearSignPsbt(
      chain,
      btcSignerPsbt(
        [{account: segwit, previous: true, value: 100_000n}],
        [{script, value: 0n}, {account: change, value: 99_000n}, ...outputs]
      ),
      {accounts: [...xpubAccounts], ...options}
    )

  const dog = {
    tokens: {
      token: ({address}: {readonly address: string}) =>
        address === '840000:3' ? {decimals: 5, name: 'DOG•GO•TO•THE•MOON', symbol: 'DOG'} : undefined,
    },
  }

  test('a transfer: what each edict moves where, in base units unless the token list knows the rune', async () => {
    const script = runestoneScript([TAG.body, 840000n, 3n, 100_000n, 2n])
    const outputs = [{account: other, noOrigin: true, value: 546n}]
    const unknown = await read(script, outputs)
    const action = actionAt(unknown, [0])
    assert.ok(action)
    assert.equal(action.intent.code, BITCOIN_TEXTS.intent.runestone.code)
    assert.deepEqual(action.source, {decoder: 'runestone', kind: 'builtin'})
    assert.deepEqual(action.summary?.params, {count: 1})

    const rune = field(action, 'edict-0-rune')
    assert.ok(rune.kind === 'text' && rune.value === '840000:3')
    const amount = field(action, 'edict-0-amount')
    assert.ok(amount.kind === 'amount')
    assert.deepEqual([amount.value, amount.decimals, amount.token], [100_000n, undefined, '840000:3'])
    const output = field(action, 'edict-0-output')
    assert.ok(output.kind === 'number' && output.value === 2)
    const warning = only(unknown, 'UNKNOWN_TOKEN')
    assert.deepEqual([warning.action, warning.fields], [[0], ['edict-0-amount']])
    assert.equal(has(unknown, 'bitcoin.RUNES_BURNED'), false)

    const known = await read(script, outputs, {resolvers: dog})
    const knownAction = actionAt(known, [0]) ?? known
    const named = field(knownAction, 'edict-0-rune')
    assert.ok(named.kind === 'text' && named.value === 'DOG•GO•TO•THE•MOON (840000:3)')
    const dogs = field(knownAction, 'edict-0-amount')
    assert.ok(dogs.kind === 'amount')
    assert.deepEqual([dogs.decimals, dogs.symbol], [5, 'DOG'])
    assert.equal(has(known, 'UNKNOWN_TOKEN'), false)
    assert.match(plainText(known), /Amount: 1 DOG/)
  })

  test('all that is left, split among every output', async () => {
    const result = await read(runestoneScript([TAG.body, 840000n, 3n, 0n, 3n]), [
      {account: other, noOrigin: true, value: 546n},
    ])
    const action = actionAt(result, [0]) ?? result
    const all = field(action, 'edict-0-all')
    assert.ok(all.kind === 'boolean' && all.value)
    const split = field(action, 'edict-0-split')
    assert.ok(split.kind === 'boolean' && split.value)
  })

  test('runes sent to an OP_RETURN output, by edict or pointer, are burned', async () => {
    const edictBurn = await read(runestoneScript([TAG.body, 840000n, 3n, 10n, 0n]))
    const burned = only(edictBurn, 'bitcoin.RUNES_BURNED')
    assert.deepEqual([burned.severity, burned.action, burned.fields], ['critical', [0], ['edict-0']])

    const pointerBurn = await read(runestoneScript([TAG.pointer, 0n]))
    assert.deepEqual(only(pointerBurn, 'bitcoin.RUNES_BURNED').fields, ['pointer'])

    const kept = await read(runestoneScript([TAG.pointer, 1n, TAG.body, 840000n, 3n, 10n, 1n]))
    assert.equal(has(kept, 'bitcoin.RUNES_BURNED'), false)
    const pointer = field(actionAt(kept, [0]) ?? kept, 'pointer')
    assert.ok(pointer.kind === 'number' && pointer.value === 1)
  })

  test('an etching: the rune`s name, spacers and terms; the root says so when nothing is paid', async () => {
    // UNCOMMON•GOODS, the first rune: its name, a spacer after the eighth letter, and open mint terms.
    const rune = runeOf('UNCOMMONGOODS')
    const result = await read(
      runestoneScript([
        TAG.flags,
        ETCHING | TERMS,
        TAG.rune,
        rune,
        TAG.spacers,
        128n,
        TAG.symbol,
        0x29c9n,
        TAG.amount,
        1n,
        TAG.cap,
        U128_MAX,
        14n,
        1_050_000n,
        12n,
        840_000n,
      ])
    )
    assert.equal(result.intent.code, BITCOIN_TEXTS.intent.etchRune.code)
    assert.deepEqual(result.summary?.params, {rune: 'UNCOMMON•GOODS'})
    const action = actionAt(result, [0]) ?? result
    const etched = field(action, 'etching-rune')
    assert.ok(etched.kind === 'text' && etched.value === 'UNCOMMON•GOODS')
    const symbol = field(action, 'etching-symbol')
    assert.ok(symbol.kind === 'text' && symbol.value === '⧉')
    const amount = field(action, 'etching-amount')
    assert.ok(amount.kind === 'amount' && amount.value === 1n && amount.symbol === '⧉' && amount.decimals === 0)
    const heightEnd = field(action, 'etching-heightEnd')
    assert.ok(heightEnd.kind === 'number' && heightEnd.value === 1_050_000n)
    assert.deepEqual(codes(result), [])
  })

  test('an etching whose symbol hides characters', async () => {
    const result = await read(runestoneScript([TAG.flags, ETCHING, TAG.rune, 4n, TAG.symbol, 0x202en]))
    const hidden = only(result, 'HIDDEN_CHARACTERS')
    assert.deepEqual([hidden.action, hidden.fields], [[0], ['etching-symbol']])
    assert.equal(WARNINGS.HIDDEN_CHARACTERS.severity, hidden.severity)
  })

  test('a mint: the root says so when nothing is paid', async () => {
    const result = await read(runestoneScript([TAG.mint, 840000n, TAG.mint, 3n]), [], {resolvers: dog})
    assert.equal(result.intent.code, BITCOIN_TEXTS.intent.mintRune.code)
    assert.deepEqual(result.summary?.params, {rune: 'DOG•GO•TO•THE•MOON (840000:3)'})
  })

  test('a cenotaph: critical, with the flaw and the script', async () => {
    const result = await read(runestoneScript([TAG.cenotaph, 1n, TAG.flags, ETCHING, TAG.rune, 4n]))
    const action = actionAt(result, [0])
    assert.ok(action)
    assert.equal(action.summary?.code, BITCOIN_TEXTS.summary.cenotaph.code)
    const flaw = field(action, 'flaw')
    assert.ok(flaw.kind === 'text' && flaw.value === 'unrecognized-even-tag')
    const etched = field(action, 'etching-rune')
    assert.ok(etched.kind === 'text' && etched.value === 'E')
    assert.ok(field(action, 'script').kind === 'raw')

    const warning = only(result, 'bitcoin.CENOTAPH')
    assert.deepEqual([warning.severity, warning.action, warning.fields], ['critical', [0], ['flaw']])
    assert.deepEqual(warning.params, {flaw: 'unrecognized-even-tag'})
    assert.equal(result.risk, 'critical')

    const valid = await read(runestoneScript([TAG.flags, ETCHING, TAG.rune, 4n]))
    assert.equal(has(valid, 'bitcoin.CENOTAPH'), false)
  })
})

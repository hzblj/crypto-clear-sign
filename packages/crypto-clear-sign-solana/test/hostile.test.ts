// Hostile input, seeded so a failure replays: random and mutated transactions, random instruction data for every
// built-in program, random IDLs with random data, random messages. Each case reads (a result the core's checks
// accepted) or is refused with a ClearSignError, never anything else, and each finishes quickly.

import assert from 'node:assert/strict'
import {describe, test} from 'node:test'

import {type ClearSigning, type Field, isClearSignError} from '@hzblj/crypto-clear-sign'
import {base58, utf8} from '@hzblj/nitro-crypto/adapter'

import {clearSignMessage, clearSignTransaction, IDL_LIMITS, SOLANA_PROGRAMS, type SolanaIdl} from '../src'
import {BUILTIN_DECODERS} from '../src/decoders/index'
import {address, chain, clock, compile, OTHER, raw, STRANGER, TOKEN, USDC, WALLET, wire} from './support'

/** mulberry32: the same "random" cases on every run. */
const seeded = (seed: number) => {
  let state = seed
  const next = () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const integer = (below: number) => Math.floor(next() * below)

  return {
    bytes: (length: number) => Array.from({length}, () => integer(256)),
    integer,
    next,
    pick: <Value>(values: readonly Value[]): Value => values[integer(values.length)] as Value,
  }
}

type Random = ReturnType<typeof seeded>

/** The most one case may take, in milliseconds: generous, so a slow machine passes and a runaway does not. */
const QUICK = 1_000

/** Runs one case: it settles quickly, as a frozen result or one of `refusals`. Anything else fails the test. */
const settles = async (
  run: () => Promise<ClearSigning>,
  refusals: readonly string[] = ['INVALID_INPUT', 'UNSUPPORTED']
): Promise<ClearSigning | undefined> => {
  const start = performance.now()

  try {
    const result = await run()
    assert.ok(Object.isFrozen(result))

    return result
  } catch (error) {
    assert.ok(
      refusals.some(code => isClearSignError(error, code as 'INVALID_INPUT')),
      `unexpected ${String(error)}`
    )
    // Messages name what is wrong, never the bytes.
    assert.doesNotMatch((error as Error).message, /[0-9a-f]{16}|[1-9A-HJ-NP-Za-km-z]{32}/)

    return undefined
  } finally {
    assert.ok(performance.now() - start < QUICK, 'a case finishes quickly')
  }
}

/** Every field id of an action and its lists, and the action's own and nested ones. */
const fieldIds = (fields: readonly Field[]): string[] =>
  fields.flatMap(entry => [
    ...(entry.id === undefined ? [] : [entry.id]),
    ...(entry.kind === 'list' ? fieldIds(entry.items) : []),
  ])

const mutate = (random: Random, bytes: Uint8Array): Uint8Array => {
  const out = bytes.slice()

  switch (random.integer(4)) {
    case 0: {
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

const TABLE = address(50)
const LOOKED_UP = [OTHER, STRANGER, address(51), address(52)]

/** Accounts an instruction may name: the wallet (signing), strangers, a sysvar, a mint, a looked-up few. */
const POOL = [
  [WALLET, 'sw'],
  [WALLET, 's'],
  [OTHER, 'w'],
  [STRANGER, ''],
  [address(51), 'w'],
  [address(52), ''],
  [USDC, ''],
  ['SysvarC1ock11111111111111111111111111111111', ''],
  ['SysvarRent111111111111111111111111111111111', ''],
] as const

const randomAccounts = (random: Random) =>
  Array.from({length: random.integer(9)}, () => random.pick(POOL)) as [string, '' | 's' | 'w' | 'sw'][]

/** Real transactions to mutate: transfers, token calls, a v0 one with a lookup table, a durable nonce one. */
const REAL = [
  compile([
    raw(
      '11111111111111111111111111111111',
      [
        [WALLET, 'sw'],
        [STRANGER, 'w'],
      ],
      [2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]
    ),
  ]),
  compile([
    raw(
      TOKEN,
      [
        [address(30), 'w'],
        [USDC, ''],
        [address(31), 'w'],
        [WALLET, 's'],
      ],
      [12, 1, 0, 0, 0, 0, 0, 0, 0, 6]
    ),
    raw('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', [], [...utf8.encode('hello')]),
  ]),
  compile(
    [
      raw(
        address(70),
        [
          [WALLET, 'sw'],
          [OTHER, 'w'],
          [STRANGER, ''],
        ],
        [1, 2, 3]
      ),
    ],
    {
      tables: {[TABLE]: LOOKED_UP},
      version: 0,
    }
  ),
  compile([
    raw(
      '11111111111111111111111111111111',
      [
        [address(62), 'w'],
        ['SysvarRecentB1ockHashes11111111111111111111', ''],
        [WALLET, 's'],
      ],
      [4, 0, 0, 0]
    ),
    raw('ComputeBudget111111111111111111111111111111', [], [3, 1, 0, 0, 0, 0, 0, 0, 0]),
  ]),
]

describe('hostile transactions', () => {
  test('random bytes, as a wire transaction or a message, are refused or read, never crash', async () => {
    const random = seeded(0x501a)

    for (let round = 0; round < 400; round++) {
      const bytes = Uint8Array.from(random.bytes(random.integer(400)))
      const payload = random.integer(2) === 0 ? bytes : {message: bytes}
      await settles(() => clearSignTransaction(chain, payload, {resolvers: {clock}}))
    }
  })

  test('mutations of real transactions are refused or read, never crash', async () => {
    const random = seeded(0x7e57)
    let read = 0
    let refused = 0

    for (let round = 0; round < 600; round++) {
      const message = mutate(random, random.pick(REAL))
      const options = random.integer(2) === 0 ? {addressLookupTables: {[TABLE]: LOOKED_UP}} : {}
      // Lookup tables given that a mutated message no longer fits are the caller's: INVALID_ARGUMENT.
      const result = await settles(
        () => clearSignTransaction(chain, {message}, {...options, resolvers: {clock}}),
        ['INVALID_INPUT', 'UNSUPPORTED', 'INVALID_ARGUMENT']
      )

      if (result === undefined) {
        refused += 1
      } else {
        read += 1
      }
    }

    // Both ways are exercised: a mutation that still reads, and one that does not.
    assert.ok(read > 50, `${read} read`)
    assert.ok(refused > 50, `${refused} refused`)
  })

  test('a wire transaction`s signature count, mutated, is refused or read', async () => {
    const random = seeded(0x51)

    for (let round = 0; round < 100; round++) {
      await settles(() => clearSignTransaction(chain, mutate(random, wire(random.pick(REAL))), {resolvers: {clock}}))
    }
  })
})

describe('hostile instruction data', () => {
  /**
   * The layouts the decoders read, by decoder and tag: a part is a number of random bytes, a literal byte (`[n]`), a
   * key (`k`: one the transaction names, or 32 random bytes), a `COption<Pubkey>` (`o`), a bincode seed (`s`), a
   * bincode vector of keys (`v`) or of bytes (`b`), a finite `f64` (`f`), UTF-8 text to the end (`t`), and tags kept
   * in range: an authority type (`a`), a stake authority (`w`), an account state (`e`).
   */
  type Part = number | readonly [number] | 'a' | 'b' | 'e' | 'f' | 'k' | 'o' | 's' | 't' | 'v' | 'w'
  type Layouts = Readonly<Record<number, readonly (readonly Part[])[]>>

  const SYSTEM_LAYOUTS: Layouts = {
    0: [[8, 8, 'k']],
    1: [['k']],
    2: [[8]],
    3: [['k', 's', 8, 8, 'k']],
    4: [[]],
    5: [[8]],
    6: [['k']],
    7: [['k']],
    8: [[8]],
    9: [['k', 's', 8, 'k']],
    10: [['k', 's', 'k']],
    11: [[8, 's', 'k']],
    12: [[]],
    13: [[8, 8, 'k']],
  }
  const STAKE_LAYOUTS: Layouts = {
    0: [['k', 'k', 8, 8, 'k']],
    1: [['k', 'w']],
    2: [[]],
    3: [[8]],
    4: [[8]],
    5: [[]],
    7: [[]],
    9: [[]],
    10: [['w']],
    16: [[8]],
    17: [[8]],
  }
  const TABLE_LAYOUTS: Layouts = {0: [[8, 1]], 1: [[]], 2: [['v']], 3: [[]], 4: [[]]}
  const LOADER_LAYOUTS: Layouts = {0: [[]], 1: [[4, 'b']], 2: [[8]], 3: [[]], 4: [[]], 5: [[]], 6: [[4]], 7: [[]]}
  const BUDGET_LAYOUTS: Layouts = {1: [[4]], 2: [[4]], 3: [[8]], 4: [[4]]}
  const TOKEN_LAYOUTS: Layouts = {
    0: [[1, 'k', 'o']],
    1: [[]],
    2: [[1]],
    3: [[8]],
    4: [[8]],
    5: [[]],
    6: [['a', 'o']],
    7: [[8]],
    8: [[8]],
    9: [[]],
    10: [[]],
    11: [[]],
    12: [[8, 1]],
    13: [[8, 1]],
    14: [[8, 1]],
    15: [[8, 1]],
    16: [['k']],
    17: [[]],
    18: [['k']],
    19: [[1]],
    20: [[1, 'k', 'o']],
    21: [[], [2, 2]],
    22: [[]],
    23: [[8]],
    24: [['t']],
    25: [['o']],
    26: [[[0], 'o', 'o', 2, 8], [[1], 8, 1, 8], [[2]], [[3], 1], [[4]], [[5], 2, 8]],
    28: [
      [[0], 'e'],
      [[1], 'e'],
    ],
    29: [[2, 2]],
    30: [[[0]], [[1]]],
    31: [[]],
    32: [[]],
    33: [
      [[0], 'k', 2],
      [[1], 2],
    ],
    34: [[[0]], [[1]]],
    35: [['k']],
    36: [
      [[0], 'k', 'k'],
      [[1], 'k'],
    ],
    38: [[]],
    39: [
      [[0], 'k', 'k'],
      [[1], 'k'],
    ],
    40: [
      [[0], 'k', 'k'],
      [[1], 'k'],
    ],
    41: [
      [[0], 'k', 'k'],
      [[1], 'k'],
    ],
    43: [
      [[0], 'k', 'f'],
      [[1], 'f', 8],
    ],
    44: [[[0], 'k'], [[1]], [[2]]],
    45: [[[0]], [[1], 8]],
    46: [
      [[0], 'k'],
      [[1], 8],
      [[2], 8, 1],
    ],
  }
  const KEYS = [WALLET, OTHER, STRANGER, USDC, '11111111111111111111111111111111']

  const part = (random: Random, value: Part): number[] => {
    const u64 = (length: number) => [length, 0, 0, 0, 0, 0, 0, 0]
    const key = () => (random.integer(2) === 0 ? [...base58.decode(random.pick(KEYS))] : random.bytes(32))

    if (typeof value === 'number') {
      return random.bytes(value)
    }

    if (Array.isArray(value)) {
      return [...value]
    }

    switch (value) {
      case 'a':
        return [random.integer(18)]
      case 'w':
        return [random.integer(2), 0, 0, 0]
      case 'e':
        return [random.integer(3)]
      case 'k':
        return key()
      case 'o':
        return random.integer(2) === 0 ? [0] : [1, ...key()]
      case 's': {
        const seed = [...utf8.encode(random.pick(['', 'vault', 'stake:0', 'x'.repeat(32)]))]
        return [...u64(seed.length), ...seed]
      }
      case 'v': {
        const count = random.integer(4)
        return [...u64(count), ...Array.from({length: count}, key).flat()]
      }
      case 'b': {
        const bytes = random.bytes(random.integer(16))
        return [...u64(bytes.length), ...bytes]
      }
      case 'f': {
        const out = new Uint8Array(8)
        new DataView(out.buffer).setFloat64(0, random.next() * 4 - 1, true)
        return [...out]
      }
      default:
        return [...utf8.encode(random.pick(['1.5', '0', 'one', '']))]
    }
  }

  /** An instruction as its layout has it, its values random: read to the end, and deep into each decoder. */
  const honest = (random: Random, layouts: Layouts, tagBytes: number): number[] => {
    const tags = Object.keys(layouts).map(Number)
    const tag = random.pick(tags)
    const parts = random.pick(layouts[tag] ?? [[]])

    return [tag, ...new Array(tagBytes - 1).fill(0), ...parts.flatMap(entry => part(random, entry))]
  }

  /** Data for `program`: as its layouts have it, then cut, padded or flipped now and then, or anything at all. */
  const data = (random: Random, program: string): number[] => {
    const decoder = BUILTIN_DECODERS.get(program)?.decoder
    const anything = random.bytes(random.integer(random.integer(4) === 0 ? 200 : 40))
    const roll = random.integer(8)

    if (roll === 0) {
      return anything
    }

    const made = (() => {
      switch (decoder) {
        case 'system-program':
          return honest(random, SYSTEM_LAYOUTS, 4)
        case 'stake-program':
          return honest(random, STAKE_LAYOUTS, 4)
        case 'address-lookup-table':
          return honest(random, TABLE_LAYOUTS, 4)
        case 'bpf-upgradeable-loader':
          return honest(random, LOADER_LAYOUTS, 4)
        case 'compute-budget':
          return honest(random, BUDGET_LAYOUTS, 1)
        case 'spl-token':
        case 'spl-token-2022': {
          if (random.integer(8) === 0) {
            // A batch of instructions as their layouts have them, their accounts counted right or wrong.
            const inner = Array.from({length: random.integer(4)}, () => {
              const bytes = random.integer(6) === 0 ? [255, 1, 0] : honest(random, TOKEN_LAYOUTS, 1)
              return [random.integer(5), bytes.length, ...bytes]
            })
            return [255, ...inner.flat()]
          }

          return honest(random, TOKEN_LAYOUTS, 1)
        }
        case 'associated-token-account':
          return random.pick([[], [0], [1], [2]])
        default:
          return [...utf8.encode(random.pick(['', 'gm', 'note \u202e', 'é'.repeat(30)]))]
      }
    })()

    return roll <= 2 ? [...mutate(random, Uint8Array.from(made))] : made
  }

  for (const [program, {decoder}] of BUILTIN_DECODERS) {
    test(`${decoder} (${SOLANA_PROGRAMS[program]}): any data, any accounts, legacy or looked up, always reads`, async () => {
      const random = seeded([...program].reduce((sum, character) => sum * 31 + character.charCodeAt(0), 7) | 0)
      let builtin = 0
      let unknown = 0

      for (let round = 0; round < 400; round++) {
        const bytes = data(random, program)
        const lookedUp = random.integer(3) === 0
        const message = compile([raw(program, randomAccounts(random), bytes)], {
          ...(lookedUp ? {tables: {[TABLE]: LOOKED_UP}, version: 0} : {}),
        })
        const options = {
          ...(lookedUp && random.integer(2) === 0 ? {addressLookupTables: {[TABLE]: LOOKED_UP}} : {}),
          ...(random.integer(3) === 0 ? {} : {signer: WALLET}),
        }
        // A message that reads must give a result: no refusal at all.
        const result = await settles(() => clearSignTransaction(chain, {message}, {...options, resolvers: {clock}}), [])
        const action = result?.actions[0]
        assert.ok(action)

        if (action.source.kind === 'unknown') {
          unknown += 1
          assert.ok(result?.warnings.some(entry => entry.code === 'UNKNOWN_CONTRACT_CALL' && entry.action[0] === 0))
          assert.equal(action.raw[0]?.kind === 'raw' && action.raw[0].value, `0x${Buffer.from(bytes).toString('hex')}`)
        } else {
          builtin += 1
          assert.deepEqual(action.source, {decoder, kind: 'builtin'})
        }

        // Ids are unique within an action, and every warning names fields its action has.
        const ids = fieldIds([...action.fields, ...action.raw])
        assert.equal(new Set(ids).size, ids.length)
      }

      assert.ok(builtin > 50 && unknown > 50, `${builtin} read, ${unknown} raw`)
    })
  }
})

describe('hostile IDLs', () => {
  const PROGRAM = address(70)
  const PRIMITIVES = [
    'bool',
    'u8',
    'i8',
    'u16',
    'i16',
    'u32',
    'i32',
    'f32',
    'u64',
    'i64',
    'f64',
    'u128',
    'i128',
    'u256',
    'i256',
    'bytes',
    'string',
    'pubkey',
    'publicKey',
  ] as const
  const SIZES: Readonly<Record<string, number>> = {
    bool: 1,
    f32: 4,
    f64: 8,
    i8: 1,
    i16: 2,
    i32: 4,
    i64: 8,
    i128: 16,
    i256: 32,
    pubkey: 32,
    publicKey: 32,
    u8: 1,
    u16: 2,
    u32: 4,
    u64: 8,
    u128: 16,
    u256: 32,
  }
  /** Not types, or types this does not read: each makes the IDL not describe the call. */
  const JUNK = [
    42,
    null,
    'u512',
    'usize',
    {option: 'u8', vec: 'u8'},
    {generic: 'T'},
    [],
    {array: ['u8']},
    {defined: {}},
  ]
  const NAMES = ['amount', 'side', 'x', 'Ünïcödé', 'claim‮reward', 'a'.repeat(IDL_LIMITS.name), '', 'constructor']

  type Definition = {readonly name: string; readonly type: unknown}

  const randomType = (random: Random, depth: number, defined: readonly Definition[]): unknown => {
    const roll = random.integer(depth > 3 ? 4 : 12)

    switch (roll) {
      case 4:
        return {option: randomType(random, depth + 1, defined)}
      case 5:
        return {coption: randomType(random, depth + 1, defined)}
      case 6:
        return {vec: randomType(random, depth + 1, defined)}
      case 7:
        return {array: [randomType(random, depth + 1, defined), random.integer(4)]}
      case 8:
      case 9:
        return defined.length === 0
          ? random.pick(PRIMITIVES)
          : {defined: random.integer(4) === 0 ? random.pick(defined).name : {name: random.pick(defined).name}}
      case 10:
        return random.integer(3) === 0 ? random.pick(JUNK) : random.pick(PRIMITIVES)
      default:
        return random.pick(PRIMITIVES)
    }
  }

  const randomDefinitions = (random: Random): Definition[] => {
    const definitions: Definition[] = []

    for (let index = random.integer(5); index > 0; index--) {
      const name = `T${definitions.length}`
      const fields = () =>
        random.integer(2) === 0
          ? Array.from({length: random.integer(4)}, (_, at) => ({
              name: `f${at}`,
              type: randomType(random, 1, definitions),
            }))
          : Array.from({length: random.integer(3)}, () => randomType(random, 1, definitions))
      const kind = random.integer(3)
      definitions.push({
        name,
        type:
          kind === 0
            ? {fields: fields(), kind: 'struct'}
            : kind === 1
              ? {
                  kind: 'enum',
                  variants: Array.from({length: 1 + random.integer(4)}, (_, at) => ({
                    name: random.integer(6) === 0 ? random.pick(NAMES) : `V${at}`,
                    ...(random.integer(2) === 0 ? {} : {fields: fields()}),
                  })),
                }
              : {alias: randomType(random, 1, definitions), kind: 'type'},
      })
    }

    // Now and then, a type that refers to itself.
    if (random.integer(6) === 0) {
      definitions.push({
        name: 'Loop',
        type: {fields: [{name: 'next', type: {defined: {name: 'Loop'}}}], kind: 'struct'},
      })
    }

    return definitions
  }

  /** Data that a type reads (most of the time): what an honest client would send, so the IDL is followed deep. */
  const encode = (random: Random, type: unknown, definitions: readonly Definition[], depth = 0): number[] => {
    if (depth > 40) {
      return []
    }

    if (typeof type === 'string') {
      const size = SIZES[type]

      if (type === 'bool') {
        return [random.integer(2)]
      }

      if (type === 'f32' && random.integer(4) === 0) {
        return [0, 0, 0xc0, 0x7f]
      }

      if (type === 'bytes' || type === 'string') {
        const text = random.integer(3) === 0 ? [...utf8.encode('hi​')] : random.bytes(random.integer(5))
        return [text.length, 0, 0, 0, ...text]
      }

      return size === undefined ? random.bytes(random.integer(4)) : random.bytes(size)
    }

    if (typeof type !== 'object' || type === null || Array.isArray(type)) {
      return random.bytes(random.integer(3))
    }

    const record = type as Record<string, unknown>

    if ('option' in record) {
      return random.integer(2) === 0 ? [0] : [1, ...encode(random, record.option, definitions, depth + 1)]
    }

    if ('coption' in record) {
      return random.integer(2) === 0
        ? [0, 0, 0, 0]
        : [1, 0, 0, 0, ...encode(random, record.coption, definitions, depth + 1)]
    }

    if ('vec' in record) {
      const count = random.integer(4)
      return [
        count,
        0,
        0,
        0,
        ...Array.from({length: count}, () => encode(random, record.vec, definitions, depth + 1)).flat(),
      ]
    }

    if ('array' in record && Array.isArray(record.array)) {
      const [element, count] = record.array as [unknown, unknown]
      return typeof count === 'number'
        ? Array.from({length: count}, () => encode(random, element, definitions, depth + 1)).flat()
        : []
    }

    if ('defined' in record) {
      const reference = record.defined
      const name = typeof reference === 'string' ? reference : (reference as {name?: unknown} | null)?.name
      const definition = definitions.find(entry => entry.name === name)
      const body = definition?.type as Record<string, unknown> | undefined

      if (body === undefined) {
        return []
      }

      const fields = (value: unknown) =>
        (Array.isArray(value) ? value : [])
          .map(field =>
            encode(
              random,
              typeof field === 'object' && field !== null && 'name' in field ? field.type : field,
              definitions,
              depth + 1
            )
          )
          .flat()

      if (body.kind === 'struct') {
        return fields(body.fields)
      }

      if (body.kind === 'enum') {
        const variants = body.variants as {fields?: unknown}[]
        const at = random.integer(variants.length)
        return [at, ...fields(variants[at]?.fields)]
      }

      return encode(random, body.alias, definitions, depth + 1)
    }

    return []
  }

  const randomAccountList = (random: Random): unknown[] =>
    Array.from({length: random.integer(5)}, (_, at) =>
      random.integer(8) === 0
        ? {accounts: [{name: `inner${at}`}, {name: `inner${at}b`, writable: true}], name: `group${at}`}
        : {
            name: random.integer(8) === 0 ? random.pick(NAMES) : `account${at}`,
            ...(random.integer(3) === 0 ? {signer: true} : {}),
            ...(random.integer(3) === 0 ? {writable: true} : {}),
            ...(random.integer(6) === 0 ? {optional: true} : {}),
            ...(random.integer(8) === 0 ? {address: random.pick([WALLET, STRANGER, PROGRAM])} : {}),
          }
    )

  test('random IDLs over random and honest data: described or shown raw, never a crash, always quick', async () => {
    const random = seeded(0x1d1)
    let described = 0
    let ignored = 0

    for (let round = 0; round < 500; round++) {
      const definitions = randomDefinitions(random)
      const args = Array.from({length: random.integer(5)}, (_, at) => ({
        name: random.integer(10) === 0 ? random.pick(NAMES) : `arg${at}`,
        type: randomType(random, 0, definitions),
      }))
      const discriminator = random.integer(4) === 0 ? random.bytes(1 + random.integer(8)) : [7, 7, 7, 7, 7, 7, 7, 7]
      const idl = {
        address: random.integer(12) === 0 ? STRANGER : PROGRAM,
        instructions: [
          {
            accounts: randomAccountList(random),
            args,
            discriminator,
            name: random.integer(6) === 0 ? random.pick(NAMES) : 'go',
          },
          ...(random.integer(6) === 0 ? [{accounts: [], args: [], discriminator: [7], name: 'twin'}] : []),
        ],
        metadata: {name: random.integer(5) === 0 ? random.pick(NAMES) : 'fuzz'},
        types: definitions,
      }
      const honest = [...discriminator, ...args.flatMap(arg => encode(random, arg.type, definitions))]
      const bytes =
        random.integer(4) === 0
          ? [...discriminator, ...random.bytes(random.integer(40))]
          : random.integer(5) === 0
            ? [...mutate(random, Uint8Array.from(honest))]
            : honest
      const message = compile([raw(PROGRAM, randomAccounts(random), bytes)], {
        ...(random.integer(4) === 0 ? {tables: {[TABLE]: LOOKED_UP}, version: 0 as const} : {}),
      })
      const result = await settles(
        () =>
          clearSignTransaction(
            chain,
            {message},
            {
              resolvers: {clock, descriptors: {descriptor: () => ({content: idl as unknown as SolanaIdl, id: 'fuzz'})}},
              signer: WALLET,
            }
          ),
        []
      )
      const action = result?.actions[0]
      assert.ok(action)

      if (action.source.kind === 'descriptor') {
        described += 1
        assert.equal(action.intent.code, 'external')

        for (const id of fieldIds([...action.fields, ...action.raw])) {
          assert.ok(id.length <= 128)
        }
      } else {
        ignored += 1
        assert.deepEqual(action.source, {kind: 'unknown'})
      }
    }

    assert.ok(described > 100, `${described} described`)
    assert.ok(ignored > 50, `${ignored} ignored`)
  })

  test('random JSON in place of an IDL is ignored', async () => {
    const random = seeded(0x15)
    const junk = (depth: number): unknown => {
      switch (random.integer(depth > 3 ? 4 : 7)) {
        case 0:
          return random.integer(1000) - 500
        case 1:
          return random.pick(['', 'u8', 'instructions', 'defined', '__proto__', PROGRAM])
        case 2:
          return random.pick([null, true, false, undefined])
        case 3:
          return random.pick(PRIMITIVES)
        case 4:
          return Array.from({length: random.integer(4)}, () => junk(depth + 1))
        default:
          return Object.fromEntries(
            Array.from({length: random.integer(5)}, () => [
              random.pick([
                'address',
                'instructions',
                'types',
                'name',
                'args',
                'accounts',
                'discriminator',
                'type',
                'kind',
              ]),
              junk(depth + 1),
            ])
          )
      }
    }

    for (let round = 0; round < 300; round++) {
      const content = {
        address: PROGRAM,
        instructions: [{...(junk(1) as object), discriminator: [7]}],
        types: junk(1),
      } as unknown as SolanaIdl
      const message = compile([raw(PROGRAM, randomAccounts(random), [7, ...random.bytes(random.integer(16))])])
      const result = await settles(
        () =>
          clearSignTransaction(
            chain,
            {message},
            {resolvers: {clock, descriptors: {descriptor: () => ({content, id: 'junk'})}}}
          ),
        []
      )
      assert.ok(result?.actions[0])
    }
  })
})

describe('hostile messages', () => {
  const CHARACTERS = ['a', ' ', '\n', 'é', '中', '😀', '​', '‮', '\u0000', '⁦', ':', '-', '1']

  test('random bytes, with and without the off-chain domain, are refused or read', async () => {
    const random = seeded(0x3e55)
    const domain = [0xff, ...utf8.encode('solana offchain')]

    for (let round = 0; round < 400; round++) {
      const tail = random.bytes(random.integer(300))
      const bytes = Uint8Array.from(random.integer(3) === 0 ? [...domain, random.integer(3), ...tail] : tail)
      const result = await settles(
        () =>
          clearSignMessage(chain, bytes, {
            resolvers: {clock},
            ...(random.integer(2) === 0 ? {signer: WALLET} : {}),
          }),
        ['INVALID_INPUT', 'INVALID_ARGUMENT']
      )

      if (result !== undefined) {
        assert.ok(result.kind === 'message' || result.kind === 'offchain-message')
      }
    }
  })

  test('random text reads, its hidden characters warned about', async () => {
    const random = seeded(0x7e47)

    for (let round = 0; round < 300; round++) {
      const text = Array.from({length: random.integer(60)}, () => random.pick(CHARACTERS)).join('')
      const result = await settles(() => clearSignMessage(chain, text, {resolvers: {clock}}), [])
      assert.ok(result)

      if (/[​‮⁦]/.test(text) && result.source.kind === 'builtin' && result.source.decoder === 'text') {
        assert.ok(result.warnings.some(entry => entry.code === 'HIDDEN_CHARACTERS'))
      }
    }
  })

  test('sign-in messages, mutated line by line, read as a sign-in or as text', async () => {
    const random = seeded(0x5105)
    const lines = [
      'app.example.com wants you to sign in with your Solana account:',
      WALLET,
      '',
      'Sign in.',
      '',
      'URI: https://app.example.com',
      'Version: 1',
      'Chain ID: mainnet',
      'Nonce: abc',
      'Issued At: 2026-10-27T11:00:00Z',
      'Expiration Time: 2026-10-28T11:00:00Z',
      'Not Before: 2026-10-27T11:00:00Z',
      'Request ID: 1',
      'Resources:',
      '- https://app.example.com/tos',
    ]

    for (let round = 0; round < 400; round++) {
      const mutated = [...lines]

      for (let edits = 1 + random.integer(3); edits > 0; edits--) {
        const at = random.integer(mutated.length)

        switch (random.integer(4)) {
          case 0:
            mutated.splice(at, 1)
            break
          case 1:
            mutated.splice(at, 0, random.pick(lines))
            break
          case 2:
            mutated[at] = `${mutated[at] ?? ''}${random.pick(CHARACTERS)}`
            break
          default:
            mutated[at] = (mutated[at] ?? '').slice(0, random.integer(20))
        }
      }

      const text = mutated.join('\n')
      const result = await settles(
        () =>
          clearSignMessage(
            chain,
            random.integer(4) === 0
              ? chain.encodeOffchainMessage({signers: [WALLET], text: text || 'x', version: 1})
              : text,
            {
              origin: random.pick(['https://app.example.com', 'app.example.com:443', 'https://evil.example']),
              resolvers: {clock},
              signer: WALLET,
            }
          ),
        []
      )
      assert.ok(result)
      assert.ok(['intent.signIn', 'intent.signMessage'].includes(result.intent.code))
    }
  })

  test('off-chain messages, encoded then mutated, are refused or read', async () => {
    const random = seeded(0x0ff)

    for (let round = 0; round < 300; round++) {
      const text = Array.from({length: 1 + random.integer(40)}, () =>
        random.pick(CHARACTERS.filter(entry => entry !== '\u0000'))
      ).join('')
      const message =
        random.integer(2) === 0
          ? chain.encodeOffchainMessage({signers: [WALLET, OTHER], text, version: 1})
          : chain.encodeOffchainMessage({applicationDomain: STRANGER, signers: [WALLET], text, version: 0})
      await settles(() => clearSignMessage(chain, mutate(random, message), {resolvers: {clock}}), ['INVALID_INPUT'])
    }
  })

  test('the bytes of a transaction message, mutated, never read as text', async () => {
    const random = seeded(0x7a)

    for (let round = 0; round < 200; round++) {
      const result = await settles(
        () => clearSignMessage(chain, mutate(random, random.pick(REAL)), {resolvers: {clock}}),
        []
      )
      assert.ok(result)

      if (result.warnings.some(entry => entry.code === 'solana.MESSAGE_IS_TRANSACTION')) {
        assert.equal(result.fields.length, 0)
      }
    }
  })
})

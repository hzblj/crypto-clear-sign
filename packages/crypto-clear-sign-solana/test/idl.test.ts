import assert from 'node:assert/strict'
import {describe, test} from 'node:test'

import {type Field, isClearSignError, maxUint} from '@hzblj/crypto-clear-sign'
import {base58, utf8} from '@hzblj/nitro-crypto/adapter'
import type {Address} from '@solana/kit'
import {getTransferSolInstruction} from '@solana-program/system'

import {clearSignTransaction, createIdlResolver, IDL_LIMITS, type SolanaIdl} from '../src'
import {snakeCase} from '../src/idl/resolver'
import {
  address,
  addressOf,
  chain,
  clear,
  clock,
  codes,
  codesAt,
  compile,
  crypto,
  field,
  first,
  raw,
  STRANGER,
  SYSTEM,
  signer,
  WALLET,
  warningOf,
} from './support'

const PROGRAM = address(70)
const VAULT = address(71)
const MINT = address(72)

/** Borsh, by hand: the bytes an Anchor client would send. */
const b = {
  bool: (value: boolean) => [value ? 1 : 0],
  bytes: (value: readonly number[]) => [...b.u32(value.length), ...value],
  f32: (value: number) => {
    const out = new Uint8Array(4)
    new DataView(out.buffer).setFloat32(0, value, true)
    return [...out]
  },
  f64: (value: number) => {
    const out = new Uint8Array(8)
    new DataView(out.buffer).setFloat64(0, value, true)
    return [...out]
  },
  int: (value: bigint, bytes: number) => {
    const unsigned = BigInt.asUintN(bytes * 8, value)
    return Array.from({length: bytes}, (_, index) => Number((unsigned >> BigInt(index * 8)) & 0xffn))
  },
  pubkey: (value: string) => [...base58.decode(value)],
  string: (value: string) => b.bytes([...utf8.encode(value)]),
  u16: (value: number) => b.int(BigInt(value), 2),
  u32: (value: number) => b.int(BigInt(value), 4),
  u64: (value: bigint) => b.int(value, 8),
}

const DEPOSIT = [242, 35, 198, 137, 82, 225, 242, 182]
const EVERYTHING = [1, 2, 3, 4, 5, 6, 7, 8]

const IDL: SolanaIdl = {
  address: PROGRAM,
  instructions: [
    {
      accounts: [
        {name: 'user', signer: true, writable: true},
        {name: 'vault', writable: true},
        {address: SYSTEM, name: 'system_program'},
      ],
      args: [{name: 'amount', type: 'u64'}],
      discriminator: DEPOSIT,
      name: 'deposit',
    },
    {
      accounts: [
        {name: 'user', signer: true},
        {accounts: [{name: 'inner_a'}, {name: 'inner_b', writable: true}], name: 'group'},
        {name: 'maybe', optional: true},
      ],
      args: [
        {name: 'flag', type: 'bool'},
        {name: 'small', type: 'u8'},
        {name: 'negative', type: 'i8'},
        {name: 'u16', type: 'u16'},
        {name: 'i16', type: 'i16'},
        {name: 'u32', type: 'u32'},
        {name: 'i32', type: 'i32'},
        {name: 'u64', type: 'u64'},
        {name: 'i64', type: 'i64'},
        {name: 'u128', type: 'u128'},
        {name: 'i128', type: 'i128'},
        {name: 'u256', type: 'u256'},
        {name: 'i256', type: 'i256'},
        {name: 'f32', type: 'f32'},
        {name: 'f64', type: 'f64'},
        {name: 'label', type: 'string'},
        {name: 'blob', type: 'bytes'},
        {name: 'mint', type: 'pubkey'},
        {name: 'some', type: {option: 'u8'}},
        {name: 'none', type: {option: 'u8'}},
        {name: 'csome', type: {coption: 'pubkey'}},
        {name: 'cnone', type: {coption: 'pubkey'}},
        {name: 'numbers', type: {vec: 'u16'}},
        {name: 'raw', type: {vec: 'u8'}},
        {name: 'triple', type: {array: ['u32', 3]}},
        {name: 'four', type: {array: ['u8', 4]}},
        {name: 'point', type: {defined: {name: 'Point'}}},
        {name: 'pair', type: {defined: {name: 'Tuple'}}},
        {name: 'side', type: {defined: {name: 'Side'}}},
        {name: 'order', type: {defined: {name: 'Side'}}},
        {name: 'wrapped', type: {defined: {name: 'Side'}}},
        {name: 'alias', type: {defined: {name: 'Amount'}}},
        {
          name: 'generic',
          type: {
            defined: {
              generics: [
                {kind: 'type', type: 'u8'},
                {kind: 'const', value: '2'},
              ],
              name: 'Many',
            },
          },
        },
      ],
      discriminator: EVERYTHING,
      name: 'everything',
    },
  ],
  metadata: {name: 'vault', spec: '0.1.0', version: '0.1.0'},
  types: [
    {
      name: 'Point',
      type: {
        fields: [
          {name: 'x', type: 'i32'},
          {name: 'y', type: 'i32'},
        ],
        kind: 'struct',
      },
    },
    {name: 'Tuple', type: {fields: ['u8', 'bool'], kind: 'struct'}},
    {
      name: 'Side',
      type: {
        kind: 'enum',
        variants: [
          {name: 'Bid'},
          {fields: [{name: 'price', type: 'u64'}], name: 'Limit'},
          {fields: ['u8', 'u8'], name: 'Pair'},
        ],
      },
    },
    {name: 'Amount', type: {alias: 'u64', kind: 'type'}},
    {
      generics: [
        {kind: 'type', name: 'T'},
        {kind: 'const', name: 'N', type: 'usize'},
      ],
      name: 'Many',
      type: {fields: [{name: 'items', type: {array: [{generic: 'T'}, {generic: 'N'}]}}], kind: 'struct'},
    },
  ],
}

const everythingData = [
  ...EVERYTHING,
  ...b.bool(true),
  255,
  ...b.int(-5n, 1),
  ...b.u16(65_535),
  ...b.int(-300n, 2),
  ...b.u32(4_000_000_000),
  ...b.int(-70_000n, 4),
  ...b.u64(maxUint(64)),
  ...b.int(-1n, 8),
  ...b.int(maxUint(128), 16),
  ...b.int(-2n, 16),
  ...b.int(maxUint(256), 32),
  ...b.int(-3n, 32),
  ...b.f32(1.5),
  ...b.f64(-0.25),
  ...b.string('hello'),
  ...b.bytes([9, 8]),
  ...b.pubkey(MINT),
  1,
  7,
  0,
  ...b.u32(1),
  ...b.pubkey(STRANGER),
  ...b.u32(0),
  ...b.u32(2),
  ...b.u16(1),
  ...b.u16(2),
  ...b.bytes([5, 6, 7]),
  ...b.u32(1),
  ...b.u32(2),
  ...b.u32(3),
  1,
  2,
  3,
  4,
  ...b.int(-1n, 4),
  ...b.int(2n, 4),
  12,
  1,
  0,
  1,
  ...b.u64(99n),
  2,
  4,
  5,
  ...b.u64(1_000n),
  10,
  11,
]

const deposit = (
  amount: bigint,
  accounts: Parameters<typeof raw>[1] = [
    [WALLET, 'sw'],
    [VAULT, 'w'],
    [SYSTEM, ''],
  ]
) => raw(PROGRAM, accounts, [...DEPOSIT, ...b.u64(amount)])

const withIdl = (idl: unknown, publisher?: string) => ({
  resolvers: {
    descriptors: {
      descriptor: ({programId}: {programId: string}) =>
        programId === PROGRAM
          ? {content: idl as SolanaIdl, id: 'registry/vault.json', ...(publisher ? {publisher} : {})}
          : undefined,
    },
  },
})

/** The instruction is shown raw: the IDL was ignored, not believed. */
const ignored = async (instructions: Parameters<typeof clear>[0], idl: unknown) => {
  const result = await clear(instructions, withIdl(idl))

  assert.deepEqual(first(result).source, {kind: 'unknown'})
  assert.deepEqual(codesAt(result, [0]), ['UNKNOWN_CONTRACT_CALL'])
}

describe('IDL interpreter', () => {
  test('an instruction an IDL describes: its name, named accounts, decoded arguments, the descriptor as its source', async () => {
    const result = await clear([deposit(1_000_000n)], withIdl(IDL, 'Vault Labs'))
    const action = first(result)

    assert.deepEqual(action.source, {
      format: 'idl',
      id: 'registry/vault.json',
      kind: 'descriptor',
      publisher: 'Vault Labs',
    })
    assert.deepEqual(action.intent, {code: 'external', text: 'deposit'})
    assert.equal(action.summary?.params?.contract, 'vault')
    assert.equal(field(action, 'arg-0', 'number').value, 1_000_000n)
    assert.deepEqual(field(action, 'arg-0', 'number').label, {code: 'external', text: 'amount'})
    assert.equal(addressOf(action, 'account-0').relation, 'self')
    assert.equal(addressOf(action, 'account-0').secondary, undefined)
    assert.equal(addressOf(action, 'account-1').label.text, 'vault')
    assert.equal(addressOf(action, 'account-1').secondary, true)
    assert.equal(addressOf(action, 'program').name, 'vault')
    assert.equal(addressOf(action, 'program').relation, 'contract')
    assert.deepEqual(codesAt(result, [0]), [])
    assert.equal(result.risk, 'none')
  })

  test('every Borsh type: primitives, text, bytes, keys, options, vectors, arrays, structs, enums, aliases, generics', async () => {
    const result = await clear(
      [
        raw(
          PROGRAM,
          [
            [WALLET, 's'],
            [VAULT, ''],
            [MINT, 'w'],
            [PROGRAM, ''],
          ],
          everythingData
        ),
      ],
      withIdl(IDL)
    )
    const action = first(result)
    const value = (id: string) => field(action, id, 'number').value

    assert.equal(field(action, 'arg-0', 'boolean').value, true)
    assert.equal(value('arg-1'), 255)
    assert.equal(value('arg-2'), -5)
    assert.equal(value('arg-3'), 65_535)
    assert.equal(value('arg-4'), -300)
    assert.equal(value('arg-5'), 4_000_000_000)
    assert.equal(value('arg-6'), -70_000)
    assert.equal(value('arg-7'), maxUint(64))
    assert.equal(value('arg-8'), -1n)
    assert.equal(value('arg-9'), maxUint(128))
    assert.equal(value('arg-10'), -2n)
    assert.equal(value('arg-11'), maxUint(256))
    assert.equal(value('arg-12'), -3n)
    assert.equal(value('arg-13'), 1.5)
    assert.equal(value('arg-14'), -0.25)
    assert.equal(field(action, 'arg-15', 'text').value, 'hello')
    assert.equal(field(action, 'arg-16', 'raw').value, '0x0908')
    assert.equal(addressOf(action, 'arg-17').value, MINT)
    assert.equal(value('arg-18'), 7)
    assert.equal(field(action, 'arg-19', 'text').value, 'None')
    assert.equal(addressOf(action, 'arg-20').value, STRANGER)
    assert.equal(field(action, 'arg-21', 'text').value, 'None')
    assert.deepEqual(
      field(action, 'arg-22', 'list').items.map(item => item.kind === 'number' && item.value),
      [1, 2]
    )
    assert.equal(field(action, 'arg-22.1', 'number').label.code, 'solana.label.item')
    assert.equal(field(action, 'arg-23', 'raw').value, '0x050607')
    assert.equal(field(action, 'arg-24', 'list').items.length, 3)
    assert.equal(field(action, 'arg-25', 'raw').value, '0x01020304')
    assert.deepEqual(field(action, 'arg-26.0', 'number').label, {code: 'external', text: 'x'})
    assert.equal(value('arg-26.0'), -1)
    assert.equal(value('arg-27.0'), 12)
    assert.equal(field(action, 'arg-27.1', 'boolean').value, true)
    assert.equal(field(action, 'arg-28', 'text').value, 'Bid')
    assert.equal(field(action, 'arg-29.variant', 'text').value, 'Limit')
    assert.equal(value('arg-29.0'), 99n)
    assert.equal(field(action, 'arg-30.variant', 'text').value, 'Pair')
    assert.equal(value('arg-30.1'), 5)
    assert.equal(value('arg-31'), 1_000n)
    // Many<u8, 2>: its [T; N] is two bytes.
    assert.equal(field(action, 'arg-32.0', 'raw').value, '0x0a0b')

    // Accounts: groups flattened in order, the optional one too.
    assert.deepEqual(
      [0, 1, 2, 3].map(index => addressOf(action, `account-${index}`).label.text),
      ['user', 'inner_a', 'inner_b', 'maybe']
    )
  })

  test('bytes after the arguments are kept raw', async () => {
    const result = await clear(
      [
        raw(
          PROGRAM,
          [
            [WALLET, 'sw'],
            [VAULT, 'w'],
            [SYSTEM, ''],
          ],
          [...DEPOSIT, ...b.u64(1n), 0xaa]
        ),
      ],
      withIdl(IDL)
    )

    assert.equal(field(first(result), 'trailingData', 'raw').value, '0xaa')
  })

  test('accounts past the IDL`s are shown by role', async () => {
    const result = await clear(
      [
        deposit(1n, [
          [WALLET, 'sw'],
          [VAULT, 'w'],
          [SYSTEM, ''],
          [STRANGER, 'w'],
        ]),
      ],
      withIdl(IDL)
    )

    assert.equal(field(first(result), 'account-3', 'address').label.code, 'solana.label.writableAccount')
  })

  test('HIDDEN_CHARACTERS: in an instruction`s name (the action), an account`s, an argument`s value', async () => {
    const idl = {
      ...IDL,
      instructions: [
        {
          accounts: [{name: 'us​er'}],
          args: [{name: 'note', type: 'string'}],
          discriminator: [9],
          name: 'claim‮',
        },
      ],
    }
    const result = await clear([raw(PROGRAM, [[WALLET, 's']], [9, ...b.string('free⁦money')])], withIdl(idl))
    const hidden = result.warnings.filter(entry => entry.code === 'HIDDEN_CHARACTERS')

    assert.deepEqual(
      hidden.map(entry => entry.fields),
      [[], ['arg-0'], ['account-0']]
    )
    assert.ok(hidden.every(entry => entry.action.join() === '0'))
  })

  test('an IDL that does not describe the call is ignored, not believed', async () => {
    const instruction = deposit(5n)
    const without = (key: string) => ({...IDL, [key]: undefined})

    await ignored([instruction], {...IDL, address: STRANGER})
    await ignored([raw(PROGRAM, [[WALLET, 'sw']], [0, 0, 0, 0, 0, 0, 0, 0])], IDL)
    await ignored([instruction], {...IDL, instructions: [...IDL.instructions, {...IDL.instructions[0], name: 'twin'}]})
    await ignored(
      [
        raw(
          PROGRAM,
          [
            [WALLET, 'sw'],
            [VAULT, 'w'],
            [SYSTEM, ''],
          ],
          [...DEPOSIT, 1, 2]
        ),
      ],
      IDL
    )
    await ignored(
      [
        deposit(1n, [
          [WALLET, 'sw'],
          [VAULT, 'w'],
          [STRANGER, ''],
        ]),
      ],
      IDL
    )
    await ignored(
      [
        deposit(1n, [
          [WALLET, 'sw'],
          [VAULT, 'w'],
        ]),
      ],
      IDL
    )
    await ignored([instruction], without('instructions'))
    await ignored([instruction], 'not an idl')
    await ignored([instruction], null)
    await ignored([instruction], [IDL])
  })

  test('data an argument cannot hold: a bool of 2, an option tag of 2, text that is not UTF-8, a vector past the data', async () => {
    const one = (type: unknown, data: number[]) => ({
      idl: {
        address: PROGRAM,
        instructions: [{accounts: [], args: [{name: 'x', type}], discriminator: [7], name: 'one'}],
      },
      instruction: raw(PROGRAM, [], [7, ...data]),
    })

    for (const {idl, instruction} of [
      one('bool', [2]),
      one({option: 'u8'}, [2, 1]),
      one({coption: 'u8'}, [2, 0, 0, 0, 1]),
      one('string', [...b.u32(2), 0xff, 0xfe]),
      one({vec: 'u64'}, [...b.u32(1_000_000)]),
      one({vec: 'u8'}, [...b.u32(10), 1]),
      one('u64', [1, 2, 3]),
      one({array: ['u8', 99_999]}, [1]),
      one({array: ['u8', -1]}, [1]),
      one({array: ['u8', 1, 2]}, [1]),
      one({defined: {name: 'Side'}}, [9]),
    ]) {
      await ignored([instruction], {...idl, types: IDL.types})
    }
  })

  test('a malformed or hostile IDL never crashes: it is ignored', async () => {
    const instruction = raw(PROGRAM, [[WALLET, 's']], [7, 1, 2, 3, 4])
    const shaped = (args: unknown, types: unknown = [], extra: object = {}) => ({
      address: PROGRAM,
      instructions: [{accounts: [], args, discriminator: [7], name: 'x', ...extra}],
      types,
    })
    const recursive = shaped(
      [{name: 'x', type: {defined: {name: 'Node'}}}],
      [{name: 'Node', type: {fields: [{name: 'next', type: {defined: {name: 'Node'}}}], kind: 'struct'}}]
    )
    let deep: unknown = 'u8'

    for (let level = 0; level <= IDL_LIMITS.typeDepth; level++) {
      deep = {option: deep}
    }

    const getter = shaped([])
    Object.defineProperty(getter, 'types', {
      enumerable: true,
      get: () => {
        throw new Error('boom')
      },
    })

    for (const idl of [
      recursive,
      shaped([{name: 'x', type: deep}]),
      shaped([{name: 'x', type: {vec: {vec: {vec: 'bool'}}}}]),
      shaped([{name: 'x', type: 'u512'}]),
      shaped([{name: 'x', type: {option: 'u8', vec: 'u8'}}]),
      shaped([{name: 'x', type: {defined: 'constructor'}}]),
      shaped([{name: 'x', type: {defined: '__proto__'}}]),
      shaped([{name: 'x', type: {defined: {name: 'Missing'}}}]),
      shaped([{name: 'x', type: {generic: 'T'}}]),
      shaped(
        [{name: 'x', type: {defined: {name: 'Bytemuck'}}}],
        [{name: 'Bytemuck', serialization: 'bytemuck', type: {fields: [], kind: 'struct'}}]
      ),
      shaped(
        [{name: 'x', type: {defined: {name: 'Twice'}}}],
        [
          {name: 'Twice', type: {fields: [], kind: 'struct'}},
          {name: 'Twice', type: {fields: [], kind: 'struct'}},
        ]
      ),
      shaped(
        [{name: 'x', type: {defined: {generics: [{kind: 'type', type: 'u8'}], name: 'Plain'}}}],
        [{name: 'Plain', type: {fields: [], kind: 'struct'}}]
      ),
      shaped([{name: 'x'.repeat(IDL_LIMITS.name + 1), type: 'u8'}]),
      shaped([{name: '', type: 'u8'}]),
      shaped([{name: 'x', type: 'u8'}], [], {discriminator: [7, 300]}),
      shaped([{name: 'x', type: 'u8'}], [], {discriminator: []}),
      shaped([{name: 'x', type: 'u8'}], [], {discriminator: [7.5]}),
      shaped([{name: 'x', type: 'u8'}], [], {accounts: 'all'}),
      shaped([{name: 'x', type: 'u8'}], [], {accounts: [{address: 5, name: 'a'}]}),
      shaped('args'),
      shaped([null]),
      getter,
      {address: PROGRAM, instructions: Array.from({length: IDL_LIMITS.instructions + 1}, () => ({}))},
    ]) {
      await ignored([instruction], idl)
    }
  })

  test('a program name with hidden characters is not believed: the program is shown by its address alone', async () => {
    const result = await clear([deposit(1n)], withIdl({...IDL, metadata: {...IDL.metadata, name: 'Jupiter\u202e'}}))
    const action = first(result)
    const program = addressOf(action, 'program')

    assert.deepEqual(action.source.kind, 'descriptor')
    assert.equal(program.name, undefined)
    assert.equal(program.relation, 'unknown')
    assert.equal(action.summary?.params?.contract, PROGRAM)
    assert.deepEqual(codesAt(result, [0]), [])

    // The near miss: a name that hides nothing names the program.
    assert.equal(addressOf(first(await clear([deposit(1n)], withIdl(IDL))), 'program').name, 'vault')
  })

  test('a resolver whose content is not an object: the call is shown raw; no content at all is RESOLVER_FAILED', async () => {
    for (const content of [42, true, 'idl', () => IDL, new Map([['address', PROGRAM]])]) {
      const result = await clear([deposit(1n)], withIdl(content))

      assert.deepEqual(first(result).source, {kind: 'unknown'})
      assert.deepEqual(codes(result), ['UNKNOWN_CONTRACT_CALL'])
    }

    const empty = await clear([deposit(1n)], withIdl(undefined))
    assert.equal(warningOf(empty, 'RESOLVER_FAILED').params?.resolvers, 'descriptors')
    assert.deepEqual(codesAt(empty, [0]), ['UNKNOWN_CONTRACT_CALL'])
  })

  test('nesting as deep as IDL_LIMITS allows keeps field ids within the model`s 128 characters; one more is not read', async () => {
    // Vectors in vectors, each of 11 items, the last one going deeper: ids grow by `.10` a level. Within the limits on
    // depth (32) and values (1,024), no path makes an id past 128 characters: `arg-0` and 32 levels of `.10` is 101.
    const nested = (levels: number): unknown => (levels === 0 ? 'bool' : {vec: nested(levels - 1)})
    const data = (levels: number): number[] =>
      levels === 1
        ? [...b.u32(11), ...new Array(11).fill(1)]
        : [...b.u32(11), ...new Array(10).fill([0, 0, 0, 0]).flat(), ...data(levels - 1)]
    const one = (levels: number) => ({
      address: PROGRAM,
      instructions: [{accounts: [], args: [{name: 'deep', type: nested(levels)}], discriminator: [7], name: 'deep'}],
    })
    const deepest = IDL_LIMITS.typeDepth
    const result = await clear([raw(PROGRAM, [], [7, ...data(deepest)])], withIdl(one(deepest)))
    const action = first(result)
    const id = `arg-0${'.10'.repeat(deepest)}`

    assert.deepEqual(action.source.kind, 'descriptor')
    assert.equal(id.length, 101)
    assert.equal(field(action, id, 'boolean').value, true)

    const ids: string[] = []
    const collect = (fields: readonly Field[]) => {
      for (const entry of fields) {
        ids.push(entry.id ?? '')
        if (entry.kind === 'list') {
          collect(entry.items)
        }
      }
    }
    collect(action.fields)
    assert.ok(ids.every(entry => entry.length <= 128))

    await ignored([raw(PROGRAM, [], [7, ...data(deepest + 1)])], one(deepest + 1))
  })

  test('floats that are not numbers are shown as text: an f32 NaN, an f64 infinity; finite ones as numbers', async () => {
    const idl = {
      address: PROGRAM,
      instructions: [
        {
          accounts: [],
          args: [
            {name: 'nan', type: 'f32'},
            {name: 'infinite', type: 'f64'},
            {name: 'finite', type: 'f32'},
          ],
          discriminator: [7],
          name: 'floats',
        },
      ],
    }
    const result = await clear(
      [raw(PROGRAM, [], [7, ...b.f32(Number.NaN), ...b.f64(-Infinity), ...b.f32(0.5)])],
      withIdl(idl)
    )
    const action = first(result)

    assert.equal(field(action, 'arg-0', 'text').value, 'NaN')
    assert.equal(field(action, 'arg-1', 'text').value, '-Infinity')
    assert.equal(field(action, 'arg-2', 'number').value, 0.5)
    assert.deepEqual(codes(result), [])
  })

  test('HIDDEN_CHARACTERS in an enum variant`s name, unit or with fields; none in a plain one', async () => {
    const idl = {
      address: PROGRAM,
      instructions: [
        {
          accounts: [],
          args: [
            {name: 'plain', type: {defined: {name: 'Choice'}}},
            {name: 'unit', type: {defined: {name: 'Choice'}}},
            {name: 'fields', type: {defined: {name: 'Choice'}}},
          ],
          discriminator: [7],
          name: 'choose',
        },
      ],
      types: [
        {
          name: 'Choice',
          type: {
            kind: 'enum',
            variants: [{name: 'Keep'}, {name: 'Sell\u200bAll'}, {fields: ['u8'], name: 'Send\u2066'}],
          },
        },
      ],
    }
    const result = await clear([raw(PROGRAM, [], [7, 0, 1, 2, 9])], withIdl(idl))
    const action = first(result)

    assert.equal(field(action, 'arg-0', 'text').value, 'Keep')
    assert.equal(field(action, 'arg-1', 'text').value, 'Sell\u200bAll')
    assert.equal(field(action, 'arg-2.variant', 'text').value, 'Send\u2066')
    assert.equal(field(action, 'arg-2.0', 'number').value, 9)
    assert.deepEqual(
      result.warnings.map(entry => [entry.code, entry.fields]),
      [
        ['HIDDEN_CHARACTERS', ['arg-1']],
        ['HIDDEN_CHARACTERS', ['arg-2.variant']],
      ]
    )
  })

  test('UNRESOLVED_LOOKUPS in an instruction an IDL describes: on the IDL`s account and on those past it', async () => {
    const table = address(73)
    const tables = {[table]: [VAULT, STRANGER]}
    const message = compile(
      [
        deposit(2n, [
          [WALLET, 'sw'],
          [VAULT, 'w'],
          [SYSTEM, ''],
          [STRANGER, ''],
        ]),
      ],
      {tables, version: 0}
    )
    const options = {...withIdl(IDL), signer: WALLET}
    const unresolved = await clearSignTransaction(
      chain,
      {message},
      {...options, resolvers: {...options.resolvers, clock}}
    )
    const action = first(unresolved)
    const raised = warningOf(unresolved, 'solana.UNRESOLVED_LOOKUPS')

    assert.equal(action.source.kind, 'descriptor')
    assert.deepEqual(field(action, 'account-1', 'list').label, {code: 'external', text: 'vault'})
    assert.equal(field(action, 'account-1.lookupIndex', 'number').value, 0)
    assert.equal(field(action, 'account-3.lookupIndex', 'number').value, 1)
    assert.deepEqual(raised.action, [0])
    assert.deepEqual(raised.fields, ['account-1', 'account-3'])
    assert.equal(unresolved.risk, 'medium')

    // The near miss: with the table, the same accounts by name, and nothing unresolved.
    const resolved = await clearSignTransaction(chain, {message}, {...options, addressLookupTables: tables})
    assert.equal(addressOf(first(resolved), 'account-1').value, VAULT)
    assert.deepEqual(codes(resolved), [])
  })

  test('built-in programs are never described by a descriptor: an IDL cannot rename a transfer', async () => {
    const lie = {
      address: SYSTEM,
      instructions: [{accounts: [], args: [], discriminator: [2, 0, 0, 0], name: 'claim_reward'}],
    }
    const result = await clear(
      [getTransferSolInstruction({amount: 1n, destination: STRANGER as Address, source: signer(WALLET)})],
      {resolvers: {descriptors: {descriptor: () => ({content: lie as SolanaIdl, id: 'lie'})}}}
    )

    assert.equal(first(result).intent.code, 'intent.send')
    assert.deepEqual(first(result).source, {decoder: 'system-program', kind: 'builtin'})
  })

  test('a descriptor resolver that fails is RESOLVER_FAILED, and the call is unknown', async () => {
    const result = await clear([deposit(1n)], {
      resolvers: {
        descriptors: {
          descriptor: () => {
            throw new Error('down')
          },
        },
      },
    })

    assert.equal(warningOf(result, 'RESOLVER_FAILED').params?.resolvers, 'descriptors')
    assert.deepEqual(codesAt(result, [0]), ['UNKNOWN_CONTRACT_CALL'])
  })
})

describe('createIdlResolver', () => {
  test('answers by program address, with the id and publisher given, or the address', async () => {
    const descriptors = createIdlResolver([{id: 'registry/vault.json', idl: IDL, publisher: 'Vault Labs'}])
    const bare = createIdlResolver([IDL])
    const chainRef = {family: 'solana', id: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', name: 'Solana'}

    assert.equal((await descriptors.descriptor({chain: chainRef, programId: PROGRAM}))?.publisher, 'Vault Labs')
    assert.equal((await bare.descriptor({chain: chainRef, programId: PROGRAM}))?.id, PROGRAM)
    assert.equal(await bare.descriptor({chain: chainRef, programId: STRANGER}), undefined)

    const result = await clear([deposit(3n)], {resolvers: {descriptors}})
    assert.equal(field(first(result), 'arg-0', 'number').value, 3n)
  })

  test('refuses an IDL without a program address or instructions, and two for one program', () => {
    const refused = (run: () => unknown) => assert.throws(run, error => isClearSignError(error, 'INVALID_ARGUMENT'))

    refused(() => createIdlResolver([{...IDL, address: undefined}]))
    refused(() => createIdlResolver([{...IDL, address: 'nope'}]))
    refused(() => createIdlResolver([{...IDL, instructions: 'none' as never}]))
    refused(() => createIdlResolver([IDL, IDL]))
  })

  test('a pre-0.30 IDL: discriminators from sha256("global:" + snake_case name), its old spellings read', async () => {
    const legacy = {
      instructions: [
        {
          accounts: [
            {isMut: true, isSigner: true, name: 'authority'},
            {isMut: false, isSigner: false, name: 'mintAccount'},
          ],
          args: [
            {name: 'owner', type: 'publicKey'},
            {name: 'side', type: {defined: 'Side'}},
          ],
          name: 'setOwnerV2',
        },
        {accounts: [], args: [], name: 'initialize'},
      ],
      metadata: {address: PROGRAM},
      name: 'legacy_vault',
      types: [{name: 'Side', type: {kind: 'enum', variants: [{name: 'Bid'}, {name: 'Ask'}]}}],
      version: '0.1.0',
    } as unknown as SolanaIdl

    assert.throws(
      () => createIdlResolver([legacy]),
      error => isClearSignError(error, 'INVALID_ARGUMENT')
    )

    const descriptors = createIdlResolver([legacy], {sha256: crypto.hash.sha256})
    const content = (
      await descriptors.descriptor({chain: {family: 'solana', id: 'solana:x', name: ''}, programId: PROGRAM})
    )?.content
    // Anchor's own: the discriminator of `initialize`.
    assert.deepEqual(content?.instructions[1]?.discriminator, [175, 175, 109, 31, 13, 152, 155, 237])

    const discriminator = [...crypto.hash.sha256(utf8.encode('global:set_owner_v2')).subarray(0, 8)]
    const result = await clear(
      [
        raw(
          PROGRAM,
          [
            [WALLET, 'sw'],
            [MINT, ''],
          ],
          [...discriminator, ...b.pubkey(STRANGER), 1]
        ),
      ],
      {resolvers: {descriptors}}
    )
    const action = first(result)

    assert.equal(action.intent.text, 'setOwnerV2')
    assert.equal(addressOf(action, 'arg-0').value, STRANGER)
    assert.equal(field(action, 'arg-1', 'text').value, 'Ask')
    assert.equal(addressOf(action, 'account-1').label.text, 'mintAccount')
    assert.equal(addressOf(action, 'program').name, 'legacy_vault')
  })

  test('a sha256 that answers with anything but 32 bytes is INVALID_ARGUMENT; the real one is not', () => {
    const legacy = {
      instructions: [{accounts: [], args: [], name: 'initialize'}],
      metadata: {address: PROGRAM},
    } as unknown as SolanaIdl
    const refused = (sha256: (data: Uint8Array) => Uint8Array) =>
      assert.throws(
        () => createIdlResolver([legacy], {sha256}),
        error => isClearSignError(error, 'INVALID_ARGUMENT')
      )

    refused(() => new Uint8Array(31))
    refused(() => new Uint8Array(33))
    refused(() => new Uint8Array())
    refused(() => Array.from({length: 32}, () => 0) as unknown as Uint8Array)
    refused(() => 'digest' as unknown as Uint8Array)
    assert.doesNotThrow(() => createIdlResolver([legacy], {sha256: crypto.hash.sha256}))
  })

  test('a pre-0.30 IDL with some discriminators given: those are kept, the rest computed, both read', async () => {
    const mixed = {
      instructions: [
        {
          accounts: [{isMut: true, isSigner: true, name: 'authority'}],
          args: [{name: 'amount', type: 'u64'}],
          name: 'stake',
        },
        {accounts: [], args: [{name: 'flag', type: 'bool'}], discriminator: [42], name: 'custom'},
      ],
      metadata: {address: PROGRAM},
      name: 'mixed',
    } as unknown as SolanaIdl
    const sha = (text: string) => [...crypto.hash.sha256(utf8.encode(text)).subarray(0, 8)]

    // Without sha256, the one that has no discriminator cannot be read: refused.
    assert.throws(
      () => createIdlResolver([mixed]),
      error => isClearSignError(error, 'INVALID_ARGUMENT')
    )

    const descriptors = createIdlResolver([mixed], {sha256: crypto.hash.sha256})
    const content = (
      await descriptors.descriptor({chain: {family: 'solana', id: 'solana:x', name: ''}, programId: PROGRAM})
    )?.content
    assert.deepEqual(
      content?.instructions.map(instruction => instruction.discriminator),
      [sha('global:stake'), [42]]
    )

    const result = await clear(
      [raw(PROGRAM, [[WALLET, 'sw']], [...sha('global:stake'), ...b.u64(5n)]), raw(PROGRAM, [], [42, 1])],
      {resolvers: {descriptors}}
    )
    const [staked, custom] = result.actions

    assert.ok(staked && custom)
    assert.equal(staked.intent.text, 'stake')
    assert.equal(field(staked, 'arg-0', 'number').value, 5n)
    assert.equal(custom.intent.text, 'custom')
    assert.equal(field(custom, 'arg-0', 'boolean').value, true)
    assert.deepEqual(codes(result), [])
  })

  test('snake_case as Anchor before 0.30 wrote it', () => {
    assert.equal(snakeCase('initialize'), 'initialize')
    assert.equal(snakeCase('initializeUser'), 'initialize_user')
    assert.equal(snakeCase('swapV2'), 'swap_v2')
    assert.equal(snakeCase('setXYZValue'), 'set_xyz_value')
    assert.equal(snakeCase('already_snake'), 'already_snake')
  })
})

import assert from 'node:assert/strict'
import {describe, test} from 'node:test'

import {
  type AbiParameter as ViemParameter,
  bytesToHex,
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  hexToBytes,
  keccak256 as viemKeccak,
  parseAbiItem,
  toFunctionSelector,
} from 'viem'

import {
  AbiError,
  type AbiField,
  type AbiParameter,
  type AbiType,
  type AbiValue,
  canonicalType,
  decodeCall,
  decodeParameters,
  jsonFunctions,
  MAX_ABI_VALUES,
  parseFunction,
} from '../src/abi'
import {BUILTINS} from '../src/calls/builtins'
import {keccak256} from '../src/keccak'

/** A seeded generator (mulberry32), so a failure reproduces. */
const random = (seed: number) => {
  let state = seed >>> 0

  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const int = (next: () => number, max: number) => Math.floor(next() * max)

const randomBytes = (next: () => number, length: number) => Uint8Array.from({length}, () => int(next, 256))

const randomType = (next: () => number, depth: number): AbiType => {
  const pick = int(next, depth >= 3 ? 7 : 10)

  switch (pick) {
    case 0:
      return {bits: 8 * (1 + int(next, 32)), kind: 'uint'}
    case 1:
      return {bits: 8 * (1 + int(next, 32)), kind: 'int'}
    case 2:
      return {kind: 'address'}
    case 3:
      return {kind: 'bool'}
    case 4:
      return {kind: 'bytes', size: 1 + int(next, 32)}
    case 5:
      return {kind: 'bytes'}
    case 6:
      return {kind: 'string'}
    case 7:
      return {item: randomType(next, depth + 1), kind: 'array'}
    case 8:
      return {item: randomType(next, depth + 1), kind: 'array', length: 1 + int(next, 3)}
    default:
      return {
        components: Array.from({length: 1 + int(next, 3)}, (_, index) => ({
          name: `c${index}`,
          type: randomType(next, depth + 1),
        })),
        kind: 'tuple',
      }
  }
}

/** A type as viem's JSON ABI parameter. */
const toViem = (type: AbiType, name?: string): ViemParameter => {
  const named = name === undefined ? {} : {name}

  if (type.kind === 'tuple') {
    return {...named, components: type.components.map(component => toViem(component.type, component.name)), type: 'tuple'}
  }

  if (type.kind === 'array') {
    const inner = toViem(type.item)
    const suffix = `[${type.length ?? ''}]`

    return {...named, ...inner, type: `${inner.type}${suffix}`} as ViemParameter
  }

  return {...named, type: canonicalType(type)} as ViemParameter
}

const ALPHABET = 'abcxyz 019éř漢😀'

/** A random value of `type`, in viem's shape. */
const randomValue = (next: () => number, type: AbiType): unknown => {
  switch (type.kind) {
    case 'uint': {
      let value = 0n

      for (let index = 0; index < type.bits / 8; index++) {
        value = (value << 8n) | BigInt(int(next, 256))
      }

      return type.bits <= 48 ? Number(value) : value
    }
    case 'int': {
      let value = 0n

      for (let index = 0; index < type.bits / 8; index++) {
        value = (value << 8n) | BigInt(int(next, 256))
      }

      const signed = value >= 1n << BigInt(type.bits - 1) ? value - (1n << BigInt(type.bits)) : value

      return type.bits <= 48 ? Number(signed) : signed
    }
    case 'address':
      return bytesToHex(randomBytes(next, 20))
    case 'bool':
      return next() < 0.5
    case 'bytes':
      return bytesToHex(randomBytes(next, type.size ?? int(next, 70)))
    case 'string':
      return Array.from({length: int(next, 12)}, () => [...ALPHABET][int(next, [...ALPHABET].length)]).join('')
    case 'array':
      return Array.from({length: type.length ?? int(next, 4)}, () => randomValue(next, type.item))
    case 'tuple':
      return Object.fromEntries(type.components.map(component => [component.name, randomValue(next, component.type)]))
  }
}

/** A decoded value in viem's shape: what `decodeAbiParameters` returns for it. */
const viemShape = (value: AbiValue): unknown => {
  switch (value.kind) {
    case 'uint':
    case 'int':
      return value.bits <= 48 ? Number(value.value) : value.value
    case 'address':
      return value.value
    case 'bool':
      return value.value
    case 'bytes':
      return bytesToHex(value.value)
    case 'string':
      return value.value
    case 'array':
      return value.items.map(viemShape)
    case 'tuple':
      return value.fields.every(field => field.name !== undefined)
        ? Object.fromEntries(value.fields.map(field => [field.name, viemShape(field.value)]))
        : value.fields.map(field => viemShape(field.value))
  }
}

/** viem's result with addresses lowercase, as this package keeps them. */
const lowered = (value: unknown): unknown => {
  if (typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)) {
    return value.toLowerCase()
  }

  if (Array.isArray(value)) {
    return value.map(lowered)
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, lowered(entry)]))
  }

  return value
}

const fieldsShape = (fields: readonly AbiField[]) => fields.map(field => viemShape(field.value))

describe('keccak256', () => {
  test('equals viem over every length around the rate, and random data', () => {
    for (let length = 0; length <= 300; length++) {
      const data = Uint8Array.from({length}, (_, index) => (index * 31 + length) & 0xff)
      assert.equal(bytesToHex(keccak256(data)), viemKeccak(data))
    }

    const next = random(7)

    for (let run = 0; run < 50; run++) {
      const data = randomBytes(next, int(next, 2000))
      assert.equal(bytesToHex(keccak256(data)), viemKeccak(data))
    }
  })
})

describe('signatures', () => {
  test('read with names, spaces, tuples, arrays and modifiers; selectors equal viem', () => {
    const cases = [
      'transfer(address to,uint256 value)',
      'transfer(address _to, uint256 _value)',
      'swap(address executor, (address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags) desc, bytes data)',
      'submitOrder((address token,uint256 amount,uint256 price) order,bytes32 salt)',
      'airdrop(address[] recipients,uint256[3] values)',
      'f(tuple(uint8 a,bytes[] b)[2][] c, string calldata s, bytes memory m)',
      'g()',
      'h(uint a,int b)',
    ]

    for (const text of cases) {
      const fn = parseFunction(text)
      const viem = toFunctionSelector(text.replace(/\btuple\(/g, '(').replace(/\buint\b/, 'uint256').replace(/\bint\b/, 'int256'))
      assert.equal(fn.selector, viem, text)
    }

    assert.equal(parseFunction('transfer(address to,uint256 value)').signature, 'transfer(address,uint256)')
    assert.deepEqual(
      parseFunction('f((uint8 a,bytes b)[] c)').inputs[0]?.type,
      {item: {components: [{name: 'a', type: {bits: 8, kind: 'uint'}}, {name: 'b', type: {kind: 'bytes'}}], kind: 'tuple'}, kind: 'array'}
    )
  })

  test('refuses what is not a signature', () => {
    for (const text of [
      '',
      'transfer',
      'transfer(address',
      'transfer(address to uint256 value)',
      'transfer(uint7 a)',
      'transfer(uint264 a)',
      'transfer(bytes33 a)',
      'transfer(address[0] a)',
      'transfer(address a) returns (bool)',
      '1transfer(address)',
      `f(${'('.repeat(40)}uint8${')'.repeat(40)})`,
      `f(${'a'.repeat(9000)})`,
    ]) {
      assert.throws(() => parseFunction(text), AbiError, text)
    }
  })

  test("a JSON ABI's functions, with their selectors; anything else skipped", () => {
    const functions = jsonFunctions([
      {inputs: [{name: 'to', type: 'address'}, {name: 'amount', type: 'uint256'}], name: 'transfer', type: 'function'},
      {
        inputs: [{components: [{name: 'a', type: 'uint8'}], name: 'p', type: 'tuple[]'}],
        name: 'g',
        type: 'function',
      },
      {inputs: [], name: 'Transfer', type: 'event'},
      {inputs: [{type: 'uint7'}], name: 'bad', type: 'function'},
      'nonsense',
    ])
    assert.deepEqual(
      functions.map(fn => [fn.signature, fn.selector]),
      [
        ['transfer(address,uint256)', '0xa9059cbb'],
        ['g((uint8)[])', toFunctionSelector('g((uint8)[])')],
      ]
    )
    assert.deepEqual(jsonFunctions('https://example.com/abi.json'), [])
  })

  test("every built-in decoder's selector equals viem's", () => {
    for (const builtin of BUILTINS) {
      assert.equal(builtin.fn.selector, toFunctionSelector(builtin.fn.signature), builtin.fn.signature)
    }
  })
})

describe('decoding, against viem', () => {
  test('random ABIs and values decode exactly as viem decodes them', () => {
    const next = random(42)

    for (let run = 0; run < 400; run++) {
      const params: AbiParameter[] = Array.from({length: 1 + int(next, 4)}, (_, index) => ({
        name: `p${index}`,
        type: randomType(next, 0),
      }))
      const viemParams = params.map(param => toViem(param.type, param.name))
      const values = params.map(param => randomValue(next, param.type))
      const encoded = encodeAbiParameters(viemParams, values)
      const theirs = decodeAbiParameters(viemParams, encoded)
      const ours = decodeParameters(params, hexToBytes(encoded))
      assert.deepEqual(fieldsShape(ours), lowered([...theirs]), JSON.stringify(viemParams))
    }
  })

  test('call data decodes as decodeFunctionData decodes it', () => {
    const next = random(9)

    for (let run = 0; run < 100; run++) {
      const params: AbiParameter[] = Array.from({length: int(next, 4)}, (_, index) => ({
        name: `p${index}`,
        type: randomType(next, 1),
      }))
      const fn = parseFunction(`f(${params.map(param => `${canonicalType(param.type)} ${param.name}`).join(',')})`)
      const abi = [{inputs: params.map(param => toViem(param.type, param.name)), name: 'f', outputs: [], stateMutability: 'nonpayable', type: 'function'}] as const
      const args = params.map(param => randomValue(next, param.type))
      const data = encodeFunctionData({abi, args} as never)
      const theirs = decodeFunctionData({abi, data} as never) as {args?: readonly unknown[]}
      assert.deepEqual(fieldsShape(decodeCall(fn, hexToBytes(data))), lowered([...(theirs.args ?? [])]))
    }
  })

  test('mutated encodings: never anything but AbiError, and agreement whenever both decode', () => {
    const next = random(1234)
    let agreed = 0

    for (let run = 0; run < 600; run++) {
      const params: AbiParameter[] = Array.from({length: 1 + int(next, 3)}, (_, index) => ({
        name: `p${index}`,
        type: randomType(next, 0),
      }))
      const viemParams = params.map(param => toViem(param.type, param.name))
      const bytes = hexToBytes(encodeAbiParameters(viemParams, params.map(param => randomValue(next, param.type))))

      // Flip bytes, truncate, or write a huge word where an offset or a length may be.
      const mutation = int(next, 3)

      if (mutation === 0 && bytes.length > 0) {
        for (let flips = 0; flips < 1 + int(next, 4); flips++) {
          bytes[int(next, bytes.length)] = int(next, 256)
        }
      }

      const data =
        mutation === 1
          ? bytes.slice(0, int(next, bytes.length + 1))
          : mutation === 2 && bytes.length >= 32
            ? (() => {
                const at = 32 * int(next, bytes.length / 32)
                bytes.fill(0xff, at, at + 32)

                return bytes
              })()
            : bytes
      let ours: unknown
      let theirs: unknown

      try {
        ours = fieldsShape(decodeParameters(params, data))
      } catch (error) {
        assert.ok(error instanceof AbiError, String(error))
      }

      try {
        theirs = lowered([...decodeAbiParameters(viemParams, bytesToHex(data))])
      } catch {
        theirs = undefined
      }

      if (ours !== undefined && theirs !== undefined) {
        assert.deepEqual(ours, theirs)
        agreed++
      }
    }

    assert.ok(agreed > 100, `agreed on ${agreed}`)
  })
})

describe('hostile call data', () => {
  const word = (value: bigint) => {
    const out = new Uint8Array(32)
    let rest = value

    for (let index = 31; index >= 0; index--) {
      out[index] = Number(rest & 0xffn)
      rest >>= 8n
    }

    return out
  }
  const concat = (...parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
    let at = 0

    for (const part of parts) {
      out.set(part, at)
      at += part.length
    }

    return out
  }
  const type = (text: string) => parseFunction(`f(${text} x)`).inputs

  test('stray high bits, a bool past 1, and stray low bits of bytesN are refused', () => {
    assert.throws(() => decodeParameters(type('address'), word(1n << 160n)), AbiError)
    assert.throws(() => decodeParameters(type('bool'), word(2n)), AbiError)
    assert.throws(() => decodeParameters(type('uint8'), word(256n)), AbiError)
    assert.throws(() => decodeParameters(type('int8'), word(128n)), AbiError)
    assert.throws(() => decodeParameters(type('bytes1'), word(1n)), AbiError)
    assert.equal((decodeParameters(type('int8'), word((1n << 256n) - 128n))[0]?.value as {value: bigint}).value, -128n)
  })

  test('offsets and lengths past the data, and arrays longer than their data, are refused at once', () => {
    assert.throws(() => decodeParameters(type('bytes'), word(1n << 200n)), AbiError)
    assert.throws(() => decodeParameters(type('bytes'), concat(word(32n), word(1n << 64n))), AbiError)
    assert.throws(() => decodeParameters(type('uint256[]'), concat(word(32n), word(1_000_000_000n))), AbiError)
    assert.throws(() => decodeParameters(type('uint256[65536]'), word(1n)), AbiError)
    assert.throws(() => decodeParameters(type('string'), new Uint8Array(31)), AbiError)
  })

  test('offsets that point at the same data again and again stop at the value limit, quickly', () => {
    // bytes[][]: an outer array of 2000 offsets, all pointing at one inner array of 2000 offsets to one empty bytes.
    const count = 2000n
    const inner = concat(word(count), ...Array.from({length: Number(count)}, () => word(count * 32n)), word(0n))
    const outer = concat(word(32n), word(count), ...Array.from({length: Number(count)}, () => word(count * 32n)), inner)
    const started = Date.now()
    assert.throws(() => decodeParameters(type('bytes[][]'), outer), AbiError)
    assert.ok(Date.now() - started < 2000)
    assert.ok(MAX_ABI_VALUES < Number(count * count))
  })

  test('an offset that points back at itself does not loop', () => {
    // A tuple (bytes[]) whose array offset points at the array's own head.
    assert.throws(() => decodeParameters(type('bytes[]'), concat(word(0n), word(1n), word(0n))), AbiError)
  })

  test('random bytes never throw anything but AbiError, whatever the types', () => {
    const next = random(99)

    for (let run = 0; run < 2000; run++) {
      const params = Array.from({length: 1 + int(next, 3)}, () => ({type: randomType(next, 0)}))

      try {
        decodeParameters(params, randomBytes(next, int(next, 400)))
      } catch (error) {
        assert.ok(error instanceof AbiError, String(error))
      }
    }
  })

  test('a selector that is not the function`s is refused', () => {
    const fn = parseFunction('transfer(address to,uint256 value)')
    assert.throws(() => decodeCall(fn, hexToBytes('0x095ea7b3')), AbiError)
    assert.throws(() => decodeCall(fn, new Uint8Array(2)), AbiError)
    assert.ok(parseAbiItem('function transfer(address to, uint256 value)'))
  })
})

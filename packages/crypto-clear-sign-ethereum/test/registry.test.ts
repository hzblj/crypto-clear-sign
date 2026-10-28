import assert from 'node:assert/strict'
import {readdirSync, readFileSync, statSync} from 'node:fs'
import path from 'node:path'
import {describe, test} from 'node:test'

import {
  type ClearSigning,
  type ClearSigningAction,
  type Field,
  formatField,
  isClearSignError,
} from '@hzblj/crypto-clear-sign'
import type {TypedDataDefinition} from '@hzblj/crypto-ethereum'
import {parseTransaction} from 'viem'

import {clearSignTransaction, clearSignTypedData} from '../src'
import {ETHEREUM_REGISTRY, REGISTRY_SOURCE, registryResolver} from '../src/registry'
import {chainOf, request} from './helpers'

// The registry's own test cases (testsv2), for every bundled descriptor, imported with them. Each case is a real (or
// synthetic) transaction or typed message and what the reference formatter shows for it: the intent and each field's
// label and value. They run here offline, with the case's own token list and names, and the bundled descriptors,
// rendered by @ethereum-sourcify/clear-signing and read into the model.

const VECTORS = new URL('./vectors/registry/', import.meta.url).pathname

/** A field's label and what it shows; a nested call's is its own intent and fields. */
type ExpectedField = {
  readonly label: string
  readonly value: string | {readonly intent: string; readonly fields: readonly ExpectedField[]}
}
type Case = {
  readonly description: string
  readonly rawTx?: `0x${string}`
  readonly data?: TypedDataDefinition
  readonly from?: string
  readonly expected: {readonly intent?: string; readonly fields?: readonly ExpectedField[]}
}
type Vectors = {
  readonly dataProvider?: {
    readonly tokens?: Readonly<
      Record<string, {readonly symbol: string; readonly decimals: number; readonly name: string}>
    >
    readonly addressNames?: Readonly<Record<string, string>>
    readonly ensNames?: Readonly<Record<string, string>>
  }
  readonly tests: readonly Case[]
}

const files = (directory: string): string[] =>
  readdirSync(directory)
    .sort()
    .flatMap(entry => {
      const full = path.join(directory, entry)

      return statSync(full).isDirectory() ? files(full) : full.endsWith('.tests.json') ? [full] : []
    })

const descriptors = registryResolver()

/**
 * Cases the reference expects something of that this package shows otherwise, on purpose, each with why. Anything
 * else that differs fails the test.
 */
const DEVIATIONS: Readonly<Record<string, string>> = {
  '1inch limit order - swap WETH for USDC, restricted taker, with predicate':
    'Its makerAsset has a broken EIP-55 checksum: the adapter refuses the typed data (INVALID_INPUT), as it must.',
}

/** A field and every label it is shown under: its own, and its list's for an item. */
const labelled = (fields: readonly Field[], parents: readonly string[] = []): {field: Field; labels: string[]}[] =>
  fields.flatMap(entry => [
    {field: entry, labels: [entry.label.text, ...parents]},
    ...(entry.kind === 'list' ? labelled(entry.items, [entry.label.text]) : []),
  ])

const HMS = /^(\d+):(\d{2}):(\d{2})$/

/** Whether a field shows what the reference shows, allowing for the model's own forms (exact amounts, ISO dates). */
const shows = (entry: Field, expected: string, from: string | undefined): boolean => {
  const shown = formatField(entry)
  const want = expected.trim()

  if (shown === want) {
    return true
  }

  switch (entry.kind) {
    case 'address':
      // "Sender": an address the descriptor says stands for the sender, which is the signer when it is known.
      return (
        entry.value.toLowerCase() === want.toLowerCase() ||
        entry.name === want ||
        (want === 'Sender' && (entry.relation === 'self' || from === undefined))
      )
    case 'boolean':
      return (want === 'true' && entry.value) || (want === 'false' && !entry.value)
    case 'datetime':
      return shown.replace('T', ' ') === want
    case 'duration': {
      const hms = HMS.exec(want)

      return hms !== null && entry.value === (Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3])) * 1000
    }
    case 'amount':
      // An unlimited amount is shown as "Unlimited" here whatever word the descriptor gives it.
      return entry.unlimited || shown.replace(/ base units$/, '') === want
    case 'number':
      return String(entry.value) === want
    default:
      return false
  }
}

/**
 * Nested calls the reference shows as their bytes (it has no descriptor for them) and this package describes as
 * actions of their own, with its built-in decoders: counted, and each must be there.
 */
let callsDescribed = 0

const check = (action: ClearSigningAction, expected: readonly ExpectedField[], from: string | undefined): string[] => {
  const all = [
    ...labelled(action.fields),
    ...action.actions.flatMap(child => labelled(child.fields).map(entry => ({...entry, nested: true}))),
  ]
  const problems: string[] = []

  for (const want of expected) {
    if (typeof want.value !== 'string') {
      // A nested call, as the reference writes it: its intent and fields, read against the nested action.
      const nested = want.value
      const child = action.actions.find(entry => entry.intent.text === nested.intent)

      problems.push(
        ...(child === undefined
          ? [`${want.label}: no nested action ${JSON.stringify(nested.intent)}`]
          : check(child, nested.fields, from).map(problem => `${want.label} > ${problem}`))
      )
      continue
    }

    const candidates = all.filter(entry => entry.labels.includes(want.label))

    const value = want.value

    if (candidates.length === 0 && /^0x(?:[0-9a-fA-F]{2})*$/.test(value) && action.actions.length > 0) {
      callsDescribed++
      continue
    }

    if (!candidates.some(candidate => shows(candidate.field, value, from))) {
      problems.push(
        `${want.label}: ${JSON.stringify(want.value)} is shown as ${JSON.stringify(candidates.map(candidate => formatField(candidate.field)))}`
      )
    }
  }

  return problems
}

type Outcome = 'described' | 'builtin' | 'refused'

const run = async (vectors: Vectors, entry: Case): Promise<{outcome: Outcome; problems: string[]}> => {
  const known = vectors.dataProvider?.tokens ?? {}
  const named = {...(vectors.dataProvider?.addressNames ?? {}), ...(vectors.dataProvider?.ensNames ?? {})}
  const options = {
    // The case's own token list and names, as the reference had them: none of the package's built-in ones.
    builtins: false,
    resolvers: {
      descriptors,
      names: {
        name: ({address}: {readonly address: string}) => {
          const name = named[address.toLowerCase()]

          return name === undefined ? undefined : {name, relation: 'contact' as const}
        },
      },
      tokens: {token: ({address}: {readonly address: string}) => known[address.toLowerCase()]},
    },
    ...(entry.from === undefined ? {} : {signer: entry.from}),
  }
  let result: ClearSigning

  try {
    if (entry.rawTx !== undefined) {
      const tx = parseTransaction(entry.rawTx)
      assert.ok(tx.chainId !== undefined && typeof tx.to === 'string', 'a call on a chain')
      result = await clearSignTransaction(
        chainOf(tx.chainId),
        request({chainId: tx.chainId, data: tx.data ?? '0x', to: tx.to, value: tx.value ?? 0n}),
        options
      )
    } else {
      assert.ok(entry.data !== undefined, 'a transaction or typed data')
      result = await clearSignTypedData(chainOf(Number(entry.data.domain?.chainId ?? 1)), entry.data, options)
    }
  } catch (error) {
    if (isClearSignError(error, 'INVALID_INPUT') && DEVIATIONS[entry.description] !== undefined) {
      return {outcome: 'refused', problems: []}
    }

    throw error
  }

  // A built-in decoder wins over a descriptor for the same call (an ERC-20 transfer, WETH, Permit2, a multicall,
  // whose calls still go to the descriptors), by design.
  if (result.source.kind === 'builtin') {
    return {outcome: 'builtin', problems: []}
  }

  const described = [result, ...result.actions].find(action => action.source.kind === 'descriptor')

  if (described === undefined) {
    return {outcome: 'described', problems: [`no descriptor read it (${result.source.kind})`]}
  }

  const problems = check(described, entry.expected.fields ?? [], entry.from)

  if (entry.expected.intent !== undefined && described.intent.text !== entry.expected.intent) {
    problems.unshift(`intent ${JSON.stringify(described.intent.text)} is not ${JSON.stringify(entry.expected.intent)}`)
  }

  return {outcome: 'described', problems}
}

describe('the bundled registry', () => {
  test('every bundled descriptor compiles and binds; include-only files are not rejected', () => {
    assert.deepEqual(descriptors.rejected, [])
    assert.equal(descriptors.paths.length, REGISTRY_SOURCE.files.filter(file => file.role === 'descriptor').length)
    assert.equal(ETHEREUM_REGISTRY.length, REGISTRY_SOURCE.files.length)
    assert.match(REGISTRY_SOURCE.commit, /^[0-9a-f]{40}$/)
    assert.equal(REGISTRY_SOURCE.license, 'CC0-1.0')
  })

  test("the registry's own test cases read as the reference formatter reads them", async () => {
    const counts: Record<Outcome, number> = {builtin: 0, described: 0, refused: 0}
    const failures: string[] = []

    for (const file of files(VECTORS)) {
      const vectors = JSON.parse(readFileSync(file, 'utf8')) as Vectors

      for (const entry of vectors.tests) {
        const {outcome, problems} = await run(vectors, entry)
        counts[outcome]++

        if (problems.length > 0) {
          failures.push(`${path.basename(file)} / ${entry.description}:\n    ${problems.join('\n    ')}`)
        }
      }
    }

    assert.deepEqual(failures, [])
    assert.deepEqual(counts, {builtin: 22, described: 201, refused: 1})
    // Safe's transactions as typed data: a plain ether transfer and a MultiSend, read by the built-ins.
    assert.equal(callsDescribed, 2)
  })
})

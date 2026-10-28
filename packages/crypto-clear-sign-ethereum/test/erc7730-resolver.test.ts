import assert from 'node:assert/strict'
import {readdirSync, readFileSync, statSync} from 'node:fs'
import path from 'node:path'
import {describe, test} from 'node:test'

import {type ClearSigning, isClearSignError} from '@hzblj/crypto-clear-sign'
import type {TypedDataDefinition} from '@hzblj/crypto-ethereum'

import {
  clearSignTransaction,
  clearSignTypedData,
  createDescriptorResolver,
  type Erc7730Descriptor,
  type Erc7730File,
  type EthereumDescriptorQuery,
  mergeDescriptors,
} from '../src'
import {bindingOf, DescriptorError} from '../src/erc7730/binding'
import {ETHEREUM_REGISTRY, registryResolver} from '../src/registry'
import {chainOf, codes, encode, mainnet, OTHER, options, request} from './helpers'

const VAULT = '0x7777777777777777777777777777777777777777'

/** A descriptor for VAULT on mainnet with `formats`. */
const vault = (formats: Record<string, unknown>, extra: Record<string, unknown> = {}): Erc7730Descriptor => ({
  context: {contract: {deployments: [{address: VAULT, chainId: 1}]}},
  display: {formats},
  metadata: {owner: 'Vault'},
  ...extra,
})

const STAKE = {'stake(uint256 amount)': {fields: [{label: 'Amount', path: 'amount'}], intent: 'Stake'}}

describe('descriptor files', () => {
  const COMMON: Erc7730File = {
    descriptor: {
      display: {
        definitions: {amount: {format: 'tokenAmount', label: 'Amount', params: {token: OTHER}}},
        formats: {
          'stake(uint256 amount)': {fields: [{$ref: '$.display.definitions.amount', path: 'amount'}], intent: 'Stake'},
        },
      },
      metadata: {owner: 'Vault Labs'},
    },
    path: 'registry/vault/common-vault.json',
  }

  test('includes merge from the files given, relative to the including file; fields by path, the includer winning', async () => {
    const resolver = createDescriptorResolver([
      COMMON,
      {
        descriptor: {
          context: {contract: {deployments: [{address: VAULT, chainId: 1}]}},
          display: {
            formats: {
              'stake(uint256 amount)': {
                fields: [
                  {label: 'Staked amount', path: 'amount'},
                  {label: 'Note', path: '@.value'},
                ],
                intent: 'Deposit',
              },
            },
          },
          includes: './common-vault.json',
        },
        path: 'registry/vault/calldata-vault.json',
        publisher: 'Vault Labs',
      },
    ])
    assert.deepEqual(resolver.rejected, [])
    assert.deepEqual(resolver.paths, ['registry/vault/calldata-vault.json'])

    const answer = await resolver.descriptor({
      address: VAULT,
      chain: {family: 'ethereum', id: 'eip155:1', name: 'Ethereum'},
      chainId: 1,
      kind: 'calldata',
      selector: '0xa694fc3a',
    })
    assert.equal(answer?.id, 'registry/vault/calldata-vault.json')
    assert.equal(answer?.publisher, 'Vault Labs')
    const formats = answer?.content.display?.formats as Record<string, {fields: unknown[]; intent: string}> | undefined
    const format = formats?.['stake(uint256 amount)']
    assert.equal(format?.intent, 'Deposit')
    assert.deepEqual(format?.fields, [
      {$ref: '$.display.definitions.amount', label: 'Staked amount', path: 'amount'},
      {label: 'Note', path: '@.value'},
    ])
    assert.deepEqual(answer?.content.metadata, {owner: 'Vault Labs'})
  })

  test('an include that is missing, a cycle, and an include past 8 levels are rejected, with why', () => {
    const file = (name: string, includes?: string | string[]): Erc7730File => ({
      descriptor: {...vault(STAKE), ...(includes === undefined ? {} : {includes})},
      path: `app/${name}.json`,
    })
    const resolver = createDescriptorResolver([
      file('missing', 'nowhere.json'),
      file('a', 'b.json'),
      file('b', 'a.json'),
      file('self', ['./self.json']),
      file('not-text', [5 as unknown as string]),
      ...Array.from({length: 11}, (_, index) =>
        file(`chain${index}`, index === 10 ? undefined : `chain${index + 1}.json`)
      ),
    ])
    const cycle = 'Its includes form a cycle or nest too deep.'
    // Every file is either used or listed with why: one included by another is no exception when its includes break.
    assert.deepEqual(Object.fromEntries(resolver.rejected.map(entry => [entry.path, entry.reason])), {
      'app/a.json': cycle,
      'app/b.json': cycle,
      'app/chain0.json': cycle,
      'app/chain1.json': cycle,
      'app/missing.json': 'It includes a file that was not given.',
      'app/not-text.json': 'An include is a relative path.',
      'app/self.json': cycle,
    })
    assert.deepEqual(
      resolver.paths,
      Array.from({length: 9}, (_, index) => `app/chain${index + 2}.json`)
    )
  })

  test('__proto__ in a descriptor stays a key: merging never reaches a prototype', () => {
    const base = JSON.parse('{"metadata": {"owner": "Vault", "__proto__": {"owner": "Evil"}}}') as Erc7730Descriptor
    const overlay = JSON.parse(
      '{"__proto__": {"polluted": true}, "metadata": {"__proto__": {"contractName": "Evil"}, "constructor": {"prototype": {"polluted": true}}}}'
    ) as Erc7730Descriptor
    const merged = mergeDescriptors(base, overlay) as Record<string, unknown>
    const metadata = merged.metadata as Record<string, unknown>

    assert.equal(({} as Record<string, unknown>).polluted, undefined)
    assert.equal(Object.getPrototypeOf(merged), Object.prototype)
    assert.equal(Object.getPrototypeOf(metadata), Object.prototype)
    assert.equal(metadata.owner, 'Vault')
    assert.ok(Object.hasOwn(metadata, '__proto__'))
    assert.ok(Object.hasOwn(merged, '__proto__'))

    // Through the resolver too, as JSON from a file would come.
    const resolver = createDescriptorResolver([
      {descriptor: JSON.parse('{"__proto__": {"x": 1}, "metadata": {"owner": "Common"}}'), path: 'app/common.json'},
      {
        descriptor: JSON.parse(
          `{"includes": "common.json", "context": {"contract": {"deployments": [{"chainId": 1, "address": "${VAULT}"}]}}, "display": {"formats": {"stake(uint256 amount)": {"intent": "Stake"}}}, "metadata": {"__proto__": {"owner": "Evil"}}}`
        ),
        path: 'app/vault.json',
      },
    ])
    assert.deepEqual(resolver.rejected, [])
    assert.equal(({} as Record<string, unknown>).x, undefined)
  })

  test('mergeDescriptors: objects key by key, fields by path, anything else replaced', () => {
    const merged = mergeDescriptors(
      {
        context: {contract: {deployments: [{address: OTHER, chainId: 1}]}},
        display: {
          formats: {
            'f(uint256 a,uint256 b)': {
              fields: [
                {label: 'A', params: {x: 1, y: 2}, path: 'a'},
                {label: 'B', path: 'b'},
              ],
              intent: 'F',
            },
          },
        },
      },
      {
        context: {contract: {deployments: [{address: VAULT, chainId: 10}]}},
        display: {
          formats: {
            'f(uint256 a,uint256 b)': {
              fields: [
                {params: {y: 3}, path: 'a'},
                {label: 'C', path: '@.value'},
              ],
            },
          },
        },
      }
    )
    assert.deepEqual(merged, {
      context: {contract: {deployments: [{address: VAULT, chainId: 10}]}},
      display: {
        formats: {
          'f(uint256 a,uint256 b)': {
            fields: [
              {label: 'A', params: {x: 1, y: 3}, path: 'a'},
              {label: 'B', path: 'b'},
              {label: 'C', path: '@.value'},
            ],
            intent: 'F',
          },
        },
      },
    })
  })

  test('a later file overrides an earlier one where both bind; an app file can extend a registry file by including it', async () => {
    const STETH = '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84'
    const submit = encode('submit(address _referral)', [OTHER])
    const registryOnly = await clearSignTransaction(
      mainnet,
      request({data: submit, to: STETH, value: 10n ** 18n}),
      options({resolvers: {descriptors: registryResolver()}})
    )
    assert.equal(registryOnly.intent.text, 'Stake ETH')
    assert.equal(
      registryOnly.source.kind === 'descriptor' && registryOnly.source.id,
      'registry/lido/calldata-stETH.json'
    )

    // Override: the app's own file for the same deployment and function, after the registry's.
    const override = await clearSignTransaction(
      mainnet,
      request({data: submit, to: STETH, value: 10n ** 18n}),
      options({
        resolvers: {
          descriptors: registryResolver([
            {
              descriptor: {
                context: {contract: {deployments: [{address: STETH, chainId: 1}]}},
                display: {formats: {'submit(address _referral)': {fields: [], intent: 'Stake with Lido'}}},
              },
              path: 'app/steth.json',
            },
          ]),
        },
      })
    )
    assert.deepEqual(
      [override.intent.text, override.source.kind === 'descriptor' && override.source.id],
      ['Stake with Lido', 'app/steth.json']
    )

    // Extend: the app's file includes the registry's and changes one label.
    const extended = await clearSignTransaction(
      mainnet,
      request({data: submit, to: STETH, value: 10n ** 18n}),
      options({
        resolvers: {
          descriptors: registryResolver([
            {
              descriptor: {
                display: {formats: {'submit(address _referral)': {intent: 'Stake ETH with Lido'}}},
                includes: 'calldata-stETH.json',
              },
              path: 'registry/lido/app-stETH.json',
            },
          ]),
        },
      })
    )
    assert.equal(extended.intent.text, 'Stake ETH with Lido')
    assert.equal(extended.source.kind === 'descriptor' && extended.source.id, 'registry/lido/app-stETH.json')
  })

  test('files that cannot be used are listed in rejected; files only included are not', () => {
    const resolver = createDescriptorResolver([
      COMMON,
      {descriptor: {...vault({}), includes: 'common-vault.json'}, path: 'registry/vault/calldata-vault.json'},
      // Not included by anything, a common file is no descriptor: rejected.
      {descriptor: COMMON.descriptor, path: 'app/common-alone.json'},
      {descriptor: vault({'stake(uint256 a': {intent: 'X'}}), path: 'app/broken.json'},
      {descriptor: {...vault(STAKE), context: {contract: {deployments: []}}}, path: 'app/unbound.json'},
      {descriptor: {context: {contract: {factory: {}}}, display: {formats: STAKE}}, path: 'app/factory.json'},
      {descriptor: 'nope' as unknown as Erc7730Descriptor, path: 'app/not-json.json'},
      null as unknown as Erc7730File,
    ])
    assert.deepEqual(Object.fromEntries(resolver.rejected.map(entry => [entry.path, entry.reason])), {
      'app/broken.json': 'A format of a contract is keyed by a function signature.',
      'app/common-alone.json': 'A descriptor has a context, display and, when present, metadata objects.',
      'app/factory.json': 'It binds to no contract or message.',
      'app/not-json.json': 'It is not a JSON object.',
      'app/unbound.json': 'It binds to no contract or message.',
    })
    assert.deepEqual(resolver.paths, ['registry/vault/calldata-vault.json'])
    assert.ok(Object.isFrozen(resolver) && Object.isFrozen(resolver.rejected))
  })

  test('EIP-712 descriptors bound by domain alone are tried latest first, by name, chain and contract', async () => {
    const order = (name: string, intent: string, domain: Record<string, unknown>): Erc7730File => ({
      descriptor: {
        context: {eip712: {domain}},
        display: {formats: {'Order(address maker)': {fields: [{label: 'Maker', path: 'maker'}], intent}}},
      },
      path: `app/${name}.json`,
    })
    const resolver = createDescriptorResolver([
      order('any', 'Any order', {name: 'Orders'}),
      order('chain10', 'Order on 10', {chainId: 10, name: 'Orders'}),
      order('vault', 'Vault order', {name: 'Orders', verifyingContract: VAULT}),
    ])
    const query = (extra: Partial<Extract<EthereumDescriptorQuery, {kind: 'eip712'}>>) =>
      resolver.descriptor({
        chain: {family: 'ethereum', id: 'eip155:1', name: 'Ethereum'},
        encodeType: 'Order(address maker)',
        kind: 'eip712',
        primaryType: 'Order',
        ...extra,
      })
    assert.equal((await query({chainId: 1, domainName: 'Orders', verifyingContract: VAULT}))?.id, 'app/vault.json')
    assert.equal((await query({chainId: 1, domainName: 'Orders', verifyingContract: OTHER}))?.id, 'app/any.json')
    assert.equal((await query({chainId: 10, domainName: 'Orders'}))?.id, 'app/chain10.json')
    assert.equal(await query({chainId: 1, domainName: 'Other'}), undefined)
  })
})

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

/** Every place in a JSON tree: the parent and the key. */
const places = (value: unknown, out: [Record<string, unknown> | unknown[], string | number][] = []) => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      out.push([value, index])
      places(item, out)
    })
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      out.push([value as Record<string, unknown>, key])
      places(item, out)
    }
  }

  return out
}

const NASTY: readonly unknown[] = [
  null,
  0,
  -1,
  1.5,
  2 ** 60,
  '',
  ' ',
  'x'.repeat(5000),
  '‮',
  '#.',
  '@.from',
  '$.metadata',
  '$.display.definitions',
  'amount.[]',
  'a.[-1:]',
  '0x',
  `0x${'ff'.repeat(32)}`,
  '__proto__',
  true,
  [],
  [[[[]]]],
  {},
  {keyPath: 'a', map: '$.metadata.maps.x'},
  {$ref: '$.display.definitions.x'},
  {fields: [{fields: [{fields: []}]}]},
  {ifNotIn: [0]},
  {mustMatch: ['x']},
]

const mutate = (descriptor: unknown, next: () => number): unknown => {
  const copy = structuredClone(descriptor)
  const count = 1 + Math.floor(next() * 4)

  for (let round = 0; round < count; round++) {
    const all = places(copy)
    const place = all[Math.floor(next() * all.length)]

    if (place === undefined) {
      break
    }

    const [parent, key] = place
    const choice = next()
    const target = parent as Record<string | number, unknown>

    if (choice < 0.3) {
      if (Array.isArray(parent)) {
        parent.splice(Number(key), 1)
      } else {
        delete target[key]
      }
    } else if (choice < 0.8) {
      target[key] = structuredClone(NASTY[Math.floor(next() * NASTY.length)])
    } else if (choice < 0.9) {
      target[key] = structuredClone(all[Math.floor(next() * all.length)]?.[0])
    } else if (Array.isArray(parent)) {
      parent.push(structuredClone(parent[Number(key)]))
    } else {
      target[`${key}2`] = structuredClone(target[key])
    }
  }

  return copy
}

const VECTORS = new URL('./vectors/registry/', import.meta.url).pathname
const vectorFiles = (directory: string): string[] =>
  readdirSync(directory)
    .sort()
    .flatMap(entry => {
      const full = path.join(directory, entry)

      return statSync(full).isDirectory() ? vectorFiles(full) : full.endsWith('.tests.json') ? [full] : []
    })

describe('fuzzing mutated descriptors', () => {
  test('binding: a descriptor binds or throws DescriptorError, nothing else; a resolver never throws', () => {
    const next = random(7730)
    let refused = 0
    let runs = 0

    for (const file of ETHEREUM_REGISTRY) {
      for (let round = 0; round < 60; round++) {
        runs++

        const mutated = mutate(file.descriptor, next) as Erc7730Descriptor

        assert.doesNotThrow(() => createDescriptorResolver([{descriptor: mutated, path: file.path}]))

        try {
          bindingOf(mutated)
        } catch (error) {
          assert.ok(error instanceof DescriptorError, `${file.path}: ${String(error)}`)
          refused++
        }
      }
    }

    assert.equal(runs, ETHEREUM_REGISTRY.length * 60)
    assert.ok(refused > runs / 10 && refused < runs, `${refused} of ${runs} refused`)
  })

  test('describing: the registry`s own cases with their descriptors mutated never throw, and never lose a warning', async () => {
    const next = random(4242)
    const registry = registryResolver()
    let runs = 0
    let used = 0

    for (const file of vectorFiles(VECTORS)) {
      const vectors = JSON.parse(readFileSync(file, 'utf8')) as {
        readonly tests: readonly {readonly rawTx?: `0x${string}`; readonly data?: TypedDataDefinition}[]
      }

      for (const entry of vectors.tests.slice(0, 4)) {
        // The descriptor the registry answers for this case, mutated, answered for whatever is asked.
        let original: Erc7730Descriptor | undefined
        const capture = {
          descriptor: async (query: EthereumDescriptorQuery) => {
            const answer = await registry.descriptor(query)
            original ??= answer?.content

            return answer
          },
        }
        const describe = (descriptors: typeof capture): Promise<ClearSigning> => {
          if (entry.rawTx !== undefined) {
            const bytes = entry.rawTx

            return import('viem').then(({parseTransaction}) => {
              const tx = parseTransaction(bytes)

              return clearSignTransaction(
                chainOf(tx.chainId ?? 1),
                request({chainId: tx.chainId, data: tx.data ?? '0x', to: tx.to ?? null, value: tx.value ?? 0n}),
                options({resolvers: {descriptors}})
              )
            })
          }

          return clearSignTypedData(
            chainOf(Number(entry.data?.domain?.chainId ?? 1)),
            entry.data as TypedDataDefinition,
            options({resolvers: {descriptors}})
          )
        }

        let baseline: ClearSigning

        try {
          baseline = await describe(capture)
        } catch (error) {
          // The one case the adapter refuses (a broken checksum) is refused whatever the descriptor.
          assert.ok(isClearSignError(error, 'INVALID_INPUT'))
          continue
        }

        if (original === undefined) {
          continue
        }

        used++

        for (let round = 0; round < 5; round++) {
          runs++
          const mutated = mutate(original, next) as Erc7730Descriptor
          const result = await describe({descriptor: () => Promise.resolve({content: mutated, id: 'fuzz'})})
          // A descriptor never takes away what the package raises by itself.
          const own = codes(baseline).filter(code =>
            ['UNLIMITED_APPROVAL', 'ASSET_OWNERSHIP_TRANSFER', 'ALL_CHAINS', 'EXPIRED', 'LONG_LIVED'].includes(code)
          )

          for (const code of own) {
            assert.ok(codes(result).includes(code), `${path.basename(file)}: ${code}`)
          }
        }
      }
    }

    assert.ok(used > 40, `${used} cases had a descriptor`)
    assert.equal(runs, used * 5)
  })

  test('call data mutated under the bundled descriptors: never a throw, never a hang', async () => {
    const next = random(1337)
    const registry = registryResolver()
    const {parseTransaction} = await import('viem')
    let runs = 0
    let read = 0

    for (const file of vectorFiles(VECTORS)) {
      const vectors = JSON.parse(readFileSync(file, 'utf8')) as {
        readonly tests: readonly {readonly rawTx?: `0x${string}`}[]
      }

      for (const entry of vectors.tests.filter(test => test.rawTx !== undefined).slice(0, 3)) {
        const tx = parseTransaction(entry.rawTx as `0x${string}`)
        const original = Buffer.from((tx.data ?? '0x').slice(2), 'hex')

        if (original.length < 4 || typeof tx.to !== 'string') {
          continue
        }

        for (let round = 0; round < 6; round++) {
          runs++
          const bytes = Uint8Array.from(original)
          const choice = next()

          if (choice < 0.4) {
            // A word past the selector set to a huge length or offset.
            const word = 4 + 32 * Math.floor(next() * Math.max(1, (bytes.length - 4) / 32))
            bytes.fill(0xff, Math.min(word, bytes.length), Math.min(word + 28, bytes.length))
          } else if (choice < 0.7) {
            for (let flip = 0; flip < 8; flip++) {
              const at = 4 + Math.floor(next() * Math.max(1, bytes.length - 4))
              bytes[Math.min(at, bytes.length - 1)] = Math.floor(next() * 256)
            }
          }

          const data = choice >= 0.85 ? bytes.subarray(0, 4 + Math.floor(next() * (bytes.length - 4))) : bytes
          const result = await clearSignTransaction(
            chainOf(tx.chainId ?? 1),
            request({
              chainId: tx.chainId,
              data: `0x${Buffer.from(data).toString('hex')}`,
              to: tx.to,
              value: tx.value ?? 0n,
            }),
            options({resolvers: {descriptors: registry}})
          )

          if (result.source.kind === 'descriptor') {
            read++
          }
        }
      }
    }

    assert.ok(runs > 200, `${runs} runs`)
    assert.ok(read > 0 && read < runs, `${read} of ${runs} still read by a descriptor`)
  })
})

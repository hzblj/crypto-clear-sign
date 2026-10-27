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
import {compileDescriptor, DescriptorError} from '../src/erc7730/compile'
import {atText, locate, MAX_LOCATED, parsePath, pathText} from '../src/erc7730/path'
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

const rejected = (content: unknown, why: string) =>
  assert.throws(
    () => compileDescriptor(content),
    error => error instanceof DescriptorError,
    why
  )

describe('ERC-7730 paths', () => {
  test('the parser: roots, members, indexes, slices and every element', () => {
    const table: readonly [string, unknown][] = [
      ['amount', {absolute: false, root: 'data', steps: [{kind: 'field', name: 'amount'}]}],
      ['#.amount', {absolute: true, root: 'data', steps: [{kind: 'field', name: 'amount'}]}],
      ['@.from', {absolute: true, root: 'container', steps: [{kind: 'field', name: 'from'}]}],
      ['@.chainId', {absolute: true, root: 'container', steps: [{kind: 'field', name: 'chainId'}]}],
      [
        '$.metadata.constants.max',
        {
          absolute: true,
          root: 'descriptor',
          steps: [
            {kind: 'field', name: 'metadata'},
            {kind: 'field', name: 'constants'},
            {kind: 'field', name: 'max'},
          ],
        },
      ],
      [
        'details.[0].amount',
        {
          absolute: false,
          root: 'data',
          steps: [
            {kind: 'field', name: 'details'},
            {index: 0, kind: 'index'},
            {kind: 'field', name: 'amount'},
          ],
        },
      ],
      [
        'details[0].amount',
        {
          absolute: false,
          root: 'data',
          steps: [
            {kind: 'field', name: 'details'},
            {index: 0, kind: 'index'},
            {kind: 'field', name: 'amount'},
          ],
        },
      ],
      [
        'path.[-1]',
        {
          absolute: false,
          root: 'data',
          steps: [
            {kind: 'field', name: 'path'},
            {index: -1, kind: 'index'},
          ],
        },
      ],
      [
        'path.[1:3]',
        {
          absolute: false,
          root: 'data',
          steps: [
            {kind: 'field', name: 'path'},
            {end: 3, kind: 'slice', start: 1},
          ],
        },
      ],
      [
        'path.[:20]',
        {
          absolute: false,
          root: 'data',
          steps: [
            {kind: 'field', name: 'path'},
            {end: 20, kind: 'slice'},
          ],
        },
      ],
      [
        'path.[-20:]',
        {
          absolute: false,
          root: 'data',
          steps: [
            {kind: 'field', name: 'path'},
            {kind: 'slice', start: -20},
          ],
        },
      ],
      ['orders.[]', {absolute: false, root: 'data', steps: [{kind: 'field', name: 'orders'}, {kind: 'all'}]}],
      ['orders[]', {absolute: false, root: 'data', steps: [{kind: 'field', name: 'orders'}, {kind: 'all'}]}],
      ['_amount$0', {absolute: false, root: 'data', steps: [{kind: 'field', name: '_amount$0'}]}],
      // Not paths.
      ['', undefined],
      ['#.', undefined],
      ['a..b', undefined],
      ['a b', undefined],
      ['a-b', undefined],
      ['a.[x]', undefined],
      ['a.[1:2:3]', undefined],
      ['a.[1234567]', undefined],
      ['a.[0', undefined],
      ['@.sender', undefined],
      ['@.from.x', undefined],
      ['@.[0]', undefined],
      ['x'.repeat(257), undefined],
    ]

    for (const [text, expected] of table) {
      assert.deepEqual(parsePath(text), expected, text)
    }

    for (const value of [42, null, undefined, {}, ['a']]) {
      assert.equal(parsePath(value), undefined)
    }

    // Written back with concrete indexes, as ids and interpolation keys use it.
    for (const text of ['amount', '@.from', '$.metadata.x', 'a.[0].b', 'a.[1:]', 'a.[]']) {
      const parsed = parsePath(text)
      assert.ok(parsed)
      assert.equal(pathText(parsed), text)
    }
  })

  test('locate: members, negative indexes, slices of arrays and of bytes, bounded', () => {
    const tree = {
      fields: [
        {
          name: 'list',
          value: {
            items: [1n, 2n, 3n, 4n].map(value => ({bits: 256, kind: 'uint' as const, value})),
            kind: 'array' as const,
          },
        },
        {name: 'blob', value: {kind: 'bytes' as const, value: Uint8Array.of(1, 2, 3, 4, 5)}},
        {name: 'word', value: {bits: 256, kind: 'uint' as const, value: 0x0102n}},
      ],
      kind: 'tuple' as const,
    }
    const at = (text: string) => {
      const parsed = parsePath(text)
      assert.ok(parsed, text)

      return locate(tree, parsed.steps)
    }

    assert.deepEqual(
      at('list.[-1]').map(entry => atText(entry.at)),
      ['list.3']
    )
    assert.deepEqual(
      at('list.[1:3]').map(entry => atText(entry.at)),
      ['list.1', 'list.2']
    )
    assert.deepEqual(
      at('list.[-2:]').map(entry => atText(entry.at)),
      ['list.2', 'list.3']
    )
    assert.equal(at('list.[]').length, 4)
    assert.deepEqual(at('list.[9]'), [])
    assert.deepEqual(at('list.[-9]'), [])
    assert.deepEqual(at('missing'), [])
    assert.deepEqual(at('blob.[1:3]')[0]?.value, {kind: 'bytes', value: Uint8Array.of(2, 3)})
    assert.deepEqual(at('blob.[-2:]')[0]?.value, {kind: 'bytes', value: Uint8Array.of(4, 5)})
    // An integer's 32-byte word, sliced.
    assert.deepEqual(at('word.[30:]')[0]?.value, {kind: 'bytes', value: Uint8Array.of(1, 2)})
    // A slice past the end is cut to it; one that ends before it starts is empty.
    assert.deepEqual(at('blob.[3:99]')[0]?.value, {kind: 'bytes', value: Uint8Array.of(4, 5)})
    assert.deepEqual(at('blob.[4:2]')[0]?.value, {kind: 'bytes', value: new Uint8Array()})

    const many = {
      fields: [
        {
          name: 'list',
          value: {
            items: Array.from({length: 1000}, () => ({bits: 8, kind: 'uint' as const, value: 1n})),
            kind: 'array' as const,
          },
        },
      ],
      kind: 'tuple' as const,
    }
    assert.equal(locate(many, parsePath('list.[]')?.steps ?? []).length, MAX_LOCATED)
  })
})

describe('compiling a descriptor', () => {
  test('a well-formed one compiles, $refs merged with their params', () => {
    const compiled = compileDescriptor(
      vault(
        {
          'stake(uint256 amount, address to)': {
            fields: [
              {$ref: '$.display.definitions.amount', params: {threshold: '0x10'}, path: 'amount'},
              {format: 'addressName', label: '$.metadata.constants.toLabel', path: 'to'},
            ],
            intent: {Stake: 'tokens'},
            interpolatedIntent: 'Stake {amount}',
          },
        },
        {
          display: {
            definitions: {amount: {format: 'tokenAmount', label: 'Amount', params: {token: OTHER}}},
            formats: {
              'stake(uint256 amount, address to)': {
                fields: [
                  {$ref: '$.display.definitions.amount', params: {threshold: '0x10'}, path: 'amount'},
                  {format: 'addressName', label: '$.metadata.constants.toLabel', path: 'to'},
                ],
                intent: {Stake: 'tokens'},
                interpolatedIntent: 'Stake {amount}',
              },
            },
          },
          metadata: {constants: {toLabel: 'Beneficiary'}, owner: 'Vault', token: {decimals: 18, ticker: 'VLT'}},
        }
      )
    )
    assert.equal(compiled.kind, 'calldata')
    assert.equal(compiled.version, 2)
    assert.deepEqual(compiled.deployments, [{address: VAULT.toLowerCase(), chainId: 1}])
    assert.deepEqual(compiled.token, {decimals: 18, ticker: 'VLT'})
    const [format] = compiled.formats
    assert.equal(format?.fn?.signature, 'stake(uint256,address)')
    assert.equal(format?.intent, 'Stake: tokens')
    const [amount, to] = format?.fields ?? []
    assert.deepEqual(amount?.kind === 'field' && [amount.format, amount.label, amount.params], [
      'tokenAmount',
      'Amount',
      {threshold: '0x10', token: OTHER},
    ])
    assert.equal(to?.kind === 'field' && to.label, 'Beneficiary')
  })

  test('every malformed part is refused whole: DescriptorError, never half a descriptor', () => {
    const field = (extra: Record<string, unknown>) =>
      vault({'stake(uint256 amount)': {fields: [extra], intent: 'Stake'}})
    const format = (extra: Record<string, unknown>) =>
      vault({'stake(uint256 amount)': {fields: [{label: 'Amount', path: 'amount'}], intent: 'Stake', ...extra}})
    const eip712 = (
      context: Record<string, unknown>,
      formats: Record<string, unknown> = {Order: {intent: 'Order'}}
    ) => ({
      context: {eip712: context},
      display: {formats},
    })
    const nest = (depth: number): Record<string, unknown> =>
      depth === 0 ? {label: 'Amount', path: 'amount'} : {fields: [nest(depth - 1)]}

    const cases: readonly [string, unknown][] = [
      ['not an object', 'descriptor'],
      ['an array', []],
      ['null', null],
      ['includes not merged', {...vault(STAKE), includes: 'common.json'}],
      ['$schema not text', {...vault(STAKE), $schema: 2}],
      [
        'a later major version',
        {...vault(STAKE), $schema: 'https://eips.ethereum.org/assets/erc-7730/erc7730-v3.schema.json'},
      ],
      ['no context', {display: {formats: STAKE}}],
      ['no display', {context: {contract: {deployments: []}}}],
      ['metadata not an object', {...vault(STAKE), metadata: 'Vault'}],
      ['bound to both', {...vault(STAKE), context: {contract: {}, eip712: {}}}],
      ['bound to neither', {...vault(STAKE), context: {}}],
      ['context.contract not an object', {...vault(STAKE), context: {contract: 'x'}}],
      ['formats not an object', {...vault(STAKE), display: {formats: []}}],
      ['definitions not an object', {...vault(STAKE), display: {definitions: [], formats: STAKE}}],
      [
        'too many formats',
        vault(Object.fromEntries(Array.from({length: 2049}, (_, index) => [`f${index}(uint256 a)`, {intent: 'F'}]))),
      ],
      ['a format not an object', vault({'stake(uint256 amount)': 'Stake'})],
      ['deployments not a list', {...vault(STAKE), context: {contract: {deployments: {}}}}],
      ['chain id 0', {...vault(STAKE), context: {contract: {deployments: [{address: VAULT, chainId: 0}]}}}],
      ['chain id as text', {...vault(STAKE), context: {contract: {deployments: [{address: VAULT, chainId: '1'}]}}}],
      ['chain id not whole', {...vault(STAKE), context: {contract: {deployments: [{address: VAULT, chainId: 1.5}]}}}],
      [
        'an address that is not one',
        {...vault(STAKE), context: {contract: {deployments: [{address: '0x77', chainId: 1}]}}},
      ],
      ['a field with a path and a value', field({label: 'Amount', path: 'amount', value: 1})],
      ['a field with neither', field({label: 'Amount'})],
      ['a $ref to nothing', field({$ref: '$.display.definitions.missing', path: 'amount'})],
      ['a $ref that is not one', field({$ref: 'definitions.amount', path: 'amount'})],
      ['params not an object', field({params: [], path: 'amount'})],
      ['a format that is not a name', field({format: 7, path: 'amount'})],
      ['a format name past 64', field({format: 'x'.repeat(65), path: 'amount'})],
      ['a value that is an object', field({value: {}})],
      ['a path that is not one', field({path: 'a..b'})],
      ['visibility unknown', field({path: 'amount', visible: 'sometimes'})],
      ['ifNotIn empty', field({path: 'amount', visible: {ifNotIn: []}})],
      ['ifNotIn and mustMatch', field({path: 'amount', visible: {ifNotIn: [1], mustMatch: [1]}})],
      [
        'mustMatch past 64',
        field({path: 'amount', visible: {mustMatch: Array.from({length: 65}, (_, index) => index)}}),
      ],
      ['a label past 128', field({label: 'L'.repeat(129), path: 'amount'})],
      ['a label naming a constant that is not text', field({label: '$.metadata.owner.x', path: 'amount'})],
      ['a separator past 128', field({path: 'amount', separator: 'S'.repeat(129)})],
      ['an iteration unknown', format({fields: [{fields: [], iteration: 'parallel'}]})],
      ['groups nested past 8', format({fields: [nest(10)]})],
      ['more than 512 fields', format({fields: Array.from({length: 513}, () => ({label: 'A', path: 'amount'}))})],
      ['fields not a list', format({fields: {}})],
      ['a field not an object', format({fields: ['amount']})],
      ['an empty intent', format({intent: ' '})],
      ['an intent past 128', format({intent: 'I'.repeat(129)})],
      ['an intent object of non-text', format({intent: {Stake: 5}})],
      [
        'an intent object of 9 entries',
        format({intent: Object.fromEntries(Array.from({length: 9}, (_, i) => [`k${i}`, 'v']))}),
      ],
      ['an interpolated intent past 512', format({interpolatedIntent: 'I'.repeat(513)})],
      ['an interpolated intent not text', format({interpolatedIntent: 5})],
      ['required not a list', format({required: 'amount'})],
      ['excluded listing a non-path', format({excluded: ['a..b']})],
      ['a selector the ABI does not have', vault({'0x12345678': {intent: 'X'}})],
      ['a name without an ABI', vault({stake: {intent: 'X'}})],
      ['a broken signature', vault({'stake(uint256': {intent: 'X'}})],
      ['an unknown type', vault({'stake(uint7 amount)': {intent: 'X'}})],
      ['two formats of one function', vault({'stake(uint256 a)': {intent: 'X'}, 'stake(uint256 b)': {intent: 'Y'}})],
      ['context.eip712 not an object', {context: {eip712: 'x'}, display: {formats: {}}}],
      ['a domain not an object', eip712({domain: 'Permit2'})],
      ['a domain separator not 32 bytes', eip712({domainSeparator: '0x1234'})],
      [
        'two formats of one message type',
        eip712({}, {'Order(uint256  a)': {intent: 'B'}, 'Order(uint256 a)': {intent: 'A'}}),
      ],
      ['schemas not a list', eip712({schemas: {}})],
      ['a schema without a primary type', eip712({schemas: [{types: {}}]})],
      ['a schema type not a list', eip712({schemas: [{primaryType: 'Order', types: {Order: {}}}]})],
      ['a schema member not a pair', eip712({schemas: [{primaryType: 'Order', types: {Order: [{name: 'a'}]}}]})],
    ]

    for (const [why, content] of cases) {
      rejected(content, why)
    }
  })

  test('version 1: formats by selector, by name and by unnamed signature, from its ABI; schemas by primary type', () => {
    const abi = [
      {
        inputs: [
          {name: 'amount', type: 'uint256'},
          {components: [{name: 'to', type: 'address'}], name: 'target', type: 'tuple'},
        ],
        name: 'stake',
        type: 'function',
      },
      {inputs: [{name: 'amount', type: 'uint256'}], name: 'unstake', type: 'function'},
      {inputs: [], name: 'claim', type: 'function'},
    ]
    const v1 = compileDescriptor({
      $schema: 'https://github.com/LedgerHQ/clear-signing-erc7730-registry/specs/erc7730-v1.schema.json',
      context: {contract: {abi, deployments: [{address: VAULT, chainId: 1}]}},
      display: {
        formats: {
          '0x4e71d92d': {intent: 'Claim'},
          'stake(uint256,(address))': {intent: 'Stake'},
          unstake: {intent: 'Unstake'},
        },
      },
      metadata: {owner: 'Vault'},
    })
    assert.equal(v1.version, 1)
    assert.deepEqual(
      v1.formats.map(entry => [entry.key, entry.fn?.name, entry.fn?.inputs.map(input => input.name)]),
      [
        ['0x4e71d92d', 'claim', []],
        ['stake(uint256,(address))', 'stake', ['amount', 'target']],
        ['unstake', 'unstake', ['amount']],
      ]
    )

    const schemas = compileDescriptor({
      $schema: '../../specs/erc7730-v1.schema.json',
      context: {
        eip712: {
          deployments: [{address: VAULT, chainId: 1}],
          schemas: [
            'https://example.com/schema.json',
            {
              primaryType: 'Order',
              types: {
                EIP712Domain: [{name: 'name', type: 'string'}],
                Item: [{name: 'id', type: 'uint256'}],
                Order: [
                  {name: 'item', type: 'Item'},
                  {name: 'maker', type: 'address'},
                ],
              },
            },
          ],
        },
      },
      display: {formats: {Order: {intent: 'Order'}}},
    })
    assert.deepEqual([...schemas.schemas], [['Order', 'Order(Item item,address maker)Item(uint256 id)']])
    assert.equal(schemas.formats[0]?.primaryType, 'Order')
  })
})

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
      'app/broken.json': 'display.formats["stake(uint256 a"] is not a function signature.',
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
  test('compiling: a descriptor compiles or throws DescriptorError, nothing else', () => {
    const next = random(7730)
    let refused = 0
    let runs = 0

    for (const file of ETHEREUM_REGISTRY) {
      for (let round = 0; round < 60; round++) {
        runs++

        try {
          compileDescriptor(mutate(file.descriptor, next))
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
})

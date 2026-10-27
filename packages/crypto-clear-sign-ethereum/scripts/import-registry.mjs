/**
 * Re-imports the bundled ERC-7730 descriptors from LedgerHQ/clear-signing-erc7730-registry (CC0-1.0).
 *
 *   node scripts/import-registry.mjs                      # clones the registry's default branch into a temp directory
 *   node scripts/import-registry.mjs --registry <clone>   # or reads a local clone
 *
 * It copies each descriptor in SELECTION byte for byte, with every file its `includes` reach, into
 * src/registry/descriptors/ (keeping the registry's layout, so includes resolve as they do there), copies the
 * registry's own test cases for them into test/vectors/registry/, and writes src/registry/manifest.json (the commit,
 * and each file's path and SHA-256) and src/registry/files.ts (the list the `/registry` entry exports). Review the
 * diff before committing: a descriptor is believed by whoever loads it.
 */
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {existsSync} from 'node:fs'
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'

const REPOSITORY = 'https://github.com/LedgerHQ/clear-signing-erc7730-registry'
const PACKAGE = path.resolve(import.meta.dirname, '..')
const DESCRIPTORS = path.join(PACKAGE, 'src/registry/descriptors')
const VECTORS = path.join(PACKAGE, 'test/vectors/registry')

/** The descriptors bundled: the most used protocols the registry has, by the paths it keeps them at. */
export const SELECTION = [
  'registry/1inch/calldata-AggregationRouterV5.json',
  'registry/1inch/calldata-AggregationRouterV6.json',
  'registry/1inch/eip712-1inch-limit-order.json',
  'registry/aave/calldata-lpv3.json',
  'registry/aave/calldata-WrappedTokenGatewayV3.json',
  'registry/circle/calldata-TokenMessengerV2.json',
  'registry/circle/eip712-ReceiveWithAuthorization.json',
  'registry/circle/eip712-TransferWithAuthorization.json',
  'registry/ethena/calldata-ethena.json',
  'registry/kyberswap/calldata-MetaAggregationRouterV2.json',
  'registry/lido/calldata-stETH.json',
  'registry/lido/calldata-WithdrawalQueueERC721.json',
  'registry/lido/calldata-wstETH.json',
  'registry/lifi/calldata-LIFIDiamond.json',
  'registry/morpho/calldata-MorphoBlue.json',
  'registry/paraswap/calldata-AugustusSwapper-v6.2.json',
  'registry/safe/calldata-Safe-1.4.1.json',
  'registry/safe/calldata-SafeToL2Setup-1.4.1.json',
  'registry/safe/eip712-Safe-1.4.1.json',
  'registry/sky/calldata-sUSDS.json',
  'registry/tether/calldata-usdt.json',
  'registry/uniswap/calldata-UniswapV2Router02.json',
  'registry/uniswap/calldata-UniswapV3Router02.json',
  'registry/uniswap/eip712-uniswap-permit2.json',
  'registry/weth/calldata-weth.json',
]

const run = (command, args, cwd) => execFileSync(command, args, {cwd, encoding: 'utf8', maxBuffer: 64 << 20}).trim()

const argument = name => {
  const index = process.argv.indexOf(name)

  return index < 0 ? undefined : process.argv[index + 1]
}

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

let registry = argument('--registry')
let temporary

if (registry === undefined) {
  temporary = await mkdtemp(path.join(tmpdir(), 'erc7730-registry-'))
  registry = path.join(temporary, 'registry')
  run('git', ['clone', '--depth', '1', `${REPOSITORY}.git`, registry], temporary)
}

registry = path.resolve(registry)
const commit = run('git', ['rev-parse', 'HEAD'], registry)

/** Every file a descriptor reaches through `includes`, the descriptor first. */
const reach = async (file, seen = new Set()) => {
  if (seen.has(file)) {
    return []
  }

  seen.add(file)
  const json = JSON.parse(await readFile(path.join(registry, file), 'utf8'))
  const includes = json.includes === undefined ? [] : [json.includes].flat()
  const nested = []

  for (const include of includes) {
    nested.push(...(await reach(path.posix.normalize(path.posix.join(path.posix.dirname(file), include)), seen)))
  }

  return [file, ...nested]
}

const files = new Map()

for (const descriptor of SELECTION) {
  for (const [position, file] of (await reach(descriptor)).entries()) {
    if (!files.has(file) || position === 0) {
      files.set(file, position === 0 ? 'descriptor' : (files.get(file) ?? 'include'))
    }
  }
}

await rm(DESCRIPTORS, {force: true, recursive: true})
await rm(VECTORS, {force: true, recursive: true})

const manifest = []
const tests = []

for (const [file, role] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
  const bytes = await readFile(path.join(registry, file))
  await mkdir(path.dirname(path.join(DESCRIPTORS, file)), {recursive: true})
  await writeFile(path.join(DESCRIPTORS, file), bytes)
  manifest.push({path: file, role, sha256: sha256(bytes)})

  const test = path.posix.join(path.posix.dirname(file), 'testsv2', path.posix.basename(file).replace(/\.json$/, '.tests.json'))

  if (role === 'descriptor' && existsSync(path.join(registry, test))) {
    const testBytes = await readFile(path.join(registry, test))
    await mkdir(path.dirname(path.join(VECTORS, test)), {recursive: true})
    await writeFile(path.join(VECTORS, test), testBytes)
    tests.push({path: test, sha256: sha256(testBytes)})
  }
}

await writeFile(
  path.join(PACKAGE, 'src/registry/manifest.json'),
  `${JSON.stringify({commit, files: manifest, license: 'CC0-1.0', repository: REPOSITORY, tests}, null, 2)}\n`
)

const descriptors = manifest.filter(entry => entry.role === 'descriptor' || entry.role === 'include')
const name = index => `file${index}`
const source = [
  `// Generated by scripts/import-registry.mjs from ${REPOSITORY} at ${commit} (CC0-1.0). Do not edit: re-import.`,
  "import type {Erc7730Descriptor} from '../erc7730/types'",
  "import type {Erc7730File} from '../erc7730/resolver'",
  ...descriptors.map((entry, index) => `import ${name(index)} from './descriptors/${entry.path}'`),
  '',
  `/** Every bundled file, descriptors and the files they include, by its path in the registry. */`,
  'export const FILES: readonly Erc7730File[] = Object.freeze([',
  ...descriptors.map((entry, index) => `  {descriptor: ${name(index)} as Erc7730Descriptor, path: '${entry.path}', publisher: 'ERC-7730 registry'},`),
  '])',
  '',
]

await writeFile(path.join(PACKAGE, 'src/registry/files.ts'), source.join('\n'))
run('yarn', ['run', '-T', 'biome', 'check', '--write', 'src/registry/files.ts'], PACKAGE)

if (temporary !== undefined) {
  await rm(temporary, {force: true, recursive: true})
}

console.log(`import-registry: ${manifest.length} files (${SELECTION.length} descriptors) and ${tests.length} test files at ${commit}`)

/**
 * Checks what npm would receive, the way a consumer meets it. Packs every published package (each `prepack` builds it
 * through turbo's cache), asserts what must and must not ship in each tarball, then installs them into a throwaway
 * app and type-checks real usage with a consumer's TypeScript (each package's `test/consumer.ts`): no `source`
 * condition, no workspace links, only what the tarballs declare (and `@hzblj/nitro-crypto` and the chain adapters, the
 * chain packages' peers, from npm, as a consumer has them).
 *
 * The negative cases matter as much as the positive ones: if a declaration failed to resolve, its imports would
 * quietly become `any` and everything would compile, so each `@ts-expect-error` is there to prove the types are real.
 */
import {execFileSync} from 'node:child_process'
import {existsSync} from 'node:fs'
import {mkdir, readdir, readFile, rm, writeFile} from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const WORK = path.join(ROOT, '.pack-check')

const run = (command, args, cwd = ROOT) => execFileSync(command, args, {cwd, encoding: 'utf8', maxBuffer: 64 << 20})

const fail = message => {
  console.error(`pack-check: ${message}`)
  process.exit(1)
}

const PACKAGE = ['package.json', 'README.md', 'LICENSE', 'CHANGELOG.md', 'build/index.js', 'build/index.d.ts']

const REQUIRED = {
  '@hzblj/crypto-clear-sign': PACKAGE,
  '@hzblj/crypto-clear-sign-bitcoin': PACKAGE,
  '@hzblj/crypto-clear-sign-ethereum': PACKAGE,
  '@hzblj/crypto-clear-sign-solana': PACKAGE,
}

// Tests, TypeScript sources and build metadata stay home.
const FORBIDDEN = [/^src\//, /^test\//, /\.DS_Store$/, /\.tsbuildinfo$/]

const packages = []
for (const directory of await readdir(path.join(ROOT, 'packages'))) {
  const manifestPath = path.join(ROOT, 'packages', directory, 'package.json')
  if (!existsSync(manifestPath)) {
    continue
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (!manifest.private) {
    packages.push({directory, name: manifest.name})
  }
}

await rm(WORK, {force: true, recursive: true})
await mkdir(path.join(WORK, 'tarballs'), {recursive: true})

let fileCount = 0
for (const {directory, name} of packages) {
  const tarball = path.join(WORK, 'tarballs', `${directory}.tgz`)
  run('yarn', ['pack', '--out', tarball], path.join(ROOT, 'packages', directory))

  const files = run('tar', ['-tzf', tarball])
    .split('\n')
    .filter(Boolean)
    .map(file => file.replace(/^package\//, ''))
  const missing = (REQUIRED[name] ?? ['package.json', 'README.md']).filter(file => !files.includes(file))
  const leaked = files.filter(file => FORBIDDEN.some(pattern => pattern.test(file)))
  if (missing.length > 0) {
    fail(`${name} is missing:\n  ${missing.join('\n  ')}`)
  }
  if (leaked.length > 0) {
    fail(`${name} must not ship:\n  ${leaked.join('\n  ')}`)
  }

  const packed = JSON.parse(run('tar', ['-xzOf', tarball, 'package/package.json']))
  for (const field of ['dependencies', 'peerDependencies']) {
    if (JSON.stringify(packed[field] ?? {}).includes('workspace:')) {
      fail(`${name} still declares a workspace: range in ${field}: it would not install outside this repo`)
    }
  }
  // `source` points at src/, which stays home: a consumer that sets the condition (a monorepo's own tests do) would
  // resolve to a file that is not there. `publishConfig.exports` is the published map without it.
  if (JSON.stringify(packed.exports ?? {}).includes('"source"')) {
    fail(`${name} publishes a \`source\` condition in its exports, to a src/ it does not ship`)
  }

  const installed = path.join(WORK, 'node_modules', name)
  await mkdir(installed, {recursive: true})
  run('tar', ['-xzf', tarball, '-C', installed, '--strip-components', '1'])
  fileCount += files.length
}

// Each package's consumer, `test/consumer.ts`: what a consumer of that package writes, real usage and the mistakes the
// types must refuse. Every published package has one; each owns its own, so the packages grow them independently.
await mkdir(path.join(WORK, 'consumers'), {recursive: true})
for (const {directory, name} of packages) {
  const source = path.join(ROOT, 'packages', directory, 'test', 'consumer.ts')
  if (!existsSync(source)) {
    fail(`${name} has no test/consumer.ts to type-check against its tarball`)
  }
  await writeFile(path.join(WORK, 'consumers', `${directory}.ts`), await readFile(source, 'utf8'))
}

await writeFile(
  path.join(WORK, 'tsconfig.json'),
  JSON.stringify(
    {
      // expo/tsconfig.base's options, as a React Native app has them.
      compilerOptions: {
        customConditions: ['react-native'],
        esModuleInterop: true,
        lib: ['ESNext', 'DOM'],
        module: 'preserve',
        moduleDetection: 'force',
        moduleResolution: 'bundler',
        noEmit: true,
        skipLibCheck: true,
        strict: true,
        target: 'ESNext',
        types: [],
      },
      include: ['consumers/*.ts'],
    },
    null,
    2
  )
)

try {
  run('yarn', ['run', '-T', 'tsc', '-p', WORK])
} catch (error) {
  fail(`a consumer's type check failed:\n${error.stdout}`)
}

await rm(WORK, {force: true, recursive: true})
console.log(`pack-check: ${packages.length} packages, ${fileCount} files, and each package's consumer type-checks`)

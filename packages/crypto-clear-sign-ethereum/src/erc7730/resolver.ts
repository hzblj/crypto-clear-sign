import type {DescriptorResolver} from '@hzblj/crypto-clear-sign'

import {normalizeEncodeType} from '../eip712'
import type {EthereumDescriptorQuery} from '../env'
import {type Binding, bindingOf, DescriptorError, isBound} from './binding'
import type {Erc7730Descriptor} from './types'

/** A descriptor file, as a registry lays it out. */
export type Erc7730File = {
  /**
   * Where the file is in its registry (`registry/uniswap/calldata-UniswapV3Router02.json`): what its `includes`
   * resolve against, and the `source.id` of what it describes.
   */
  readonly path: string
  /** The file's JSON, `includes` and all. */
  readonly descriptor: Erc7730Descriptor
  /** Who published it, for people: shown as the source's `publisher`. Up to 128 characters. */
  readonly publisher?: string
}

/** A descriptor resolver built from files, and what it made of them. */
export type Erc7730Resolver = DescriptorResolver<EthereumDescriptorQuery, Erc7730Descriptor> & {
  /** The files it answers with, by path. */
  readonly paths: readonly string[]
  /** Files it cannot use, and why: malformed, an `includes` it was not given, or bound to nothing. */
  readonly rejected: readonly {readonly path: string; readonly reason: string}[]
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const MAX_MERGE_DEPTH = 64
const MAX_INCLUDE_DEPTH = 8

const mergeFields = (base: readonly unknown[], overlay: readonly unknown[], depth: number): unknown[] => {
  const out = [...base]

  for (const entry of overlay) {
    const path = isRecord(entry) ? entry.path : undefined
    const index = path === undefined ? -1 : out.findIndex(existing => isRecord(existing) && existing.path === path)

    if (index < 0) {
      out.push(entry)
    } else {
      out[index] = mergeValues(out[index], entry, undefined, depth + 1)
    }
  }

  return out
}

const mergeValues = (base: unknown, overlay: unknown, key: string | undefined, depth: number): unknown => {
  if (depth > MAX_MERGE_DEPTH) {
    return overlay
  }

  if (key === 'fields' && Array.isArray(base) && Array.isArray(overlay)) {
    return mergeFields(base, overlay, depth)
  }

  if (isRecord(base) && isRecord(overlay)) {
    // Built from entries, so that a key such as "__proto__" stays a key and never a prototype.
    return Object.fromEntries([
      ...Object.entries(base).filter(([name]) => !Object.hasOwn(overlay, name)),
      ...Object.entries(overlay).map(([name, value]) => [
        name,
        Object.hasOwn(base, name) ? mergeValues(base[name], value, name, depth + 1) : value,
      ]),
    ])
  }

  return overlay
}

/**
 * `overlay` merged over `base`, as ERC-7730 merges an included file: objects key by key, the including file winning;
 * `fields` lists by `path` (a field of the same path merged, its `params` overriding, others appended); anything
 * else replaced.
 */
export const mergeDescriptors = (base: Erc7730Descriptor, overlay: Erc7730Descriptor): Erc7730Descriptor =>
  mergeValues(base, overlay, undefined, 0) as Erc7730Descriptor

const normalizePath = (path: string): string => {
  const parts: string[] = []

  for (const part of path.split('/')) {
    if (part === '..') {
      parts.pop()
    } else if (part !== '.' && part !== '') {
      parts.push(part)
    }
  }

  return parts.join('/')
}

const directoryOf = (path: string) => path.split('/').slice(0, -1).join('/')

const bindingKeys = (binding: Binding): string[] =>
  binding.kind === 'calldata'
    ? binding.deployments.flatMap(deployment =>
        [...binding.functions.keys()].map(selector => `c:${deployment.chainId}:${deployment.address}:${selector}`)
      )
    : [...binding.encodeTypes.keys()].flatMap(type =>
        binding.deployments.length > 0
          ? binding.deployments.map(deployment => `t:${deployment.chainId}:${deployment.address}:${type}`)
          : [`t:any:${type}`]
      )

type Entry = {
  readonly path: string
  readonly content: Erc7730Descriptor
  readonly binding: Binding
  readonly publisher?: string
}

const domainFits = (binding: Binding, query: Extract<EthereumDescriptorQuery, {kind: 'eip712'}>) => {
  const domain = binding.kind === 'eip712' ? (binding.domain ?? {}) : {}
  const name = domain.name
  const chainId = domain.chainId
  const verifyingContract = domain.verifyingContract

  return (
    isBound(binding) &&
    (name === undefined || name === query.domainName) &&
    (chainId === undefined || String(chainId) === String(query.chainId)) &&
    (verifyingContract === undefined ||
      (typeof verifyingContract === 'string' &&
        query.verifyingContract !== undefined &&
        verifyingContract.toLowerCase() === query.verifyingContract.toLowerCase()))
  )
}

/**
 * A `descriptors` resolver from ERC-7730 files: each file's `includes` merged from the files given (resolved against
 * its `path`, never fetched), checked and compiled, and indexed by what it binds to (a contract's deployments and
 * selectors, a message's domain and type). A later file wins over an earlier one for the same deployment and function
 * or message type, so an app's own descriptors listed after a registry's override or extend them:
 *
 * ```ts
 * import {ETHEREUM_REGISTRY} from '@hzblj/crypto-clear-sign-ethereum/registry'
 *
 * const descriptors = createDescriptorResolver([...ETHEREUM_REGISTRY, ...myDescriptors])
 * await clearSignTransaction(chain, unsigned, {resolvers: {descriptors}})
 * ```
 *
 * Files that cannot be used are left out and listed in `rejected`; files that only exist to be included are not.
 * The package checks every answer's binding again before it uses it. **A descriptor is believed:** load files only
 * from a registry the app trusts, never from the dApp asking for the signature.
 */
export const createDescriptorResolver = (
  files: readonly Erc7730File[],
  options: {readonly publisher?: string} = {}
): Erc7730Resolver => {
  const byPath = new Map<string, Erc7730File>()

  for (const file of files) {
    if (isRecord(file) && typeof file.path === 'string') {
      byPath.set(normalizePath(file.path), file)
    }
  }

  const included = new Set<string>()
  const rejected: {path: string; reason: string}[] = []

  const merged = (path: string, stack: readonly string[]): Erc7730Descriptor => {
    const file = byPath.get(path)

    if (file === undefined) {
      throw new DescriptorError('It includes a file that was not given.')
    }

    if (!isRecord(file.descriptor)) {
      throw new DescriptorError(
        stack.length === 0 ? 'It is not a JSON object.' : 'It includes a file that is not a JSON object.'
      )
    }

    if (stack.includes(path) || stack.length > MAX_INCLUDE_DEPTH) {
      throw new DescriptorError('Its includes form a cycle or nest too deep.')
    }

    const {includes, ...own} = file.descriptor
    const list = includes === undefined ? [] : Array.isArray(includes) ? includes : [includes]
    let base: Erc7730Descriptor = {}

    for (const include of list) {
      if (typeof include !== 'string') {
        throw new DescriptorError('An include is a relative path.')
      }

      const target = normalizePath(`${directoryOf(path)}/${include}`)
      included.add(target)
      base = mergeDescriptors(base, merged(target, [...stack, path]))
    }

    return list.length === 0 ? own : mergeDescriptors(base, own)
  }

  const entries: Entry[] = []
  const unbound: string[] = []
  const failures: {path: string; reason: string}[] = []

  for (const [path, file] of byPath) {
    let content: Erc7730Descriptor

    try {
      content = merged(path, [])
    } catch (error) {
      // Broken includes (a cycle, a file not given) are the file's own fault, whoever includes it: always reported.
      rejected.push({path, reason: error instanceof DescriptorError ? error.message : 'It could not be read.'})
      continue
    }

    try {
      const binding = bindingOf(content)

      if (bindingKeys(binding).length === 0 || !isBound(binding)) {
        unbound.push(path)
        continue
      }

      entries.push({binding, content, path, ...(file.publisher === undefined ? {} : {publisher: file.publisher})})
    } catch (error) {
      failures.push({path, reason: error instanceof DescriptorError ? error.message : 'It could not be read.'})
    }
  }

  // A file that only exists to be included is no descriptor by itself: it fails alone and binds nothing, and is fine.
  for (const failure of failures) {
    if (!included.has(failure.path)) {
      rejected.push(failure)
    }
  }

  for (const path of unbound) {
    if (!included.has(path)) {
      rejected.push({path, reason: 'It binds to no contract or message.'})
    }
  }

  const index = new Map<string, Entry>()
  // Domain-bound descriptors (no deployments) are many per type: each is tried, the latest first.
  const unanchored = new Map<string, Entry[]>()

  for (const entry of entries) {
    for (const key of bindingKeys(entry.binding)) {
      if (key.startsWith('t:any:')) {
        unanchored.set(key, [entry, ...(unanchored.get(key) ?? [])])
      } else {
        index.set(key, entry)
      }
    }
  }

  const answer = (entry: Entry | undefined) => {
    if (entry === undefined) {
      return undefined
    }

    const publisher = entry.publisher ?? options.publisher

    return {content: entry.content, id: entry.path, ...(publisher === undefined ? {} : {publisher})}
  }

  return Object.freeze({
    descriptor: (query: EthereumDescriptorQuery) => {
      if (query.kind === 'calldata') {
        return answer(index.get(`c:${query.chainId}:${query.address.toLowerCase()}:${query.selector}`))
      }

      const types = [normalizeEncodeType(query.encodeType)]
      const bound =
        query.chainId === undefined || query.verifyingContract === undefined
          ? undefined
          : types
              .map(type => index.get(`t:${query.chainId}:${query.verifyingContract?.toLowerCase()}:${type}`))
              .find(Boolean)

      return answer(
        bound ??
          types.flatMap(type => unanchored.get(`t:any:${type}`) ?? []).find(entry => domainFits(entry.binding, query))
      )
    },
    paths: Object.freeze(entries.map(entry => entry.path)),
    rejected: Object.freeze(rejected.map(entry => Object.freeze(entry))),
  })
}

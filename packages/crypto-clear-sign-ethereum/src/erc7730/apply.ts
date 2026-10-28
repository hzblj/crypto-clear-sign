import {
  type CustomResolverOptions,
  type GitHubResolverOptions,
  resolveCalldataDescriptor,
  resolveTypedDataDescriptor,
  eip712 as sourcifyEip712,
  type TypedData,
} from '@ethereum-sourcify/clear-signing'
import {hasHiddenCharacters, INTENTS, LABELS, type WarningInput, warning} from '@hzblj/crypto-clear-sign'
import {hex, utf8} from '@hzblj/nitro-crypto/adapter'
import {keccak_256} from '@noble/hashes/sha3'

import {AbiError, type AbiValue, decodeCall} from '../abi'
import type {Call, DescribeCall, Described} from '../calls/common'
import {ETHEREUM_TEXTS, ETHEREUM_WARNINGS} from '../catalogs'
import {normalizeEncodeType} from '../eip712'
import {type Env, lower} from '../env'
import {bindingCached, DescriptorError, isBound} from './binding'
import {renderDisplay} from './display'
import {NO_SIGNER, runCalldata, runTypedData} from './sourcify'

/** What applying a descriptor gave: an action, or nothing (with why, when one was found and not used). */
export type Applied = {readonly described?: Described; readonly warnings: readonly WarningInput[]}

/** A descriptor found for a call or a message, from the app's resolver or the online registry. */
type Found = {readonly id: string; readonly content: unknown; readonly publisher?: string}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Not used: `ethereum.INVALID_DESCRIPTOR`, or `ethereum.UNTRUSTED_DESCRIPTOR` for a missing attestation. */
const failed = (code: string): Applied =>
  code === 'NO_TRUSTED_ATTESTATION' || code === 'ATTESTATION_OPTIONS_INCOMPLETE'
    ? {warnings: [warning(ETHEREUM_WARNINGS.UNTRUSTED_DESCRIPTOR, {params: {code}})]}
    : {warnings: [warning(ETHEREUM_WARNINGS.INVALID_DESCRIPTOR, {params: {code}})]}

/** The contract's name a descriptor gives, when it is fit to show. */
const nameOf = (content: Readonly<Record<string, unknown>>): string | undefined => {
  const metadata = isRecord(content.metadata) ? content.metadata : {}
  const name = [metadata.contractName, metadata.owner].find(
    (entry): entry is string => typeof entry === 'string' && entry.trim() !== '' && entry.length <= 128
  )

  return name === undefined || hasHiddenCharacters(name) ? undefined : name.trim()
}

const sourceOf = (found: Found) =>
  ({
    format: 'erc7730',
    id: found.id,
    kind: 'descriptor',
    ...(found.publisher === undefined ? {} : {publisher: found.publisher}),
  }) as const

const DEFAULT_REPOSITORY = 'ethereum/clear-signing-erc7730-registry'

/** Answers nothing: the resolver behind a trusted token list alone. */
const NOTHING = {
  fetchDescriptor: async () => {
    throw new Error('Nothing is served.')
  },
  index: {calldataIndex: {}, typedDataIndex: {}},
}

/**
 * The online registry (`sourcify.registry`) and the trusted token list (`sourcify.trustedTokens`), asked through the
 * reference implementation when the app's resolver has nothing: with the attestation policy, when set. A fetch that
 * fails is `RESOLVER_FAILED` (`descriptors`), as any resolver's.
 */
const online = async (
  env: Env,
  lookup:
    | {readonly kind: 'calldata'; readonly to: string}
    | {
        readonly kind: 'eip712'
        readonly typedData: TypedData
        readonly verifyingContract: string
        readonly hash: string
      }
): Promise<Found | Applied | undefined> => {
  const sourcify = env.options.sourcify
  const registry = sourcify?.registry

  if (sourcify === undefined || (registry === undefined && sourcify.trustedTokens === undefined)) {
    return undefined
  }

  const policy = {
    ...(sourcify.attestations === undefined ? {} : {attestations: sourcify.attestations}),
    ...(sourcify.trustedTokens === undefined ? {} : {trustedTokens: sourcify.trustedTokens}),
  }
  const options: GitHubResolverOptions | CustomResolverOptions =
    registry === undefined ? {resolver: NOTHING, type: 'custom', ...policy} : {...registry, type: 'github', ...policy}
  const address = lower(lookup.kind === 'calldata' ? lookup.to : lookup.verifyingContract)
  const key = `eip155:${env.chainId}:${address}`

  try {
    const result =
      lookup.kind === 'calldata'
        ? await resolveCalldataDescriptor(env.chainId, lookup.to, options, sourcify.chainClient)
        : await resolveTypedDataDescriptor(lookup.typedData, options, sourcify.chainClient)

    if ('warning' in result) {
      return result.warning.code === 'NO_DESCRIPTOR' ? undefined : failed(result.warning.code)
    }

    const path =
      lookup.kind === 'calldata'
        ? registry?.index?.calldataIndex[key]
        : registry?.index?.typedDataIndex[key]?.[lookup.typedData.primaryType]?.find(entry =>
            entry.encodeTypeHashes.includes(lookup.hash)
          )?.path
    const repository = registry?.githubSource?.repo ?? DEFAULT_REPOSITORY

    if (typeof path === 'string' && path.length <= 256) {
      return {content: result.descriptor, id: path, publisher: repository}
    }

    return registry === undefined || (registry.index !== undefined && lookup.kind === 'calldata')
      ? {content: result.descriptor, id: `trusted-tokens/${key}`, publisher: 'Trusted token list'}
      : {content: result.descriptor, id: key, publisher: repository}
  } catch {
    env.context.fail('descriptors')

    return undefined
  }
}

/** The descriptor's JSON, when it can be given to the reference whole: an object, its includes already merged. */
const contentOf = (found: Found): Readonly<Record<string, unknown>> | undefined =>
  isRecord(found.content) && found.content.includes === undefined ? found.content : undefined

/**
 * A call described by the descriptor the resolver answers for its contract and selector (or, when it has none, the
 * online registry), after checking that the descriptor binds to this chain and contract, has a format for the
 * selector, and that the call data decodes strictly as that format's function. Rendered by the reference
 * implementation; anything that keeps it from rendering leaves the call to the next reader.
 */
export const describeCallByDescriptor = async (env: Env, call: Call, nested: DescribeCall): Promise<Applied> => {
  const selector = `0x${hex.encode(call.data.subarray(0, 4))}`
  const answer = await env.context.descriptor({
    address: call.to,
    chain: env.ref,
    chainId: env.chainId,
    kind: 'calldata',
    selector,
  })
  const found = answer ?? (await online(env, {kind: 'calldata', to: call.to}))

  if (found === undefined) {
    return {warnings: []}
  }

  if ('warnings' in found) {
    return found
  }

  const content = contentOf(found)
  let binding: ReturnType<typeof bindingCached>

  try {
    binding = bindingCached(content)
  } catch (error) {
    if (error instanceof DescriptorError) {
      return failed('INVALID_DESCRIPTOR')
    }

    throw error
  }

  if (
    content === undefined ||
    binding.kind !== 'calldata' ||
    !binding.deployments.some(entry => entry.chainId === env.chainId && entry.address === lower(call.to))
  ) {
    return failed('DEPLOYMENT_MISMATCH')
  }

  const entry = binding.functions.get(selector)

  if (entry === undefined) {
    // The online registry finds a contract's descriptor, whatever the function: one without it describes nothing.
    return answer === undefined ? {warnings: []} : failed('NO_FORMAT_MATCH')
  }

  try {
    // Strict and bounded: hostile call data never reaches the reference's decoder.
    decodeCall(entry.fn, call.data)
  } catch (error) {
    if (error instanceof AbiError) {
      return failed('CALLDATA_DECODE_ERROR')
    }

    throw error
  }

  const from = call.from ?? env.options.signer
  const run = await runCalldata(env, {
    data: `0x${hex.encode(call.data)}`,
    descriptor: content,
    key: entry.key,
    to: call.to,
    value: call.value,
    ...(from === undefined ? {} : {from}),
  })

  if (!run.ok) {
    return failed(run.code)
  }

  const rendered = await renderDisplay({
    calldata: true,
    depth: call.depth,
    descriptor: content,
    env,
    nested,
    run,
    taken: ['contract', 'value'],
    to: call.to,
    ...(from === undefined ? {} : {from}),
  })
  const name = nameOf(content)
  const contract = await env.address({
    id: 'contract',
    label: LABELS.contract,
    value: call.to,
    ...(name === undefined ? {} : {fallbackName: name}),
  })

  return {
    described: {
      actions: rendered.actions,
      fields: [...rendered.fields, contract],
      intent: rendered.intent ?? INTENTS.contractCall,
      raw: [],
      source: sourceOf(found),
      warnings: rendered.warnings,
      ...(rendered.summary === undefined ? {} : {summary: rendered.summary}),
    },
    warnings: [],
  }
}

/** Typed data as the package read it: its types, its message decoded, and its domain. */
export type TypedDataSubject = {
  readonly types: Readonly<Record<string, readonly {readonly name: string; readonly type: string}[]>>
  readonly primaryType: string
  /** The package's `encodeType` of the primary type. */
  readonly encodeType: string
  readonly message: AbiValue
  readonly domain: Readonly<Record<string, unknown>>
  readonly chainId?: number
  /** EIP-55. */
  readonly verifyingContract?: string
  readonly domainName?: string
  /** The domain separator, lowercase hex, when it can be computed. */
  readonly domainSeparator: () => string | undefined
}

/** A decoded value as the plain JSON the reference reads a message from. */
const plain = (value: AbiValue): unknown => {
  switch (value.kind) {
    case 'uint':
    case 'int':
      return value.value.toString()
    case 'address':
      return value.value
    case 'bool':
      return value.value
    case 'bytes':
      return `0x${hex.encode(value.value)}`
    case 'string':
      return value.value
    case 'array':
      return value.items.map(plain)
    case 'tuple':
      return Object.fromEntries(value.fields.map((field, index) => [field.name ?? String(index), plain(field.value)]))
  }
}

/**
 * Typed data described by the descriptor the resolver answers for its domain and type (or, when it has none, the
 * online registry), after checking that it binds (by deployments, domain values, or a domain separator the package
 * computes), and that it has a format for the message's `encodeType`. Rendered by the reference implementation, which
 * needs the domain's chain id and verifying contract. Calls in the message (`calldata` fields) are described by `nested`.
 */
export const describeTypedDataByDescriptor = async (
  env: Env,
  subject: TypedDataSubject,
  nested?: DescribeCall
): Promise<Applied> => {
  const {chainId, verifyingContract} = subject
  const answer = await env.context.descriptor({
    chain: env.ref,
    encodeType: subject.encodeType,
    kind: 'eip712',
    primaryType: subject.primaryType,
    ...(chainId === undefined ? {} : {chainId}),
    ...(verifyingContract === undefined ? {} : {verifyingContract}),
    ...(subject.domainName === undefined ? {} : {domainName: subject.domainName}),
  })

  if (chainId === undefined || verifyingContract === undefined) {
    // The reference reads typed data bound to a contract on a chain only.
    return answer === undefined ? {warnings: []} : failed('UNSUPPORTED_DOMAIN')
  }

  const exact = sourcifyEip712.computeEncodeType(
    subject.primaryType,
    subject.types as Record<string, {name: string; type: string}[]>
  )

  if (exact === undefined) {
    return answer === undefined ? {warnings: []} : failed('NO_FORMAT_MATCH')
  }

  const hash = `0x${hex.encode(keccak_256(utf8.encode(exact)))}`
  const domain = subject.domain
  const typedData: TypedData = {
    account: env.options.signer ?? NO_SIGNER,
    domain: {
      chainId,
      verifyingContract: typeof domain.verifyingContract === 'string' ? domain.verifyingContract : verifyingContract,
      ...(typeof domain.name === 'string' ? {name: domain.name} : {}),
      ...(typeof domain.version === 'string' ? {version: domain.version} : {}),
      ...(typeof domain.salt === 'string' ? {salt: domain.salt} : {}),
    },
    message: (subject.message.kind === 'tuple' ? plain(subject.message) : {}) as Record<string, unknown>,
    primaryType: subject.primaryType,
    types: subject.types as Record<string, {name: string; type: string}[]>,
  }
  const found = answer ?? (await online(env, {hash, kind: 'eip712', typedData, verifyingContract}))

  if (found === undefined) {
    return {warnings: []}
  }

  if ('warnings' in found) {
    return found
  }

  const content = contentOf(found)
  let binding: ReturnType<typeof bindingCached>

  try {
    binding = bindingCached(content)
  } catch (error) {
    if (error instanceof DescriptorError) {
      return failed('INVALID_DESCRIPTOR')
    }

    throw error
  }

  if (
    content === undefined ||
    binding.kind !== 'eip712' ||
    !isBound(binding) ||
    (binding.domainSeparator !== undefined && binding.domainSeparator !== subject.domainSeparator())
  ) {
    return failed('DOMAIN_MISMATCH')
  }

  const key = binding.encodeTypes.get(normalizeEncodeType(subject.encodeType))

  if (key === undefined) {
    return failed('NO_FORMAT_MATCH')
  }

  // The reference finds a message's format by its exact `encodeType`; a key spaced otherwise is the same type.
  const display = isRecord(content.display) ? content.display : {}
  const formats = isRecord(display.formats) ? display.formats : {}
  const served =
    key === exact ? content : {...content, display: {...display, formats: {...formats, [exact]: formats[key]}}}
  const run = await runTypedData(env, {descriptor: served, hash, key: exact, typedData, verifyingContract})

  if (!run.ok) {
    return failed(run.code)
  }

  const rendered = await renderDisplay({
    calldata: false,
    depth: 0,
    descriptor: served,
    env,
    run,
    ...(nested === undefined ? {} : {nested}),
    taken: ['contract', 'domain', 'version', 'salt'],
    to: verifyingContract,
    ...(env.options.signer === undefined ? {} : {from: env.options.signer}),
  })
  const name = nameOf(content)
  const contract = await env.address({
    id: 'contract',
    label: LABELS.contract,
    value: verifyingContract,
    ...(name === undefined ? {} : {fallbackName: name}),
  })

  return {
    described: {
      actions: rendered.actions,
      fields: [...rendered.fields, contract],
      intent: rendered.intent ?? ETHEREUM_TEXTS.intent.signTypedData,
      raw: [],
      source: sourceOf(found),
      warnings: rendered.warnings,
      ...(rendered.summary === undefined ? {} : {summary: rendered.summary}),
    },
    warnings: [],
  }
}

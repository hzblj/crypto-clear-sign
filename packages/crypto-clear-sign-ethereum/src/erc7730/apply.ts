import {
  type AddressField,
  type Descriptor,
  externalText,
  hasHiddenCharacters,
  LABELS,
  type WarningInput,
  warning,
} from '@hzblj/crypto-clear-sign'
import {hex} from '@hzblj/nitro-crypto/adapter'

import {type AbiValue, decodeCall} from '../abi'
import type {Call, DescribeCall, Described} from '../calls/common'
import {ETHEREUM_WARNINGS} from '../catalogs'
import {type Env, lower} from '../env'
import {type CompiledDescriptor, compileCached, DescriptorError, type Format} from './compile'
import {renderFormat} from './render'
import type {Erc7730Descriptor} from './types'

/** What applying a descriptor gave: an action, or nothing (with `ethereum.INVALID_DESCRIPTOR` when one was found). */
export type Applied = {readonly described?: Described; readonly warnings: readonly WarningInput[]}

const invalid = (): Applied => ({warnings: [warning(ETHEREUM_WARNINGS.INVALID_DESCRIPTOR)]})

/** The contract's name a descriptor gives, when it is fit to show. */
const nameOf = (descriptor: CompiledDescriptor): string | undefined => {
  const name = descriptor.contractName ?? descriptor.owner

  return name === undefined || hasHiddenCharacters(name) ? undefined : name.trim()
}

const sourceOf = (answer: Descriptor<Erc7730Descriptor>) =>
  ({
    format: 'erc7730',
    id: answer.id,
    kind: 'descriptor',
    ...(answer.publisher === undefined ? {} : {publisher: answer.publisher}),
  }) as const

/**
 * A call described by the descriptor the resolver answers for its contract and selector, after checking that the
 * descriptor binds to this chain and contract, has a format for the selector, and that the call data decodes as that
 * format's function. Anything else, and any failure, leaves the call to the next reader.
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

  if (answer === undefined) {
    return {warnings: []}
  }

  try {
    const descriptor = compileCached(answer.content)
    const format = descriptor.formats.find(entry => entry.fn?.selector === selector)

    if (
      descriptor.kind !== 'calldata' ||
      format?.fn === undefined ||
      !descriptor.deployments.some(entry => entry.chainId === env.chainId && entry.address === lower(call.to))
    ) {
      return invalid()
    }

    const data: AbiValue = {fields: decodeCall(format.fn, call.data), kind: 'tuple'}
    const from = call.from ?? env.options.signer
    const rendered = await renderFormat({
      container: {chainId: env.chainId, to: call.to, value: call.value, ...(from === undefined ? {} : {from})},
      data,
      depth: call.depth,
      descriptor,
      env,
      format,
      nested,
      taken: ['contract', 'value'],
    })
    const name = nameOf(descriptor)
    const contract: AddressField = await env.address({
      id: 'contract',
      label: LABELS.contract,
      value: call.to,
      ...(name === undefined ? {} : {fallbackName: name}),
    })

    return {
      described: {
        actions: rendered.actions,
        fields: [...rendered.fields, contract],
        intent: externalText(format.intent),
        raw: rendered.raw,
        source: sourceOf(answer),
        warnings: rendered.warnings,
        ...(rendered.summary === undefined ? {} : {summary: rendered.summary}),
      },
      warnings: [],
    }
  } catch (error) {
    if (error instanceof DescriptorError || error instanceof Error) {
      return invalid()
    }

    throw error
  }
}

/** What typed data's binding is checked against: its domain as the adapter read it, and its types. */
export type TypedDataSubject = {
  readonly chainId?: number
  readonly verifyingContract?: string
  readonly domain: Readonly<Record<string, unknown>>
  readonly encodeType: string
  readonly primaryType: string
  /** The domain separator, lowercase hex, when it could be computed. */
  readonly domainSeparator?: string
}

const sameValue = (constraint: unknown, actual: unknown, key: string): boolean => {
  if (actual === undefined) {
    return false
  }

  if (key === 'verifyingContract') {
    return typeof constraint === 'string' && typeof actual === 'string' && lower(constraint) === lower(actual)
  }

  if (key === 'chainId') {
    try {
      return BigInt(constraint as string | number) === BigInt(actual as string | number)
    } catch {
      return false
    }
  }

  return String(constraint) === String(actual)
}

/** The format of a compiled EIP-712 descriptor for `subject`, when the descriptor binds to it. */
export const typedDataFormat = (descriptor: CompiledDescriptor, subject: TypedDataSubject): Format | undefined => {
  if (descriptor.kind !== 'eip712') {
    return undefined
  }

  const {domain, domainSeparator} = descriptor
  const bound = descriptor.deployments.length > 0 || domain !== undefined || domainSeparator !== undefined

  if (!bound) {
    return undefined
  }

  if (
    descriptor.deployments.length > 0 &&
    !descriptor.deployments.some(
      entry =>
        entry.chainId === subject.chainId &&
        subject.verifyingContract !== undefined &&
        entry.address === lower(subject.verifyingContract)
    )
  ) {
    return undefined
  }

  if (
    domain !== undefined &&
    !Object.entries(domain).every(([key, value]) => sameValue(value, subject.domain[key], key))
  ) {
    return undefined
  }

  if (domainSeparator !== undefined && domainSeparator !== subject.domainSeparator) {
    return undefined
  }

  return descriptor.formats.find(
    format =>
      format.encodeType === subject.encodeType ||
      (format.primaryType === subject.primaryType && descriptor.schemas.get(subject.primaryType) === subject.encodeType)
  )
}

/** Typed data described by a descriptor bound to its domain and type; nothing when none applies. */
export const describeTypedDataByDescriptor = async (
  env: Env,
  subject: TypedDataSubject,
  message: AbiValue,
  answer: Descriptor<Erc7730Descriptor>
): Promise<Applied> => {
  try {
    const descriptor = compileCached(answer.content)
    const format = typedDataFormat(descriptor, subject)

    if (format === undefined) {
      return invalid()
    }

    const rendered = await renderFormat({
      container: {
        value: 0n,
        ...(env.options.signer === undefined ? {} : {from: env.options.signer}),
        ...(subject.verifyingContract === undefined ? {} : {to: subject.verifyingContract}),
        ...(subject.chainId === undefined ? {} : {chainId: subject.chainId}),
      },
      data: message,
      depth: 0,
      descriptor,
      env,
      format,
      taken: ['contract', 'domain', 'version', 'salt'],
    })
    const name = nameOf(descriptor)
    const contract =
      subject.verifyingContract === undefined
        ? []
        : [
            await env.address({
              id: 'contract',
              label: LABELS.contract,
              value: subject.verifyingContract,
              ...(name === undefined ? {} : {fallbackName: name}),
            }),
          ]

    return {
      described: {
        actions: rendered.actions,
        fields: [...rendered.fields, ...contract],
        intent: externalText(format.intent),
        raw: rendered.raw,
        source: sourceOf(answer),
        warnings: rendered.warnings,
        ...(rendered.summary === undefined ? {} : {summary: rendered.summary}),
      },
      warnings: [],
    }
  } catch (error) {
    if (error instanceof Error) {
      return invalid()
    }

    throw error
  }
}

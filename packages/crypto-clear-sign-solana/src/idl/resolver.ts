import {ClearSignError, type Descriptor, type DescriptorResolver} from '@hzblj/crypto-clear-sign'
import {base58, isCryptoError, utf8} from '@hzblj/nitro-crypto/adapter'

import type {SolanaDescriptorQuery} from '../options'
import {idlAddress} from './decode'
import type {SolanaIdl, SolanaIdlInstruction} from './types'

/** An IDL to resolve, alone or with how a result names it: its descriptor `id` and `publisher`. */
export type IdlResolverEntry =
  | SolanaIdl
  | {
      readonly idl: SolanaIdl
      /** How `source.id` names it: a registry path, a URL, a digest. The program's address unless given. */
      readonly id?: string
      /** Who made it, for people: `Jupiter`, `Anchor registry`. */
      readonly publisher?: string
    }

export type IdlResolverOptions = {
  /**
   * SHA-256, for IDLs written before Anchor 0.30, whose instructions carry no discriminator: each is computed as
   * Anchor did, the first 8 bytes of `sha256("global:" + snake_case(name))`. The engine has one:
   * `crypto.hash.sha256`.
   */
  readonly sha256?: (data: Uint8Array) => Uint8Array
}

const invalid = (message: string) => new ClearSignError('INVALID_ARGUMENT', message)

const isAddress = (value: unknown): value is string => {
  if (typeof value !== 'string') {
    return false
  }

  try {
    const decoded = base58.decode(value)

    return decoded.length === 32 && base58.encode(decoded) === value
  } catch (error) {
    if (isCryptoError(error)) {
      return false
    }

    throw error
  }
}

/** A camelCase instruction name as Anchor before 0.30 hashed it: `initializeUser` is `initialize_user`. */
export const snakeCase = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()

/** Each instruction with a discriminator: its own, or the one Anchor before 0.30 computed from its name. */
const withDiscriminators = (idl: SolanaIdl, sha256: IdlResolverOptions['sha256']): SolanaIdl => {
  if (!Array.isArray(idl.instructions)) {
    throw invalid('An IDL lists its instructions.')
  }

  if (
    idl.instructions.every(instruction => typeof instruction === 'object' && instruction?.discriminator !== undefined)
  ) {
    return idl
  }

  if (sha256 === undefined) {
    throw invalid('An IDL without discriminators (written before Anchor 0.30) needs sha256 to compute them.')
  }

  const instructions = idl.instructions.map((instruction): SolanaIdlInstruction => {
    if (typeof instruction !== 'object' || instruction === null || typeof instruction.name !== 'string') {
      throw invalid('An IDL instruction has a name.')
    }

    if (instruction.discriminator !== undefined) {
      return instruction
    }

    const digest = sha256(utf8.encode(`global:${snakeCase(instruction.name)}`))

    if (!(digest instanceof Uint8Array) || digest.length !== 32) {
      throw invalid('sha256 answers with 32 bytes.')
    }

    return {...instruction, discriminator: [...digest.subarray(0, 8)]}
  })

  return {...idl, instructions}
}

/**
 * A `descriptors` resolver over IDLs the app holds: each keyed by the program address it names (`address`, or
 * `metadata.address` before Anchor 0.30), answered for that program on any cluster. IDLs from before 0.30 get their
 * instructions' discriminators here, which needs `sha256`.
 *
 * An IDL describes a program in words its author chose: load IDLs only from sources the app trusts (its own bundle, a
 * registry it verifies), never from the dApp that asks for a signature. A malformed IDL, or one that does not read an
 * instruction's data, is ignored for that instruction and the instruction is shown raw.
 *
 * Throws `INVALID_ARGUMENT` for an IDL without a valid program address or a list of instructions, two IDLs for one
 * program, or a pre-0.30 IDL without `sha256`.
 *
 * ```ts
 * const descriptors = createIdlResolver([{idl: jupiterIdl, publisher: 'Jupiter'}], {sha256: crypto.hash.sha256})
 * await clearSignTransaction(crypto.chains.solana, bytes, {resolvers: {descriptors}})
 * ```
 */
export const createIdlResolver = (
  entries: readonly IdlResolverEntry[],
  options: IdlResolverOptions = {}
): DescriptorResolver<SolanaDescriptorQuery, SolanaIdl> => {
  const byProgram = new Map<string, Descriptor<SolanaIdl>>()

  for (const entry of entries) {
    const wrapped = typeof entry === 'object' && entry !== null && Object.hasOwn(entry, 'idl')
    const source = wrapped ? (entry as {readonly idl: SolanaIdl}).idl : (entry as SolanaIdl)
    const address = idlAddress(source)

    if (!isAddress(address)) {
      throw invalid('An IDL names the address of its program.')
    }

    if (byProgram.has(address)) {
      throw invalid('Two IDLs name the same program.')
    }

    const {id = address, publisher} = wrapped ? (entry as {readonly id?: string; readonly publisher?: string}) : {}

    byProgram.set(
      address,
      Object.freeze({
        content: withDiscriminators(source, options.sha256),
        id,
        ...(publisher === undefined ? {} : {publisher}),
      })
    )
  }

  return Object.freeze({descriptor: ({programId}: SolanaDescriptorQuery) => byProgram.get(programId)})
}

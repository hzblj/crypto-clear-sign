import assert from 'node:assert/strict'

import {
  type AddressField,
  type ClearSigning,
  type ClearSigningAction,
  type Field,
  findField,
  type Resolvers,
  type Warning,
} from '@hzblj/crypto-clear-sign'
import {type SolanaAddressLookupTables, type SolanaInstruction, solanaAdapter} from '@hzblj/crypto-solana'
import {base58} from '@hzblj/nitro-crypto/adapter'
import {createTestCryptoEngine} from '@hzblj/nitro-crypto/testing'
import {type Address, createNoopSigner, type Instruction, isSignerRole, isWritableRole} from '@solana/kit'

import {clearSignTransaction, type SolanaClearSignOptions, type SolanaDescriptorQuery, type SolanaIdl} from '../src'

export const crypto = createTestCryptoEngine({adapters: [solanaAdapter()]})
export const chain = crypto.chains.solana
export const devnet = createTestCryptoEngine({adapters: [solanaAdapter({cluster: 'devnet'})]}).chains.solana

/** A fixed, valid address: 32 bytes of `seed` (and `variant` in the last byte, to make more of them). */
export const address = (seed: number, variant = 0): string => {
  const bytes = new Uint8Array(32).fill(seed)
  bytes[31] = variant

  return base58.encode(bytes)
}

export const WALLET = address(1)
export const OTHER = address(2)
export const STRANGER = address(3)
export const FRIEND = address(4)
export const BLOCKHASH = address(9)

export const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
export const SYSTEM = '11111111111111111111111111111111'
export const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
export const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'

/** 2026-10-27T12:00:00Z, the clock every result is made with. */
export const NOW = Date.UTC(2026, 9, 27, 12)
export const clock = {now: () => NOW}

/** A kit instruction (as the program clients build it) in the adapter's shape. */
export const fromKit = (instruction: Instruction): SolanaInstruction => ({
  accounts: (instruction.accounts ?? []).map(account => ({
    address: account.address,
    isSigner: isSignerRole(account.role),
    isWritable: isWritableRole(account.role),
  })),
  data: new Uint8Array(instruction.data ?? []),
  programId: instruction.programAddress,
})

/** A signer for kit's clients, which only needs its address here. */
export const signer = (value: string) => createNoopSigner(value as Address)

/** An instruction by hand: a program, its accounts (`s` signs, `w` is writable) and data. */
export const raw = (
  programId: string,
  accounts: readonly (readonly [string, '' | 's' | 'w' | 'sw'])[],
  data: Uint8Array | readonly number[]
): SolanaInstruction => ({
  accounts: accounts.map(([value, role]) => ({
    address: value,
    isSigner: role.includes('s'),
    isWritable: role.includes('w'),
  })),
  data: Uint8Array.from(data),
  programId,
})

/** The message bytes of `instructions`, paid for by `feePayer` (the wallet unless given). */
export const compile = (
  instructions: readonly (SolanaInstruction | Instruction)[],
  options: {
    readonly feePayer?: string
    readonly version?: 0 | 'legacy'
    readonly tables?: SolanaAddressLookupTables
  } = {}
) =>
  chain.compileMessage({
    feePayer: options.feePayer ?? WALLET,
    instructions: instructions.map(entry => ('programAddress' in entry ? fromKit(entry) : entry)),
    recentBlockhash: BLOCKHASH,
    ...(options.version === undefined ? {} : {version: options.version}),
    ...(options.tables === undefined ? {} : {addressLookupTables: options.tables}),
  })

/** A wire transaction of a message, every signature slot empty. */
export const wire = (message: Uint8Array) => {
  const signers = chain.decodeMessage(message).signers.length

  return Uint8Array.from([signers, ...new Uint8Array(64 * signers), ...message])
}

/** Clears a transaction of `instructions` for the wallet, on the fixed clock. */
export const clear = (
  instructions: readonly (SolanaInstruction | Instruction)[],
  options: SolanaClearSignOptions & {readonly feePayer?: string; readonly version?: 0} = {}
) => {
  const {feePayer, version, ...rest} = options

  return clearSignTransaction(
    chain,
    {message: compile(instructions, {feePayer, version})},
    {signer: WALLET, ...rest, resolvers: {clock, ...rest.resolvers}}
  )
}

/** The action of the first instruction. */
export const first = (result: ClearSigning): ClearSigningAction => {
  const action = result.actions[0]
  assert.ok(action)

  return action
}

/** The codes of the warnings raised on the action at `path` (not below it). */
export const codesAt = (result: ClearSigning, path: readonly number[]) =>
  result.warnings.filter(entry => entry.action.join('.') === path.join('.')).map(entry => entry.code)

/** The one warning of `code`, which must be there. */
export const warningOf = (result: ClearSigning, code: string): Warning => {
  const found = result.warnings.filter(entry => entry.code === code)
  assert.equal(found.length, 1, `one ${code}`)

  return found[0] as Warning
}

export const codes = (result: ClearSigning) => result.warnings.map(entry => entry.code)

/** A field of an action, which must be there, of `kind`. */
export const field = <Kind extends Field['kind']>(
  action: ClearSigningAction,
  id: string,
  kind: Kind
): Extract<Field, {readonly kind: Kind}> => {
  const found = findField(action, id)
  assert.ok(found, `field ${id}`)
  assert.equal(found.kind, kind, `field ${id} is ${kind}`)

  return found as Extract<Field, {readonly kind: Kind}>
}

export const addressOf = (action: ClearSigningAction, id: string): AddressField => field(action, id, 'address')

/** Resolvers that answer at once: USDC's symbol for a test mint, names for the friend and a program. */
export const TEST_MINT = address(20)

export const syncResolvers: Resolvers<SolanaDescriptorQuery, SolanaIdl> = {
  clock,
  names: {
    name: ({address: value}) =>
      value === FRIEND
        ? {name: 'Friend', relation: 'contact'}
        : value === OTHER
          ? {name: 'Savings', relation: 'own'}
          : undefined,
  },
  tokens: {token: ({address: value}) => (value === TEST_MINT ? {decimals: 2, name: 'Test', symbol: 'TST'} : undefined)},
}

export const asyncResolvers: Resolvers<SolanaDescriptorQuery, SolanaIdl> = {
  clock,
  names: {name: async query => syncResolvers.names?.name(query)},
  tokens: {token: async query => syncResolvers.tokens?.token(query)},
}

export const throwingResolvers: Resolvers<SolanaDescriptorQuery, SolanaIdl> = {
  clock,
  descriptors: {
    descriptor: () => {
      throw new Error('registry down')
    },
  },
  names: {
    name: () => {
      throw new Error('address book down')
    },
  },
  tokens: {token: async () => Promise.reject(new Error('token list down'))},
}

/** Little-endian bytes of an unsigned integer. */
export const le = (value: bigint | number, bytes: number) =>
  Array.from({length: bytes}, (_, index) => Number((BigInt(value) >> BigInt(index * 8)) & 0xffn))

/**
 * An IDL type: Anchor's (0.30 and later), with the spellings of earlier versions read too (`publicKey`, a `defined`
 * name as a string). A type is untrusted input: the interpreter checks every part of it as it reads.
 */
export type SolanaIdlType =
  | 'bool'
  | 'u8'
  | 'i8'
  | 'u16'
  | 'i16'
  | 'u32'
  | 'i32'
  | 'f32'
  | 'u64'
  | 'i64'
  | 'f64'
  | 'u128'
  | 'i128'
  | 'u256'
  | 'i256'
  | 'bytes'
  | 'string'
  | 'pubkey'
  | 'publicKey'
  | {readonly option: SolanaIdlType}
  | {readonly coption: SolanaIdlType}
  | {readonly vec: SolanaIdlType}
  | {readonly array: readonly [SolanaIdlType, number | {readonly generic: string}]}
  | {readonly defined: string | {readonly name: string; readonly generics?: readonly SolanaIdlGenericArgument[]}}
  | {readonly generic: string}

/** What a generic type's parameter is set to where it is used. */
export type SolanaIdlGenericArgument =
  | {readonly kind: 'type'; readonly type: SolanaIdlType}
  | {readonly kind: 'const'; readonly value: string}

/** A named field of a struct, an argument of an instruction, or a field of an enum variant. */
export type SolanaIdlField = {
  readonly name: string
  readonly type: SolanaIdlType
  readonly docs?: readonly string[]
}

/** An enum variant: a name alone, or with named or positional fields. */
export type SolanaIdlEnumVariant = {
  readonly name: string
  readonly fields?: readonly SolanaIdlField[] | readonly SolanaIdlType[]
}

/** A type the IDL defines by name: a struct, an enum, or an alias. Only Borsh serialization is read. */
export type SolanaIdlTypeDefinition = {
  readonly name: string
  readonly docs?: readonly string[]
  readonly serialization?: 'borsh' | (string & {}) | {readonly custom: string}
  readonly generics?: readonly (
    | {readonly kind: 'type'; readonly name: string}
    | {
        readonly kind: 'const'
        readonly name: string
        readonly type: string
      }
  )[]
  readonly type:
    | {readonly kind: 'struct'; readonly fields?: readonly SolanaIdlField[] | readonly SolanaIdlType[]}
    | {readonly kind: 'enum'; readonly variants: readonly SolanaIdlEnumVariant[]}
    | {readonly kind: 'type'; readonly alias: SolanaIdlType}
}

/**
 * An account an instruction takes, in order: one account (`writable`, `signer`, `optional`, a fixed `address`), or a
 * group of them (`accounts`), which counts as its accounts in order. `isMut`, `isSigner` and `isOptional` are the
 * names before Anchor 0.30.
 */
export type SolanaIdlInstructionAccount =
  | {
      readonly name: string
      readonly docs?: readonly string[]
      readonly writable?: boolean
      readonly signer?: boolean
      readonly optional?: boolean
      readonly isMut?: boolean
      readonly isSigner?: boolean
      readonly isOptional?: boolean
      readonly address?: string
    }
  | {readonly name: string; readonly accounts: readonly SolanaIdlInstructionAccount[]}

/**
 * An instruction: its name, the bytes its data starts with (`discriminator`: 8 bytes for Anchor's own, any length up
 * to 32 for a custom one), its accounts and its arguments, which follow the discriminator in Borsh.
 */
export type SolanaIdlInstruction = {
  readonly name: string
  readonly docs?: readonly string[]
  readonly discriminator?: readonly number[]
  readonly accounts: readonly SolanaIdlInstructionAccount[]
  readonly args: readonly SolanaIdlField[]
}

/**
 * An Anchor IDL: the program's `address` and `metadata`, its instructions and the types they use. The format of Anchor
 * 0.30 and later. An IDL written before 0.30 (`name` and `version` at the top, no discriminators, the address in
 * `metadata.address`) is read once `createIdlResolver` has given its instructions their discriminators. Other parts
 * of an IDL (accounts, events, errors, constants) may be present and are not read.
 */
export type SolanaIdl = {
  readonly address?: string
  readonly metadata?: {
    readonly name?: string
    readonly version?: string
    readonly spec?: string
    readonly description?: string
    readonly address?: string
  }
  readonly name?: string
  readonly version?: string
  readonly instructions: readonly SolanaIdlInstruction[]
  readonly types?: readonly SolanaIdlTypeDefinition[]
}

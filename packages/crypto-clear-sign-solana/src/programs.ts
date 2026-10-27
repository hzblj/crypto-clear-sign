export const SYSTEM_PROGRAM = '11111111111111111111111111111111'
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
export const ASSOCIATED_TOKEN_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
export const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111'
export const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'
export const MEMO_V1_PROGRAM = 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo'
export const MEMO_V4_PROGRAM = 'Memo4c2pN8afCj432Lb7RMVKi9PbQnnW7ewFFaV3oAH'

/** Every Memo program deployed: v1, the long-standing one, and the newest (v4), which the kit client builds for. */
export const MEMO_PROGRAMS: ReadonlySet<string> = new Set([MEMO_V1_PROGRAM, MEMO_PROGRAM, MEMO_V4_PROGRAM])
export const STAKE_PROGRAM = 'Stake11111111111111111111111111111111111111'
export const LOOKUP_TABLE_PROGRAM = 'AddressLookupTab1e1111111111111111111111111'
export const UPGRADEABLE_LOADER_PROGRAM = 'BPFLoaderUpgradeab1e11111111111111111111111'
export const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112'

/**
 * The programs and sysvars this package names by itself (a `contract` address with this name) when the `names`
 * resolver does not: Solana's native programs and the Solana Program Library's. Names only: what a program does is
 * read by a built-in decoder or an IDL, never by its name.
 */
export const SOLANA_PROGRAMS: Readonly<Record<string, string>> = Object.freeze({
  [ASSOCIATED_TOKEN_PROGRAM]: 'Associated Token Account Program',
  [COMPUTE_BUDGET_PROGRAM]: 'Compute Budget Program',
  [LOOKUP_TABLE_PROGRAM]: 'Address Lookup Table Program',
  [MEMO_PROGRAM]: 'Memo Program',
  [MEMO_V1_PROGRAM]: 'Memo Program (v1)',
  [MEMO_V4_PROGRAM]: 'Memo Program',
  [STAKE_PROGRAM]: 'Stake Program',
  [SYSTEM_PROGRAM]: 'System Program',
  [TOKEN_2022_PROGRAM]: 'Token-2022 Program',
  [TOKEN_PROGRAM]: 'Token Program',
  [UPGRADEABLE_LOADER_PROGRAM]: 'BPF Upgradeable Loader',
  BPFLoader1111111111111111111111111111111111: 'BPF Loader (deprecated)',
  BPFLoader2111111111111111111111111111111111: 'BPF Loader',
  Config1111111111111111111111111111111111111: 'Config Program',
  Ed25519SigVerify111111111111111111111111111: 'Ed25519 Signature Verification',
  KeccakSecp256k11111111111111111111111111111: 'Secp256k1 Signature Verification',
  LoaderV411111111111111111111111111111111111: 'Loader v4',
  NativeLoader1111111111111111111111111111111: 'Native Loader',
  Secp256r1SigVerify1111111111111111111111111: 'Secp256r1 Signature Verification',
  StakeConfig11111111111111111111111111111111: 'Stake Config',
  Sysvar1nstructions1111111111111111111111111: 'Instructions Sysvar',
  SysvarC1ock11111111111111111111111111111111: 'Clock Sysvar',
  SysvarEpochSchedu1e111111111111111111111111: 'Epoch Schedule Sysvar',
  SysvarRecentB1ockHashes11111111111111111111: 'Recent Blockhashes Sysvar',
  SysvarRent111111111111111111111111111111111: 'Rent Sysvar',
  SysvarS1otHashes111111111111111111111111111: 'Slot Hashes Sysvar',
  SysvarStakeHistory1111111111111111111111111: 'Stake History Sysvar',
  Vote111111111111111111111111111111111111111: 'Vote Program',
})

/** Programs the runtime runs natively: each reserves 3,000 compute units by default rather than 200,000. */
export const BUILTIN_PROGRAMS: ReadonlySet<string> = new Set([
  'BPFLoader1111111111111111111111111111111111',
  'BPFLoader2111111111111111111111111111111111',
  COMPUTE_BUDGET_PROGRAM,
  'Config1111111111111111111111111111111111111',
  'Ed25519SigVerify111111111111111111111111111',
  'KeccakSecp256k11111111111111111111111111111',
  'LoaderV411111111111111111111111111111111111',
  LOOKUP_TABLE_PROGRAM,
  'Secp256r1SigVerify1111111111111111111111111',
  STAKE_PROGRAM,
  SYSTEM_PROGRAM,
  UPGRADEABLE_LOADER_PROGRAM,
  'Vote111111111111111111111111111111111111111',
])

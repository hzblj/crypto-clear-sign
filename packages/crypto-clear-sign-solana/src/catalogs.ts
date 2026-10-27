import {defineTexts, defineWarnings, type SharedWarningCode} from '@hzblj/crypto-clear-sign'

/**
 * Solana's own warnings, coded `solana.<KEY>`, for what no shared code says. The shared codes come first wherever
 * they apply: `ASSET_OWNERSHIP_TRANSFER` for an authority handed over, `UNLIMITED_APPROVAL`, `UNKNOWN_CONTRACT_CALL`,
 * `UNKNOWN_DESTINATION`, `HIGH_FEE` and the rest.
 */
export const SOLANA_WARNINGS = defineWarnings('solana', {
  /**
   * A token account (or a lookup table, or a program account) closed to an account that is not its owner: what it
   * holds goes there. Closing a wrapped SOL account sends all of its SOL.
   */
  CLOSE_TO_OTHER: {
    message: 'Closing this account sends what it holds to an account that is not its owner.',
    severity: 'high',
  },
  /**
   * The transaction's first instruction advances a durable nonce: it never expires, and whoever holds it signed can
   * submit it at any time until the nonce moves. Drainers ask for these to use later.
   */
  DURABLE_NONCE: {
    message:
      'This transaction never expires: whoever holds it once signed can submit it at any time, until its nonce is used.',
    severity: 'high',
  },
  /** Bytes asked for as a message that read as a transaction message: signing them signs that transaction. */
  MESSAGE_IS_TRANSACTION: {
    message: 'These bytes are a transaction: signing them as a message signs the transaction, whatever it does.',
    severity: 'critical',
  },
  /** The signer signs, but another account pays the fee. */
  NOT_FEE_PAYER: {
    message: 'Another account pays the fee for this transaction.',
    severity: 'low',
  },
  /** Other accounts must sign too (the transaction's signers, or an off-chain message's). */
  OTHER_SIGNERS: {
    message: 'Other accounts must sign this too.',
    severity: 'low',
  },
  /** A BPF upgradeable program's code replaced. */
  PROGRAM_UPGRADE: {
    message: "This replaces a program's code: the new code can do anything the program controls.",
    severity: 'critical',
  },
  /** A Sign In With Solana message for another account than the one signing. */
  SIGN_IN_ADDRESS_MISMATCH: {
    message: 'The sign-in request names another account than the one signing it.',
    severity: 'high',
  },
  /** A Sign In With Solana message for another cluster than the chain client's. */
  SIGN_IN_CHAIN_MISMATCH: {
    message: 'The sign-in request is for another Solana network than this one.',
    severity: 'medium',
  },
  /** A Sign In With Solana message whose domain is not the site that asks (the `origin` option). */
  SIGN_IN_DOMAIN_MISMATCH: {
    message: 'The sign-in request names another site than the one asking: it may be phishing.',
    severity: 'high',
  },
  /** Text that starts as a Sign In With Solana message but does not follow its format. */
  SIGN_IN_MALFORMED: {
    message: 'This looks like a sign-in request but does not follow its format, so its details cannot be checked.',
    severity: 'medium',
  },
  /** Accounts loaded from address lookup tables that were not given: who they are is unknown. */
  UNRESOLVED_LOOKUPS: {
    message: 'Some accounts come from address lookup tables that were not given, so who they are is unknown.',
    severity: 'medium',
  },
})

/** A warning code this package can raise: a shared one, or one of `SOLANA_WARNINGS`. */
export type SolanaWarningCode = SharedWarningCode | (typeof SOLANA_WARNINGS)[keyof typeof SOLANA_WARNINGS]['code']

/**
 * Solana's own words, coded `solana.<group>.<key>`: the intents and summaries of the built-in decoders, the labels
 * of their fields and the units of their numbers. The shared `INTENTS`, `SUMMARIES` and `LABELS` come first wherever
 * they say it (`intent.send`, `summary.approveUnlimited`, `label.recipient`).
 */
export const SOLANA_TEXTS = defineTexts('solana', {
  intent: {
    advanceNonce: 'Use durable nonce',
    allocate: 'Allocate space',
    assign: 'Change account owner',
    authorizeNonce: 'Change nonce authority',
    authorizeStake: 'Change stake authority',
    burnTokens: 'Burn tokens',
    closeAccount: 'Close account',
    closeLookupTable: 'Close lookup table',
    closeProgram: 'Close program account',
    configureToken: 'Configure token',
    createAccount: 'Create account',
    createBuffer: 'Create program buffer',
    createLookupTable: 'Create lookup table',
    createTokenAccount: 'Create token account',
    deactivateLookupTable: 'Deactivate lookup table',
    extendLookupTable: 'Extend lookup table',
    extendProgram: 'Extend program',
    freezeAccount: 'Freeze token account',
    freezeLookupTable: 'Freeze lookup table',
    initializeMint: 'Create token',
    initializeMultisig: 'Create multisig',
    initializeNonce: 'Create nonce account',
    initializeStake: 'Create stake account',
    initializeTokenAccount: 'Initialize token account',
    makeImmutable: 'Make program immutable',
    memo: 'Memo',
    mergeStake: 'Merge stake',
    mintTokens: 'Mint tokens',
    moveStake: 'Move stake',
    readToken: 'Read token data',
    recoverNested: 'Recover tokens',
    removeAuthority: 'Remove authority',
    requestHeapFrame: 'Request heap',
    setAuthority: 'Change authority',
    setComputeUnitLimit: 'Set compute limit',
    setComputeUnitPrice: 'Set priority fee',
    setLoadedAccountsDataSizeLimit: 'Set data size limit',
    setProgramAuthority: 'Change program authority',
    splitStake: 'Split stake',
    stake: 'Stake',
    syncNative: 'Sync wrapped SOL',
    thawAccount: 'Thaw token account',
    tokenBatch: 'Token batch',
    unstake: 'Deactivate stake',
    unwrapSol: 'Unwrap SOL',
    upgradeNonce: 'Upgrade nonce account',
    upgradeProgram: 'Upgrade program',
    withdrawExcessLamports: 'Withdraw excess SOL',
    withdrawNonce: 'Withdraw from nonce account',
    withdrawStake: 'Withdraw stake',
    withdrawTokenFees: 'Withdraw token fees',
    writeProgram: 'Write program buffer',
  },
  label: {
    accountState: 'Default state',
    additionalBytes: 'Additional bytes',
    addresses: 'Addresses',
    applicationDomain: 'Application',
    authority: 'Authority',
    authorityType: 'Authority type',
    base: 'Base account',
    buffer: 'Buffer',
    bump: 'Bump seed',
    closeAuthority: 'Close authority',
    computeUnitLimit: 'Compute unit limit',
    computeUnitPrice: 'Compute unit price',
    cpiGuard: 'CPI guard',
    custodian: 'Custodian',
    dataSizeLimit: 'Loaded data size limit',
    decimals: 'Decimals',
    destinationAccount: 'To token account',
    effectiveAt: 'Effective from',
    extensions: 'Extensions',
    feePayer: 'Fee payer',
    feeRate: 'Fee rate',
    format: 'Format',
    freezeAuthority: 'Freeze authority',
    heapSize: 'Heap size',
    hookProgram: 'Transfer hook program',
    item: 'Item {index}',
    lockupEpoch: 'Locked until epoch',
    lockupTime: 'Locked until',
    lookupIndex: 'Index in table',
    lookupTable: 'Lookup table',
    lookupTables: 'Lookup tables',
    maxDataLength: 'Maximum program size',
    memoRequired: 'Memo required',
    mint: 'Mint',
    mintAuthority: 'Mint authority',
    multiplier: 'Multiplier',
    newAccount: 'New account',
    newAuthority: 'New authority',
    nonceAccount: 'Nonce account',
    nonceAuthority: 'Nonce authority',
    nonTransferable: 'Non-transferable',
    offset: 'Offset',
    ownerProgram: 'Owner program',
    paused: 'Paused',
    permanentDelegate: 'Permanent delegate',
    pointer: 'Points to',
    priorityFee: 'Priority fee',
    programData: 'Program data',
    rate: 'Interest rate',
    readonlyAccount: 'Account',
    recentBlockhash: 'Recent blockhash',
    recentSlot: 'Recent slot',
    requestId: 'Request ID',
    requiredSigners: 'Required signers',
    resources: 'Resources',
    seed: 'Seed',
    sent: 'You send',
    signer: 'Signer',
    signerAccount: 'Signing account',
    signers: 'Signers',
    sourceAccount: 'From token account',
    space: 'Space',
    spill: 'Refund to',
    stakeAccount: 'Stake account',
    staker: 'Stake authority',
    trailingData: 'Trailing data',
    validator: 'Validator',
    variant: 'Variant',
    version: 'Version',
    withdrawer: 'Withdraw authority',
    writableAccount: 'Writable account',
    writableSignerAccount: 'Writable signing account',
  },
  summary: {
    advanceNonce: 'Use the durable nonce of {account}',
    allocate: 'Allocate {space} bytes for {account}',
    assign: 'Make {program} the owner of {account}',
    authorizeNonce: 'Make {authority} the authority of nonce account {account}',
    burnTokens: 'Burn {amount} from {account}',
    closeAccount: 'Close {account} and send what it holds to {recipient}',
    configureToken: 'Change the settings of {account}',
    createAccount: 'Create {account} with {amount}, owned by {program}',
    createLookupTable: 'Create lookup table {account}',
    createTokenAccount: 'Create a {token} account for {owner}',
    deployProgram: 'Deploy program {program}',
    extendLookupTable: 'Add {count} addresses to {account}',
    freezeAccount: 'Freeze {account}',
    initializeMint: 'Create token {mint} with {decimals} decimals',
    initializeMultisig: 'Make {account} a multisig of {required} signers',
    initializeNonce: 'Make {account} a nonce account controlled by {authority}',
    initializeStake: 'Make {account} a stake account controlled by {authority}',
    initializeTokenAccount: 'Make {account} a {token} account owned by {owner}',
    makeImmutable: 'Make {account} immutable: its code can never change again',
    memo: 'Attach a note',
    mergeStake: 'Merge {source} into {account}',
    mintTokens: 'Mint {amount} to {recipient}',
    moveStake: 'Move {amount} from {account} to {destination}',
    recoverNested: 'Recover tokens held in a nested account of {owner}',
    removeAuthority: 'Remove the {type} authority of {account}',
    revoke: 'Remove the delegate of {account}',
    setAuthority: 'Make {authority} the {type} authority of {account}',
    setComputeUnitLimit: 'Allow up to {units} compute units',
    setComputeUnitPrice: 'Pay {price} micro-lamports per compute unit',
    setProgramAuthority: 'Make {authority} the upgrade authority of {account}',
    splitStake: 'Move {amount} of {account} to {destination}',
    stake: 'Stake {account} with {validator}',
    syncNative: 'Update the wrapped SOL balance of {account}',
    thawAccount: 'Thaw {account}',
    tokenBatch: '{count} token instructions at once',
    unstake: 'Stop staking {account}',
    unwrapSol: 'Unwrap {amount} to {recipient}',
    upgradeProgram: 'Replace the code of {program}',
    withdraw: 'Withdraw {amount} from {account} to {recipient}',
  },
  unit: {
    basisPoints: 'basis points',
    bytes: 'bytes',
    computeUnits: 'compute units',
    microLamports: 'micro-lamports per compute unit',
  },
})

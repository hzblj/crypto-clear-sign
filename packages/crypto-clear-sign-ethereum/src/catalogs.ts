import {defineTexts, defineWarnings, type SharedWarningCode} from '@hzblj/crypto-clear-sign'

/**
 * The package's own warnings, for what no shared code says. Codes are an API: apps branch and translate by them, and
 * a code is never renamed or reused.
 */
export const ETHEREUM_WARNINGS = defineWarnings('ethereum', {
  /**
   * An address is not the kind a descriptor expects there (its `types`): the names resolver knows it as a contract
   * where the descriptor expects an account, say.
   */
  ADDRESS_TYPE_MISMATCH: {
    message: 'An address here is not the kind of account or contract the description expects.',
    severity: 'medium',
  },
  /** The transaction deploys a contract: there is no recipient, and the data is its code. */
  CONTRACT_CREATION: {
    message: 'This deploys a new contract. Its code is the transaction data, which is not described here.',
    severity: 'info',
  },
  /**
   * A descriptor answered for this call or message, but it is malformed or does not bind to it: it was not used.
   * `params.code` is the reference implementation's reason (`DEPLOYMENT_MISMATCH`, `MUSTMATCH_VIOLATION`, …).
   */
  INVALID_DESCRIPTOR: {
    message: 'A description was found for this, but it is malformed or does not apply, so it was not used.',
    severity: 'low',
  },
  /** A message that starts like an ERC-4361 sign-in request but does not follow its format. */
  MALFORMED_SIGN_IN: {
    message: 'This looks like a sign-in request but does not follow the format, so it is shown as plain text.',
    severity: 'medium',
  },
  /** A sign-in request for another account than the signer. */
  SIGN_IN_ACCOUNT_MISMATCH: {
    message: 'This signs in as another account than the one signing.',
    severity: 'high',
  },
  /** A sign-in request for another chain than the client's. */
  SIGN_IN_CHAIN_MISMATCH: {
    message: 'The sign-in request names another chain than this one.',
    severity: 'medium',
  },
  /** A sign-in request for another site than the one asking (`origin`). */
  SIGN_IN_DOMAIN_MISMATCH: {
    message: 'The site asking is not the site this signs in to. This is how phishing sites reuse sign-ins.',
    severity: 'high',
  },
  /** A sign-in request whose URI is not on the domain it names. */
  SIGN_IN_URI_MISMATCH: {
    message: 'The sign-in URI is not on the domain the request names.',
    severity: 'medium',
  },
  /** Ether sent with a call that, as the decoder reads it, does not take any. */
  UNEXPECTED_VALUE: {
    message: 'This sends ether with a call that does not take any: it may be lost, or the transaction may fail.',
    severity: 'medium',
  },
  /** An approval or a permit to a spender no resolver names. */
  UNKNOWN_SPENDER: {
    message: 'The spender is not a contract or an account the wallet knows. Most thefts start with such an approval.',
    severity: 'high',
  },
  /** An amount a descriptor marks as unlimited (at or past its threshold), in anything but a plain approval. */
  UNLIMITED_AMOUNT: {
    message: 'An amount here is unlimited: the other side may take as much of the token as it can.',
    severity: 'medium',
  },
  /**
   * A descriptor's field that could not be read as it says: shown raw. `params.code`, when present, is the reference
   * implementation's reason (`ARGUMENT_TYPE_MISMATCH`, `FORMAT_PARAM_RESOLUTION_ERROR`, …).
   */
  UNREADABLE_FIELD: {
    message: 'Part of the description could not be read, so it is shown raw.',
    severity: 'medium',
  },
  /**
   * A descriptor from the online registry has no valid attestation from an auditor the app trusts (ERC-8176): it was
   * not used. `params.code` is the reference implementation's (`NO_TRUSTED_ATTESTATION`).
   */
  UNTRUSTED_DESCRIPTOR: {
    message: 'A description was found for this, but no auditor the wallet trusts vouches for it, so it was not used.',
    severity: 'medium',
  },
})

/** Every warning code this package can raise: the shared ones it uses, and its own. */
export type EthereumWarningCode = SharedWarningCode | (typeof ETHEREUM_WARNINGS)[keyof typeof ETHEREUM_WARNINGS]['code']

/** The package's own words, by group: what the shared `INTENTS`, `SUMMARIES` and `LABELS` do not say. */
export const ETHEREUM_TEXTS = defineTexts('ethereum', {
  intent: {
    decreaseAllowance: 'Decrease allowance',
    renounceOwnership: 'Renounce ownership',
    signTypedData: 'Sign typed data',
    undelegate: 'Clear delegation',
    unwrap: 'Unwrap',
    upgrade: 'Upgrade contract',
    wrap: 'Wrap',
  },
  label: {
    accessList: 'Access list',
    approved: 'Approved for all',
    authority: 'Authorizing account',
    chain: 'Chain',
    collection: 'Collection',
    delegate: 'Delegate',
    gasLimit: 'Gas limit',
    gasPrice: 'Gas price',
    implementation: 'New code',
    item: 'Item {index}',
    maxFeePerGas: 'Max fee per gas',
    maxPriorityFeePerGas: 'Max priority fee per gas',
    newOwner: 'New owner',
    operation: 'Operation',
    requestId: 'Request ID',
    resources: 'Resources',
    salt: 'Salt',
    selector: 'Function selector',
    signatureDeadline: 'Signature deadline',
    tokenId: 'Token ID',
    transactionType: 'Transaction type',
    value: 'Value',
    version: 'Version',
    witness: 'Witness',
  },
  summary: {
    approveAll: 'Allow {operator} to transfer all your {collection}',
    decreaseAllowance: "Lower {spender}'s allowance by {amount}",
    delegateAccount: 'Let {delegate} run code as {account}',
    increaseAllowance: 'Allow {spender} to spend {amount} more',
    lockdown: 'Revoke {count} Permit2 allowances',
    permitBatch: 'Allow {spender} to spend {count} tokens',
    permitTransfer: 'Allow {spender} to take {amount} once',
    renounceOwnership: 'Give up control of {contract} for good',
    revokeAll: 'Stop {operator} from transferring your {collection}',
    sendNft: 'Send {collection} #{tokenId} to {recipient}',
    sendNftBatch: 'Send {count} kinds of {collection} to {recipient}',
    signTypedData: 'Sign {primaryType} for {domain}',
    undelegate: "Clear this account's delegation",
    undelegateAccount: 'Clear the delegation of {account}',
    unwrap: 'Unwrap {amount}',
    upgrade: 'Replace the code of {contract} with {implementation}',
    wrap: 'Wrap {amount}',
  },
  unit: {
    blocks: 'blocks',
    gas: 'gas',
  },
})

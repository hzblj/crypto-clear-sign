import {defineTexts, defineWarnings, type SharedWarningCode} from '@hzblj/crypto-clear-sign'

/**
 * Bitcoin's own warnings, for what no shared code says. Codes are stable: a UI may branch on them and translate by
 * them (`bitcoin.SIGHASH_NONE`); a new one is a minor release, and a code is never reused for another meaning.
 */
export const BITCOIN_WARNINGS = defineWarnings('bitcoin', {
  /** An output pays an address one of the inputs spends from. */
  ADDRESS_REUSE: {
    message: 'This pays an address it also spends from, which links your payments together.',
    severity: 'info',
  },
  /** A protected coin's inscription or runes end up destroyed: in an `OP_RETURN` output, or burned by a cenotaph. */
  ASSET_BURNED: {
    message: 'An inscription or runes this spends are destroyed by this transaction.',
    severity: 'critical',
  },
  /** Where a protected coin's inscription or runes end up cannot be worked out (a coin's value is missing). */
  ASSET_DESTINATION_UNKNOWN: {
    message: 'This spends a coin holding an inscription or runes, and where they end up cannot be worked out.',
    severity: 'high',
  },
  /** A protected coin's inscription or runes stay with you: every output they can reach is yours. */
  ASSET_KEPT: {
    message: 'An inscription or runes this spends stay in your wallet.',
    severity: 'info',
  },
  /** An `OP_RETURN` output that carries bitcoin: it can never be spent. */
  BURN: {
    message: 'This output can never be spent: the bitcoin it carries is destroyed.',
    severity: 'critical',
  },
  /** A malformed runestone: by the Runes protocol, every rune the transaction's inputs hold is burned. */
  CENOTAPH: {
    message: 'This transaction carries a malformed runestone, which burns every rune its inputs hold.',
    severity: 'critical',
  },
  /** Several outputs pay the same address. */
  DUPLICATE_OUTPUT: {
    message: 'Several outputs pay the same address.',
    severity: 'low',
  },
  /** An output below its script's dust limit: nodes do not relay the transaction. */
  DUST_OUTPUT: {
    message: 'This output is below the dust limit, so nodes will not relay the transaction.',
    severity: 'low',
  },
  /**
   * The PSBT names a key at one of the signer's account paths (its fingerprint, a receiving or change path) that is
   * not the key the account has there: it claims a coin or an output is the signer's, falsely.
   */
  FALSE_DERIVATION: {
    message: 'The PSBT says a key of your account pays this, but your account has another key there. It is not yours.',
    severity: 'high',
  },
  /** An absolute lock time more than 30 days ahead: a signed transaction that stays usable for a long time. */
  FAR_FUTURE_LOCKTIME: {
    message:
      'This transaction cannot be confirmed for a long time. Until then, whoever holds it can broadcast it, unless these coins are spent first.',
    severity: 'medium',
  },
  /** Some inputs spend coins of other wallets: this signature is one of several. */
  FOREIGN_INPUTS: {
    message: 'Some inputs spend coins that are not yours: you sign only your own part of this transaction.',
    severity: 'low',
  },
  /** An output pays a script that has no address and is not `OP_RETURN` data. */
  NO_ADDRESS_OUTPUT: {
    message:
      'An output pays a script with no address, which nothing here can read: whoever can satisfy it gets the coins.',
    severity: 'high',
  },
  /** None of the inputs is the signer's: there is nothing to sign with the accounts given. */
  NO_OWN_INPUTS: {
    message: 'None of the inputs is yours, so there is nothing for you to sign. Check the account.',
    severity: 'medium',
  },
  /** A runestone sends runes to an `OP_RETURN` output, where they are destroyed. */
  RUNES_BURNED: {
    message: 'This runestone sends runes to an output that can never be spent: they are destroyed.',
    severity: 'critical',
  },
  /** SIGHASH_ALL|ANYONECANPAY: the outputs are fixed, the inputs are not. */
  SIGHASH_ANYONECANPAY: {
    message: 'Input #{input} lets others add their own inputs to this transaction. The outputs stay as they are.',
    severity: 'medium',
  },
  /** SIGHASH_NONE (alone or with ANYONECANPAY), or SIGHASH_SINGLE with no output at its index. */
  SIGHASH_NONE: {
    message: 'Input #{input} is signed without its outputs: whoever has this signature can send this coin anywhere.',
    severity: 'critical',
  },
  /** SIGHASH_SINGLE: one output is fixed, every other can change. */
  SIGHASH_SINGLE: {
    message: 'Input #{input} is signed for output #{output} only: every other output can be changed after you sign.',
    severity: 'high',
  },
  /** SIGHASH_SINGLE|ANYONECANPAY: how marketplace offers are signed, and how many scams are too. */
  SIGHASH_SINGLE_ANYONECANPAY: {
    message:
      'Input #{input} is signed as an offer: you are paid output #{output}, and whoever completes the transaction decides where the rest of this coin goes. Marketplaces list this way, and so do scams.',
    severity: 'high',
  },
  /** A sign-in message names another account than the one signing it. */
  SIGN_IN_MISMATCH: {
    message: 'The message names another account than the one signing it.',
    severity: 'high',
  },
  /** An absolute lock time ahead of now, or of the chain tip. */
  TIMELOCKED: {
    message: 'This transaction cannot be confirmed before its lock time.',
    severity: 'info',
  },
  /** No fee can be shown: an input does not state the value of its coin. */
  UNKNOWN_FEE: {
    message: 'The fee cannot be known: an input does not say what its coin is worth.',
    severity: 'medium',
  },
  /** An output pays a SegWit version no rules exist for yet: anyone can spend it until a soft fork gives it some. */
  UNKNOWN_SCRIPT_TYPE: {
    message: 'An output pays a kind of address no wallet uses yet: until Bitcoin gives it rules, anyone can spend it.',
    severity: 'high',
  },
  /** A sighash type outside the standard ones. */
  UNUSUAL_SIGHASH: {
    message: 'Input #{input} asks for a signature type wallets do not use, so what it signs is unclear.',
    severity: 'high',
  },
  /** Change is the user's by the PSBT's word only: its key was not derived from an account here. */
  UNVERIFIED_CHANGE: {
    message:
      "An output is change by the PSBT's word only: its key was not derived from your account here. Check its address on your signer.",
    severity: 'medium',
  },
  /** The value of a coin the signer spends is the PSBT's word: its previous transaction is not included. */
  UNVERIFIED_VALUES: {
    message:
      "Your coins' values are the PSBT's word, not checked against their transactions, so the fee may be more than it says.",
    severity: 'medium',
  },
})

/** A warning code this package raises: a shared one, or one of `BITCOIN_WARNINGS`. */
export type BitcoinWarningCode = SharedWarningCode | (typeof BITCOIN_WARNINGS)[keyof typeof BITCOIN_WARNINGS]['code']

/** Bitcoin's own words: intents, summaries, labels and units no shared text says. */
export const BITCOIN_TEXTS = defineTexts('bitcoin', {
  intent: {
    burn: 'Burn',
    change: 'Change',
    consolidate: 'Consolidate',
    data: 'Data',
    etchRune: 'Etch rune',
    mintRune: 'Mint rune',
    offer: 'Offer',
    receive: 'Receive',
    runestone: 'Runes',
    selfTransfer: 'Transfer to yourself',
    signPart: 'Sign part of a transaction',
    unknownScript: 'Unknown script',
  },
  label: {
    allOutputs: 'Split across outputs',
    allRemaining: 'All remaining',
    amountPerMint: 'Amount per mint',
    backToYou: 'Back to you',
    cap: 'Mint cap',
    derivation: 'Derivation path',
    divisibility: 'Divisibility',
    edict: 'Transfer #{index}',
    estimatedSize: 'Estimated size',
    etching: 'Etching',
    feeRate: 'Fee rate',
    flaw: 'Flaw',
    format: 'Format',
    heightEnd: 'Mints end at block',
    heightStart: 'Mints start at block',
    input: 'Input #{index}',
    inReturn: 'In return',
    inscriptions: 'Inscriptions',
    mint: 'Mint',
    notBeforeBlock: 'Not before block',
    offsetEnd: 'Mints end after blocks',
    offsetStart: 'Mints start after blocks',
    outpoint: 'Coin',
    pointer: 'Unallocated runes to output',
    premine: 'Premine',
    relativeLock: 'Relative lock',
    replaceable: 'Replaceable (RBF)',
    requestId: 'Request ID',
    resources: 'Resources',
    rune: 'Rune',
    runes: 'Runes',
    script: 'Script',
    sighash: 'Signature type',
    size: 'Size',
    symbol: 'Symbol',
    toOutput: 'To output',
    turbo: 'Turbo',
    txid: 'Transaction ID',
    unfunded: 'Left for others to fund',
    valueVerified: 'Value verified',
    version: 'Version',
    youPay: 'You pay',
    youReceive: 'You receive',
    yourCoins: 'Your coins',
  },
  summary: {
    burn: 'Destroy {amount}',
    cenotaph: 'A malformed runestone: every rune this transaction spends is burned',
    change: 'Return {amount} to you as change',
    consolidate: 'Combine {count} coins into {amount}',
    data: 'Record data on the blockchain',
    etchRune: 'Etch the rune {rune}',
    mintRune: 'Mint the rune {rune}',
    offer: 'Offer {given} for {asked}',
    offerAssets: 'Offer {given} and the inscriptions or runes it holds for {asked}',
    offerNothing: 'Offer {given} for nothing in return',
    receive: 'Receive {amount} in return',
    runestone: 'Move runes by {count} edicts',
    selfTransfer: 'Move {amount} to your own address',
    sendMany: 'Send {amount} to {count} recipients',
    signPart: 'Sign {count} of the {total} inputs of a shared transaction',
    unknownScript: 'Pay {amount} to a script with no address',
  },
  unit: {
    blocks: 'blocks',
    satPerVbyte: 'sat/vB',
    vbytes: 'vB',
  },
})

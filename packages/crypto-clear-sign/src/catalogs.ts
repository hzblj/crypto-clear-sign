import {catalog, type DisplayText} from './text'

type Catalog = Readonly<Record<string, DisplayText>>

const group = <const Group extends string, const Texts extends Readonly<Record<string, string>>>(
  name: Group,
  texts: Texts
): {readonly [Key in keyof Texts & string]: {readonly code: `${Group}.${Key}`; readonly text: Texts[Key]}} =>
  catalog(texts, name) as never

/**
 * What an action does, as a short title: the shared intents, coded `intent.<key>`. A chain package adds its own with
 * `defineTexts` for what none of these says (`solana.intent.createAccount`), and an intent a descriptor names is
 * `externalText`.
 */
export const INTENTS = group('intent', {
  approve: 'Approve',
  batch: 'Batch',
  contractCall: 'Contract call',
  delegate: 'Delegate account',
  deploy: 'Deploy contract',
  revoke: 'Revoke',
  send: 'Send',
  signIn: 'Sign in',
  signMessage: 'Sign message',
  swap: 'Swap',
  transferOwnership: 'Transfer ownership',
  unknown: 'Unknown',
}) satisfies Catalog

/** A shared intent's code. */
export type IntentCode = keyof typeof INTENTS

/**
 * One-sentence descriptions with placeholders, coded `summary.<key>`, filled with
 * `text(SUMMARIES.approve, {amount, spender})`. Each value is the string the English shows (`'100 USDC'`, `'Uniswap'`),
 * so a translation shows the same.
 */
export const SUMMARIES = group('summary', {
  approve: 'Allow {spender} to spend {amount}',
  approveUnlimited: 'Allow {spender} to spend an unlimited amount of {token}',
  batch: '{count} actions in one signature',
  blind: 'Sign data that could not be read',
  contractCall: 'Call {contract}',
  delegate: 'Let {delegate} run code as your account',
  deploy: 'Deploy a contract',
  revoke: 'Stop {spender} from spending {token}',
  send: 'Send {amount} to {recipient}',
  signIn: 'Sign in to {domain}',
  signMessage: 'Sign a message',
  swap: 'Swap {amountIn} for at least {amountOut}',
  transferOwnership: 'Give {recipient} control of {asset}',
}) satisfies Catalog

/** A shared summary's code. */
export type SummaryCode = keyof typeof SUMMARIES

/**
 * Field labels every chain shares, coded `label.<key>`. A chain package adds its own with `defineTexts`
 * (`ethereum.label.gasLimit`), and a label a descriptor gives is `externalText`.
 */
export const LABELS = group('label', {
  account: 'Account',
  amount: 'Amount',
  contract: 'Contract',
  data: 'Data',
  deadline: 'Deadline',
  domain: 'Domain',
  expiry: 'Expires',
  fee: 'Fee',
  from: 'From',
  issuedAt: 'Issued at',
  maxFee: 'Max fee',
  message: 'Message',
  minimumReceived: 'Minimum received',
  network: 'Network',
  nonce: 'Nonce',
  notBefore: 'Not before',
  operator: 'Operator',
  owner: 'Owner',
  program: 'Program',
  recipient: 'Recipient',
  spender: 'Spender',
  statement: 'Statement',
  to: 'To',
  token: 'Token',
  uri: 'URI',
  validFor: 'Valid for',
}) satisfies Catalog

/** A shared label's code. */
export type LabelCode = keyof typeof LABELS

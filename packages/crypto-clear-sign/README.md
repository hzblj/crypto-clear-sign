# @hzblj/crypto-clear-sign

[![npm](https://img.shields.io/npm/v/@hzblj/crypto-clear-sign.svg)](https://www.npmjs.com/package/@hzblj/crypto-clear-sign)
[![license](https://img.shields.io/npm/l/@hzblj/crypto-clear-sign.svg)](https://github.com/hzblj/crypto-clear-sign/blob/main/LICENSE)

Clear signing as data. Before a wallet signs, it should say what the signature does: "Allow Uniswap to spend an
unlimited amount of USDC", marked critical, rather than "call data 0x095ea7b3…". This package is the **display model**
that sentence lives in: the intent, the fields in order, the actions a batch is made of, the warnings with stable
codes and the risk they add up to, how it was understood, and what was left raw. Chain packages read what is about to
be signed into it; every UI renders it. Pure TypeScript with no dependencies: no UI, no network, no native code.

```sh
npm install @hzblj/crypto-clear-sign
```

The chain packages fill it from what is signed, through [`@hzblj/nitro-crypto`](https://www.npmjs.com/package/@hzblj/nitro-crypto)'s
chain adapters:

| Package | Reads |
| --- | --- |
| [`@hzblj/crypto-clear-sign-ethereum`](https://github.com/hzblj/crypto-clear-sign/tree/main/packages/crypto-clear-sign-ethereum) | Transactions of every type, EIP-712 typed data, personal messages; ERC-7730 descriptors |
| [`@hzblj/crypto-clear-sign-solana`](https://github.com/hzblj/crypto-clear-sign/tree/main/packages/crypto-clear-sign-solana) | Legacy and v0 transactions, messages, off-chain messages; IDLs |
| [`@hzblj/crypto-clear-sign-bitcoin`](https://github.com/hzblj/crypto-clear-sign/tree/main/packages/crypto-clear-sign-bitcoin) | PSBTs (P2WPKH and Taproot), messages |

## The model

A `ClearSigning` is plain data, deeply frozen, with no class instances:

```ts
const result = await clearSignTransaction(crypto.chains.ethereum, unsigned, {resolvers, signer})

result.chain // {family: 'ethereum', id: 'eip155:1', name: 'Ethereum'}: CAIP-2 ids
result.kind // 'transaction' | 'typed-data' | 'message' | 'offchain-message' | 'psbt' | 'authorization'
result.intent // {code: 'intent.approve', text: 'Approve'}: a short title
result.summary // {code: 'summary.approveUnlimited', text: 'Allow Uniswap to spend an unlimited amount of USDC', params}
result.fields // what to show, in order: [spender, amount, …]
result.actions // the actions it is made of: the calls of a multicall, a transaction's instructions, a PSBT's outputs
result.warnings // every warning of the whole tree, most serious first
result.risk // 'none' | 'info' | 'low' | 'medium' | 'high' | 'critical': the most serious warning's severity
result.source // {kind: 'builtin', decoder: 'erc20'}, {kind: 'descriptor', format: 'erc7730', id}, {kind: 'unknown'}
result.raw // what was left undecoded, as fields for "Show raw data"
```

The result is its own root action (`path: []`). An action has the same shape without `chain`, `kind` and
`warnings`: `intent`, `summary`, `fields`, `raw`, `source`, `risk`, its `actions`, and its `path` in the tree
(`[1, 0]` is the first action of the second). Actions nest: a batch of calls, a router's commands inside one call.

### Fields

A field has a `label` (a `DisplayText`), an optional `id` that warnings point at, an optional `secondary` flag (show it
behind "More details"), and a `kind`:

| `kind` | Value | Notes |
| --- | --- | --- |
| `amount` | `value: bigint` in base units, `decimals?`, `symbol?`, `token?`, `unlimited`, `baseUnit?` | `formatAmount` shows it exactly. No `decimals` means an unknown token: base units, and `UNKNOWN_TOKEN`. `unlimited` means show "Unlimited", never the number. `baseUnit` is a native asset's smallest unit (`wei`, `lamports`, `sat`). |
| `address` | `value`, `name?`, `relation` | `relation`: `self` (the signer), `own` (another of the user's accounts, as the `names` resolver says, or as the chain package knows from what is signed: the signer's own token accounts, its change), `contact`, `contract` (known by name), `token`, `unknown`. |
| `text` | `value: string` | Shown as is. Text from outside is checked for hidden characters (`HIDDEN_CHARACTERS`). |
| `datetime` | `value?` (milliseconds, UTC), `never`, `expired` | `never` has no value; `expired` is decided by the clock when the result was made, for a deadline. A moment that is not one (an issue time, a "valid from") is never `expired`. |
| `duration` | `value?` (milliseconds), `never` | |
| `raw` | `value`: lowercase hex with `0x` | Bytes nothing decoded. |
| `percent` | `value: number` | `0.5` is 0.5 %. |
| `number` | `value: bigint \| number`, `unit?` | A nonce, a gas limit, a count. |
| `boolean` | `value: boolean` | |
| `list` | `items: Field[]` | A group: a recipient and its amount, the tokens of a batch permit. |

### Warnings and risk

A warning has a stable `code`, a `severity`, an English `message`, `params` for translations, the `fields` it is about
(ids in its action), and the `action` it was raised on (a path). Every warning of the tree is in `result.warnings`,
most serious first, so a UI that only reads the top still shows them all; `warningsAt(result, path)` gives an
action's.

`risk` is computed, never set: an action's is the most serious severity of the warnings raised on it and below it, and
`none` without any. No risk without a reason the user can read.

| Severity | Meaning |
| --- | --- |
| `info` | Context worth knowing, no risk by itself. |
| `low` | Worth a look; nothing is lost by it alone. |
| `medium` | Check before signing: the result may not be what it seems. |
| `high` | What this moves can be lost if the other side is malicious, and what it does is not fully known. |
| `critical` | Everything it covers can be lost, now or later, without another signature. |

The shared codes, which every chain package uses where they apply:

| Code | Severity | When |
| --- | --- | --- |
| `UNLIMITED_APPROVAL` | critical | An approval of the largest amount the protocol can express (`maxUint(256)` for ERC-20). |
| `ASSET_OWNERSHIP_TRANSFER` | critical | Control passes to someone else: approval for all of a collection, an authority, an account's owner or code. |
| `UNKNOWN_CONTRACT_CALL` | high | A call to a contract or program that no decoder and no descriptor reads. |
| `BLIND_SIGNING` | high | Nothing could read what is signed. |
| `ALL_CHAINS` | high | The signature binds to no chain: typed data without a chain id, an EIP-7702 authorization for chain 0. |
| `UNKNOWN_TOKEN` | medium | An amount of a token no resolver knows: no symbol, no decimals. |
| `HIDDEN_CHARACTERS` | medium | Text with control, invisible or direction-changing characters. |
| `LONG_LIVED` | medium | Valid for longer than `LONG_LIVED_AFTER` (30 days), or with no expiry. |
| `HIGH_FEE` | medium | A fee out of proportion, by the chain package's documented threshold. |
| `EXPIRED` | low | A deadline already past. |
| `UNKNOWN_DESTINATION` | low | Assets go to an address that is not the signer, the user's, a contact or a known contract. |
| `RESOLVER_FAILED` | info | A resolver threw or answered with something malformed: names, tokens or descriptions may be missing. |

A chain package adds codes of its own only for what none of these says, namespaced by its family:
`ethereum.CONTRACT_CREATION`, `solana.OTHER_SIGNERS`, `bitcoin.FOREIGN_INPUTS`. Its README lists them.

## Rendering

A UI renders the model, not strings. The least it does: the intent and summary, the risk, the fields, and every
warning; the rest (actions, raw data, the source) one tap away.

```tsx
import {formatField, localize, plainText, warningsAt} from '@hzblj/crypto-clear-sign'

const Review = ({result}: {result: ClearSigning}) => (
  <Screen>
    <Title>{localize(result.intent, translations)}</Title>
    {result.summary && <Subtitle>{localize(result.summary, translations)}</Subtitle>}
    <RiskBadge level={result.risk} />
    {result.warnings.map(warning => <Banner key={…} severity={warning.severity}>{localize(warning, translations)}</Banner>)}
    {result.fields.filter(field => !field.secondary).map(field => (
      <Row key={…} label={localize(field.label, translations)} value={formatField(field)} />
    ))}
    {result.actions.map(action => <ActionCard key={action.path.join('.')} action={action} warnings={warningsAt(result, action.path)} />)}
  </Screen>
)

accessibilityLabel={plainText(result)} // the whole review as text, for screen readers, logs and "copy details"
```

- **`formatField(field)`** writes a value as exact English text: amounts by `formatAmount`, addresses with their
  name, moments as ISO 8601 in UTC, durations in exact units. An app with its own number and date formats renders the
  fields itself; amounts must stay exact (no rounding on a review screen).
- **`formatAmount({value, decimals, symbol, unlimited})`** is exact: `1500000n` with 6 decimals is `1.5`, one wei is
  `0.000000000000000001`, and an unlimited amount is `Unlimited USDC`. Options: `grouping` (`1,234,567.5`), `symbol`,
  and the word for unlimited.
- **`plainText(result)`** is the whole review as text: heading, chain, risk, fields, numbered actions, warnings with
  their codes and where they were raised, how each part was understood. Hidden characters come out escaped
  (`\u{202E}`). Its layout may change in a minor release: tests assert on the model.
- **Unknown kinds.** A new field kind, signing kind or code is a minor release. A UI shows a field kind it does not
  know by its label and nothing else, a warning code it does not know by its message and severity.

### Translations

Every word the model carries is a `DisplayText`: a stable `code`, the English `text` with its params filled, and the
`params`. Codes say their group: `intent.approve`, `summary.approveUnlimited`, `label.amount`, `unit.gas`; a chain
package's are namespaced (`ethereum.label.gasLimit`); warnings translate by their code (`UNLIMITED_APPROVAL`).

```ts
const cs = {'intent.approve': 'Schválit', 'summary.approveUnlimited': 'Povolit {spender} neomezeně utrácet {token}'}
localize(result.summary, cs) // 'Povolit Uniswap neomezeně utrácet USDC', the same params
localize(result.intent) // 'Approve': without a translation, the English
```

Words that are not the library's, a descriptor's labels and intents, have the code `external`: they are shown as
they are and never translated.

### JSON

Amounts and some numbers are `bigint`, which `JSON.stringify` refuses. `JSON.stringify(result, jsonReplacer)` writes
them as decimal strings, for logs. A result is not meant to travel: it is worth something only on the device that
made it from the bytes it is about to sign. A description received from elsewhere is the sender's word.

## Resolvers

Chain packages read what is signed offline, with their built-in decoders. Resolvers are how an app adds what it
knows; none is required:

```ts
const resolvers: Resolvers<EthereumDescriptorQuery, Erc7730Descriptor> = {
  tokens: {token: ({chain, address}) => tokenList.get(`${chain.id}:${address.toLowerCase()}`)}, // {symbol, decimals, name?}
  names: {name: ({address}) => addressBook.get(address)}, // {name, relation: 'own' | 'contact' | 'contract'}
  descriptors: {descriptor: query => registry.find(query)}, // {id, content, publisher?}
  clock: {now: () => Date.now()}, // tests pass a fixed one
}
```

- **Sync or async.** Each may answer with a value or a promise. Chain packages always await, so every `clearSign*`
  function is async.
- **Failures degrade, never crash.** A resolver that throws, rejects or answers with something malformed (decimals
  past 255, an empty symbol, a name with hidden characters, an unknown relation) counts as no answer: the result is
  what the rest could read, with `RESOLVER_FAILED` (info) at its root. Less known never means less warned: an
  approval to a contract nobody names still carries its own warnings.
- **Keys.** Queries carry the chain (`chain.id` is CAIP-2: key token lists by it) and the address in the chain's own
  form. Descriptor queries are each chain package's: its README says what it asks.

Chain packages reach them through `createResolverContext`, which checks answers, caches lookups per address, reads the
clock once, and finds an address's relation the same way on every chain: `self` for the signer, else the name
resolver's, else `token` when the token list has it, else `unknown`. A chain package may also mark an address `own`
itself, from what is signed (the signer's own token accounts on Solana, a PSBT's change on Bitcoin), and report a
failure it finds itself with `context.fail(name)`: a built-in list that stood in for a resolver that threw, or a
resolver of its own (declared in `ownResolvers`, such as Bitcoin's `assets`) that answered nonsense. `RESOLVER_FAILED`
then names it with the rest.

### Trust

**A resolver's answer is shown to the user as fact.** A token list that calls a scam token "USDC", an address book
entry an attacker planted, a descriptor that labels an approval "Claim reward": each makes the review lie, with the
model's full authority. So:

- Load token lists, names and descriptors from sources the app trusts (signed registries, the user's own address book),
  never from the dApp that asks for the signature, and never from the payload being signed.
- A descriptor can describe a call wrongly. The result's `source` says when one was used (`kind: 'descriptor'`, its
  `id` and `publisher`), so a UI can say "described by Uniswap's descriptor" and let the user judge.
- Decoding is not simulation. A result says what the signature asks for, not what will happen on chain: a contract
  can do something other than its interface suggests, and a balance change is a simulator's job.

## Building results (for chain packages)

[`docs/chain-package-contract.md`](https://github.com/hzblj/crypto-clear-sign/blob/main/docs/chain-package-contract.md)
is the full contract. In short: describe actions with the field constructors (`amountField`, `addressField`, …) and
the shared texts (`INTENTS`, `SUMMARIES`, `LABELS`), raise warnings from definitions (`warning(WARNINGS.EXPIRED,
{fields: ['deadline']})`), and let `createClearSigning` check everything, place the warnings and add up the risk:

```ts
import {createClearSigning, INTENTS, LABELS, SUMMARIES, text, warning, WARNINGS} from '@hzblj/crypto-clear-sign'

const context = createResolverContext({chain, normalize: address => address.toLowerCase(), ...options})
const spender = await context.address({id: 'spender', label: LABELS.spender, value: call.spender})
const amount = await context.amount({id: 'amount', label: LABELS.amount, token: to, unlimited, value: call.amount})

return createClearSigning({
  chain,
  fields: [spender, amount],
  intent: INTENTS.approve,
  kind: 'transaction',
  source: {decoder: 'erc20', kind: 'builtin'},
  summary: text(SUMMARIES.approveUnlimited, {spender: spender.name ?? spender.value, token: amount.symbol ?? to}),
  warnings: [warning(WARNINGS.UNLIMITED_APPROVAL, {fields: ['amount', 'spender']}), ...context.warnings()],
})
```

A chain package's own words and codes: `defineTexts('ethereum', {label: {gasLimit: 'Gas limit'}})` and
`defineWarnings('ethereum', {CONTRACT_CREATION: {message, severity}})`. Words from a descriptor: `externalText`.

| Helper | What it does |
| --- | --- |
| `createClearSigning(input)` | Checks a result against the model (`INVALID_ARGUMENT`, naming where), places warnings, adds risk, freezes |
| `amountField`, `addressField`, `textField`, `dateTimeField`, `durationField`, `rawField`, `percentField`, `numberField`, `booleanField`, `listField` | Fields, checked and compact |
| `warning(definition, {fields, params})`, `defineWarnings`, `WARNINGS` | Warnings from definitions |
| `text(template, params)`, `defineTexts`, `externalText`, `INTENTS`, `SUMMARIES`, `LABELS` | Words |
| `createResolverContext(options)` | Resolvers, checked, cached, failures reported (`context.fail` for those the chain package finds) |
| `fromUnixSeconds`, `checkDeadline`, `checkDuration`, `LONG_LIVED_AFTER` | Deadlines into `datetime` fields and `EXPIRED`/`LONG_LIVED`; `dateTimeField({deadline: false, value})` for a moment that is not one |
| `maxUint(bits)` | The "unlimited" of each protocol |
| `hasHiddenCharacters(text)` | For `HIDDEN_CHARACTERS` |
| `maxRisk`, `compareRisk`, `actionAt`, `warningsAt`, `hasWarning`, `findField` | Reading results |
| `isField`, `isFieldKind`, `isSigningKind`, `isSeverity`, `isRiskLevel`, `isWarningCode`, `isSharedWarningCode`, `isTextCode` | Type guards |

## Errors

Not understanding something is never an error: it is a result with its raw data and a warning. A `ClearSignError`
means there is nothing that could be signed, or a caller's mistake. Messages never quote the payload.

| Code | When |
| --- | --- |
| `INVALID_INPUT` | What is to be signed does not read at all (the chain adapter refused it, its error the `cause`) |
| `CHAIN_MISMATCH` | It is bound to another chain than the client's |
| `UNSUPPORTED` | A kind of payload the chain package does not read |
| `INVALID_ARGUMENT` | A result that breaks the model, a malformed definition, an option out of range |

**Not in this version:** simulation (balance changes, what a call does on chain), fetching anything (token lists and
descriptors are the app's), and parsing ERC-7730 or IDLs (each chain package reads its own format).

[Documentation](https://github.com/hzblj/crypto-clear-sign#readme) · [Security](https://github.com/hzblj/crypto-clear-sign/blob/main/SECURITY.md)

The other libraries from the same author are at **[libraries.janblazej.dev](https://www.libraries.janblazej.dev)**.

# @hzblj/crypto-clear-sign

[![npm](https://img.shields.io/npm/v/@hzblj/crypto-clear-sign.svg)](https://www.npmjs.com/package/@hzblj/crypto-clear-sign)
[![license](https://img.shields.io/npm/l/@hzblj/crypto-clear-sign.svg)](https://github.com/hzblj/crypto-clear-sign/blob/main/LICENSE)

The display model of clear signing: what a wallet is about to sign, as an intent, fields, actions, warnings with
stable codes and a computed risk, for any UI to render. No dependencies, no UI, no network.

## Install

```sh
npx expo install @hzblj/crypto-clear-sign
```

With a chain package to fill it: `@hzblj/crypto-clear-sign-ethereum`, `-solana` or `-bitcoin`.

## Quick start

```ts
import {plainText} from '@hzblj/crypto-clear-sign'
import {clearSignTransaction} from '@hzblj/crypto-clear-sign-ethereum'
import {ethereumAdapter} from '@hzblj/crypto-ethereum'
import {createCryptoEngine} from '@hzblj/nitro-crypto'

const crypto = createCryptoEngine({adapters: [ethereumAdapter()]})
const result = await clearSignTransaction(crypto.chains.ethereum, unsigned, {resolvers, signer: account.address})

result.intent.text // 'Approve'
result.summary?.text // 'Allow Uniswap to spend an unlimited amount of USDC'
result.risk // 'critical'
result.warnings.map(warning => warning.code) // ['UNLIMITED_APPROVAL']
plainText(result) // the whole review as text, for screen readers and logs
```

## API

| Export | What it does |
| --- | --- |
| `plainText(result, {raw?, translations?})` | The whole review as text. Its layout may change: assert on the model. |
| `localize(text, translations?)` | A `DisplayText` or a warning in the user's language by its code, English without one. |
| `formatField(field, {translations?, grouping?})`, `formatAmount(amount, {grouping?, symbol?})` | Exact English text: `1500000n` with 6 decimals is `1.5`. |
| `warningsAt(result, path)`, `actionAt(result, path)`, `findField(action, id)`, `hasWarning(result, code)` | Reading a result. |
| `maxRisk(items)`, `compareRisk(a, b)`, `jsonReplacer` | Ordering risk levels; `JSON.stringify(result, jsonReplacer)` for bigints. |
| `isClearSignError(error, code?)` | Whether a chain package threw a `ClearSignError` (of `code`). |
| `WARNINGS`, `INTENTS`, `SUMMARIES`, `LABELS` | The shared codes with their English, to translate. |
| `createClearSigning`, the field constructors, `createResolverContext` | For writing a chain package: see [the contract](https://github.com/hzblj/crypto-clear-sign/blob/main/docs/chain-package-contract.md). |

A chain package throws `ClearSignError` only when nothing can be signed (`INVALID_INPUT`, `CHAIN_MISMATCH`,
`UNSUPPORTED`) or on a caller's mistake (`INVALID_ARGUMENT`). What it cannot understand is a result with a warning.

## The result

A `ClearSigning` is plain, frozen data:

| Field | What it is |
| --- | --- |
| `intent`, `summary` | A short title and one sentence, each a `DisplayText`: a stable `code`, English `text`, `params`. |
| `fields` | What to show, in order. `secondary` ones go behind "More details". |
| `actions` | What it is made of: a batch's calls, a transaction's instructions, a PSBT's outputs. Same shape, nested, each with its `path`. |
| `warnings` | Every warning of the tree, most serious first: `code`, `severity`, `message`, `fields` (ids), `action` (path). |
| `risk` | `none`, `info`, `low`, `medium`, `high` or `critical`: the most serious warning. Never set by hand. |
| `chain`, `kind` | `{family, id, name}` with a CAIP-2 `id`; `transaction`, `typed-data`, `message`, `offchain-message`, `psbt` or `authorization`. |
| `source`, `raw` | How it was understood (`builtin` with its `decoder`, `descriptor`, `unknown`); what was left undecoded. |

Every field has a `label`, an optional `id` that warnings point at, and a `kind`:

| `kind` | Value |
| --- | --- |
| `amount` | `value: bigint` in base units, `decimals?`, `symbol?`, `token?`, `unlimited`. No `decimals` means an unknown token. |
| `address` | `value`, `name?`, `relation`: `self`, `own`, `contact`, `contract`, `token` or `unknown`. |
| `datetime`, `duration` | `value?` in milliseconds, `never`; a `datetime` also `expired`. |
| `text`, `raw` | `value: string`; `raw` is hex with `0x`. |
| `number`, `percent`, `boolean` | `value`; a `number` may have a `unit`, a `percent` of `0.5` is 0.5 %. |
| `list` | `items: Field[]`: fields that belong together. |

## Rendering

```tsx
import {type ClearSigning, formatField, localize, plainText, type Translations} from '@hzblj/crypto-clear-sign'
import {Text, View} from 'react-native'

export const Review = ({result, t}: {result: ClearSigning; t?: Translations}) => (
  <View accessibilityLabel={plainText(result, {translations: t})}>
    <Text>{localize(result.intent, t)} ({result.risk})</Text>
    {result.warnings.map(warning => (
      <Text key={`${warning.code}@${warning.action.join('.')}`}>{localize(warning, t)}</Text>
    ))}
    {result.fields.map(field => (
      <Text key={field.id ?? field.label.code}>{`${localize(field.label, t)}: ${formatField(field)}`}</Text>
    ))}
  </View>
)
```

Show at least the intent, summary, risk, every warning and the fields that are not `secondary`; actions, raw data and
the source can be a tap away. Keep amounts exact. Show a field kind or warning code you do not know by its label, or
by its message and severity: new ones come in minor releases.

## Resolvers

Resolvers add what the bytes do not say. All are optional and may answer sync or async; one that throws or answers
nonsense counts as no answer and adds `RESOLVER_FAILED`.

| Resolver | What it answers |
| --- | --- |
| `tokens` | `{symbol, decimals, name?}` for a token contract or mint, asked with `{chain, address}`. |
| `names` | `{name, relation}` for the user's own accounts (`own`), contacts (`contact`) and known contracts (`contract`). |
| `descriptors` | ERC-7730 descriptors on Ethereum, IDLs on Solana: see the chain package. |
| `clock` | `{now}` for deadlines; the system clock unless given. |

```ts
import type {NameResolver, TokenResolver} from '@hzblj/crypto-clear-sign'

const tokens: TokenResolver = {token: ({chain, address}) => tokenList.get(`${chain.id}:${address}`)}
const names: NameResolver = {name: ({address}) => addressBook.get(address)}

await clearSignTransaction(crypto.chains.ethereum, unsigned, {resolvers: {names, tokens}})
```

Their answers are shown as fact: load them from sources the app trusts, never from the dApp asking for the signature
([SECURITY.md](https://github.com/hzblj/crypto-clear-sign/blob/main/SECURITY.md)).

## Localization

Every word has a stable code (`intent.approve`, `label.amount`, `ethereum.label.gasLimit`, warnings by theirs), and
`localize` translates by it with the same params. A descriptor's words are `external` and stay as they are.

```ts
const cs: Translations = {
  'intent.approve': 'Schválit',
  'summary.approveUnlimited': 'Povolit {spender} utratit neomezené množství {token}',
  UNLIMITED_APPROVAL: 'Oprávněný si může kdykoli vzít všechny tyto tokeny, aniž by se znovu ptal.',
}

localize(result.intent, cs) // 'Schválit'
plainText(result, {translations: cs})
```

## Warnings

The shared codes. A chain package adds its own (`solana.OTHER_SIGNERS`) only for what none of these says.

| Code | Severity | When |
| --- | --- | --- |
| `UNLIMITED_APPROVAL` | critical | An approval of the largest amount the protocol can express. |
| `ASSET_OWNERSHIP_TRANSFER` | critical | Control passes to someone else: approval for all, an authority, an account's owner or code. |
| `UNKNOWN_CONTRACT_CALL` | high | A call to a contract or program nothing reads. |
| `BLIND_SIGNING` | high | Nothing could read what is signed. |
| `ALL_CHAINS` | high | The signature binds to no chain. |
| `UNKNOWN_TOKEN` | medium | An amount of a token no resolver knows. |
| `HIDDEN_CHARACTERS` | medium | Text with control, invisible or direction-changing characters. |
| `LONG_LIVED` | medium | Valid for more than 30 days, or with no expiry. |
| `HIGH_FEE` | medium | A fee above the chain package's threshold. |
| `EXPIRED` | low | A deadline already past. |
| `UNKNOWN_DESTINATION` | low | Assets go to an address that is not the user's, a contact or a known contract. |
| `RESOLVER_FAILED` | info | A resolver failed: some names, tokens or descriptions may be missing. |

## Not supported

- Simulation: a result says what a signature asks for, not what will happen on chain.
- Fetching anything: token lists, names and descriptors are the app's.
- Parsing ERC-7730 or IDLs: each chain package reads its own format.

[Security](https://github.com/hzblj/crypto-clear-sign/blob/main/SECURITY.md) · [Compatibility](https://github.com/hzblj/crypto-clear-sign/blob/main/docs/compatibility.md) · [Decisions](https://github.com/hzblj/crypto-clear-sign/tree/main/docs/adr) · [MIT](https://github.com/hzblj/crypto-clear-sign/blob/main/LICENSE)

The other libraries from the same author are at **[libraries.janblazej.dev](https://www.libraries.janblazej.dev)**.

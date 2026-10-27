# @hzblj/crypto-clear-sign-solana

[![npm](https://img.shields.io/npm/v/@hzblj/crypto-clear-sign-solana.svg)](https://www.npmjs.com/package/@hzblj/crypto-clear-sign-solana)
[![license](https://img.shields.io/npm/l/@hzblj/crypto-clear-sign-solana.svg)](https://github.com/hzblj/crypto-clear-sign/blob/main/LICENSE)

Reads Solana transactions (legacy and v0) and messages (text, Sign In With Solana, off-chain messages) into the
[`@hzblj/crypto-clear-sign`](https://github.com/hzblj/crypto-clear-sign/tree/main/packages/crypto-clear-sign) display model.

## Install

```sh
npx expo install @hzblj/crypto-clear-sign @hzblj/crypto-clear-sign-solana @hzblj/crypto-solana @hzblj/nitro-crypto react-native-nitro-modules
```

## Quick start

```ts
import {plainText} from '@hzblj/crypto-clear-sign'
import {clearSignTransaction} from '@hzblj/crypto-clear-sign-solana'
import {solanaAdapter} from '@hzblj/crypto-solana'
import {createCryptoEngine} from '@hzblj/nitro-crypto'

const crypto = createCryptoEngine({adapters: [solanaAdapter()]})
const result = await clearSignTransaction(crypto.chains.solana, transaction, {signer: account.address}) // wire bytes

result.intent.text // 'Send'
result.summary?.text // 'Send 1.5 SOL to 9xQe…'
result.risk // 'low': UNKNOWN_DESTINATION, a recipient the wallet does not know
result.actions // one per instruction, in order
plainText(result)
```

Built in: System, Token and Token-2022, Associated Token Account, Compute Budget, Memo, Stake, Address Lookup Table and
the BPF Upgradeable Loader. Any other program is read by an Anchor IDL you give it, or shown raw with
`UNKNOWN_CONTRACT_CALL`.

## API

| Export | What it does |
| --- | --- |
| `clearSignTransaction(chain, transaction, options?)` | A wire transaction (`Uint8Array`), or `{message}` with the message bytes alone as an air-gapped signer gets them. |
| `clearSignMessage(chain, message, options?)` | Text or bytes: an off-chain message, Sign In With Solana, text; anything else raw with `BLIND_SIGNING`. |
| `createIdlResolver(idls, {sha256?})` | A `descriptors` resolver from Anchor IDLs; `sha256` only for IDLs from before Anchor 0.30. |
| `SOLANA_WARNINGS`, `SOLANA_TEXTS` | Its own warning and text codes (`solana.*`), to branch on and translate. |
| `SOLANA_PROGRAMS`, `SOLANA_TOKENS` | The built-in program names, and token list (USDC, USDT, wrapped SOL) used where your `tokens` resolver has no answer. |
| `SOLANA_CHAIN_IDS` | The CAIP-2 id of each cluster: what resolvers key tokens and names by. |
| `HIGH_PRIORITY_FEE`, `LAMPORTS_PER_SIGNATURE`, `IDL_LIMITS` | The `highPriorityFee` default, the base fee, the bounds an IDL is read within. |

Types you may name: `SolanaClearSignOptions`, `SolanaResolvers`, `SolanaIdl`, `SolanaWarningCode`.

Errors (`ClearSignError`): `INVALID_INPUT` for bytes the adapter cannot read, `UNSUPPORTED` for a message version
after v0, `INVALID_ARGUMENT` for an option out of range or a `signer` that is not one of the transaction's signers.

## Warnings

Its own codes; the shared ones are in the [core's README](https://github.com/hzblj/crypto-clear-sign/tree/main/packages/crypto-clear-sign#warnings),
at their default severities.

| Code | Severity | When |
| --- | --- | --- |
| `solana.MESSAGE_IS_TRANSACTION` | critical | Bytes asked for as a message are a transaction message the signer signs. |
| `solana.PROGRAM_UPGRADE` | critical | A program's code is replaced. |
| `solana.CLOSE_TO_OTHER` | high | A token account, lookup table or program account is closed to an account that is neither the user's nor its owner. |
| `solana.DURABLE_NONCE` | high | A durable nonce: the transaction never expires, and whoever holds it can submit it. |
| `solana.SIGN_IN_ADDRESS_MISMATCH` | high | A sign-in message for another account than `signer`. |
| `solana.SIGN_IN_DOMAIN_MISMATCH` | high | A sign-in message for another site than `origin`. |
| `solana.SIGN_IN_CHAIN_MISMATCH` | medium | A sign-in message for another cluster. |
| `solana.SIGN_IN_MALFORMED` | medium | Text that starts as a sign-in message and breaks its format. |
| `solana.UNRESOLVED_LOOKUPS` | medium | An instruction uses accounts from lookup tables that were not given. |
| `solana.NOT_FEE_PAYER` | low | The signer signs, another account pays the fee. |
| `solana.OTHER_SIGNERS` | low | Other accounts must sign too. |

## Options

Besides the core's `signer` and `resolvers`:

| Option | What it does |
| --- | --- |
| `addressLookupTables` | `{[table]: addresses}`: the tables a v0 transaction loads accounts from, so those accounts are named. |
| `resolvers.lookupTables` | `{lookupTable: ({address}) => addresses}`, asked for each table the option does not give. |
| `resolvers.descriptors` | An Anchor IDL for a program nothing built in reads: `createIdlResolver`. |
| `highPriorityFee` | Lamports above which the priority fee is `HIGH_FEE`. 0.01 SOL unless given. |
| `builtinTokens` | `false` turns `SOLANA_TOKENS` off. |
| `origin` | Messages: the site asking, which a Sign In With Solana domain must match. |

```ts
import {createIdlResolver} from '@hzblj/crypto-clear-sign-solana'

const descriptors = createIdlResolver([{idl: routerIdl, publisher: 'Router'}], {sha256: crypto.hash.sha256})
const result = await clearSignTransaction(crypto.chains.solana, transaction, {
  addressLookupTables: {[tableAddress]: tableAddresses},
  resolvers: {descriptors},
  signer: account.address,
})
```

An IDL only names an instruction, its accounts and arguments: it cannot describe Solana's own programs, remove a
warning or set a risk, and one that does not fit the data is ignored. Load IDLs, lookup tables, token lists and names
only from sources you trust ([SECURITY.md](https://github.com/hzblj/crypto-clear-sign/blob/main/SECURITY.md)).

## Not supported

- Simulation and fetching: lookup tables and IDLs are the app's.
- Confidential transfers and Token-2022's confidential extensions, token metadata and token group instructions
  (shown raw).
- Stake's `setLockup` and `authorizeWithSeed` (and their checked forms) and `deactivateDelinquent`, System's
  instructions after `createAccountAllowPrefund`, the loader's `migrate` and `extendProgramChecked` (shown raw).
- Codama IDLs, and Anchor IDLs' `bytemuck` types, events, accounts and errors.
- Version 1 transactions, and the `solana` CLI's older off-chain message format.
- A sign-in message's URI is shown, not compared with its domain.

[Security](https://github.com/hzblj/crypto-clear-sign/blob/main/SECURITY.md) · [Compatibility](https://github.com/hzblj/crypto-clear-sign/blob/main/docs/compatibility.md) · [Decisions](https://github.com/hzblj/crypto-clear-sign/tree/main/docs/adr) · [MIT](https://github.com/hzblj/crypto-clear-sign/blob/main/LICENSE)

The other libraries from the same author are at **[libraries.janblazej.dev](https://www.libraries.janblazej.dev)**.

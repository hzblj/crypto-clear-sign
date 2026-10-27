# @hzblj/crypto-clear-sign-solana

[![npm](https://img.shields.io/npm/v/@hzblj/crypto-clear-sign-solana.svg)](https://www.npmjs.com/package/@hzblj/crypto-clear-sign-solana)
[![license](https://img.shields.io/npm/l/@hzblj/crypto-clear-sign-solana.svg)](https://github.com/hzblj/crypto-clear-sign/blob/main/LICENSE)

Solana clear signing for [`@hzblj/crypto-clear-sign`](https://github.com/hzblj/crypto-clear-sign/tree/main/packages/crypto-clear-sign):
legacy and v0 transactions (as a dApp sends them, or as bare messages), text, Sign In With Solana and off-chain
messages, read through the chain client of [`@hzblj/crypto-solana`](https://www.npmjs.com/package/@hzblj/crypto-solana)
into the shared display model. Solana's own programs are read by built-in decoders, any other program by an Anchor IDL
an app trusts, and whatever nothing reads is shown raw with a warning.

```sh
npx expo install @hzblj/crypto-clear-sign @hzblj/crypto-clear-sign-solana @hzblj/crypto-solana @hzblj/nitro-crypto react-native-nitro-modules
```

`@hzblj/crypto-solana` (0.3.0 or later) is a dependency; `@hzblj/nitro-crypto` is a peer, as everywhere: one engine
per app. The chain client is the app's `crypto.chains.solana`.

## Transactions

```ts
import {plainText} from '@hzblj/crypto-clear-sign'
import {clearSignTransaction} from '@hzblj/crypto-clear-sign-solana'

const bytes = base64ToBytes(request.transaction) // what the dApp sent: signatures and message
const result = await clearSignTransaction(crypto.chains.solana, bytes, {resolvers, signer: account.address})

result.kind // 'transaction'
result.intent // {code: 'intent.send', text: 'Send'}
result.summary?.text // 'Send 1.5 SOL to 9xQe…'
result.actions // one per instruction, in order: actions[i] is instruction i
result.risk // 'low': UNKNOWN_DESTINATION, the recipient is no one the wallet knows
plainText(result)
// Send: Send 1.5 SOL to 9xQe…
// Transaction on Solana. Risk: low.
// You send:
//   Amount: 1.5 SOL
// Fee payer: Hzsu…, this account
// Fee: 0.000005 SOL
// …
```

The payload is the wire transaction (`Uint8Array`, read with `chain.decodeTransaction`) or `{message}` with the
message bytes alone, as an air-gapped signer receives them (read with `chain.decodeMessage`). Both read the same.

**The result itself** is what the whole transaction does:

| Field | What it is |
| --- | --- |
| `sent` | A list of what leaves the wallet (the `signer`, or the fee payer without one): SOL from transfers and account funding, tokens by mint from transfers and burns the wallet authorizes. A floor, not a simulation: a program nothing reads can move more. |
| `feePayer`, `fee` | Who pays, and the base fee: 5,000 lamports per signature. |
| `priorityFee` | The compute unit price times the limit the transaction asks for (or the runtime's default: 200,000 units per instruction, 3,000 for a native program, at most 1,400,000), rounded up. Only with a price. |
| `signers` | Every signer, when there is more than one. |
| `recentBlockhash`, or `nonceAccount`, `nonce` and `expiry` | The lifetime: a recent blockhash, or a durable nonce that never expires. |
| `computeUnitLimit`, `computeUnitPrice`, `version`, `lookupTables` | Secondary: the budget, `legacy` or `v0`, the tables a v0 transaction loads from. |

Its **intent** is the one instruction that is not set-up (compute budget, memo, associated token account creation, the
durable nonce's advance), when there is one: a transfer with a priority fee and a recipient's token account created is
`intent.send`. Otherwise it is `intent.batch`, "{count} actions in one signature".

**Lookup tables.** A v0 transaction names accounts by their index in an address lookup table. Give the tables'
addresses (`addressLookupTables`, as the adapter takes them, or `resolvers.lookupTables`, asked for each table the
option does not give) and those accounts are named. Without them, an account shows as its table and index, and the
instruction that uses it carries `solana.UNRESOLVED_LOOKUPS`.

```ts
await clearSignTransaction(chain, bytes, {
  addressLookupTables: {[tableAddress]: tableAddresses},
  resolvers: {lookupTables: {lookupTable: ({address}) => fetchLookupTable(address)}}, // or this, for the rest
})
```

**Options**, besides the core's `signer` and `resolvers`: `addressLookupTables`, `highPriorityFee` (lamports above
which `HIGH_FEE` is raised; `HIGH_PRIORITY_FEE`, 0.01 SOL, unless given), and `builtinTokens` (`false` turns the
built-in token list off).

**Errors.** `INVALID_INPUT` when the adapter cannot read the bytes (its error is the `cause`), `UNSUPPORTED` for a
message version after v0, `INVALID_ARGUMENT` for an option out of range, lookup tables given as an option that do not
hold what the message loads, or a `signer` that is not one of the transaction's signers. Solana transactions do not
name a cluster, so there is no `CHAIN_MISMATCH`.

## Messages

```ts
import {clearSignMessage} from '@hzblj/crypto-clear-sign-solana'

const result = await clearSignMessage(crypto.chains.solana, request.message, {
  origin: 'https://app.example.com', // the site that asks, as the wallet knows it
  signer: account.address,
})
```

| What is signed | `kind` | Intent | What it shows |
| --- | --- | --- | --- |
| An off-chain message (bytes starting with `\xffsolana offchain`, versions 0 and 1) | `offchain-message` | `intent.signMessage` (or `intent.signIn`) | The text, the signers, and for version 0 the application and the format. `solana.OTHER_SIGNERS` when others must sign too. |
| A Sign In With Solana message | `message` | `intent.signIn`, "Sign in to app.example.com" | The domain, the account, the statement, URI, network, nonce, times, request id and resources. |
| UTF-8 text | `message` | `intent.signMessage` | The text. `HIDDEN_CHARACTERS` when it hides anything. |
| Anything else | `message` | `intent.signMessage`, `summary.blind` | The bytes, raw, with `BLIND_SIGNING`; or `solana.MESSAGE_IS_TRANSACTION` when they are a transaction message the signer signs. |

A string is signed as its UTF-8 bytes. **Sign In With Solana** messages are read by the wallet standard's layout
(`createSignInMessageText`): the header line, the address, an optional statement, then the fields in their one order,
each once. Its checks:

- the domain against `options.origin` (an origin or a host; the scheme's default port is ignored):
  `solana.SIGN_IN_DOMAIN_MISMATCH`;
- the address against `options.signer`: `solana.SIGN_IN_ADDRESS_MISMATCH`;
- the chain id (`mainnet`, `devnet`, `testnet`, `solana:<name>` or CAIP-2) against the client's cluster:
  `solana.SIGN_IN_CHAIN_MISMATCH` (any other, `localnet` included, is a mismatch);
- the expiration time: `EXPIRED` once past, `LONG_LIVED` past 30 days. The issue time and "not before" are shown,
  never "expired".

Text that starts as one and breaks the format (fields out of order or twice, a time that is not RFC 3339, a version
other than 1, a line that belongs to nothing) is plain text with `solana.SIGN_IN_MALFORMED`. Without `origin` the
domain is shown, not checked. `INVALID_INPUT` for an off-chain message the adapter refuses, `INVALID_ARGUMENT` for a
`signer` an off-chain message does not name.

## What it recognizes

Built-in decoders read Solana's own programs, before any descriptor: an IDL can never describe the System or Token
program. Each action's `source` is `{kind: 'builtin', decoder}` with these names. Instruction data must read to its
last byte; data a decoder cannot read (cut short, an unknown tag, bytes left over, accounts missing) is shown raw with
`UNKNOWN_CONTRACT_CALL`, as the program would refuse it.

| `decoder` | Program | Instructions | Intents and warnings |
| --- | --- | --- | --- |
| `system-program` | System | `transfer`, `transferWithSeed`, `createAccount`, `createAccountWithSeed`, `createAccountAllowPrefund`, `assign`, `assignWithSeed`, `allocate`, `allocateWithSeed`, the nonce instructions (`advance`, `withdraw`, `initialize`, `authorize`, `upgrade`) | `intent.send` with `UNKNOWN_DESTINATION`; `assign` of the user's account to another program and `authorizeNonce` to someone else are `ASSET_OWNERSHIP_TRANSFER` |
| `spl-token`, `spl-token-2022` | Token and Token-2022 | `transfer`, `transferChecked`, `approve`, `approveChecked`, `revoke`, `setAuthority`, `mintTo(Checked)`, `burn(Checked)`, `closeAccount`, `freezeAccount`, `thawAccount`, `syncNative`, `initializeMint(2)`, `initializeAccount(2, 3)`, `initializeMultisig(2)`, `getAccountDataSize`, `initializeImmutableOwner`, `amountToUiAmount`, `uiAmountToAmount`, `withdrawExcessLamports`, `unwrapLamports`, and `batch` (each of its instructions a nested action) | `intent.send` (`UNKNOWN_DESTINATION`, `UNKNOWN_TOKEN`), `intent.approve` (`UNLIMITED_APPROVAL` at the largest `u64`), `intent.transferOwnership` (`ASSET_OWNERSHIP_TRANSFER`), `solana.CLOSE_TO_OTHER` |
| `spl-token-2022` | Token-2022's extensions | `transferCheckedWithFee`; the mint close authority, transfer fee config and `setTransferFee`, withheld fee withdrawal and harvest, default account state, `reallocate`, memo transfers, native mint, non-transferable mint, interest-bearing mint, CPI guard, permanent delegate, transfer hook, metadata, group and group member pointers, scaled UI amount, pausable, permissioned burn | `solana.intent.configureToken` with what is set; confidential transfers, token metadata and token group instructions are not read |
| `associated-token-account` | Associated Token Account | `create`, `createIdempotent`, `recoverNested` | `solana.intent.createTokenAccount` |
| `compute-budget` | Compute Budget | `setComputeUnitLimit`, `setComputeUnitPrice`, `requestHeapFrame`, `setLoadedAccountsDataSizeLimit` | The priority fee at the root, `HIGH_FEE` |
| `memo` | Memo (v1, v3 and v4) | The note | `HIDDEN_CHARACTERS` |
| `stake-program` | Stake | `initialize(Checked)`, `delegateStake`, `deactivate`, `withdraw`, `split`, `merge`, `moveStake`, `moveLamports`, `authorize(Checked)` | `authorize` to someone else is `ASSET_OWNERSHIP_TRANSFER`; `withdraw` to a stranger `UNKNOWN_DESTINATION`. The sysvars the program's older layouts pass are skipped, so both layouts read. |
| `address-lookup-table` | Address Lookup Table | `create`, `extend`, `freeze`, `deactivate`, `close` | `close` to a stranger is `solana.CLOSE_TO_OTHER` |
| `bpf-upgradeable-loader` | BPF Upgradeable Loader | `initializeBuffer`, `write`, `deployWithMaxDataLen`, `upgrade`, `setAuthority(Checked)`, `close`, `extendProgram` | `upgrade` is `solana.PROGRAM_UPGRADE`; `setAuthority` to someone else `ASSET_OWNERSHIP_TRANSFER`, to no one `solana.intent.makeImmutable` |
| `solana-transaction` | | The root of a transaction | |
| `text`, `siws`, `offchain-message` | | Messages | |

Any other program is read by an IDL the `descriptors` resolver gives (`{kind: 'descriptor', format: 'idl', id,
publisher}`), or shown as `intent.contractCall` with its program, its data raw and its accounts labelled by role
(signing, writable), with `UNKNOWN_CONTRACT_CALL`.

**Who an account is.** Addresses get their relation from the resolvers (`self` for the signer, then the names
resolver, then the token list). This package adds what it knows by itself: the names of Solana's native programs, the
SPL programs and the sysvars (`SOLANA_PROGRAMS`, a `contract`), and, as `own`, the signer's associated token accounts
the transaction creates and its wrapped SOL accounts. A token transfer to an associated token account the transaction
creates, or to the signer's own, names its owner as the `recipient`; the mint of a transfer without one
(`transfer`, `approve`) is taken from the associated token account it goes to, when the transaction creates it.

**Tokens.** Amounts are exact `bigint`s. `transferChecked` and every checked instruction carry their decimals, and
those are shown, whatever the token list says; the symbol comes from the token list. `SOLANA_TOKENS` is the built-in
list (USDC and USDT on mainnet, Circle's devnet USDC, wrapped SOL everywhere): it answers only where the app's
`tokens` resolver does not, and `builtinTokens: false` turns it off.

## Warnings

| Code | Severity | When |
| --- | --- | --- |
| `ASSET_OWNERSHIP_TRANSFER` | critical | A token account's or mint's authority (any type: owner, close, mint, freeze, Token-2022's), a stake authority, a nonce authority or a program's upgrade authority handed to someone who is not the user (`self` or `own`); the user's account assigned to another program. Without a `signer`, any account that signs the transaction may be the user's. |
| `UNLIMITED_APPROVAL` | critical | `approve` or `approveChecked` of the largest `u64`, exactly. |
| `solana.PROGRAM_UPGRADE` | critical | A program's code replaced. |
| `solana.MESSAGE_IS_TRANSACTION` | critical | Bytes asked for as a message that read as a transaction message the signer signs. |
| `UNKNOWN_CONTRACT_CALL` | high | An instruction no built-in decoder or IDL reads. |
| `BLIND_SIGNING` | high | A message that is neither text nor a format this reads. |
| `solana.CLOSE_TO_OTHER` | high | A token account (or a lookup table, or a program account) closed to an account that is neither the user's nor its owner. Closing a wrapped SOL account sends all of its SOL. |
| `solana.DURABLE_NONCE` | high | The first instruction advances a durable nonce: the transaction never expires, and whoever holds it signed can submit it at any time. |
| `solana.SIGN_IN_DOMAIN_MISMATCH` | high | A sign-in message for another site than `origin`. |
| `solana.SIGN_IN_ADDRESS_MISMATCH` | high | A sign-in message for another account than `signer`. |
| `UNKNOWN_TOKEN` | medium | An amount of a mint no token list knows, or of a transfer or approval that names no mint. |
| `HIDDEN_CHARACTERS` | medium | A message, a memo, a sign-in field, or an IDL's name or text with hidden characters. |
| `HIGH_FEE` | medium | A priority fee above `highPriorityFee`. |
| `LONG_LIVED` | medium | A sign-in message valid for more than 30 days. |
| `solana.UNRESOLVED_LOOKUPS` | medium | An instruction uses accounts from lookup tables that were not given. |
| `solana.SIGN_IN_CHAIN_MISMATCH` | medium | A sign-in message for another cluster. |
| `solana.SIGN_IN_MALFORMED` | medium | Text that starts as a sign-in message and breaks its format. |
| `UNKNOWN_DESTINATION` | low | SOL or tokens to an address that is not the user's, a contact or a known contract. |
| `EXPIRED` | low | A sign-in message past its expiration time. |
| `solana.NOT_FEE_PAYER` | low | The signer signs, another account pays the fee. |
| `solana.OTHER_SIGNERS` | low | Other accounts must sign too. |
| `RESOLVER_FAILED` | info | A resolver failed: its `params.resolvers` names which, `lookupTables` included. |

No shared code's severity is changed. A durable nonce is its own code rather than `LONG_LIVED`: it is not a long
validity the user chose but a transaction anyone holding it can submit whenever they like, a pattern drainers use.

## Texts

`SOLANA_TEXTS` holds the package's own words, coded `solana.<group>.<key>`: an intent for each built-in instruction
(`solana.intent.createAccount`, `solana.intent.closeAccount`, `solana.intent.stake`, `solana.intent.configureToken`,
…), their summaries (`solana.summary.createTokenAccount`: "Create a {token} account for {owner}"), their field labels
(`solana.label.feePayer`, `solana.label.priorityFee`, `solana.label.newAuthority`, `solana.label.lookupTable`, …) and
units (`solana.unit.computeUnits`, `solana.unit.microLamports`, `solana.unit.bytes`, `solana.unit.basisPoints`). The
shared ones come first wherever they say it: `intent.send`, `intent.approve`, `intent.revoke`,
`intent.transferOwnership`, `intent.deploy`, `intent.contractCall`, `intent.batch`, `intent.signIn`,
`intent.signMessage`, their summaries, and labels such as `label.recipient`, `label.amount`, `label.spender`,
`label.owner`, `label.fee`, `label.nonce`, `label.domain`. An IDL's names are `external`. An authority type is shown as
the program's own name for it (`accountOwner`, `closeAccount`, `mintTokens`, `staker`, `withdrawer`).

## Resolvers

| Resolver | Asked | With |
| --- | --- | --- |
| `tokens` | For each mint an amount or account names | `{chain, address}`: the mint |
| `names` | For every address shown | `{chain, address}` |
| `descriptors` | Once per program no built-in decoder reads | `SolanaDescriptorQuery`: `{chain, programId}` |
| `lookupTables` | For each table a v0 transaction loads from that `addressLookupTables` does not give | `{chain, address}`: the table |
| `clock` | Once | For expiration times |

**IDLs.** The `descriptors` resolver answers with an Anchor IDL (`SolanaIdl`) for the program. `createIdlResolver`
builds one from IDLs the app holds:

```ts
import {createIdlResolver} from '@hzblj/crypto-clear-sign-solana'

const descriptors = createIdlResolver([{idl: routerIdl, id: 'registry/router@6.0.0', publisher: 'Router'}], {
  sha256: crypto.hash.sha256, // only for IDLs from before Anchor 0.30
})
```

What it reads of an IDL: the program `address` (an IDL for another program is ignored), each instruction's
`discriminator` (any length up to 32 bytes; the one whose discriminator starts the data, and only when exactly one
does), its `accounts` in order (groups flattened, `writable`, `signer`, `optional`, a fixed `address` that must be the
one passed), its `args` in Borsh, and the `types` they use: every primitive up to `u256`/`i256`, `f32`/`f64`, `bool`,
`string`, `bytes`, `pubkey`, `option`, `coption` (Anchor's, a `u32` tag), `vec`, `array` (with a constant or generic
length), defined structs (named or positional fields), enums (unit, named or positional variants), aliases and
generics. IDLs written before Anchor 0.30 (`publicKey`, a `defined` name as a string, `isMut`, `isSigner`,
`metadata.address`) read once `createIdlResolver` has given their instructions their discriminators, Anchor's
`sha256("global:" + snake_case(name))`. Only Borsh is read: a type with another serialization makes the IDL not
describe the instruction.

The instruction's **intent** is the IDL's name for it, its **fields** the arguments (amounts as numbers, keys as
addresses with their names, structs and vectors as lists) and then the accounts by the IDL's names (signers up front,
the rest secondary), bytes after the arguments are raw (`trailingData`), and the program is named by the IDL's
`metadata.name` when nothing else names it.

**An IDL is untrusted input.** Every part is checked as it is read, within `IDL_LIMITS` (names of up to 128
characters, 1,024 instructions and types, 256 accounts and arguments, types nested 32 deep, 1,024 values read from one
instruction). An IDL that is malformed, is for another program, has no instruction or two for the data, names more
accounts than the instruction has, or does not read the data to the end of its arguments is **ignored, not believed**:
the instruction is shown raw with `UNKNOWN_CONTRACT_CALL`. It never throws.

**What an IDL can and cannot make this say.** It names an instruction, its accounts and its arguments, and those
words are shown as they are (marked `external`, checked for hidden characters). It cannot describe Solana's own
programs, which the built-in decoders read first; it cannot remove a warning, set a risk or make an account `self`;
and it adds no warning of its own, because nothing in an IDL says what an instruction does with what it is given. An
instruction an IDL describes as `claim_reward` can still move everything the signing accounts allow it to. No
third-party IDL ships with this package.

## Trust

This reads what is signed; it does not run it. It cannot know what a program does with the accounts it is given (a
program the user signs for can move what those signatures allow), what an account holds now, whether a token
account's mint is what a token list says, whether a lookup table holds today what the app says it does, or whether an
IDL is honest. `sent` is what the built-in decoders read leaving the wallet, never more than that. Load token lists,
names, lookup tables and IDLs only from sources the app trusts, never from the dApp that asks for the signature.
[SECURITY.md](https://github.com/hzblj/crypto-clear-sign/blob/main/SECURITY.md) says what clear signing protects and
what it does not.

## Not in this version

- Simulation, balance changes, and fetching anything: lookup tables and IDLs are the app's.
- Confidential transfers, token metadata and token group instructions, and Token-2022's confidential extensions:
  shown raw.
- Stake's `setLockup`, `authorizeWithSeed` and their checked forms, `deactivateDelinquent`; System's newer
  instructions after `createAccountAllowPrefund`; the loader's `migrate` and `extendProgramChecked`: shown raw.
- Codama IDLs, and Anchor IDLs' `bytemuck` types, events, accounts and errors.
- Version 1 transactions (the adapter does not read them) and the `solana` CLI's older off-chain message format.
- A sign-in message's URI is shown, not compared with its domain.

[Documentation](https://github.com/hzblj/crypto-clear-sign#readme) · [Security](https://github.com/hzblj/crypto-clear-sign/blob/main/SECURITY.md)

The other libraries from the same author are at **[libraries.janblazej.dev](https://www.libraries.janblazej.dev)**.

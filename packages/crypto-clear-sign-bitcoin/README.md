# @hzblj/crypto-clear-sign-bitcoin

[![npm](https://img.shields.io/npm/v/@hzblj/crypto-clear-sign-bitcoin.svg)](https://www.npmjs.com/package/@hzblj/crypto-clear-sign-bitcoin)
[![license](https://img.shields.io/npm/l/@hzblj/crypto-clear-sign-bitcoin.svg)](https://github.com/hzblj/crypto-clear-sign/blob/main/LICENSE)

Bitcoin clear signing for [`@hzblj/crypto-clear-sign`](https://github.com/hzblj/crypto-clear-sign/tree/main/packages/crypto-clear-sign):
PSBTs (BIP-174 version 0, P2WPKH and Taproot alike) and messages (BIP-322 and legacy), read through the chain client
of [`@hzblj/crypto-bitcoin`](https://www.npmjs.com/package/@hzblj/crypto-bitcoin) into the shared display model. It
says whose coins are spent, who is paid and what is change, what the fee is, what each signature lets others change,
and where a coin's inscriptions and runes end up; runestones are deciphered as `ord` does.

```sh
npx expo install @hzblj/crypto-clear-sign @hzblj/crypto-clear-sign-bitcoin @hzblj/crypto-bitcoin @hzblj/nitro-crypto react-native-nitro-modules
```

`@hzblj/crypto-bitcoin` is a dependency (the parser it reads through); `@hzblj/nitro-crypto` is a peer, one engine
per app, which makes the chain client (`crypto.chains.bitcoin`) and passes it in.

## PSBTs

```ts
import {plainText} from '@hzblj/crypto-clear-sign'
import {clearSignPsbt} from '@hzblj/crypto-clear-sign-bitcoin'

const result = await clearSignPsbt(crypto.chains.bitcoin, psbt, {
  accounts: [
    {extendedKey: wallet.extendedPublicKey("m/84'/0'/0'"), fingerprint: wallet.fingerprint, path: "m/84'/0'/0'"},
    {extendedKey: wallet.extendedPublicKey("m/86'/0'/0'"), fingerprint: wallet.fingerprint, path: "m/86'/0'/0'"},
  ],
  resolvers, // names (the address book), tokens (rune ids), the clock: all optional
})

result.intent.text // 'Send'
result.summary?.text // 'Send 0.00025 BTC to bc1qksvw…'
result.risk // 'low'
plainText(result)
```

```text
Send: Send 0.00025 BTC to bc1qksvwqtkq0c2qhx2m5e0afmyh5jssefjtes9g4f
PSBT on Bitcoin. Risk: low.
Amount: 0.00025 BTC
Fee: 0.000002 BTC
Fee rate: 1.41 sat/vB
Input #0:
  From: bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr, this account
  Amount: 0.001 BTC
  Value verified: No
  Coin: 53a4718a9ca403aebd06173dcd5ec2351f819aa49731636e68c311fa787d6580:0
  Derivation path: m/86'/0'/0'/0/0
Estimated size: 142 vB
Replaceable (RBF): Yes
Transaction ID: 848809b04f52f1b55d125af3cf07e93264e72f42fcc3f2269b6d0baba5f483a5
Understood by: built-in decoder (psbt)
Actions:
  1. Send: Send 0.00025 BTC to bc1qksvwqtkq0c2qhx2m5e0afmyh5jssefjtes9g4f (risk: low)
     To: bc1qksvwqtkq0c2qhx2m5e0afmyh5jssefjtes9g4f, unknown address
     Amount: 0.00025 BTC
     Understood by: built-in decoder (psbt)
  2. Change: Return 0.000748 BTC to you as change (risk: none)
     To: bc1p3qkhfews2uk44qtvauqyr2ttdsw7svhkl9nkm9s9c3x4ax5h60wqwruhk7, this account
     Amount: 0.000748 BTC
     Derivation path: m/86'/0'/0'/1/0
     Understood by: built-in decoder (psbt)
Warnings:
  - low: The recipient is not one of your accounts, a contact or a known contract. (UNKNOWN_DESTINATION, in action 1, about To)
```

The payload is the PSBT's bytes, or its Base64 text. The result's `kind` is `psbt`:

- **The root** says what the whole does: "Send 0.00025 BTC to bc1q…" (or "to 3 recipients"), a consolidation ("Combine
  3 coins into 0.00059 BTC"), a transfer to yourself, a rune's etching or mint, or **"Sign part of a transaction"**
  when other wallets' coins are spent too, or when the signer's own signature leaves the transaction open
  (NONE, SINGLE, ANYONECANPAY): others complete it. Its fields are the amount sent to others (`amount`), with others'
  coins in it what the signer's accounts put in, get back and pay (`yourCoins`, `backToYou`, `net`), the fee (`fee`),
  the fee rate (`feeRate`, sat/vB), an absolute lock time (`lockTime`), every input as a list (`input-0`, …), and,
  behind "More details", the size (`size`), whether it is replaceable by fee (`replaceable`) and the transaction id
  (`txid`).
- **Each input** (`input-<n>`): the address it spends from (`-from`, `self` when it is the signer's), its value
  (`-amount`), whether that value is checked against the previous transaction (`-verified`), its signature type when
  the PSBT names one (`-sighash`), a relative lock (`-relativeLock`, BIP-68), the inscriptions and runes its coin
  holds (`-inscriptions`, `-runes`), the coin (`-outpoint`) and the derivation that made it the signer's
  (`-derivation`).
- **Each output is an action**, in order (`result.actions[i]` is output `#i`): a payment (`intent.send`, the
  recipient `to` and the `amount`), **change** (`bitcoin.intent.change`, `to` with `relation: 'self'`), a transfer to
  yourself (`bitcoin.intent.selfTransfer`: the signer's receiving address, or one the names resolver calls `own`),
  `OP_RETURN` data (`data`, as text when it reads as text), a runestone, or a script with no address (raw).
- **The fee** is exact; the fee rate divides it by the size: the signed transaction's when every input is signed
  and the adapter finalizes it, else an estimate from the inputs' scripts as the adapter makes its own (68 vB a
  P2WPKH input, 57.5 a Taproot key path, 148 P2PKH, 91 P2SH-P2WPKH) and the outputs' exact sizes. An input of
  another script (P2WSH, bare) leaves the rate out.

### Accounts: whose coins, and which output is change

`accounts` takes one account or several, of one wallet or more, P2WPKH and Taproot together, in three kinds:

| Account | Matched by | Change |
| --- | --- | --- |
| One address: a `BitcoinWatchAccount` or `BitcoinAccount` from the chain client | Its script | Verified |
| An account's extended public key: `{extendedKey, fingerprint, path}` (`m/84'/0'/0'`; `m/86'/…` is Taproot, or say `addressType`) | Each key the PSBT names at `<path>/0/<i>` or `<path>/1/<i>` under the fingerprint is **derived here** (the engine's public derivation) and checked to pay the script | Verified. A key the PSBT puts at the account's path that is not the key there is `bitcoin.FALSE_DERIVATION` |
| A master fingerprint: `{fingerprint, path?}` | Keys the PSBT names under it, checked to pay the script | **The PSBT's word**: `bitcoin.UNVERIFIED_CHANGE` |

The core's `signer` (an address) is one more account of the first kind. Pass extended keys: a fingerprint alone cannot
tell real change from an attacker's address the PSBT claims is yours. Without any account nothing is anyone's: every
output is a payment, and the review says so (`UNKNOWN_DESTINATION` on each).

A Taproot input of the signer's that signs without ANYONECANPAY commits to every coin's value (BIP-341), so a PSBT
lying about a P2WPKH coin's value makes it invalid; without one, a P2WPKH coin's value is checked only by its previous
transaction (`PSBT_IN_NON_WITNESS_UTXO`), and `bitcoin.UNVERIFIED_VALUES` says when it is missing.

### Inscriptions and runes

An app that indexes its user's coins (ord, a marketplace's API) says which hold inscriptions or runes, and the review
follows them: an inscription rides its sat (every input's sats fill the outputs in order, and what is left is the
fee), runes follow the runestone.

```ts
const result = await clearSignPsbt(crypto.chains.bitcoin, psbt, {
  accounts,
  assets: {assets: ({txid, vout}) => indexer.coin(txid, vout)}, // or a record keyed `txid:vout`
})
// {inscriptions: [{id: '…i0', offset: 0n}], runes: [{id: '840000:3', amount: 1_000n}]}
```

| Where they go | Warning |
| --- | --- |
| A stranger's output, or the fee (the miner's) | `ASSET_OWNERSHIP_TRANSFER` (critical), on that output, or on the root naming the input and the fee |
| A signature that leaves the transaction open (NONE, SINGLE, ANYONECANPAY): a marketplace listing, say | `ASSET_OWNERSHIP_TRANSFER`, naming the input and its signature type |
| An `OP_RETURN` output, a cenotaph, or no output to take runes | `bitcoin.ASSET_BURNED` (critical) |
| A coin's value before them is missing | `bitcoin.ASSET_DESTINATION_UNKNOWN` (high) |
| Only the signer's outputs | `bitcoin.ASSET_KEPT` (info) |

An inscription without an `offset` counts as on every sat of its coin. Runes are followed without amounts: every
output an edict of a held rune names, and the pointer or the first output that is not `OP_RETURN`, counts (a rune
without an `id` matches every edict). Only the signer's coins are followed (every coin, without accounts).

### Runestones

The first output whose script is `OP_RETURN OP_13` is deciphered exactly as ord does (its data pushes concatenated,
LEB128 integers, tags, the body's edicts), and checked against ord's own test cases. A runestone shows its etching
(the rune's spaced name, divisibility, symbol, premine, mint terms), its mint, every edict (`edict-<n>`: the rune,
the amount, the output, or "all remaining", or "split across outputs") and its pointer. A rune id is looked up in the
token list as its `address` (`840000:3`): with an answer its amounts have decimals and a symbol, without one they are
base units and `UNKNOWN_TOKEN`. Runes an edict or the pointer sends to an `OP_RETURN` output are
`bitcoin.RUNES_BURNED`. A **cenotaph** (a malformed runestone, which burns every rune the inputs hold) is
`bitcoin.CENOTAPH`, with its flaw in ord's words (`unrecognized-even-tag`, `varint`, `opcode`, `edict-output`,
`edict-rune-id`, `trailing-integers`, `truncated-field`, `unrecognized-flag`, `supply-overflow`, `invalid-script`).

### Fees, lock times

`HIGH_FEE` (medium) when the fee rate is above `maxFeeRate` (500 sat/vB), the fee above `maxFee` (1,000,000 sats,
0.01 BTC), or the fee is above 10,000 sats and more than `maxFeePercent` (10) percent of what is sent to others (of
what moves, when nothing is). The floor keeps dust-sized payments, such as an inscription's 546-sat postage, from
being judged by their share. A signature that leaves the transaction open is not judged: its fee is a draft's.

An absolute lock time binds when an input's sequence is not final: by height below 500,000,000 (judged against
`tipHeight` when the app gives it), else a Unix time (judged by the clock). Ahead of now it is `bitcoin.TIMELOCKED`
(info); more than 30 days ahead (4,320 blocks), `bitcoin.FAR_FUTURE_LOCKTIME` (medium): a signed transaction that
stays usable for whoever holds it. Relative locks (BIP-68) are shown per input; replaceability (BIP-125) on the root.

## Messages

```ts
import {clearSignMessage} from '@hzblj/crypto-clear-sign-bitcoin'

const result = await clearSignMessage(crypto.chains.bitcoin, 'Hello from Expo', {address: account.address})
```

```text
Sign message: Sign a message
Message on Bitcoin. Risk: none.
Message: Hello from Expo
Account: bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu, this account
Format: BIP-322
Understood by: built-in decoder (bip322)
```

The payload is text or bytes, the message a BIP-322 (or, with `format: 'legacy'`, a BIP-137) signature signs, for
`address` (the `signer` unless given). The result's `kind` is `message`: the text (`message`), the account
(`signer`, with its relation) and the format. Text with hidden characters is `HIDDEN_CHARACTERS`; bytes that are not
UTF-8 (shown raw) and text that is only hex (16 bytes or more) are `BLIND_SIGNING`.

A sign-in message in the form CAIP-122 (Sign-In With X) gives Bitcoin (EIP-4361's text for the `bip122` namespace:
`example.com wants you to sign in with your Bitcoin account:`) is `intent.signIn` ("Sign in to example.com"), read into
`domain`, `account`, `statement`, `uri`, `network`, `nonce`, `issuedAt`, `expiry`, `notBefore`, `requestId`,
`resources`, and the whole text (`message`, secondary). It names another account than the one signing:
`bitcoin.SIGN_IN_MISMATCH` (high); past its expiry: `EXPIRED`; for another chain: `CHAIN_MISMATCH`. Other requests
(an exchange's BIP-322 proof of address, say) have no standard text: they are messages, shown as such.

## Networks

The chain is `{family: 'bitcoin', id, name}`, its id CAIP-2 (`bip122:` and the first 32 hex characters of the genesis
block's hash, `BITCOIN_CHAIN_IDS`):

| The adapter's network | `id` | `name` |
| --- | --- | --- |
| `mainnet` | `bip122:000000000019d6689c085ae165831e93` | Bitcoin |
| `testnet` (by default) | `bip122:00000000da84f2bafbbc53dee25a72ae` | Bitcoin Testnet4 |
| `testnet` with `{testnet: 'testnet3'}` | `bip122:000000000933ea01ad0ee984209779ba` | Bitcoin Testnet3 |
| `signet` | `bip122:00000008819873e925422c1ff0f99f7c` | Bitcoin Signet |
| `regtest` | `bip122:0f9188f13cb7b2c71f2a335e3a4fc328` | Bitcoin Regtest |

The adapter's `testnet` is one set of addresses for two chains: testnet4 unless the `testnet` option says testnet3.
Amounts are `BTC` on mainnet and `tBTC` on every test network, 8 decimals, base unit `sat`.

## What it recognizes

| Decoder (`source.decoder`) | Reads | Intent, fields, warnings |
| --- | --- | --- |
| `psbt` | The PSBT (the root) and each output with an address | `intent.send`, `bitcoin.intent.change`, `bitcoin.intent.selfTransfer`, `bitcoin.intent.consolidate`, `bitcoin.intent.signPart`; inputs, outputs, fee, locks |
| `op-return` | `OP_RETURN` data that is not a runestone | `bitcoin.intent.data` (`bitcoin.intent.burn` with bitcoin in it); `data` as text or raw |
| `runestone` | The first `OP_RETURN OP_13` output | `bitcoin.intent.runestone`, `bitcoin.intent.etchRune`, `bitcoin.intent.mintRune`; etching, mint, edicts, pointer; `bitcoin.CENOTAPH`, `bitcoin.RUNES_BURNED`, `UNKNOWN_TOKEN` |
| `bip322`, `bip137` | A message's text | `intent.signMessage`; `HIDDEN_CHARACTERS`, `BLIND_SIGNING` (hex) |
| `caip122` | A sign-in message | `intent.signIn`; its fields; `bitcoin.SIGN_IN_MISMATCH`, `EXPIRED` |

Anything else is shown raw with `source: {kind: 'unknown'}`: an output whose script has no address
(`bitcoin.intent.unknownScript`, `bitcoin.NO_ADDRESS_OUTPUT`), a message that is not text (`BLIND_SIGNING`).

## Warnings

| Code | Severity | When |
| --- | --- | --- |
| `ASSET_OWNERSHIP_TRANSFER` | critical | A protected coin's inscription or runes go to a stranger or the fee, or its signature leaves the transaction open |
| `bitcoin.ASSET_BURNED` | critical | A protected coin's inscription or runes are destroyed |
| `bitcoin.BURN` | critical | An `OP_RETURN` output carries bitcoin |
| `bitcoin.CENOTAPH` | critical | A malformed runestone: every rune the inputs hold is burned |
| `bitcoin.RUNES_BURNED` | critical | An edict or the pointer sends runes to an `OP_RETURN` output |
| `bitcoin.SIGHASH_NONE` | critical | A signer's input signs NONE (with or without ANYONECANPAY), or SINGLE with no output at its index (SegWit v0, legacy): its outputs can be replaced |
| `bitcoin.ASSET_DESTINATION_UNKNOWN` | high | Where a protected coin's assets go cannot be worked out: a value before them is missing |
| `bitcoin.FALSE_DERIVATION` | high | The PSBT names a key at one of the signer's account paths that is not the key there |
| `bitcoin.NO_ADDRESS_OUTPUT` | high | An output pays a script with no address that is not `OP_RETURN` |
| `bitcoin.SIGHASH_SINGLE` | high | A signer's input signs SINGLE: only the output at its index is fixed |
| `bitcoin.SIGHASH_SINGLE_ANYONECANPAY` | high | A signer's input signs SINGLE\|ANYONECANPAY: an offer, as marketplaces (and scams) list |
| `bitcoin.SIGN_IN_MISMATCH` | high | A sign-in message names another account than the one signing |
| `bitcoin.UNKNOWN_SCRIPT_TYPE` | high | A payment to a SegWit version nothing defines yet (anyone can spend it) |
| `bitcoin.UNUSUAL_SIGHASH` | high | A signer's input asks for a type outside the standard ones (DEFAULT on a P2WPKH coin, SINGLE past the outputs on Taproot) |
| `BLIND_SIGNING` | high | A message that is not text, or only hex |
| `HIGH_FEE` | medium | Above the fee limits above |
| `HIDDEN_CHARACTERS` | medium | A message, or a rune's symbol, with hidden characters |
| `UNKNOWN_TOKEN` | medium | A rune amount the token list does not know |
| `bitcoin.FAR_FUTURE_LOCKTIME` | medium | A lock time more than 30 days ahead |
| `bitcoin.NO_OWN_INPUTS` | medium | Accounts were given and none of the inputs is theirs |
| `bitcoin.SIGHASH_ANYONECANPAY` | medium | A signer's input signs ALL\|ANYONECANPAY: others can add inputs |
| `bitcoin.UNKNOWN_FEE` | medium | An input does not state its coin's value |
| `bitcoin.UNVERIFIED_CHANGE` | medium | Change found by a fingerprint alone: the PSBT's word |
| `bitcoin.UNVERIFIED_VALUES` | medium | A signer's P2WPKH coin without its previous transaction, and no Taproot signature vouching for every value |
| `EXPIRED` | low | A sign-in message past its expiry |
| `UNKNOWN_DESTINATION` | low | A payment to an address that is not the signer's, the user's, a contact or a known contract |
| `bitcoin.DUPLICATE_OUTPUT` | low | Several outputs pay the same address |
| `bitcoin.DUST_OUTPUT` | low | An output below its script's dust limit (`dustThreshold`): nodes do not relay it |
| `bitcoin.FOREIGN_INPUTS` | low | Some inputs spend other wallets' coins |
| `RESOLVER_FAILED` | info | A resolver (`names`, `tokens`, or `assets`) threw or answered nonsense |
| `bitcoin.ADDRESS_REUSE` | info | An output pays an address an input spends from |
| `bitcoin.ASSET_KEPT` | info | A protected coin's assets stay with the signer |
| `bitcoin.TIMELOCKED` | info | A lock time ahead of now, or of the tip |

Signature types are judged on the signer's inputs only (on every input when no account is given); others' are shown.
No shared code's severity is changed. Each warning names the action it is about (the output, or the root for inputs,
the fee and locks) and its fields (`input-1-sighash`, `to`, `edict-0`).

## Texts

Its own, in `BITCOIN_TEXTS`: intents `bitcoin.intent.burn`, `change`, `consolidate`, `data`, `etchRune`, `mintRune`,
`runestone`, `selfTransfer`, `signPart`, `unknownScript`; summaries of the same names and `bitcoin.summary.cenotaph`,
`sendMany`; labels from `bitcoin.label.allOutputs` to `bitcoin.label.youReceive` (inputs, fee rate, sizes, lock times,
runestone fields, sign-in extras); units `bitcoin.unit.blocks`, `satPerVbyte`, `vbytes`. Shared ones it uses:
`intent.send`, `intent.signMessage`, `intent.signIn`, `intent.unknown`; `summary.send`, `summary.signMessage`,
`summary.signIn`, `summary.blind`; `label.amount`, `fee`, `to`, `from`, `data`, `message`, `account`, `domain`,
`statement`, `uri`, `network`, `nonce`, `issuedAt`, `expiry`, `notBefore`.

## Resolvers

| Resolver | Asked | With |
| --- | --- | --- |
| `names` | Every address of an input or output, and a message's account | `{chain, address}`: a contact is no unknown destination, `own` makes an output a transfer to yourself |
| `tokens` | Every rune id a runestone names | `{chain, address: '840000:3'}`: `{symbol, decimals, name}` of the rune |
| `assets` (this package's option) | Every input's coin | `{chain, txid, vout}`: `{inscriptions?, runes?}` |
| `clock` | Once | Time lock times and sign-in expiries |

There are no descriptors for Bitcoin. Answers are checked for shape (a name without hidden characters, an
inscription id `<txid>i<n>`, a rune id `<block>:<tx>`, amounts that are bigints 0 or more), and a resolver that
fails counts as no answer, with `RESOLVER_FAILED`. What they say is shown as fact: an address book entry an attacker
planted names their address, an indexer that misses an inscription lets it be spent as plain bitcoin.

## Trust

What it reads is what is signed: the PSBT's bytes, through the adapter's strict parser. What it cannot know: whether
a coin exists or is unspent, its value when the PSBT gives it without its previous transaction (P2WPKH), what a
script with no address does, which runes and inscriptions a coin holds (the app's indexer says), and whether a
fingerprint-only account's change is really the user's. Change is verified only against extended keys or single
addresses. See [SECURITY.md](https://github.com/hzblj/crypto-clear-sign/blob/main/SECURITY.md).

Errors (`ClearSignError`): `INVALID_INPUT` for what the adapter refuses (its error is the `cause`; a PSBT version 2,
and a PSBT whose outputs are more than its inputs, are among them), `CHAIN_MISMATCH` for a message address of another
network or a sign-in message for another chain, `INVALID_ARGUMENT` for an option out of range.

**Not in this version:** PSBT version 2 (the adapter reads version 0), Taproot script paths and their leaves (an
inscription's reveal is shown as a spend of its commit coin, not as the inscription), multisig and other scripts'
ownership (P2WSH, P2SH: a coin of them is never the signer's), the exact fee rate of inputs it cannot size, rune
amounts held by coins (destinations are conservative), BRC-20 and other protocols in inscriptions, `OP_RETURN`
protocols other than Runes (shown as data), and simulation: what a coin holds and whether it is spent is the app's
to know.

[Documentation](https://github.com/hzblj/crypto-clear-sign#readme) · [Security](https://github.com/hzblj/crypto-clear-sign/blob/main/SECURITY.md)

The other libraries from the same author are at **[libraries.janblazej.dev](https://www.libraries.janblazej.dev)**.

# @hzblj/crypto-clear-sign-bitcoin

[![npm](https://img.shields.io/npm/v/@hzblj/crypto-clear-sign-bitcoin.svg)](https://www.npmjs.com/package/@hzblj/crypto-clear-sign-bitcoin)
[![license](https://img.shields.io/npm/l/@hzblj/crypto-clear-sign-bitcoin.svg)](https://github.com/hzblj/crypto-clear-sign/blob/main/LICENSE)

Reads Bitcoin PSBTs (P2WPKH and Taproot) and messages (BIP-322, legacy, CAIP-122 sign-in) into the
[`@hzblj/crypto-clear-sign`](https://github.com/hzblj/crypto-clear-sign/tree/main/packages/crypto-clear-sign) display
model: whose coins are spent, who is paid, what is change, the fee, and where inscriptions and runes go.

## Install

```sh
npx expo install @hzblj/crypto-clear-sign @hzblj/crypto-clear-sign-bitcoin @hzblj/crypto-bitcoin @hzblj/nitro-crypto react-native-nitro-modules
```

## Quick start

```ts
import {bitcoinAdapter} from '@hzblj/crypto-bitcoin'
import {plainText} from '@hzblj/crypto-clear-sign'
import {clearSignPsbt} from '@hzblj/crypto-clear-sign-bitcoin'
import {createCryptoEngine} from '@hzblj/nitro-crypto'

const crypto = createCryptoEngine({adapters: [bitcoinAdapter()]})
const wallet = await crypto.createEphemeralWallet({mnemonic})

const result = await clearSignPsbt(crypto.chains.bitcoin, psbt, {
  accounts: [
    {extendedKey: wallet.extendedPublicKey("m/84'/0'/0'"), fingerprint: wallet.fingerprint, path: "m/84'/0'/0'"},
    {extendedKey: wallet.extendedPublicKey("m/86'/0'/0'"), fingerprint: wallet.fingerprint, path: "m/86'/0'/0'"},
  ],
})

result.intent.text // 'Send'
result.summary?.text // 'Send 0.00025 BTC to bc1qksvw…'
result.actions // one per output, in order: a payment, change, data, a runestone
plainText(result) // inputs, outputs, fee and fee rate, warnings
```

## API

| Export | What it does |
| --- | --- |
| `clearSignPsbt(chain, psbt, options?)` | A PSBT (version 0), as bytes or Base64: inputs, outputs, change, fee and fee rate, signature types, lock times, runestones, offers. |
| `clearSignMessage(chain, message, {address?, format?})` | Text or bytes a BIP-322 (or `format: 'legacy'`, BIP-137) signature signs; a CAIP-122 sign-in is `intent.signIn`. |
| `BITCOIN_WARNINGS`, `BITCOIN_TEXTS` | Its own warning and text codes (`bitcoin.*`), to branch on and translate. |
| `BITCOIN_CHAIN_IDS` | The CAIP-2 id of each network: what resolvers key tokens and names by. |
| `DEFAULT_MAX_FEE`, `DEFAULT_MAX_FEE_PERCENT`, `DEFAULT_MAX_FEE_RATE` | The `HIGH_FEE` defaults. |

Types you may name: `BitcoinClearSignOptions`, `BitcoinSigningAccount`, `BitcoinAssetResolver`, `BitcoinCoinAssets`,
`BitcoinWarningCode`.

Errors (`ClearSignError`): `INVALID_INPUT` for what the adapter refuses (a PSBT version 2 too), `CHAIN_MISMATCH` for a
message address or sign-in of another network, `INVALID_ARGUMENT` for an option out of range.

## Warnings

Its own codes; the shared ones are in the [core's README](https://github.com/hzblj/crypto-clear-sign/tree/main/packages/crypto-clear-sign#warnings),
at their default severities. Signature types are judged on the signer's inputs only (every input without
accounts).

| Code | Severity | When |
| --- | --- | --- |
| `bitcoin.ASSET_BURNED` | critical | A protected coin's inscription or runes are destroyed. |
| `bitcoin.BURN` | critical | An `OP_RETURN` output carries bitcoin. |
| `bitcoin.CENOTAPH` | critical | A malformed runestone: every rune the inputs hold is burned. |
| `bitcoin.RUNES_BURNED` | critical | An edict or the pointer sends runes to an `OP_RETURN` output. |
| `bitcoin.SIGHASH_NONE` | critical | An input signs NONE (or SINGLE with no output at its index): its outputs can be replaced. |
| `bitcoin.ASSET_DESTINATION_UNKNOWN` | high | Where a protected coin's assets go cannot be worked out. |
| `bitcoin.FALSE_DERIVATION` | high | The PSBT names a key at one of your account paths that is not the key there. |
| `bitcoin.NO_ADDRESS_OUTPUT` | high | An output pays a script with no address that is not `OP_RETURN`. |
| `bitcoin.SIGHASH_SINGLE` | high | An input signs SINGLE: only the output at its index is fixed. |
| `bitcoin.SIGHASH_SINGLE_ANYONECANPAY` | high | An input signs SINGLE\|ANYONECANPAY: an offer, as marketplaces (and scams) list. |
| `bitcoin.SIGN_IN_MISMATCH` | high | A sign-in message names another account than the one signing. |
| `bitcoin.UNKNOWN_SCRIPT_TYPE` | high | A payment to a SegWit version nothing defines yet: anyone can spend it. |
| `bitcoin.UNUSUAL_SIGHASH` | high | An input asks for a signature type outside the standard ones. |
| `bitcoin.FAR_FUTURE_LOCKTIME` | medium | A lock time more than 30 days ahead. |
| `bitcoin.NO_OWN_INPUTS` | medium | Accounts were given and none of the inputs is theirs. |
| `bitcoin.SIGHASH_ANYONECANPAY` | medium | An input signs ALL\|ANYONECANPAY: others can add inputs. |
| `bitcoin.UNKNOWN_FEE` | medium | An input does not state its coin's value. |
| `bitcoin.UNVERIFIED_CHANGE` | medium | Change found by a fingerprint alone. |
| `bitcoin.UNVERIFIED_VALUES` | medium | A P2WPKH coin of the signer's without its previous transaction, and no Taproot signature vouching for it. |
| `bitcoin.DUPLICATE_OUTPUT` | low | Several outputs pay the same address. |
| `bitcoin.DUST_OUTPUT` | low | An output below its script's dust limit: nodes do not relay it. |
| `bitcoin.FOREIGN_INPUTS` | low | Some inputs spend other wallets' coins. |
| `bitcoin.ADDRESS_REUSE` | info | An output pays an address an input spends from. |
| `bitcoin.ASSET_KEPT` | info | A protected coin's assets stay with the signer. |
| `bitcoin.TIMELOCKED` | info | A lock time ahead of now, or of the tip. |

## Options

Besides the core's `signer` (an address) and `resolvers`:

| Option | What it does |
| --- | --- |
| `accounts` | The signer's accounts, one or several: an address (`BitcoinWatchAccount`), an extended key `{extendedKey, fingerprint, path}`, or a fingerprint `{fingerprint, path?}`. Pass extended keys: change found by a fingerprint alone is the PSBT's word (`bitcoin.UNVERIFIED_CHANGE`). Without accounts, every output is a payment. |
| `assets` | Which coins hold inscriptions or runes, from your indexer: `{assets: ({txid, vout}) => …}`, or a record keyed `txid:vout`. |
| `resolvers.tokens` | Asked with a rune id as the `address` (`840000:3`), for its symbol and decimals. |
| `testnet` | `'testnet4'` (default) or `'testnet3'`: which chain id the adapter's `testnet` gets. |
| `tipHeight` | The best block's height, to judge lock times by height. |
| `maxFeeRate`, `maxFee`, `maxFeePercent` | `HIGH_FEE` above 500 sat/vB, above 1,000,000 sats, or above 10 % of what is sent (only for fees over 10,000 sats). |
| `address`, `format` | Messages: the address signed for (the `signer` unless given), `'bip322'` (default) or `'legacy'`. |

```ts
const result = await clearSignPsbt(crypto.chains.bitcoin, psbt, {
  accounts,
  assets: {assets: ({txid, vout}) => indexer.coin(txid, vout)}, // {inscriptions: [{id, offset}], runes: [{id, amount}]}
})
```

What the `names`, `tokens` and `assets` resolvers answer is shown as fact: an indexer that misses an inscription lets it
be spent as plain bitcoin ([SECURITY.md](https://github.com/hzblj/crypto-clear-sign/blob/main/SECURITY.md)).

## Not supported

- PSBT version 2 (the adapter reads version 0).
- Taproot script paths: an inscription's reveal shows as a spend of its commit coin.
- Ownership of multisig and other scripts (P2WSH, P2SH): such a coin is never the signer's.
- A fee rate for inputs it cannot size (P2WSH, bare scripts): it is left out.
- Rune amounts held by coins (where runes go is judged conservatively), BRC-20, and `OP_RETURN` protocols other than
  Runes (shown as data).
- Simulation: whether a coin exists, is unspent and what it holds is the app's to know.

[Security](https://github.com/hzblj/crypto-clear-sign/blob/main/SECURITY.md) · [Compatibility](https://github.com/hzblj/crypto-clear-sign/blob/main/docs/compatibility.md) · [Decisions](https://github.com/hzblj/crypto-clear-sign/tree/main/docs/adr) · [MIT](https://github.com/hzblj/crypto-clear-sign/blob/main/LICENSE)

The other libraries from the same author are at **[libraries.janblazej.dev](https://www.libraries.janblazej.dev)**.

# crypto-clear-sign

[![npm](https://img.shields.io/npm/v/@hzblj/crypto-clear-sign.svg)](https://www.npmjs.com/package/@hzblj/crypto-clear-sign)
[![license](https://img.shields.io/npm/l/@hzblj/crypto-clear-sign.svg)](./LICENSE)

Clear signing for React Native and Expo, as data. Before a wallet signs an Ethereum transaction, EIP-712 typed data,
a Solana transaction or a Bitcoin PSBT, it shows what the signature does: "Allow Uniswap to spend an unlimited amount
of USDC", marked critical, instead of "call data 0x095ea7b3…". The chain packages read what is about to be signed
through [`@hzblj/nitro-crypto`](https://github.com/hzblj/nitro-crypto)'s adapters into one display model (an intent,
fields, nested actions, warnings with stable codes, a risk level), and every UI renders that model. Headless: no UI,
no network.

| Package | What it is |
| --- | --- |
| [`@hzblj/crypto-clear-sign`](./packages/crypto-clear-sign/README.md) | The display model every chain package returns and every UI renders, its helpers (exact amounts, translations, plain text), the shared warning codes, and the resolver interfaces. No dependencies; installs alone. |
| [`@hzblj/crypto-clear-sign-ethereum`](./packages/crypto-clear-sign-ethereum/README.md) | Transactions of every type, EIP-712 typed data and personal messages; ERC-7730 descriptors. |
| [`@hzblj/crypto-clear-sign-solana`](./packages/crypto-clear-sign-solana/README.md) | Legacy and v0 transactions, messages and off-chain messages; IDLs. |
| [`@hzblj/crypto-clear-sign-bitcoin`](./packages/crypto-clear-sign-bitcoin/README.md) | PSBTs (P2WPKH and Taproot), with runestones and the inscriptions and runes of the signer's coins; messages (BIP-322, legacy, CAIP-122 sign-in). |

```sh
npx expo install @hzblj/crypto-clear-sign @hzblj/crypto-clear-sign-ethereum @hzblj/crypto-ethereum @hzblj/nitro-crypto react-native-nitro-modules
```

```ts
import {localize, plainText} from '@hzblj/crypto-clear-sign'
import {clearSignTransaction} from '@hzblj/crypto-clear-sign-ethereum'

const result = await clearSignTransaction(crypto.chains.ethereum, unsigned, {resolvers, signer: account.address})
result.intent.text // 'Approve'
result.summary?.text // 'Allow Uniswap to spend an unlimited amount of USDC'
result.risk // 'critical'
result.warnings.map(warning => warning.code) // ['UNLIMITED_APPROVAL']
plainText(result) // the whole review as text, for screen readers and logs
```

Resolvers are how an app adds what the bytes do not say (token symbols, names and the address book, ERC-7730
descriptors and IDLs, the clock). None is required, and each is a trust boundary: what it answers is shown as fact.
[SECURITY.md](./SECURITY.md) says what clear signing protects and what it cannot (decoding is not simulation, and a
descriptor can lie).

## This repository

| Path | What lives there |
| --- | --- |
| `packages/crypto-clear-sign/`, `crypto-clear-sign-ethereum/`, `-solana/`, `-bitcoin/` | The packages, each published on its own |
| `apps/example/` | The example app (private) |
| `scripts/` | The pack check, version sync |
| `docs/` | [The chain package contract](./docs/chain-package-contract.md), [compatibility](./docs/compatibility.md), [decisions](./docs/adr) |

```sh
yarn                 # install
yarn test            # every package's tests (the chain packages on the engine compiled to WebAssembly)
yarn typecheck       # tsc
yarn lint            # Biome and tsc, per package
yarn pack:check      # what npm receives, and each package's consumer type-checked against it
```

## More libraries

The other libraries from the same author are at **[libraries.janblazej.dev](https://www.libraries.janblazej.dev)**.

[Security](./SECURITY.md) · [MIT](./LICENSE)

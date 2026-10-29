# crypto-clear-sign

[![npm](https://img.shields.io/npm/v/@hzblj/crypto-clear-sign.svg)](https://www.npmjs.com/package/@hzblj/crypto-clear-sign)
[![license](https://img.shields.io/npm/l/@hzblj/crypto-clear-sign.svg)](./LICENSE)

Clear signing for React Native and Expo, as data: before a wallet signs an Ethereum transaction, typed data, a Solana
transaction or a Bitcoin PSBT, it shows what the signature does ("Allow Uniswap to spend an unlimited amount of USDC",
marked critical) instead of `0x095ea7b3…`. The chain packages read what is signed into one display model (intent,
fields, actions, warnings with stable codes, risk), and your UI renders it.

| Package | What it is |
| --- | --- |
| [`@hzblj/crypto-clear-sign`](./packages/crypto-clear-sign/README.md) | The display model, its helpers (exact amounts, translations, plain text), the shared warning codes, the resolver interfaces. No dependencies. |
| [`@hzblj/crypto-clear-sign-ethereum`](./packages/crypto-clear-sign-ethereum/README.md) | Transactions of every type, EIP-712 typed data, personal messages with Sign-In with Ethereum, EIP-7702 authorizations; ERC-7730 descriptors, bundled or online, rendered by [`@ethereum-sourcify/clear-signing`](https://github.com/sourcifyeth/clear-signing). |
| [`@hzblj/crypto-clear-sign-solana`](./packages/crypto-clear-sign-solana/README.md) | Legacy and v0 transactions, messages and off-chain messages; IDLs. |
| [`@hzblj/crypto-clear-sign-bitcoin`](./packages/crypto-clear-sign-bitcoin/README.md) | PSBTs (P2WPKH and Taproot) with inscriptions and runes; messages (BIP-322, legacy, CAIP-122 sign-in). |

```sh
npx expo install @hzblj/crypto-clear-sign @hzblj/crypto-clear-sign-ethereum @hzblj/crypto-ethereum @hzblj/nitro-crypto react-native-nitro-modules
```

```ts
import {plainText} from '@hzblj/crypto-clear-sign'
import {clearSignTransaction} from '@hzblj/crypto-clear-sign-ethereum'
import {ethereumAdapter} from '@hzblj/crypto-ethereum'
import {createCryptoEngine} from '@hzblj/nitro-crypto'

const crypto = createCryptoEngine({adapters: [ethereumAdapter()]})
const result = await clearSignTransaction(crypto.chains.ethereum, unsigned, {resolvers, signer: account.address})

result.summary?.text // 'Allow Uniswap to spend an unlimited amount of USDC'
result.risk // 'critical'
result.warnings.map(warning => warning.code) // ['UNLIMITED_APPROVAL']
plainText(result) // the whole review as text
```

## The example

`apps/example` is an Expo app (built with [`@hzblj/kara-ui`](https://www.kara.janblazej.dev)) that reviews real-world
signing requests on Ethereum, Solana and Bitcoin; nothing is signed or broadcast. It has a gallery per chain, Paste
(any payload as hex, Base64, JSON or text) and Settings (signers, resolvers on or off, Czech through `localize`). Its
review components in `apps/example/src/components/clear-signing` (`ClearSigningView`, `RiskBadge`, `WarningList`,
`FieldRow`, `ActionTree`) are written to be copied into a wallet.

<p>
  <img alt="The Ethereum gallery: each signing request with its risk" height="560" src="media/ios-gallery.png" />
  <img alt="An unlimited approval's review: critical, the warning pointing at the amount and the spender" height="560" src="media/ios-review.png" />
  <img alt="The same review on Android" height="560" src="media/android-review.png" />
</p>

## This repository

```sh
yarn                 # install
yarn test            # every package's tests, and the example's samples through all of them
yarn typecheck       # tsc
yarn lint            # Biome and tsc, per package
yarn pack:check      # what npm receives, and each package's consumer type-checked against it
yarn ios             # the example on the iOS simulator (yarn android for Android)
```

Docs: [the chain package contract](./docs/chain-package-contract.md), [compatibility](./docs/compatibility.md),
[decisions](./docs/adr).

## More libraries

The other libraries from the same author are at **[libraries.janblazej.dev](https://www.libraries.janblazej.dev)**.

## Sponsorship

<a href="https://www.buymeacoffee.com/hzblj"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me a Coffee" height="48"></a>

[Security](./SECURITY.md) · [MIT](./LICENSE)

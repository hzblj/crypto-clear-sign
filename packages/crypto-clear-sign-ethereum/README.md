# @hzblj/crypto-clear-sign-ethereum

[![npm](https://img.shields.io/npm/v/@hzblj/crypto-clear-sign-ethereum.svg)](https://www.npmjs.com/package/@hzblj/crypto-clear-sign-ethereum)
[![license](https://img.shields.io/npm/l/@hzblj/crypto-clear-sign-ethereum.svg)](https://github.com/hzblj/crypto-clear-sign/blob/main/LICENSE)

Reads Ethereum and EVM transactions, EIP-712 typed data, personal messages (with Sign-In with Ethereum) and EIP-7702
authorizations into the [`@hzblj/crypto-clear-sign`](https://github.com/hzblj/crypto-clear-sign/tree/main/packages/crypto-clear-sign)
display model, with risk warnings.

## Install

```sh
npx expo install @hzblj/crypto-clear-sign @hzblj/crypto-clear-sign-ethereum @hzblj/crypto-ethereum @hzblj/nitro-crypto react-native-nitro-modules
```

## Quick start

```ts
import {plainText} from '@hzblj/crypto-clear-sign'
import {clearSignTransaction} from '@hzblj/crypto-clear-sign-ethereum'
import {registryResolver} from '@hzblj/crypto-clear-sign-ethereum/registry'
import {ethereumAdapter} from '@hzblj/crypto-ethereum'
import {createCryptoEngine} from '@hzblj/nitro-crypto'

const crypto = createCryptoEngine({adapters: [ethereumAdapter()]})
const result = await clearSignTransaction(crypto.chains.ethereum, unsigned, {
  resolvers: {descriptors: registryResolver(), names, tokens},
  signer: account.address,
})

result.summary?.text // 'Allow 0x68b3…Fc45 to spend an unlimited amount of USDC'
result.risk // 'critical'
result.warnings.map(warning => warning.code) // ['UNLIMITED_APPROVAL', 'ethereum.UNKNOWN_SPENDER']
plainText(result)
```

Built-in decoders read ERC-20, ERC-721 and ERC-1155 transfers and approvals, WETH, Permit2, multicalls, Safe
MultiSend, smart account batches, ownership and proxy upgrades, EIP-2612 and DAI permits, Sign-In with Ethereum and
EIP-7702 delegations. They always come first: a descriptor can never relabel an approval. Everything else is read by
ERC-7730 descriptors, rendered by [`@ethereum-sourcify/clear-signing`](https://github.com/sourcifyeth/clear-signing),
the reference implementation; nested calls inside them are described by the built-ins again. What nothing reads is
shown raw with `UNKNOWN_CONTRACT_CALL` or `BLIND_SIGNING`.

## API

| Export | What it does |
| --- | --- |
| `clearSignTransaction(chain, transaction, options?)` | Unsigned transaction bytes, or a request (serialized and read back). Legacy, EIP-2930, EIP-1559, EIP-7702. |
| `clearSignTypedData(chain, typedData, options?)` | EIP-712 typed data (an `eth_signTypedData_v4` request, parsed). |
| `clearSignMessage(chain, message, options?)` | A `personal_sign` message, text or bytes; ERC-4361 sign-in requests are checked. |
| `clearSignAuthorization(chain, authorization, options?)` | An EIP-7702 authorization signed on its own. |
| `createDescriptorResolver(files, {publisher?})` | A `descriptors` resolver from ERC-7730 files: includes merged, later files override earlier ones, `rejected` lists files it cannot use. |
| `mergeDescriptors(base, overlay)` | ERC-7730's include merge. |
| `fetchPrebuiltRegistryIndex()` | The online registry's index, from `@ethereum-sourcify/clear-signing`, for the `sourcify` option. |
| `ETHEREUM_WARNINGS`, `ETHEREUM_TEXTS` | Its own warning and text codes (`ethereum.*`), to branch on and translate. |
| `ETHEREUM_TOKENS`, `PERMIT2`, `MULTICALL3` | The built-in token list and well-known addresses. |
| `ETHEREUM_REGISTRY`, `REGISTRY_SOURCE`, `registryResolver(extra?)` | From `/registry`: the bundled descriptors, where they come from, and a resolver over them. |

Types you may name: `EthereumClearSignOptions`, `EthereumDescriptorQuery`, `Erc7730Descriptor`, `Erc7730File`,
`SourcifyOptions`, `EthereumWarningCode`.

Errors (`ClearSignError`): `INVALID_INPUT` for what the adapter refuses, `CHAIN_MISMATCH` for another chain id,
`UNSUPPORTED` for a blob transaction, `INVALID_ARGUMENT` for an option out of range.

## Options

Besides the core's `signer` and `resolvers` (`tokens`, `names`, `descriptors`, `clock`):

| Option | What it does |
| --- | --- |
| `nativeCurrency` | `{symbol, decimals}` of the chain's coin. ETH with 18 decimals unless given. |
| `highFee` | `{ratio, above}`: `HIGH_FEE` when the most the transaction can cost is over `ratio` times the ether sent (default 1), or over `above` wei. |
| `origin` | The host the wallet is connected to: a sign-in request for another domain is `ethereum.SIGN_IN_DOMAIN_MISMATCH`. |
| `builtins` | `false` turns off the built-in token list and contract names. |
| `sourcify` | ERC-7730 online, off unless given: `registry`, `trustedTokens`, `attestations`, `chainClient` (below). |

## Descriptors: bundled, your own, or online

**Bundled** (offline, the default choice): 25 descriptors from the ERC-7730 registry (Uniswap, 1inch, Aave, Lido,
Morpho, LI.FI, Circle, KyberSwap, ParaSwap, Safe, Ethena, Sky, Tether, WETH), in a separate entry point so an app
that does not want them does not ship them.

```ts
const descriptors = registryResolver()
```

**Your own**, alone or over the bundled ones: a later file overrides an earlier one for the same contract and
function, and can `includes` a bundled file to extend it.

```ts
const descriptors = registryResolver([{descriptor: myVault, path: 'app/calldata-vault.json', publisher: 'Me'}])
descriptors.rejected // [{path, reason}]
```

**Online**: the Ethereum Foundation's registry on GitHub, asked only for what your `descriptors` resolver has nothing
for. Fetch the index once. Without an attestation policy, registry descriptors are used unreviewed; with one, only
those an auditor you trust attests (ERC-8176), else `ethereum.UNTRUSTED_DESCRIPTOR`.

```ts
const index = await fetchPrebuiltRegistryIndex()
const result = await clearSignTransaction(chain, unsigned, {
  resolvers: {descriptors: registryResolver()},
  sourcify: {
    attestations: {trustedAttesters: [auditor]},
    chainClient: {call: (chainId, {to, data}) => rpc.ethCall(chainId, to, data)},
    registry: {index},
    trustedTokens: {1: {[usdc]: 'erc20'}},
  },
})
```

A descriptor is believed: it chooses the words of a call no built-in reads. Load descriptors only from a source you
trust, never from the dApp asking for the signature.

## Warnings

Its own codes; the shared ones are in the [core's README](https://github.com/hzblj/crypto-clear-sign/tree/main/packages/crypto-clear-sign#warnings).
A descriptor that is found and not used carries the reference implementation's reason as `params.code`.

| Code | Severity | When |
| --- | --- | --- |
| `ASSET_OWNERSHIP_TRANSFER` | critical | Shared, but **high** for an EIP-7702 delegation to a contract your `names` resolver knows. |
| `ALL_CHAINS` | high | Shared, but **critical** for an EIP-7702 delegation for chain id 0. |
| `ethereum.UNKNOWN_SPENDER` | high | An approval, permit or `setApprovalForAll` to an address no resolver names. |
| `ethereum.SIGN_IN_ACCOUNT_MISMATCH` | high | A sign-in request for another account than `signer`. |
| `ethereum.SIGN_IN_DOMAIN_MISMATCH` | high | A sign-in request for another domain than `origin`. |
| `ethereum.SIGN_IN_CHAIN_MISMATCH` | medium | A sign-in request for another chain. |
| `ethereum.SIGN_IN_URI_MISMATCH` | medium | A sign-in request whose URI is not on its domain. |
| `ethereum.MALFORMED_SIGN_IN` | medium | Text that opens as a sign-in request and breaks ERC-4361. |
| `ethereum.UNEXPECTED_VALUE` | medium | Ether sent with a call that takes none. |
| `ethereum.UNLIMITED_AMOUNT` | medium | A descriptor's amount at or past its `threshold`. |
| `ethereum.UNREADABLE_FIELD` | medium | A descriptor's field that cannot be read as it says: shown raw. |
| `ethereum.ADDRESS_TYPE_MISMATCH` | medium | An address your `names` resolver knows as another kind than the descriptor expects. |
| `ethereum.UNTRUSTED_DESCRIPTOR` | medium | An online descriptor no trusted auditor attests: not used. |
| `ethereum.INVALID_DESCRIPTOR` | low | A descriptor that is malformed or does not bind to the call: not used. |
| `ethereum.CONTRACT_CREATION` | info | The transaction deploys a contract. |

## Not supported

- Simulation and on-chain state: balance changes, allowances, what a proxy points at.
- ERC-7730 version 1 descriptors, `includes` by URL, factories and proxies, block heights as dates, encrypted values.
- Typed data without a verifying contract, by descriptors (built-ins and the raw fallback still read it).
- Uniswap's Universal Router, Seaport, ERC-4337 user operations, EIP-5792 batches without a descriptor.
- Blob transactions.

[Security](https://github.com/hzblj/crypto-clear-sign/blob/main/SECURITY.md) · [Compatibility](https://github.com/hzblj/crypto-clear-sign/blob/main/docs/compatibility.md) · [Decisions](https://github.com/hzblj/crypto-clear-sign/tree/main/docs/adr) · [MIT](https://github.com/hzblj/crypto-clear-sign/blob/main/LICENSE) · [NOTICE](https://github.com/hzblj/crypto-clear-sign/blob/main/packages/crypto-clear-sign-ethereum/NOTICE)

The other libraries from the same author are at **[libraries.janblazej.dev](https://www.libraries.janblazej.dev)**.

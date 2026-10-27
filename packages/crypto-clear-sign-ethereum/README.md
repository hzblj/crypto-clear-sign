# @hzblj/crypto-clear-sign-ethereum

[![npm](https://img.shields.io/npm/v/@hzblj/crypto-clear-sign-ethereum.svg)](https://www.npmjs.com/package/@hzblj/crypto-clear-sign-ethereum)
[![license](https://img.shields.io/npm/l/@hzblj/crypto-clear-sign-ethereum.svg)](https://github.com/hzblj/crypto-clear-sign/blob/main/LICENSE)

Ethereum and EVM clear signing for [`@hzblj/crypto-clear-sign`](https://github.com/hzblj/crypto-clear-sign/tree/main/packages/crypto-clear-sign):
it reads what a wallet is about to sign (a transaction of any type, EIP-712 typed data, a `personal_sign` message, an
EIP-7702 authorization) through the chain client of [`@hzblj/crypto-ethereum`](https://www.npmjs.com/package/@hzblj/crypto-ethereum)
and describes it in the shared display model, with risk warnings. Standard calls are read by built-in decoders,
everything else by ERC-7730 descriptors from a resolver (a curated set from the CC0 registry ships in a separate entry
point), and what nothing reads is shown raw with a warning.

```sh
npx expo install @hzblj/crypto-clear-sign @hzblj/crypto-clear-sign-ethereum @hzblj/crypto-ethereum @hzblj/nitro-crypto react-native-nitro-modules
```

`@hzblj/crypto-ethereum` 0.3.0 or later is a dependency, `@hzblj/nitro-crypto` 0.1.5 or later a peer: the app's engine
makes the chain client (`crypto.chains.ethereum`) and passes it in. Pure TypeScript: no native code, no network.

## Usage

Every function takes the chain client, what is to be signed, and options, and resolves to a `ClearSigning`. Results
below are from a client on Ethereum mainnet.

```ts
import {plainText} from '@hzblj/crypto-clear-sign'
import {
  clearSignAuthorization,
  clearSignMessage,
  clearSignTransaction,
  clearSignTypedData,
} from '@hzblj/crypto-clear-sign-ethereum'
import {registryResolver} from '@hzblj/crypto-clear-sign-ethereum/registry'

const chain = crypto.chains.ethereum
const options = {signer: account.address, resolvers: {descriptors: registryResolver(), names, tokens}}
```

### `clearSignTransaction(chain, transaction, options)`

The unsigned transaction's bytes (`Hex` or `Uint8Array`, read with `chain.parseTransaction`), or a request (serialized
with `chain.serializeTransaction` and read back, so what is described is exactly what is signed). Legacy (EIP-155),
EIP-2930, EIP-1559 and EIP-7702.

```ts
const result = await clearSignTransaction(chain, unsigned, options) // USDC.approve(router, maxUint256)
result.intent // {code: 'intent.approve', text: 'Approve'}
result.summary?.text // 'Allow 0x68b3…Fc45 to spend an unlimited amount of USDC'
result.risk // 'critical'
result.warnings.map(warning => warning.code) // ['UNLIMITED_APPROVAL', 'ethereum.UNKNOWN_SPENDER']
plainText(result)
// Approve: Allow 0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45 to spend an unlimited amount of USDC
// Transaction on Ethereum. Risk: critical.
// Spender: 0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45, unknown address
// Amount: Unlimited USDC
// Token: USD Coin (0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48), token
// Max fee: 0.003 ETH
// …
```

The fields after the call's are the transaction's: `maxFee` (the most it can cost) up front, and behind "More
details" (`secondary`) the gas limit, the gas price or max fees per gas, the nonce, the transaction type and the access
list. A call inside a call (a multicall, a batch, a descriptor's `calldata` field) is an action of its own, with its
own fields, source and warnings. An EIP-7702 transaction's authorizations are actions too, before its call.

A transaction for another chain id is `CHAIN_MISMATCH`, one the adapter refuses `INVALID_INPUT` (the adapter's error as
`cause`), a blob transaction `UNSUPPORTED`.

### `clearSignTypedData(chain, typedData, options)`

EIP-712 typed data in viem's shape (an `eth_signTypedData_v4` request's JSON, parsed), hashed with `chain.hashTypedData`
first so that what the adapter refuses is refused here, and a domain for another chain is `CHAIN_MISMATCH`.

```ts
const result = await clearSignTypedData(chain, permit2PermitSingle, options)
result.source // {kind: 'builtin', decoder: 'permit2'}
result.summary?.text // 'Allow 0x3fC9…7FAD to spend an unlimited amount of USDC'
result.fields.map(field => field.id) // ['spender', 'token', 'amount', 'expiration', 'sigDeadline', 'domain', 'contract']
```

The domain's name, verifying contract (named when known), version and salt are fields of the root; a domain without a
chain id is `ALL_CHAINS`. Typed data nothing reads shows every member it declares, with `BLIND_SIGNING`.

### `clearSignMessage(chain, message, options)`

A `personal_sign` (EIP-191) message: text, signed as its UTF-8 bytes, or bytes.

```ts
const result = await clearSignMessage(chain, siweMessage, {...options, origin: 'app.example.com'})
result.intent.code // 'intent.signIn'
result.summary?.text // 'Sign in to example.com'
result.warnings.map(warning => warning.code) // ['ethereum.SIGN_IN_DOMAIN_MISMATCH']: the site asking is another
```

Text is a `message` field. A Sign-In with Ethereum request (ERC-4361) is read into its fields (`domain`, `account`,
`statement`, `uri`, `chainId`, `issuedAt`, `expiry`, `notBefore`, `nonce`, `version`, `requestId`, `resources`) and
checked: the account against the signer, the chain against the client, the URI against the domain, the domain against
`origin` (the host the wallet is connected to, never taken from the payload). Text that is hex or a bare 32-byte hash,
and bytes that are not text, are `BLIND_SIGNING` (the bytes in `raw`).

### `clearSignAuthorization(chain, authorization, options)`

An EIP-7702 authorization about to be signed on its own (`{address, nonce, chainId?}`), checked with
`chain.hashAuthorization`. Chain id 0 is read even without `allowAllChains`, and is `ALL_CHAINS`.

```ts
const result = await clearSignAuthorization(chain, {address: delegate, nonce: 7n}, {signer})
result.intent.code // 'intent.delegate'
result.summary?.text // 'Let 0x63c0…E32B run code as your account'
result.warnings.map(warning => [warning.code, warning.severity]) // [['ASSET_OWNERSHIP_TRANSFER', 'critical']]
```

### Options

| Option | What it does |
| --- | --- |
| `signer` | The address that signs: shown as `self`, the default `@.from` of descriptors, checked against sign-in requests. |
| `resolvers` | `tokens`, `names`, `descriptors` (ERC-7730), `clock`. All optional; see Resolvers. |
| `nativeCurrency` | `{symbol, decimals}` of the chain's native asset. ETH with 18 decimals unless told: the adapter's network has a name and a chain id, not a symbol. |
| `highFee` | `{ratio, above}`: `HIGH_FEE` when the most the transaction can cost is more than `ratio` (default 1) times the ether it sends (when it sends some), or more than `above` wei in any case (default: no absolute limit). |
| `origin` | The host of the site asking for the signature, for sign-in requests. |
| `builtins` | `false` turns off the built-in token list and contract names. Default `true`; the app's resolvers always answer first. |

An option out of range is `INVALID_ARGUMENT`.

## What it recognizes

Built-in decoders, by `source.decoder`. A built-in decoder wins over a descriptor for the same call, so a descriptor
can never relabel an approval; descriptors read everything else. Anything nothing reads is `UNKNOWN_CONTRACT_CALL`
(a call: its contract, value and call data raw) or `BLIND_SIGNING` (typed data, bytes).

| Decoder | Reads | Intent | Fields | Warnings |
| --- | --- | --- | --- | --- |
| `native-transfer` | Ether with no call data | `send` | `recipient`, `amount` | `UNKNOWN_DESTINATION` |
| `contract-creation` | `to: null` | `deploy` | `value`; the init code in `raw` | `ethereum.CONTRACT_CREATION` |
| `erc20` | `transfer`, `transferFrom`, `approve`, `increaseAllowance`, `decreaseAllowance` (any contract) | `send`, `approve`, `revoke` (an approval of 0), `ethereum.intent.decreaseAllowance` | `from`, `recipient`, `spender`, `amount`, `token` | `UNLIMITED_APPROVAL`, `ethereum.UNKNOWN_SPENDER`, `UNKNOWN_TOKEN`, `UNKNOWN_DESTINATION` |
| `nft` | `setApprovalForAll` | `approve` (true), `revoke` (false) | `operator`, `approved`, `collection` | `ASSET_OWNERSHIP_TRANSFER` when true, `ethereum.UNKNOWN_SPENDER` |
| `erc721` | `safeTransferFrom` (3 and 4 arguments) | `send` | `from`, `recipient`, `tokenId`, `collection`; `data` in `raw` | `UNKNOWN_DESTINATION` |
| `erc1155` | `safeTransferFrom`, `safeBatchTransferFrom` | `send` | `from`, `recipient`, `tokenId`, `amount` (a list `item-<n>` per token of a batch), `collection` | `UNKNOWN_DESTINATION` |
| `weth` | `deposit`, `withdraw` on WETH (Ethereum, Sepolia, OP Mainnet, Base, Arbitrum One) | `ethereum.intent.wrap`, `ethereum.intent.unwrap` | `amount`, `token` | |
| `permit2` | Permit2's `approve` and `lockdown`, at Permit2's address | `approve`, `revoke` | `spender`, `amount`, `expiration`, `token`; `approval-<n>` lists | `UNLIMITED_APPROVAL`, `ethereum.UNKNOWN_SPENDER`, `LONG_LIVED`, `EXPIRED`, `UNKNOWN_TOKEN` |
| `multicall` | `multicall(bytes[])`, `multicall(uint256,bytes[])`, `multicall(bytes32,bytes[])`, Multicall3's `aggregate`, `tryAggregate`, `blockAndAggregate`, `tryBlockAndAggregate`, `aggregate3`, `aggregate3Value` | the one call's, else `batch` | `contract`, `deadline`; one action per call | `EXPIRED` (deadline) |
| `safe-multisend` | Safe's `multiSend(bytes)` | as above | one action per call | `ASSET_OWNERSHIP_TRANSFER` on a delegate call |
| `smart-account` | ERC-7821 and ERC-7579 `execute(bytes32,bytes)` (single, batch, delegate call), `executeBatch((address,uint256,bytes)[])`, `execute(address,uint256,bytes)` | as above | one action per call | `ASSET_OWNERSHIP_TRANSFER` on a delegate call |
| `ownable` | `transferOwnership`, `renounceOwnership` | `transferOwnership`, `ethereum.intent.renounceOwnership` | `contract`, `newOwner` | `ASSET_OWNERSHIP_TRANSFER` |
| `proxy` | `upgradeTo`, `upgradeToAndCall`, `changeAdmin` | `ethereum.intent.upgrade`, `transferOwnership` | `contract`, `implementation`; the call as an action | `ASSET_OWNERSHIP_TRANSFER` |
| `eip2612` | EIP-2612 `Permit` typed data | `approve`, `revoke` | `owner`, `spender`, `amount` (the verifying contract's token), `deadline`, `nonce` | `UNLIMITED_APPROVAL`, `ethereum.UNKNOWN_SPENDER`, `LONG_LIVED`, `EXPIRED`, `UNKNOWN_TOKEN` |
| `dai-permit` | DAI's `Permit(holder, spender, nonce, expiry, allowed)` | `approve` (unlimited), `revoke` | as above, `expiry` 0 never ends | as above |
| `permit2` | Permit2's `PermitSingle`, `PermitBatch`, `PermitTransferFrom`, `PermitBatchTransferFrom`, `PermitWitnessTransferFrom`, `PermitBatchWitnessTransferFrom`, on Permit2's domain | `approve` | `spender`, `amount`, `token`, `expiration`, `sigDeadline` or `deadline`, `nonce`, `witness` (every member) | `UNLIMITED_APPROVAL`, `ethereum.UNKNOWN_SPENDER`, `LONG_LIVED`, `EXPIRED`, `UNKNOWN_TOKEN` |
| `eip191` | Text messages | `signMessage` | `message` | `BLIND_SIGNING` (hex), `HIDDEN_CHARACTERS`, `ethereum.MALFORMED_SIGN_IN` |
| `siwe` | ERC-4361 sign-in requests | `signIn` | as above | `ethereum.SIGN_IN_*`, `EXPIRED`, `HIDDEN_CHARACTERS` |
| `eip7702` | EIP-7702 authorizations, alone or in a transaction | `delegate`, `ethereum.intent.undelegate` (the zero address) | `authority`, `delegate`, `chainId`, `nonce` | `ASSET_OWNERSHIP_TRANSFER`, `ALL_CHAINS` |

Notes on reading:

- **Unlimited.** An ERC-20 or EIP-2612 amount is unlimited from `2^255` up (where `maxUint(256)` and "max minus what
  was spent" land), or at exactly `maxUint(96)` or `maxUint(128)` (tokens that keep allowances in narrower integers);
  a Permit2 amount from `2^159` up. Unlimited amounts show as "Unlimited" and raise `UNLIMITED_APPROVAL`.
- **Deadlines.** Timestamps past what a `Date` holds (`maxUint`) never come. A Permit2 `expiration` of 0 lasts for the
  transaction only (`validFor` 0, no warning). DAI's `expiry` 0 never ends. A permit's deadline or expiration more
  than 30 days ahead, or never, is `LONG_LIVED`; one already past `EXPIRED`. A transaction's own deadline (a
  multicall's) is only ever `EXPIRED`.
- **Value.** Ether sent with a call is a `value` field; with a call its decoder knows takes none (an ERC-20 transfer,
  an approval), `ethereum.UNEXPECTED_VALUE`.
- **`transferFrom` and `approve`** have the same selectors on ERC-20 and ERC-721. They are read as ERC-20; on a
  contract the token list does not know, the amount is base units with `UNKNOWN_TOKEN` (it may be a token id).
- **Batches.** Multicall3's calls are made by Multicall3, not by the signer; a smart account's by the account (the
  signer, for an EIP-7702 account calling its own code). Calls nest at most 4 deep; deeper ones are shown raw.
- **Call data** is decoded by the package's own ABI decoder: strict (stray high bits, bools past 1, offsets and
  lengths past the data, arrays longer than their data could hold are refused) and bounded (32 levels, 20,000 values),
  so hostile call data never crashes or loops. It decodes exactly as viem's `decodeAbiParameters` on valid encodings.
- **Built-in knowledge:** the token list (`ETHEREUM_TOKENS`: USDC, USDT, DAI, WETH and WBTC on Ethereum; USDC, EURC,
  WETH and LINK on Sepolia), and the names of Permit2, Multicall3 and the WETH contracts above. The `names` and
  `tokens` resolvers answer first.

## Warnings

| Code | Severity | When |
| --- | --- | --- |
| `UNLIMITED_APPROVAL` | critical | An ERC-20, EIP-2612, DAI or Permit2 approval or permit of an unlimited amount (see above) |
| `ASSET_OWNERSHIP_TRANSFER` | critical | `setApprovalForAll(…, true)`, an EIP-7702 delegation, an ownership transfer or renouncement, a proxy upgrade, a delegate call in a batch. **High** for a delegation to a contract the `names` resolver knows (see below) |
| `UNKNOWN_CONTRACT_CALL` | high | Call data no built-in decoder and no descriptor reads |
| `BLIND_SIGNING` | high | Typed data nothing reads, bytes that are not text, text that is hex or a hash |
| `ALL_CHAINS` | high | Typed data without `domain.chainId`. **Critical** for an EIP-7702 delegation for chain id 0 |
| `UNKNOWN_TOKEN` | medium | An amount of a token neither resolver nor list knows |
| `HIDDEN_CHARACTERS` | medium | Hidden characters in a message, a sign-in field, a typed data string or domain, or a descriptor's label, intent or enum value |
| `LONG_LIVED` | medium | A permit's deadline or expiry more than 30 days ahead, or never |
| `HIGH_FEE` | medium | The most the transaction can cost is above `highFee` (more than the ether it sends, by default) |
| `EXPIRED` | low | A deadline or expiry already past (permits, a multicall's deadline, a sign-in's expiration) |
| `UNKNOWN_DESTINATION` | low | Ether, tokens or an NFT sent to an address that is not the signer, the user's, a contact or a known contract |
| `RESOLVER_FAILED` | info | A resolver threw or answered with something malformed (params name which, once, across chains) |
| `ethereum.UNKNOWN_SPENDER` | high | An approval, a permit or `setApprovalForAll` to an address no resolver names (not for a revoke) |
| `ethereum.SIGN_IN_ACCOUNT_MISMATCH` | high | A sign-in request for another account than `signer` |
| `ethereum.SIGN_IN_DOMAIN_MISMATCH` | high | A sign-in request for another domain than `origin` |
| `ethereum.SIGN_IN_CHAIN_MISMATCH` | medium | A sign-in request for another chain than the client's |
| `ethereum.SIGN_IN_URI_MISMATCH` | medium | A sign-in request whose URI is not on its domain |
| `ethereum.MALFORMED_SIGN_IN` | medium | A message that opens as a sign-in request but does not follow ERC-4361 (shown as text) |
| `ethereum.UNEXPECTED_VALUE` | medium | Ether sent with a call that takes none |
| `ethereum.UNLIMITED_AMOUNT` | medium | A descriptor's amount at or past its `threshold` (an unlimited input to a swap, say) |
| `ethereum.UNREADABLE_FIELD` | medium | A descriptor's field that cannot be read as it says (an unknown format, a value of the wrong type, an encrypted value): shown raw |
| `ethereum.INVALID_DESCRIPTOR` | low | A descriptor answered but is malformed or does not bind to the call or message: not used |
| `ethereum.CONTRACT_CREATION` | info | The transaction deploys a contract |

**Severities this package changes**, and why: an EIP-7702 delegation to a contract the `names` resolver knows (relation
`contract` or `own`, a wallet's own smart account implementation) is `ASSET_OWNERSHIP_TRANSFER` at **high**, not
critical: it still runs as the account and a flaw in it reaches everything, but the app vouches for it; one to a
contract nobody knows stays critical. A delegation for chain id 0 is `ALL_CHAINS` at **critical**: it puts the
account's every balance on every EVM chain behind that contract. An authorization in a transaction that another account
signed (a sponsored one) carries neither: nothing of the signer's is at stake, and its summary names that account
(`ethereum.summary.delegateAccount`), not "your account".

## Texts

`ETHEREUM_TEXTS`, by group (codes `ethereum.<group>.<key>`):

- `intent`: `decreaseAllowance`, `renounceOwnership`, `signTypedData`, `undelegate`, `unwrap`, `upgrade`, `wrap`.
- `label`: `accessList`, `approved`, `authority`, `chain`, `collection`, `delegate`, `gasLimit`, `gasPrice`,
  `implementation`, `item` (`Item {index}`), `maxFeePerGas`, `maxPriorityFeePerGas`, `newOwner`, `operation`,
  `requestId`, `resources`, `salt`, `selector`, `signatureDeadline`, `tokenId`, `transactionType`, `value`, `version`,
  `witness`.
- `summary`: `approveAll`, `decreaseAllowance`, `delegateAccount` and `undelegateAccount` (another account's
  authorization, in a transaction the signer sponsors), `increaseAllowance`, `lockdown`, `permitBatch`,
  `permitTransfer`, `renounceOwnership`, `revokeAll`, `sendNft`, `sendNftBatch`, `signTypedData`, `undelegate`,
  `unwrap`, `upgrade`, `wrap`.
- `unit`: `blocks`, `gas`.

Shared ones it uses: `INTENTS` `approve`, `batch`, `contractCall`, `delegate`, `deploy`, `revoke`, `send`, `signIn`,
`signMessage`, `transferOwnership`, `unknown`; `SUMMARIES` `approve`, `approveUnlimited`, `batch`, `blind`,
`contractCall`, `delegate`, `deploy`, `revoke`, `send`, `signIn`, `signMessage`, `transferOwnership`; `LABELS`
`account`, `amount`, `contract`, `data`, `deadline`, `domain`, `expiry`, `from`, `issuedAt`, `maxFee`, `message`,
`nonce`, `notBefore`, `operator`, `owner`, `recipient`, `spender`, `statement`, `token`, `uri`, `validFor`. A
descriptor's words (intents, labels, enum values) are `external` text: shown as they are, never translated.

## Resolvers

- **`tokens`**, asked with `{chain, address}` (`chain.id` is `eip155:<chainId>`, the address EIP-55) for every token
  amount; the built-in list answers what it does not.
- **`names`**, asked with `{chain, address}` for every address; Permit2, Multicall3 and WETH are named after it.
- **`descriptors`**, asked with an `EthereumDescriptorQuery`: `{kind: 'calldata', chain, chainId, address, selector}`
  for a call no built-in reads, `{kind: 'eip712', chain, chainId?, verifyingContract?, primaryType, encodeType,
  domainName?}` for typed data. It answers `{id, content, publisher?}` with an ERC-7730 descriptor (`Erc7730Descriptor`,
  `includes` merged). `createDescriptorResolver(files)` builds one from descriptor files; see below.
- **`clock`**, read once per call, for deadlines.

Every resolver may answer synchronously or with a promise; one that throws or answers nonsense counts as no answer,
with `RESOLVER_FAILED`: the built-in token list and names then answer as they would have without it.

### ERC-7730

The package reads ERC-7730 descriptors, versions 1 and 2 of the schema (keys of later minor versions are ignored; a
later major version is refused), and checks each strictly before it uses it: a malformed descriptor is not used at all
(`ethereum.INVALID_DESCRIPTOR`), never half used.

- **Binding:** `context.contract.deployments` (and a version 1 `abi`) for call data; `context.eip712.domain`,
  `deployments`, `domainSeparator` (checked with `chain.hashDomain`) and version 1 `schemas` for typed data. The package
  checks the binding itself, whatever the resolver says: a descriptor for another contract, chain or message type is
  ignored. A descriptor bound to nothing (`factory` only, or no deployments) is not used.
- **Formats** by human-readable function signature (with or without names, spaces tolerated), by selector or name with
  a version 1 `abi`, by EIP-712 `encodeType`, or by primary type with version 1 `schemas`. The call data must decode as
  the format's function.
- **Metadata:** `owner` and `contractName` (the contract's name, after the `names` resolver), `token` (the contract's
  own token, when no list has it), `constants`, `enums`, `maps`.
- **Fields:** `intent` (text or an object), `interpolatedIntent` (the summary, when every placeholder reads; `{{` and
  `}}` escape), `fields` with `$ref` to `display.definitions` (params merged), nested groups with `iteration`
  (`sequential`, `bundled`), `visible` (`always`, `optional` as a secondary field, `never`, `ifNotIn`, `mustMatch`, which
  fails the descriptor when the value differs), version 1 `required` and `excluded`, `separator`, literal `value`s
  (constants and `$.` references).
- **Paths:** `#.` (or none) the data, `@.from`, `@.to`, `@.value`, `@.chainId` the container, `$.` the descriptor;
  `.[n]`, `.[-n]`, `.[a:b]`, `.[]` (or without the dot). A slice of bytes, text or an integer's 32-byte word is bytes.
  A path to a member the data does not have fails the descriptor.
- **Formats of fields:** `raw`, `addressName` (with `senderAddress`), `tokenAmount` (`tokenPath` or `token`, constants
  and maps, `nativeCurrencyAddress`, `threshold`, `chainId` or `chainIdPath`), `amount`, `tokenTicker`, `nftName`
  (`collection` or `collectionPath`), `date` (`timestamp`; `blockheight` as a number of blocks), `duration`, `unit`
  (`base`, `decimals`, `prefix`; `%` as a percentage), `enum`, `chainId`, `interoperableAddressName` (ERC-7930, EVM),
  `calldata` (`callee`, `selector`, `amount`, `spender`, each or its path: an action of its own, described by the same
  pipeline). An unknown format, a value of the wrong type, or an `encryption` (which cannot be decrypted here) is the
  value raw with `ethereum.UNREADABLE_FIELD`.
- **Nothing goes unseen:** arguments or members no field shows, hides or reads come after the descriptor's fields, as
  secondary fields named by their paths.
- **Not followed:** `includes` by URL, `abi` and `schemas` by URL, `factory`, proxies (a descriptor binds to the address
  called), `screens`, address `types` and `sources` (names come from the resolvers), a descriptor's custom word for
  "Unlimited" (`message`). Dates from a descriptor are never marked expired: what they mean is not known.

**What a descriptor can and cannot make it say.** A descriptor chooses the words of a call no built-in reads: its
intent, its summary, its labels, which arguments come first and which are hidden, which amounts are which token's. It
cannot relabel a call a built-in decoder reads (an approval stays an approval, with its warnings), cannot take away a
warning the package raises on what it shows (hidden characters, unknown tokens other than the contract's own, which its
`metadata.token` may name, unlimited amounts), cannot name an address the resolvers name otherwise, and cannot make the
package believe it binds to a contract it does not list.

### Descriptor files and the bundled registry

```ts
import {createDescriptorResolver} from '@hzblj/crypto-clear-sign-ethereum'
import {ETHEREUM_REGISTRY, REGISTRY_SOURCE, registryResolver} from '@hzblj/crypto-clear-sign-ethereum/registry'

const descriptors = createDescriptorResolver([...ETHEREUM_REGISTRY, ...appFiles]) // or registryResolver(appFiles)
descriptors.rejected // [{path, reason}]: files it could not use
```

`createDescriptorResolver(files)` takes `{path, descriptor, publisher?}` files, merges each one's `includes` from the
files given (resolved against its `path`, never fetched; `fields` merged by path, the including file winning), checks
and compiles them, and indexes them by what they bind to. A later file wins over an earlier one for the same
deployment and function or message type, so an app's own files listed after the registry's override or extend them.
`mergeDescriptors(base, overlay)` is that merge.

`@hzblj/crypto-clear-sign-ethereum/registry` is a separate entry point, so an app that does not want the bundled files
does not ship them. `ETHEREUM_REGISTRY` holds 25 descriptors (and the 6 files they include) from
[LedgerHQ/clear-signing-erc7730-registry](https://github.com/LedgerHQ/clear-signing-erc7730-registry) at commit
`b70998caa5dab184243a298a0253b5530428b0f2`, copied byte for byte: Uniswap's V2 and V3 routers and Permit2, 1inch's
Aggregation Router V5 and V6 and limit orders, Aave V3's pool and WETH gateway, Lido's stETH, wstETH and withdrawal
queue, Morpho Blue, LI.FI's diamond, Circle's TokenMessengerV2 and USDC transfer and receive authorizations, KyberSwap's
MetaAggregationRouterV2, ParaSwap's Augustus v6.2, Safe 1.4.1 (calls, messages, the L2 setup), Ethena, Sky's sUSDS,
Tether's USDT and WETH. `REGISTRY_SOURCE` records the repository, the commit and each file's path and SHA-256.
`node scripts/import-registry.mjs` re-imports them (its `SELECTION` lists them), with the registry's own test cases,
which this package's tests replay. The registry's files are dedicated to the public domain under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (see `NOTICE`).

## Trust

What this package cannot know:

- **What a contract does.** Decoding is not simulation: a call is described by its interface, and a contract can do
  something else (a token can take a fee, a call can depend on state that changes before it lands). Balance changes
  are a simulator's job.
- **Whether a descriptor tells the truth.** A descriptor is believed: it can label a call wrongly, with the model's
  full authority. The result's `source` names it (`{kind: 'descriptor', format: 'erc7730', id, publisher}`). Choose the
  descriptor source (a registry the app trusts, the bundled set), never take descriptors from the dApp asking for the
  signature.
- **Whether a token or a name is genuine.** The `tokens` and `names` resolvers are shown as fact.
- **On-chain state:** allowances already given, whether an address is a contract, what an account's code is now,
  what a proxy points at, block times.

[SECURITY.md](https://github.com/hzblj/crypto-clear-sign/blob/main/SECURITY.md) says what clear signing protects and
what it does not.

## How it is tested

The tests run offline on the engine as WebAssembly (`@hzblj/nitro-crypto/testing`) and assert on the model: codes,
severities, action paths, field ids and `bigint` values, with one readable `plainText` check per export.

- **Independent payloads.** Call data, typed data, sign-in messages and EIP-7702 authorizations are encoded and signed
  by viem 2.57.11, and the adapter's bytes for a transaction (an EIP-7702 one included) are viem's. ABI decoding and
  Keccak-256 are checked against viem over random ABIs, values and mutated encodings.
- **Real ones.** The ERC-7730 registry's own test cases replayed through the bundled descriptors, Uniswap's
  `exactInputSingle` from mainnet alone and inside a multicall, and a signed EIP-7702 batch delegation, sent by the
  account and sponsored.
- **Every export** offline and with resolvers that answer at once, later, by throwing or with nonsense; every built-in
  decoder; every warning the package raises, each with a near miss that does not raise it (a finite approval, a
  deadline in a week, a known spender); nesting to its limit; every option out of range.
- **ERC-7730 as hostile input:** every compile rejection, includes with cycles and `__proto__`, every field format,
  visibility rule, group mode, slice and aligned parameter, interpolation, descriptors that do not bind or decode, and
  the registry's descriptors mutated at random (seeded): none throws, and none takes away a warning the package raises.

## Not in this version

- Uniswap's Universal Router commands, Seaport orders and other protocols' calls or typed data without a descriptor
  (they are `UNKNOWN_CONTRACT_CALL` or `BLIND_SIGNING`, and readable with a descriptor).
- ERC-4337 user operations, EIP-5792 call batches, ERC-2771 forwarded calls as such (a descriptor may read them).
- ERC-7730 proxies and factories, includes by URL, block heights as dates, encrypted values.
- A list of known EIP-7702 delegates: a delegate is known when the `names` resolver names it.
- Blob transactions (the adapter does not read them).

[Documentation](https://github.com/hzblj/crypto-clear-sign#readme) · [Security](https://github.com/hzblj/crypto-clear-sign/blob/main/SECURITY.md)

The other libraries from the same author are at **[libraries.janblazej.dev](https://www.libraries.janblazej.dev)**.

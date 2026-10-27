# The chain package contract

What `@hzblj/crypto-clear-sign-ethereum`, `-solana` and `-bitcoin` export, how they build results, and what their
tests and READMEs cover. The core (`packages/crypto-clear-sign`) is the model and the helpers; its README and the JSDoc
in its `src/` are the API reference. [ADR 0001](adr/0001-display-model.md) says why the model is what it is.

## What a chain package is

- **A reader, not a decoder.** It parses with its chain's adapter (`@hzblj/crypto-<chain>`, through the chain client
  the app passes in) and describes what the adapter reads. No cryptography, no RLP, PSBT or message parser of its own
  where the adapter has one, no network, no other chain, no native code.
- **Dependencies.** `@hzblj/crypto-clear-sign` is a dependency (`workspace:^`). `@hzblj/crypto-<chain>` `^0.3.0` and
  `@hzblj/nitro-crypto` `^0.1.5` are peers (the app's engine makes the client) and devDependencies (the tests). An
  independent library a test compares against (viem, `@solana/kit`, `@scure/btc-signer`) is a devDependency pinned
  exactly, as the sibling repositories pin them.
- **Not understanding is a result.** A call, an instruction or a script it cannot read is described as far as it can
  be (its target, its value, its raw bytes) with a warning. It throws only when there is nothing that could be signed.
- **The core is not edited by a chain package.** If something is missing there, say so (in your report, and in the
  package's `CLAUDE.md` under "Asked of the core"); meanwhile use a chain code, named as the shared one would be.

## Exports

Every `clearSign*` function has the same shape: the chain client first, the payload second, options last, and a
promise of a `ClearSigning` built by `createClearSigning`.

```ts
(chain: <Chain>Chain<string>, payload: …, options?: <Chain>ClearSignOptions) => Promise<ClearSigning>
```

Type the client as the adapter's chain type with a `string` id (or a `Pick` of the members it calls, which keeps
tests simple). Options extend the core's `ClearSignOptions<Query, Content>` (`signer`, `resolvers`), where `Query`
and `Content` are the package's descriptor types (`never` when it has none), and add only what the chain needs.

### Ethereum (`@hzblj/crypto-clear-sign-ethereum`)

| Export | Payload | `kind` |
| --- | --- | --- |
| `clearSignTransaction` | The unsigned transaction: `Hex \| Uint8Array` (read with `chain.parseTransaction`), or an `EthereumTransactionRequest` (serialized with `chain.serializeTransaction`, then read back the same way, so what is described is exactly what is signed) | `transaction` |
| `clearSignTypedData` | `TypedDataDefinition` (viem's shape, `eth_signTypedData_v4` parsed), hashed with `chain.hashTypedData` first so typed data the adapter refuses is refused here | `typed-data` |
| `clearSignMessage` | `SignableMessage` (EIP-191 text or bytes) | `message` |
| `clearSignAuthorization` (optional) | An EIP-7702 authorization request, signed on its own | `authorization` |

`EthereumClearSignOptions = ClearSignOptions<EthereumDescriptorQuery, Erc7730Descriptor>` plus, suggested, the
native currency (the adapter's network has a name and a chain id, not a symbol: ETH with 18 decimals unless told).
`EthereumDescriptorQuery` is the package's to define (a call: chain, contract, selector; typed data: chain, verifying
contract, primary type), and so is the subset of ERC-7730 it reads.

### Solana (`@hzblj/crypto-clear-sign-solana`)

| Export | Payload | `kind` |
| --- | --- | --- |
| `clearSignTransaction` | A wire transaction (`Uint8Array`, read with `chain.decodeTransaction`) as a dApp sends it, or `{message: Uint8Array}` (read with `chain.decodeMessage`) as an air-gapped signer receives it; legacy and v0 | `transaction` |
| `clearSignMessage` | Message bytes or text: Solana's off-chain format (by its header, read with `chain.decodeOffchainMessage`) is `offchain-message`, anything else `message` (a Sign In With Solana message is `intent.signIn`) | `message`, `offchain-message` |

`SolanaClearSignOptions = ClearSignOptions<SolanaDescriptorQuery, SolanaIdl>` plus `addressLookupTables?`, passed to
the adapter so a v0 transaction's looked-up accounts are named. Instructions are actions (`result.actions`, one per
instruction, in order); compute budget instructions may become fields of the root (the fee) rather than actions.

### Bitcoin (`@hzblj/crypto-clear-sign-bitcoin`)

| Export | Payload | `kind` |
| --- | --- | --- |
| `clearSignPsbt` | A PSBT: `Uint8Array`, or Base64 text (decoded here), read with `chain.decodePsbt` | `psbt` |
| `clearSignMessage` | `string \| Uint8Array`, the message a BIP-322 or legacy signature would sign | `message` |

`BitcoinClearSignOptions = ClearSignOptions` plus what tells the user's own coins and change from others' (suggested:
the master key `fingerprint` the PSBT's derivations name). Outputs are actions or a list of fields, one per output,
with change marked as such; the fee is a root field (`label.fee`).

### Also exported by each

- `<CHAIN>_WARNINGS = defineWarnings('<family>', {…})`: its own codes (`ethereum.CONTRACT_CREATION`).
- `<CHAIN>_TEXTS = defineTexts('<family>', {intent: {…}, label: {…}, summary: {…}, unit: {…}})`: its own words.
- Its types: `<Chain>ClearSignOptions`, its descriptor query and content types, and `type <Chain>WarningCode =
  SharedWarningCode | (typeof <CHAIN>_WARNINGS)[keyof typeof <CHAIN>_WARNINGS]['code']`.
- `VERSION` (kept by `scripts/sync-versions.mjs`).

Named exports only, `const` arrow functions, `type` over `interface`, JSDoc on every export (it is the API reference;
no em dashes in it).

## Building a result

```ts
export const clearSignTransaction = async (chain, transaction, options = {}) => {
  const parsed = read(() => chain.parseTransaction(transaction)) // adapter errors become ClearSignErrors (below)
  const context = createResolverContext({...options, chain: chainRef(chain), normalize: lower})
  const actions = await describeCalls(parsed, context) // fields from context.address / context.amount / *Field
  return createClearSigning({chain: chainRef(chain), kind: 'transaction', ..., warnings: [...own, ...context.warnings()]})
}
```

- **The chain.** `{family: '<family>', id: <CAIP-2>, name}`. Ethereum: `eip155:<chainId>`, the adapter's network
  name. Solana: `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` (mainnet-beta), `solana:EtWTRABZaYq6iMfeYKouRu166VL2xqa1`
  (devnet), `solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z` (testnet). Bitcoin: `bip122:` and the first 32 hex characters of
  the genesis block hash: `000000000019d6689c085ae165831e93` (mainnet), `000000000933ea01ad0ee984209779ba` (testnet3),
  `00000000da84f2bafbbc53dee25a72ae` (testnet4), `00000008819873e925422c1ff0f99f7c` (signet),
  `0f9188f13cb7b2c71f2a335e3a4fc328` (regtest); the adapter's `testnet` is one network name for two chains, so say in
  the README which id it gets (or take it as an option).
- **Resolvers** only through `createResolverContext` (`normalize`: lowercase for EVM hex, the identity for Base58 and
  Bech32). Addresses through `context.address` (it finds `self`, `own`, `contact`, `contract`, `token`, `unknown`);
  token amounts through `context.amount`; native amounts with `amountField` (`decimals`, `symbol`, `baseUnit`:
  `wei`, `lamports`, `sat`). Add `context.warnings()` to the root's warnings once every lookup is done. Built-in
  knowledge (the System Program, the Token program, well-known routers if the package keeps a list) is the package's
  own, documented in its README; the names resolver comes first.
- **Moments.** Chain timestamps through `fromUnixSeconds` (`'never'` past `MAX_TIME`), then `dateTimeField({now:
  context.now, value})`; `checkDeadline` / `checkDuration` say whether `EXPIRED` or `LONG_LIVED` applies. What the
  protocol means by "no deadline" (0, the largest integer) is the package's to read and document.
- **Unlimited.** `maxUint(bits)` at the protocol's width (`256` for ERC-20 approvals, `160` for Permit2 amounts, `64`
  for SPL approvals) is `unlimited: true` and `UNLIMITED_APPROVAL`. A package that also treats near-maximum values as
  unlimited says where it draws the line.
- **Texts.** Shared first: `INTENTS`, `SUMMARIES`, `LABELS`, filled with `text(template, params)`; the package's own
  through `<CHAIN>_TEXTS`; a descriptor's words through `externalText`, after checking them (`hasHiddenCharacters`
  means `HIDDEN_CHARACTERS` on that field, and a sane length). Params are display strings (`formatAmount(amount)`,
  a name or the address), so a translation shows the same values.
- **Field ids.** lowerCamel for the fixed ones (`spender`, `amount`, `maxFee`, `deadline`, `data`), `<name>-<index>`
  for repeated ones (`output-0`, `recipient-2`). Unique within an action, lists and raw fields included; every
  warning names the fields it is about.
- **Sources.** `{kind: 'builtin', decoder}` with a stable kebab-case decoder name (`native-transfer`, `erc20`,
  `system-program`, `spl-token`, `psbt`, `eip191`, `bip322`, listed in the README); `{kind: 'descriptor', format:
  'erc7730' | 'idl', id, publisher}` from the descriptor resolver's answer; `{kind: 'unknown'}` with the bytes in
  `raw`.
- **Raw.** What was left undecoded goes in `raw` as `rawField`s: call data of an unknown call, an unknown
  instruction's data (its accounts as address fields), a message that is not text. Decoded parts are not repeated
  there.
- **Nesting.** One action per call of a multicall or batch (EIP-7702 batches too), per instruction, per PSBT output
  (or a list field per output). The root is the whole: its intent says what the whole does when one thing dominates
  (a swap made of an approval and a call is `intent.swap` with the approval as an action), `intent.batch` otherwise.
- **Risk is never set.** It is the maximum of the warnings, computed by `createClearSigning`.
- **Messages never quote the payload.** Errors name what is wrong, not the bytes.

### Errors

| Situation | Throw |
| --- | --- |
| The adapter refuses the payload as malformed (`INVALID_ARGUMENT`, `INVALID_ENCODING` and the like) | `new ClearSignError('INVALID_INPUT', message, {cause})` |
| The adapter's `CHAIN_MISMATCH` (a transaction or a domain for another chain id) | `ClearSignError('CHAIN_MISMATCH', …, {cause})` |
| The adapter's `UNSUPPORTED` (a blob transaction, a v1 Solana message) | `ClearSignError('UNSUPPORTED', …, {cause})` |
| An option out of range | `ClearSignError('INVALID_ARGUMENT', …)` |
| Anything that parses but is not understood | No error: a result with a warning |

## Warnings

Raise the shared code wherever it applies, at its default severity; a package may change a severity only where its
README says why. A code of the package's own only for what no shared code says. Suggested mappings, from what the
air-gap signers in `@hzblj/crypto-airgap-<chain>` already warn about:

| Situation | Code |
| --- | --- |
| ERC-20 `approve` / `increaseAllowance`, Permit, Permit2, SPL `Approve` at `maxUint` | `UNLIMITED_APPROVAL` |
| `setApprovalForAll(…, true)`, SPL `SetAuthority`, System `Assign`, an EIP-7702 delegation | `ASSET_OWNERSHIP_TRANSFER` |
| A call or instruction nothing reads (calldata to a contract without a decoder or descriptor) | `UNKNOWN_CONTRACT_CALL` |
| Bytes that are neither text nor a known format; typed data no decoder or descriptor reads | `BLIND_SIGNING` |
| Typed data without `domain.chainId`; an EIP-7702 authorization for chain id 0 | `ALL_CHAINS` |
| An amount of a token the token list does not have | `UNKNOWN_TOKEN` |
| A message, label or name with hidden characters | `HIDDEN_CHARACTERS` |
| Permit and order deadlines, Permit2 expirations past 30 days or never | `LONG_LIVED` |
| A deadline already past | `EXPIRED` |
| A fee above the package's documented threshold (relative to what is sent, or absolute) | `HIGH_FEE` |
| Assets to an address whose relation is `unknown` | `UNKNOWN_DESTINATION` |
| A contract creation | `ethereum.CONTRACT_CREATION` (info) |
| Other signers; not the fee payer; looked-up accounts without their tables | `solana.OTHER_SIGNERS`, `solana.NOT_FEE_PAYER`, `solana.UNRESOLVED_LOOKUPS` |
| Inputs of other wallets; coin values without previous transactions; no fee known; an output with no address | `bitcoin.FOREIGN_INPUTS`, `bitcoin.UNVERIFIED_VALUES`, `bitcoin.UNKNOWN_FEE`, `bitcoin.NO_ADDRESS_OUTPUT` |

Warnings go on the action they are about (a nested call's `UNLIMITED_APPROVAL` on that call); `createClearSigning`
gathers them at the root with their paths.

## Tests

node:test via tsx (`yarn test` runs `node --conditions=source --import tsx --test 'test/**/*.test.ts'`), on
`createTestCryptoEngine({adapters: [<chain>Adapter()]})` from `@hzblj/nitro-crypto/testing`. Payloads come from the
adapter's own builders (`serializeTransaction`, `compileMessage`, `createPsbt`, `erc20.transferData`) and, where it
matters, from an independent library (viem's `encodeFunctionData`, `@solana/kit`, `@scure/btc-signer`).

- **Every export** offline (no resolvers), with sync resolvers, with async ones, and with one that throws (the result
  still comes, with `RESOLVER_FAILED`).
- **Every warning code the package raises**, from a payload that raises it, asserting the code, severity, action path
  and field ids; and a near case that does not raise it (an approval of a finite amount, a deadline in a week).
- **Hostile input:** malformed bytes (`INVALID_INPUT`, the adapter's error as `cause`), another chain
  (`CHAIN_MISMATCH`), `maxUint` approvals, expired and never-ending deadlines on a fixed clock, hidden characters in
  messages and descriptor labels, unknown contracts or programs, a descriptor that does not match its call (ignored,
  not believed), a resolver that answers nonsense.
- **Nesting:** a multicall or batch, a transaction of several instructions, a PSBT of several outputs: paths, risk per
  action, the root's risk the maximum.
- **Assert on the model,** codes, kinds, ids and `bigint` values, never on English text, except one readable
  `plainText` check per export.
- `VERSION` matches package.json (the stub's test does).
- `test/consumer.ts` grows with every export: real usage and an `@ts-expect-error` for a mistake the types refuse.
  `yarn pack:check` type-checks it against the packed tarball.

Then `yarn test`, `yarn typecheck`, `yarn lint`, `yarn biome:check` and `yarn pack:check` pass from the root.

## The README

Each package's README, in the style of the others (badges, no em dashes, the footer with Documentation, Security and
"More libraries"):

1. What it reads, in two sentences, and the install line with its peers:
   `npx expo install @hzblj/crypto-clear-sign @hzblj/crypto-clear-sign-<chain> @hzblj/crypto-<chain> @hzblj/nitro-crypto react-native-nitro-modules`.
2. Usage of every export, with the result it gives (its `plainText`, or the fields that matter).
3. **What it recognizes:** a table of decoders (the `source.decoder` names), what each reads, and the intent, fields
   and warnings it gives. Anything else is `UNKNOWN_CONTRACT_CALL` or `BLIND_SIGNING` with its raw data.
4. **Warnings:** every code it can raise (the shared ones it uses and its own) with severity and trigger, and any
   severity it changes and why.
5. **Texts:** its own text codes (`<CHAIN>_TEXTS`) and which shared ones it uses.
6. **Resolvers:** the queries it makes (token addresses or mints, names, its descriptor query), the descriptor
   format and the subset of it that it reads, and what a descriptor can and cannot make it say.
7. **Trust:** what it cannot know (simulation, on-chain state, what a contract really does), with a link to
   `SECURITY.md`.
8. **Not in this version.**

The package's `CLAUDE.md` gets its paths table and rules; the root `README.md` package table and `docs/compatibility.md`
get the package's row (edit only that row); its changeset in `.changeset/` describes what the first release does.

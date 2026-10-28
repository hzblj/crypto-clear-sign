# example

The example app for `@hzblj/crypto-clear-sign` and its chain packages: a gallery of real-world signing requests per
chain, each reviewed by its package and rendered from the model, a Paste tab for anything else, and Settings for what
a review depends on. Built from `@hzblj/kara-ui` like every hzblj example. Private; never published. Nothing in it
signs for real or broadcasts: requests are built in the app and only reviewed. The engine is `@hzblj/nitro-crypto`
from npm.

| Path | What it is |
| --- | --- |
| `app/(tabs)/` | Native tabs (`Tabs` from `@hzblj/kara-ui/router`), each a stack with a large title: Ethereum, Solana, Bitcoin (each `index`, the gallery, and `[sample]`, its review), Paste (`index`, `review`), Settings. `app/index.tsx` redirects to `/ethereum`. Route files only re-export a screen from `src/`. |
| `src/features/` | One folder per area, each a screen and what only it uses, behind an `index.ts`: `gallery` (a chain's samples with their risk, pull to refresh), `review` (a sample's review with "Open in Paste", and the pasted one's), `paste` (chain, kind, format, the text, the site asking, "Try" chips from the samples), `settings`. |
| `src/components/clear-signing/` | **The reusable review**, written to be copied into a wallet: `ClearSigningView` (the whole review from a `ClearSigning`), `RiskBadge` and `RISK_TONES`, `WarningList` (by severity, each with its action and the labels of its fields), `FieldList` and `FieldRow` (every field kind; `flagsOf` marks fields a warning names), `ActionTree`, `SourceLine`, `RawSection`, `PlainTextView`, `RelationBadge`, `Disclosure`. They import only `@hzblj/crypto-clear-sign`, kara and their siblings in `components/`. |
| `src/components/` | Shared UI besides: `Page`, `Section`, `Rows`, `Card`, `Notice`, `Pill`, `TabStack`, `CopyProvider`. |
| `src/core/` | Everything that is not UI, and what the tests run: `chains.ts` (the adapters on Ethereum mainnet, Solana mainnet-beta and Bitcoin mainnet; the demo key's accounts and strangers' addresses), `engine.ts` (the native engine and the demo accounts, once per run), `directory.ts` (the app's token list and address book), `options.ts` (settings into each chain's options, the bundled ERC-7730 registry), `review.ts` (`ReviewRequest`, and `review`: one request through its chain package), `paste.ts` (text into a request, a request back into text), `samples/` (one file per chain, `abi.ts` and `psbt.ts` to write call data and PSBTs, `runSample`). |
| `src/store/` | Zustand stores in the `core-store` pattern: `persist(immer(...))`, a slice per concern, selectors from `auto-zustand-selectors-hook`. `settings` (persisted in MMKV, unencrypted: addresses and switches), `review` (not persisted: the Paste draft and the last pasted review). |
| `src/hooks/` | `useDemo` (the engine and the demo accounts, or why there are none), `useSampleOutcomes` (a chain's samples reviewed once per settings, shared by the gallery and the review), `useReviewSettings`, `useLocalization`. |
| `src/config/` | `theme.ts` (the sky-blue accent), `translations.ts` (the Czech table by code, the risk words). |
| `src/utils/` | Base64 and hex for pasted text, `shortAddress`. |
| `test/` | Node tests on the WebAssembly engine (`@hzblj/nitro-crypto/testing`): `samples.test.ts` runs every sample through the packages, resolved and offline, and asserts its risk and every warning code; `paste.test.ts` pastes every sample back as text and checks the errors; `translations.test.ts` holds the Czech table to the library's codes. |
| `assets/icons/` | Material Symbols SVGs, only those the app uses, turned into native assets by kara's plugin at prebuild; `native-icons.d.ts` is written from them (`npx native-icons ./assets/icons`). |
| `assets/app.icon`, `assets/icon.png`, `assets/adaptive-icon.png` | The app icon: an Icon Composer document (a signing request with a check, Liquid Glass) for iOS; the same shapes on a sky gradient as the fallback, and alone on `ICON_BACKGROUND` for Android. Its own name, bundle id and scheme, so it installs beside the other examples. |

**Folders are layers, and imports point down.** `features` may use every other folder; `hooks` use `core`, `store`,
`config` and `utils`; `store` uses `core` and `config` (types and defaults); `core` uses `utils`; `components`,
`config` and `utils` use nothing of the app's (types aside). Across folders, import a folder's `index.ts`; inside one,
the sibling file. The tests import `core` files directly, never `core/index.ts`, which loads the native engine.

**One review path.** A sample builds a `ReviewRequest` (and a `ReviewContext`: the site asking, IDLs, lookup tables,
an indexer's assets), and `review` hands it to its chain package with the options the settings make. The Paste tab
parses text into the same request. Nothing renders anything but the `ClearSigning` that comes back.

**Samples are built, not described.** Call data is ABI-encoded (`samples/abi.ts`, selectors by the engine's
Keccak-256), Solana messages compiled by the adapter, PSBTs written by `samples/psbt.ts` (or the adapter's own
`createPsbt`), from the demo key's accounts: what a dApp would send. Every sample is built relative to one `now`, so
deadlines read the same any day. A new sample gets its row in `test/samples.test.ts`'s `EXPECTED` (risk and every
warning code, resolved and offline): the test fails on any sample it does not know.

**Render the model, never strings.** Words through `localize` (by code, with the model's params), amounts through
`formatAmount` (exact, grouped, unlimited in words), risk only from `result.risk` and each action's `risk`, never
recomputed. A field kind or warning code the components do not know shows by its label or its message.

**Native views need a native parent.** Kara's native atoms (`Button`, `TextField`, `Switch`, `LabeledContent`) live in
an `Island`, and inside a native stack (`VStack`, `HStack`, `Rows`) only native children or Fragments. The review
components are React Native throughout (`Box`, `RnText`, `Pressable`), so they nest anywhere. Kara's `TextField` is
uncontrolled: a value set from outside remounts it through a `key` (`revision` in the Paste draft and in Settings).

**Settings change every review.** A signer the chain cannot read (a half-typed address) makes every sample of that
chain `INVALID_ARGUMENT`, which the gallery shows per row; so does, on Solana, a transaction or off-chain message the
signer does not sign (Bitcoin says the same with `bitcoin.NO_OWN_INPUTS`, a warning). On Bitcoin, one of the demo
key's addresses also passes its account keys (`accounts`), so change is verified by derivation; another address is
`signer` alone.

**Main networks, no network access.** The adapters are on Ethereum mainnet (chain id 1), Solana mainnet-beta and
Bitcoin mainnet so the registry's descriptors and the built-in token lists apply; the app fetches nothing.

**Native changes need a rebuild**: `yarn prebuild`, then a native run.

**Few words on screen.** No lead paragraphs under titles and no captions on gallery rows: a sample shows its title,
its summary and its risk, and the review says the rest. Section captions are one short line, only where a control
needs it. A sample's `caption` documents it in code and in tests; the app does not show it.

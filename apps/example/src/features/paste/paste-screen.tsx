import {isClearSignError} from '@hzblj/crypto-clear-sign'
import {Box, Button, Chip, Island, SegmentedControl, TextField, VStack} from '@hzblj/kara-ui'
import {getStringAsync} from 'expo-clipboard'
import {type Href, useRouter} from 'expo-router'
import {useState} from 'react'

import {Notice, Page, Section} from '../../components'
import {
  CHAIN_IDS,
  type ChainId,
  MESSAGE_FORMATS,
  type MessageFormat,
  PASTE_KINDS,
  type PasteKind,
  parsePaste,
  pasteContext,
  pasteTextOf,
  payloadOf,
  review,
  reviewOptions,
} from '../../core'
import {useDemo, useReviewSettings, useSampleOutcomes} from '../../hooks'
import {useReviewStore} from '../../store'

const CHAINS: {readonly [Id in ChainId]: string} = {bitcoin: 'Bitcoin', ethereum: 'Ethereum', solana: 'Solana'}

const KINDS: {readonly [Kind in PasteKind]: string} = {
  authorization: '7702 auth',
  message: 'Message',
  psbt: 'PSBT',
  transaction: 'Transaction',
  'typed-data': 'Typed data',
}

const FORMATS: {readonly [Format in MessageFormat]: string} = {base64: 'Base64', hex: 'Hex', text: 'Text'}

/** What the field takes for each kind, said under it. */
const HINTS: {readonly [Id in ChainId]: Partial<{readonly [Kind in PasteKind]: string}>} = {
  bitcoin: {message: 'The message a BIP-322 signature would sign.', psbt: 'A PSBT, Base64 or hex.'},
  ethereum: {
    authorization: 'JSON: {"address": "0x…", "nonce": 7, "chainId": 1}. Chain id 0 is every chain.',
    message: 'personal_sign: text, or its bytes as hex or Base64.',
    transaction: 'The unsigned transaction, hex: legacy, EIP-2930, EIP-1559 or EIP-7702.',
    'typed-data': 'The JSON of eth_signTypedData_v4: domain, types, primaryType, message.',
  },
  solana: {
    message: 'Text, Sign In With Solana, or bytes (an off-chain message) as hex or Base64.',
    transaction: 'The wire transaction a dApp sends, Base64 or hex, signatures empty.',
  },
}

/** Samples of the chain whose request is of `kind`: what "Try" fills the field with. */
const useExamples = (chain: ChainId, kind: PasteKind) => {
  const {run} = useSampleOutcomes(chain)

  return (run?.outcomes ?? []).flatMap(outcome =>
    'request' in outcome && outcome.request.request.kind === kind ? [outcome] : []
  )
}

/**
 * Anything a wallet could be asked to sign, pasted: the chain and kind, the text (hex, Base64, JSON or text), and for
 * a message the site that asks. It goes through the same `review` as the samples; text that does not read, and what
 * the chain packages refuse, come back as `ClearSignError` codes.
 */
export const PasteScreen = () => {
  const router = useRouter()
  const demo = useDemo()
  const settings = useReviewSettings()
  const draft = useReviewStore.use.draft()
  const editDraft = useReviewStore.use.editDraft()
  const replaceDraft = useReviewStore.use.replaceDraft()
  const setPasted = useReviewStore.use.setPasted()
  const examples = useExamples(draft.chain, draft.kind)
  const [error, setError] = useState<{code: string; message: string} | null>(null)
  const [busy, setBusy] = useState(false)
  const kinds: readonly PasteKind[] = PASTE_KINDS[draft.chain]
  const message = draft.kind === 'message'

  const start = (chain: ChainId, kind: PasteKind) => {
    setError(null)
    replaceDraft({chain, format: 'text', kind, origin: '', text: ''})
  }

  const fromClipboard = async () => {
    const text = await getStringAsync()
    setError(null)
    replaceDraft({...draft, text})
  }

  const submit = async () => {
    if (demo.status !== 'ready') {
      return
    }

    setBusy(true)
    setError(null)

    try {
      const request = parsePaste(draft.chain, draft.kind, draft.text, message ? draft.format : 'text')
      const now = Date.now()
      const env = {accounts: demo.accounts, crypto: demo.crypto, now}
      const result = await review(
        demo.crypto,
        request,
        reviewOptions(settings, demo.accounts, now),
        pasteContext(env, message ? draft.origin : '')
      )
      setPasted({now, payload: payloadOf(request), request, result})
      router.push('/paste/review' as Href)
    } catch (failure) {
      setError(
        isClearSignError(failure)
          ? {code: failure.code, message: failure.message}
          : {code: 'ERROR', message: failure instanceof Error ? failure.message : String(failure)}
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page testID="paste">
      <Section title="Chain">
        <SegmentedControl
          onChange={index => {
            const chain = CHAIN_IDS[index] ?? 'ethereum'
            start(chain, PASTE_KINDS[chain][0])
          }}
          selectedIndex={Math.max(0, CHAIN_IDS.indexOf(draft.chain))}
          testID="paste-chain"
          values={CHAIN_IDS.map(chain => CHAINS[chain])}
        />
      </Section>
      <Section caption={HINTS[draft.chain][draft.kind]} title="Kind">
        <SegmentedControl
          onChange={index => start(draft.chain, kinds[index] ?? 'message')}
          selectedIndex={Math.max(0, kinds.indexOf(draft.kind))}
          testID="paste-kind"
          values={kinds.map(kind => KINDS[kind])}
        />
        {message ? (
          <SegmentedControl
            onChange={index => editDraft({format: MESSAGE_FORMATS[index] ?? 'text'})}
            selectedIndex={Math.max(0, MESSAGE_FORMATS.indexOf(draft.format))}
            testID="paste-format"
            values={MESSAGE_FORMATS.map(format => FORMATS[format])}
          />
        ) : null}
      </Section>
      {examples.length > 0 ? (
        <Section title="Try">
          <Box gap="s8" row wrap>
            {examples.map(outcome =>
              'request' in outcome ? (
                <Chip
                  key={outcome.sample.id}
                  label={outcome.sample.title}
                  onPress={() => {
                    const {format, text} = pasteTextOf(outcome.request.request)
                    setError(null)
                    replaceDraft({...draft, format, origin: outcome.request.context?.origin ?? '', text})
                  }}
                  testID={`try-${outcome.sample.id}`}
                />
              ) : null
            )}
          </Box>
        </Section>
      ) : null}
      <Island>
        <VStack key={draft.revision} spacing="s12" wide>
          <TextField
            defaultValue={draft.text}
            label="Payload"
            multiline
            onChangeText={text => editDraft({text})}
            testID="paste-text"
          />
          {message ? (
            <TextField
              defaultValue={draft.origin}
              label="Site asking (for sign-in messages)"
              onChangeText={origin => editDraft({origin})}
              testID="paste-origin"
            />
          ) : null}
          <Button
            disabled={busy || demo.status !== 'ready' || draft.text.trim() === ''}
            label={busy ? 'Reading…' : 'Review'}
            onPress={submit}
            testID="paste-review-button"
          />
          <Button label="Paste from the clipboard" onPress={fromClipboard} variant="secondary" />
        </VStack>
      </Island>
      {error ? (
        <Box gap="s4" testID="paste-error">
          <Notice text={error.message} title={error.code} tone="destructive" />
        </Box>
      ) : null}
    </Page>
  )
}

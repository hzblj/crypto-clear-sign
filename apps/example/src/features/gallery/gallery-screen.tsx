import {isClearSignError, localize} from '@hzblj/crypto-clear-sign'
import {Box, EmptyState, Island, Pressable, RnIcon, RnText, Skeleton} from '@hzblj/kara-ui'
import {type Href, useRouter} from 'expo-router'

import {Lead, Notice, Page, Pill, RiskBadge} from '../../components'
import {type ChainId, type SampleOutcome, signerOf} from '../../core'
import {useLocalization, useReviewSettings, useSampleOutcomes} from '../../hooks'
import {shortAddress} from '../../utils'

const LEADS: {readonly [Id in ChainId]: string} = {
  bitcoin:
    'PSBTs and messages for the demo key’s native SegWit and Taproot accounts, read by @hzblj/crypto-clear-sign-bitcoin: whose coins, who is paid, the fee, what each signature leaves open, where inscriptions and runes go.',
  ethereum:
    'What dApps ask an Ethereum wallet to sign, read by @hzblj/crypto-clear-sign-ethereum: transactions, typed data, messages and authorizations, from the bytes that would be signed. Tap one for its review.',
  solana:
    'Transactions and messages as Solana dApps send them, read by @hzblj/crypto-clear-sign-solana: one action per instruction, lookup tables, IDLs.',
}

const Row = ({chain, outcome}: {chain: ChainId; outcome: SampleOutcome}) => {
  const router = useRouter()
  const {riskLabels, translations} = useLocalization()
  const {sample} = outcome

  return (
    <Pressable
      accessibilityHint="Opens the review"
      bg="surface.primary"
      borderRadius="large"
      gap="s8"
      onPress={() => router.push(`/${chain}/${sample.id}` as Href)}
      p="s16"
      testID={`sample-${sample.id}`}
    >
      <Box align="center" gap="s8" row>
        <RnText fill variant="subheadlineMedium">
          {sample.title}
        </RnText>
        {'result' in outcome ? (
          <RiskBadge label={riskLabels[outcome.result.risk]} level={outcome.result.risk} size="small" />
        ) : (
          <Pill label="Error" tone="destructive" />
        )}
        <RnIcon color="content.tertiary" name="chevron-right" size="s16" />
      </Box>
      {'result' in outcome ? (
        <RnText color="content.primary" numberOfLines={2} variant="footnote">
          {localize(outcome.result.summary ?? outcome.result.intent, translations)}
        </RnText>
      ) : (
        <RnText color="content.destructive" variant="footnote">
          {isClearSignError(outcome.error) ? outcome.error.code : String(outcome.error)}
        </RnText>
      )}
      <RnText color="content.tertiary" numberOfLines={2} variant="caption">
        {sample.caption}
      </RnText>
    </Pressable>
  )
}

/**
 * A chain's gallery: every sample built from the adapters, reviewed with the current settings, by its risk. The same
 * results open in each sample's screen.
 */
export const GalleryScreen = ({chain}: {chain: ChainId}) => {
  const {demo, refresh, run} = useSampleOutcomes(chain)
  const settings = useReviewSettings()

  if (demo.status === 'unavailable') {
    return (
      <Page>
        <Island>
          <EmptyState description={demo.message} icon="warning-filled" title="No native engine" />
        </Island>
      </Page>
    )
  }

  const signer = demo.status === 'ready' ? signerOf(settings, demo.accounts, chain) : undefined

  return (
    <Page onRefresh={refresh} testID={`gallery-${chain}`}>
      <Box gap="s12">
        <Lead>{LEADS[chain]}</Lead>
        <Box gap="s6" row wrap>
          <Pill label={signer === undefined ? 'No signer' : `Signer ${shortAddress(signer)}`} tone="accent" />
          <Pill label={settings.resolvers ? 'Resolvers on' : 'Resolvers off'} />
          <Pill label={settings.builtins ? 'Built-in lists on' : 'Built-in lists off'} />
        </Box>
      </Box>
      {run === null ? (
        <Box gap="s12">
          <Skeleton h={96} w="100%" />
          <Skeleton h={96} w="100%" />
          <Skeleton h={96} w="100%" />
        </Box>
      ) : (
        <Box gap="s12">
          {run.outcomes.map(outcome => (
            <Row chain={chain} key={outcome.sample.id} outcome={outcome} />
          ))}
        </Box>
      )}
      <Notice
        text="Nothing here is signed or broadcast: every request is built in the app, read by the chain package, and only shown."
        tone="info"
      />
    </Page>
  )
}

import {isClearSignError} from '@hzblj/crypto-clear-sign'
import {Box, Button, Island, Skeleton} from '@hzblj/kara-ui'
import {type Href, Stack, useLocalSearchParams, useRouter} from 'expo-router'

import {ClearSigningView, Notice, Page, Pill} from '../../components'
import {type ChainId, type PasteKind, pasteTextOf, payloadOf, sampleOf} from '../../core'
import {useLocalization, useSampleOutcomes} from '../../hooks'
import {useReviewStore} from '../../store'

/**
 * One sample's review: what it is, then the whole `ClearSigningView`. The request can be opened in the Paste tab, to
 * change a byte and see what the review makes of it.
 */
export const SampleReviewScreen = ({chain}: {chain: ChainId}) => {
  const {sample: id} = useLocalSearchParams<{sample: string}>()
  const router = useRouter()
  const {run} = useSampleOutcomes(chain)
  const {riskLabels, translations} = useLocalization()
  const replaceDraft = useReviewStore.use.replaceDraft()
  const sample = id === undefined ? undefined : sampleOf(chain, id)
  const outcome = run?.outcomes.find(entry => entry.sample.id === id)

  if (sample === undefined) {
    return (
      <Page>
        <Notice text="There is no sample by that name." tone="destructive" />
      </Page>
    )
  }

  const openInPaste = () => {
    if (outcome === undefined || !('request' in outcome)) {
      return
    }

    const {format, text} = pasteTextOf(outcome.request.request)
    replaceDraft({
      chain,
      format,
      kind: outcome.request.request.kind as PasteKind,
      origin: outcome.request.context?.origin ?? '',
      text,
    })
    router.navigate('/paste' as Href)
  }

  return (
    <Page testID={`review-${sample.id}`}>
      <Stack.Screen options={{title: sample.title}} />
      <Box gap="s8">
        {outcome !== undefined && 'request' in outcome && outcome.request.context?.origin !== undefined ? (
          <Box row>
            <Pill label={`Asked by ${outcome.request.context.origin}`} />
          </Box>
        ) : null}
      </Box>
      {outcome === undefined || run === null ? (
        <Box gap="s12">
          <Skeleton h={120} w="100%" />
          <Skeleton h={240} w="100%" />
        </Box>
      ) : 'error' in outcome ? (
        <Notice
          text={outcome.error instanceof Error ? outcome.error.message : String(outcome.error)}
          title={isClearSignError(outcome.error) ? outcome.error.code : 'Not reviewed'}
          tone="destructive"
        />
      ) : (
        <>
          <ClearSigningView
            now={run.now}
            payload={payloadOf(outcome.request.request)}
            result={outcome.result}
            riskLabels={riskLabels}
            testID="clear-signing"
            translations={translations}
          />
          <Island>
            <Button label="Open in Paste" onPress={openInPaste} testID="open-in-paste" variant="secondary" />
          </Island>
        </>
      )}
    </Page>
  )
}

import {ClearSigningView, Notice, Page} from '../../components'
import {useLocalization} from '../../hooks'
import {useReviewStore} from '../../store'

/** The review of what was pasted: the same view as every sample's. */
export const PasteReviewScreen = () => {
  const pasted = useReviewStore.use.pasted()
  const {riskLabels, translations} = useLocalization()

  return (
    <Page testID="paste-review">
      {pasted === null ? (
        <Notice text="Paste a request and review it first." />
      ) : (
        <ClearSigningView
          now={pasted.now}
          payload={pasted.payload}
          result={pasted.result}
          riskLabels={riskLabels}
          testID="clear-signing"
          translations={translations}
        />
      )}
    </Page>
  )
}

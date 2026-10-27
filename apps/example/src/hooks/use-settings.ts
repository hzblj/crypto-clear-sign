import {useMemo} from 'react'

import {RISK_LABELS, translationsFor} from '../config'
import type {ReviewSettings} from '../core'
import {useSettingsStore} from '../store'

/** The review settings as one value, the same object while none of them changes. */
export const useReviewSettings = (): ReviewSettings => {
  const signers = useSettingsStore.use.signers()
  const resolvers = useSettingsStore.use.resolvers()
  const builtins = useSettingsStore.use.builtins()

  return useMemo(() => ({builtins, resolvers, signers}), [builtins, resolvers, signers])
}

/** The language's translation table (none for English) and its words for the risk levels. */
export const useLocalization = () => {
  const language = useSettingsStore.use.language()

  return useMemo(() => ({riskLabels: RISK_LABELS[language], translations: translationsFor(language)}), [language])
}

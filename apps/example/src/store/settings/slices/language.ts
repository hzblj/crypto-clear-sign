import type {CreateLanguageSlice} from '../types'

export const languageSlice: CreateLanguageSlice = set => ({
  language: 'en',
  setLanguage: language =>
    set(state => {
      state.language = language
    }),
})

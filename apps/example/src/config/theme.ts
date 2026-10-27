import {adaptive, defineTheme} from '@hzblj/kara-ui'

/**
 * A sky-blue accent, apart from the other examples' indigo and emerald so none passes for another: every accent token
 * is set in one place, and the Android seed moves with them. Risk keeps to the theme's red and green (see
 * `components/clear-signing/risk.ts`), so the accent never reads as a warning.
 */
export const theme = defineTheme({
  colors: {
    border: {accent: '#0284c7'},
    content: {accent: adaptive({dark: '#7dd3fc', light: '#0369a1'})},
    fill: {
      accent: {
        base: adaptive({dark: '#0284c733', light: '#e0f2fe'}),
        disabled: adaptive({dark: '#0284c71f', light: '#bae6fd'}),
        primary: '#0284c7',
      },
    },
    shadow: {btn: {accent: {ring: adaptive({dark: '#0284c700', light: '#a5dcf7'})}}},
  },
  materialSeed: '#0284c7',
})

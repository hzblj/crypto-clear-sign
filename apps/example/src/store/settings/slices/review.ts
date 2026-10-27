import {DEFAULT_SETTINGS} from '../../../core'
import type {CreateReviewSlice} from '../types'

export const reviewSlice: CreateReviewSlice = set => ({
  ...DEFAULT_SETTINGS,
  setBuiltins: on =>
    set(state => {
      state.builtins = on
    }),
  setResolvers: on =>
    set(state => {
      state.resolvers = on
    }),
  setSigner: (chain, signer) =>
    set(state => {
      if (signer === undefined) {
        delete state.signers[chain]
      } else {
        state.signers[chain] = signer
      }
    }),
})

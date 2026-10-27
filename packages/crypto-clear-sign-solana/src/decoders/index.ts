import {
  ASSOCIATED_TOKEN_PROGRAM,
  COMPUTE_BUDGET_PROGRAM,
  LOOKUP_TABLE_PROGRAM,
  MEMO_PROGRAM,
  MEMO_V1_PROGRAM,
  MEMO_V4_PROGRAM,
  STAKE_PROGRAM,
  SYSTEM_PROGRAM,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
  UPGRADEABLE_LOADER_PROGRAM,
} from '../programs'
import {describeAssociatedToken} from './associated-token'
import {describeComputeBudget} from './compute-budget'
import {describeLoader} from './loader'
import {describeLookupTable} from './lookup-table'
import {describeMemo} from './memo'
import {describeStake} from './stake'
import {describeSystem} from './system'
import {describeToken} from './token'
import type {Decoder} from './types'

/** The built-in decoders by program, each with its `source.decoder` name. They come before any descriptor. */
export const BUILTIN_DECODERS: ReadonlyMap<string, {readonly decoder: string; readonly describe: Decoder}> = new Map([
  [ASSOCIATED_TOKEN_PROGRAM, {decoder: 'associated-token-account', describe: describeAssociatedToken}],
  [COMPUTE_BUDGET_PROGRAM, {decoder: 'compute-budget', describe: describeComputeBudget}],
  [LOOKUP_TABLE_PROGRAM, {decoder: 'address-lookup-table', describe: describeLookupTable}],
  [MEMO_PROGRAM, {decoder: 'memo', describe: describeMemo}],
  [MEMO_V1_PROGRAM, {decoder: 'memo', describe: describeMemo}],
  [MEMO_V4_PROGRAM, {decoder: 'memo', describe: describeMemo}],
  [STAKE_PROGRAM, {decoder: 'stake-program', describe: describeStake}],
  [SYSTEM_PROGRAM, {decoder: 'system-program', describe: describeSystem}],
  [TOKEN_2022_PROGRAM, {decoder: 'spl-token-2022', describe: describeToken}],
  [TOKEN_PROGRAM, {decoder: 'spl-token', describe: describeToken}],
  [UPGRADEABLE_LOADER_PROGRAM, {decoder: 'bpf-upgradeable-loader', describe: describeLoader}],
])

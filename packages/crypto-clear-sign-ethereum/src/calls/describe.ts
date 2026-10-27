import {type ActionInput, type Field, warning} from '@hzblj/crypto-clear-sign'
import {hex} from '@hzblj/nitro-crypto/adapter'

import {AbiError, decodeCall} from '../abi'
import {ETHEREUM_TEXTS, ETHEREUM_WARNINGS} from '../catalogs'
import type {Env} from '../env'
import {describeCallByDescriptor} from '../erc7730/apply'
import {builtinsFor} from './builtins'
import {type Call, type Described, MAX_CALL_DEPTH, nativeTransfer, Unreadable, unknownCall} from './common'

/** The call's ether, shown when its action does not show it already, with `UNEXPECTED_VALUE` for a non-payable one. */
const withValue = (env: Env, call: Call, described: Described): Described => {
  if (call.value === 0n || described.showsValue === true) {
    return described
  }

  const value: Field = env.nativeAmount({id: 'value', label: ETHEREUM_TEXTS.label.value, value: call.value})

  return {
    ...described,
    fields: [...(described.fields ?? []), value],
    showsValue: true,
    warnings: [
      ...(described.warnings ?? []),
      ...(described.payable === false ? [warning(ETHEREUM_WARNINGS.UNEXPECTED_VALUE, {fields: ['value']})] : []),
    ],
  }
}

/**
 * A call, described: ether alone is a transfer; call data is read by a built-in decoder for its selector (and
 * contract, for WETH and Permit2), else by the descriptor the resolver answers, else shown raw with
 * `UNKNOWN_CONTRACT_CALL`. Calls inside calls (multicalls, batches, a descriptor's `calldata` fields) come back here one
 * level deeper, up to `MAX_CALL_DEPTH`. Internal.
 */
export const describeCall = async (env: Env, call: Call): Promise<Described> => {
  if (call.data.length === 0) {
    return nativeTransfer(env, call)
  }

  if (call.data.length < 4 || call.depth > MAX_CALL_DEPTH) {
    return unknownCall(env, call)
  }

  const selector = `0x${hex.encode(call.data.subarray(0, 4))}`
  const nested = (inner: Call): Promise<ActionInput> => describeCall(env, inner)

  for (const builtin of builtinsFor(env, selector, call.to)) {
    try {
      const described = await builtin.describe({args: decodeCall(builtin.fn, call.data), call, env, nested})

      if (described !== undefined) {
        return withValue(env, call, {payable: builtin.payable, ...described})
      }
    } catch (error) {
      // Arguments that do not decode, or do not read as the function says: the next reader may know better.
      if (!(error instanceof AbiError || error instanceof Unreadable)) {
        throw error
      }
    }
  }

  const applied = await describeCallByDescriptor(env, call, nested)

  if (applied.described !== undefined) {
    return withValue(env, call, applied.described)
  }

  return unknownCall(env, call, applied.warnings)
}

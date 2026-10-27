import type {ActionInput} from '@hzblj/crypto-clear-sign'

import type {ActionBuilder, Instruction, Scope} from '../scope'

/**
 * A built-in decoder: one instruction of its program, read into an action. It throws `MalformedData` when the data
 * or the accounts are not what the instruction needs, and the instruction is then shown raw.
 */
export type Decoder = (instruction: Instruction, build: ActionBuilder, scope: Scope) => Promise<ActionInput>

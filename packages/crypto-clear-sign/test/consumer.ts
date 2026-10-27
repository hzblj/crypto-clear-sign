/**
 * What a consumer of @hzblj/crypto-clear-sign writes: a chain package building a result, an app rendering one. Type
 * checked against the packed tarball by scripts/pack-check.mjs, and against the source by this package's type check.
 * Each `@ts-expect-error` proves the types are real: an unresolved declaration would make every import `any`.
 */
import {
  type ClearSigning,
  type ClearSignOptions,
  createClearSigning,
  createResolverContext,
  defineTexts,
  defineWarnings,
  type Field,
  formatAmount,
  formatField,
  INTENTS,
  isClearSignError,
  LABELS,
  localize,
  maxUint,
  plainText,
  type Resolvers,
  SUMMARIES,
  type TokenResolver,
  text,
  WARNINGS,
  type Warning,
  warning,
  warningsAt,
} from '@hzblj/crypto-clear-sign'

type Query = {readonly address: string; readonly selector: string}
type Content = {readonly intent: string}

const TEXTS = defineTexts('ethereum', {label: {gasLimit: 'Gas limit'}})
const ETHEREUM_WARNINGS = defineWarnings('ethereum', {
  DELEGATION: {message: 'A contract runs code as your account.', severity: 'critical'},
})

export const describeApproval = async (
  spender: string,
  value: bigint,
  tokens: TokenResolver,
  options: ClearSignOptions<Query, Content>
): Promise<ClearSigning> => {
  const chain = {family: 'ethereum', id: 'eip155:1', name: 'Ethereum'} as const
  const resolvers: Resolvers<Query, Content> = {...options.resolvers, tokens}
  const context = createResolverContext({
    chain,
    normalize: address => address.toLowerCase(),
    resolvers,
    signer: options.signer,
  })
  const described = await context.descriptor({address: spender, selector: '0x095ea7b3'})
  const intent: string | undefined = described?.content.intent
  const amount = await context.amount({
    id: 'amount',
    label: LABELS.amount,
    token: spender,
    unlimited: value === maxUint(256),
    value,
  })

  return createClearSigning({
    chain,
    fields: [await context.address({id: 'spender', label: LABELS.spender, value: spender}), amount],
    intent: intent === undefined ? INTENTS.approve : {code: 'external', text: intent},
    kind: 'transaction',
    source: {decoder: 'erc20', kind: 'builtin'},
    summary: text(SUMMARIES.approve, {amount: formatAmount(amount), spender}),
    warnings: [
      warning(WARNINGS.UNLIMITED_APPROVAL, {fields: ['amount']}),
      warning(ETHEREUM_WARNINGS.DELEGATION),
      ...context.warnings(),
    ],
  })
}

export const render = (result: ClearSigning, translations: Readonly<Record<string, string>>) => {
  const code: 'ethereum.DELEGATION' = ETHEREUM_WARNINGS.DELEGATION.code
  const label: 'ethereum.label.gasLimit' = TEXTS.label.gasLimit.code
  const first: Warning | undefined = result.warnings[0]
  const field: Field | undefined = result.fields[0]
  const relation = field?.kind === 'address' ? field.relation : undefined
  const rows = result.fields.map(entry => `${localize(entry.label, translations)}: ${formatField(entry)}`)
  const nested = result.actions.map(action => warningsAt(result, action.path).length)

  // @ts-expect-error: a field's kind is one of the model's
  createClearSigning({...result, fields: [{kind: 'token', label: LABELS.token}]})
  // @ts-expect-error: what is signed is one of the model's kinds
  createClearSigning({...result, kind: 'signature'})
  // @ts-expect-error: an amount is a bigint of base units
  formatAmount({decimals: 6, value: 1})
  // @ts-expect-error: a warning is raised from its definition, not its code
  warning('UNLIMITED_APPROVAL')
  // @ts-expect-error: only an address field has a relation
  const amountRelation = field?.kind === 'amount' ? field.relation : undefined

  return [
    code,
    label,
    first,
    relation,
    amountRelation,
    rows,
    nested,
    plainText(result),
    isClearSignError(null, 'INVALID_INPUT'),
  ]
}

import type {BitcoinPsbt, BitcoinPsbtInput, BitcoinPsbtOutput} from '@hzblj/crypto-bitcoin'
import {
  type ActionInput,
  type AddressField,
  addressField,
  amountField,
  booleanField,
  ClearSignError,
  type ClearSigning,
  createClearSigning,
  createResolverContext,
  type DisplayText,
  dateTimeField,
  durationField,
  type Field,
  type FieldCommon,
  formatAmount,
  fromUnixSeconds,
  hasHiddenCharacters,
  INTENTS,
  LABELS,
  LONG_LIVED_AFTER,
  listField,
  numberField,
  rawField,
  SUMMARIES,
  text,
  textField,
  WARNINGS,
  type WarningInput,
  warning,
} from '@hzblj/crypto-clear-sign'
import {isCryptoError} from '@hzblj/nitro-crypto/adapter'

import {type AssetFlow, assetFlow, lookUpAssets} from './assets'
import {concatBytes, decodeBase64, decodeUtf8, instructions, isOpReturn} from './bytes'
import {BITCOIN_TEXTS, BITCOIN_WARNINGS} from './catalogs'
import {chainRef, symbolOf} from './chain'
import {describeRunestone} from './describe-runes'
import type {BitcoinClearSignChain, BitcoinClearSignOptions, BitcoinCoinAssets} from './options'
import {createOwnership, type Ownership} from './ownership'
import {decipher} from './runes'
import {
  feeRate,
  isTaprootInput,
  LOCKTIME_THRESHOLD,
  lockTimeEnforced,
  readSighash,
  relativeLock,
  type SighashReading,
  signalsReplaceable,
  transactionSize,
} from './transaction'

const LABEL = BITCOIN_TEXTS.label

/** `HIGH_FEE` defaults: the fee rate (sat/vB), the share of what is sent (percent), and the fee itself (sats). */
export const DEFAULT_MAX_FEE_RATE = 500
export const DEFAULT_MAX_FEE_PERCENT = 10
export const DEFAULT_MAX_FEE = 1_000_000n

/** The share check counts only fees above this many satoshis, so dust-sized payments (an inscription's postage) pass. */
const PERCENT_FLOOR = 10_000n

/** A block's expected interval: how a lock time by height is compared with `LONG_LIVED_AFTER`. */
const BLOCK_MS = 10 * 60 * 1000

const invalidArgument = (message: string) => new ClearSignError('INVALID_ARGUMENT', message)

const positive = (value: unknown, name: string, fallback: number): number => {
  if (value === undefined) {
    return fallback
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw invalidArgument(`${name} is a number above 0.`)
  }

  return value
}

const readLimits = (options: BitcoinClearSignOptions) => {
  if (options.maxFee !== undefined && (typeof options.maxFee !== 'bigint' || options.maxFee < 0n)) {
    throw invalidArgument('maxFee is a bigint of satoshis, 0 or more.')
  }

  if (
    options.tipHeight !== undefined &&
    (typeof options.tipHeight !== 'number' || !Number.isSafeInteger(options.tipHeight) || options.tipHeight < 0)
  ) {
    throw invalidArgument('tipHeight is a block height, a whole number 0 or more.')
  }

  return {
    fee: options.maxFee ?? DEFAULT_MAX_FEE,
    percent: positive(options.maxFeePercent, 'maxFeePercent', DEFAULT_MAX_FEE_PERCENT),
    rate: positive(options.maxFeeRate, 'maxFeeRate', DEFAULT_MAX_FEE_RATE),
  }
}

/** The PSBT's bytes, from bytes or Base64 text. */
const readBytes = (psbt: Uint8Array | string): Uint8Array => {
  if (psbt instanceof Uint8Array) {
    return psbt
  }

  const bytes = typeof psbt === 'string' ? decodeBase64(psbt) : undefined

  if (bytes === undefined) {
    throw new ClearSignError('INVALID_INPUT', 'A PSBT is bytes, or Base64 text.')
  }

  return bytes
}

/** The adapter's reading, its refusals as `ClearSignError`s with its error as the cause. */
const decode = (chain: BitcoinClearSignChain, bytes: Uint8Array): BitcoinPsbt => {
  try {
    return chain.decodePsbt(bytes)
  } catch (error) {
    if (isCryptoError(error, 'UNSUPPORTED')) {
      throw new ClearSignError('UNSUPPORTED', 'This kind of PSBT is not supported.', {cause: error})
    }

    throw new ClearSignError('INVALID_INPUT', 'The PSBT could not be read.', {cause: error})
  }
}

type Input = {
  readonly index: number
  readonly input: BitcoinPsbtInput
  readonly owner: Ownership
  readonly sighash: SighashReading
  /** Whether this review is about its signature: the signer's, or anyone's when no account was given. */
  readonly signs: boolean
  readonly taproot: boolean
}

type Role = 'change' | 'self' | 'payment' | 'data' | 'runestone' | 'script'

type Output = {
  readonly index: number
  readonly output: BitcoinPsbtOutput
  readonly role: Role
  readonly owner?: Ownership
  readonly to?: AddressField
}

const isOwn = (output: Output) => output.role === 'change' || output.role === 'self'

const sum = (values: readonly bigint[]) => values.reduce((total, value) => total + value, 0n)

/** An `OP_RETURN` output's data: its pushes as text when they read as text, else as bytes (the script, if not pushes). */
const dataField = (script: Uint8Array): Field | undefined => {
  const parsed = instructions(script.subarray(1))
  const pushes = parsed?.every(instruction => 'push' in instruction)
    ? concatBytes(parsed.map(instruction => ('push' in instruction ? instruction.push : new Uint8Array())))
    : undefined

  if (pushes === undefined) {
    return rawField({id: 'data', label: LABELS.data, value: script})
  }

  if (pushes.length === 0) {
    return undefined
  }

  const words = decodeUtf8(pushes)

  return words !== undefined && words.trim() !== '' && !hasHiddenCharacters(words)
    ? textField({id: 'data', label: LABELS.data, value: words})
    : rawField({id: 'data', label: LABELS.data, value: pushes})
}

/**
 * What a PSBT (BIP-174 version 0) asks its signer to agree to, read by the chain client's `decodePsbt`: every input
 * (its address, its value and whether that value is checked, whose coin it is, its signature type), every output as
 * an action (a payment, change, a transfer to yourself, `OP_RETURN` data or a runestone), the fee and fee rate, lock
 * times, and what the user's accounts give and get. The intent is "Send 0.01 BTC to bc1q…", a consolidation, a
 * transfer to yourself, or "Sign part of a transaction" when other wallets' coins are spent too.
 *
 * A PSBT whose outputs ask for more than its inputs hold is unfinished: an offer, as a marketplace listing is (the
 * seller's coin and its price at the same index, signed SIGHASH_SINGLE|ANYONECANPAY, waiting for a buyer's inputs). Its
 * intent is `bitcoin.intent.offer` ("Offer 0.0001 BTC for 0.001 BTC"), with what the signer gives (`yourCoins`, and
 * the `inscriptions` and `runes` its coins hold), what it asks in return (`inReturn`: its own outputs its signatures
 * fix) and what is left for others to fund (`unfunded`). It has no fee yet, so none is shown or judged.
 *
 * `psbt` is the PSBT's bytes, or Base64 text. Throws `ClearSignError`: `INVALID_INPUT` when the adapter refuses it
 * (its error is the `cause`), `INVALID_ARGUMENT` for an option out of range. Anything it reads but cannot place (an
 * output with no address, a malformed runestone) is a warning, never an error.
 *
 * ```ts
 * const result = await clearSignPsbt(crypto.chains.bitcoin, psbt, {accounts: [{extendedKey, fingerprint, path}]})
 * result.summary?.text // 'Send 0.001 BTC to bc1q…'
 * ```
 */
export const clearSignPsbt = async (
  chain: BitcoinClearSignChain,
  psbt: Uint8Array | string,
  options: BitcoinClearSignOptions = {}
): Promise<ClearSigning> => {
  const ref = chainRef(chain, options.testnet)
  const limits = readLimits(options)
  const bytes = readBytes(psbt)
  const decoded = decode(chain, bytes)
  const ownership = createOwnership(chain, options.accounts, options.signer)
  const context = createResolverContext({chain: ref, resolvers: options.resolvers, signer: options.signer})
  const symbol = symbolOf(chain)
  const btc = (value: bigint) => formatAmount({decimals: 8, symbol, value})
  const bitcoin = (input: FieldCommon & {readonly value: bigint}) =>
    amountField({...input, baseUnit: 'sat', decimals: 8, symbol})
  const scripts = decoded.outputs.map(output => output.scriptPubKey)
  const artifact = decipher(scripts)
  const assets = await lookUpAssets(options.assets, ref, decoded)

  const inputs: Input[] = decoded.inputs.map((input, index) => {
    const owner = ownership.of(input.spent?.scriptPubKey, input.address, input.derivations, input.taprootDerivations)
    const taproot = isTaprootInput(input)

    return {
      index,
      input,
      owner,
      sighash: readSighash(input.sighashType, taproot, index, decoded.outputs.length),
      signs: !ownership.known || owner.own,
      taproot,
    }
  })

  const inputAddresses = new Set(decoded.inputs.flatMap(input => (input.address === undefined ? [] : [input.address])))
  const outputs: Output[] = await Promise.all(
    decoded.outputs.map(async (output, index): Promise<Output> => {
      if (isOpReturn(output.scriptPubKey)) {
        return {index, output, role: artifact?.output === index ? 'runestone' : 'data'}
      }

      if (output.address === undefined) {
        return {index, output, role: 'script'}
      }

      const owner = ownership.of(output.scriptPubKey, output.address, output.derivations, output.taprootDerivations)

      if (owner.own) {
        const named = await context.name(output.address)
        const to = addressField({
          id: 'to',
          label: LABELS.to,
          name: named?.name,
          relation: 'self',
          value: output.address,
        })

        // A receiving address is a transfer to yourself, unless the coins come from it: one address's change.
        const receiving = owner.branch === 0 && !inputAddresses.has(output.address)

        return {index, output, owner, role: receiving ? 'self' : 'change', to}
      }

      const to = await context.address({id: 'to', label: LABELS.to, value: output.address})

      return {index, output, owner, role: to.relation === 'own' || to.relation === 'self' ? 'self' : 'payment', to}
    })
  )

  const payments = outputs.filter(output => output.role === 'payment' || output.role === 'script')
  const own = outputs.filter(isOwn)
  const sent = sum(payments.map(({output}) => output.value))
  const kept = sum(own.map(({output}) => output.value))
  const signing = inputs.filter(input => input.signs)

  // Outputs that ask for more than the inputs hold: an unfinished transaction, an offer waiting for others' inputs (a
  // marketplace listing: the seller's coin, signed SINGLE|ANYONECANPAY, and the price at its index).
  const unfinished = decoded.balance !== undefined && decoded.balance < 0n

  // What the signer's signatures ask in return: an output of its own paired with its input under SINGLE (the price of
  // a listing, finished or not); in an unfinished transaction, also its outputs an ALL signature fixes and, without
  // accounts to tell whose an output is, every SINGLE pair.
  const fixesAll = signing.some(({sighash}) => sighash.fixes === 'all')
  const paired = new Set(signing.flatMap(({index, sighash}) => (sighash.fixes === 'same' ? [index] : [])))
  const asked = new Set(
    outputs
      .filter(output =>
        isOwn(output)
          ? paired.has(output.index) || (unfinished && fixesAll)
          : unfinished && !ownership.known && paired.has(output.index)
      )
      .map(({index}) => index)
  )
  const byAddress = new Map<string, number[]>()

  for (const {index, output} of outputs) {
    if (output.address !== undefined && !isOpReturn(output.scriptPubKey)) {
      byAddress.set(output.address, [...(byAddress.get(output.address) ?? []), index])
    }
  }

  // Where each signed input's inscriptions and runes go, and whether its signature lets someone else decide.
  const flows: (AssetFlow & {readonly undecided: boolean})[] = inputs.flatMap(({index, sighash, signs}) => {
    const coin = assets.coins[index]

    return coin === undefined || !signs
      ? []
      : [{...assetFlow(decoded, index, coin, artifact), undecided: !sighash.commitsToAll}]
  })

  const describeOutput = async ({index, output, owner, role, to}: Output): Promise<ActionInput> => {
    const value = output.value
    const amount = bitcoin({id: 'amount', label: LABELS.amount, value})
    const warnings: WarningInput[] = []
    const reached = flows.filter(flow => !flow.undecided && flow.outputs.has(index))
    const assetParams = {inputs: reached.map(flow => flow.input).join(', ')}

    if (role === 'data' || role === 'runestone') {
      if (reached.length > 0) {
        warnings.push(warning(BITCOIN_WARNINGS.ASSET_BURNED, {params: assetParams}))
      }

      const burn = value > 0n ? [amount] : []

      if (value > 0n) {
        warnings.push(warning(BITCOIN_WARNINGS.BURN, {fields: ['amount'], params: {amount: btc(value)}}))
      }

      if (role === 'runestone' && artifact !== undefined) {
        const described = await describeRunestone(artifact, output.scriptPubKey, scripts, context)

        return {
          ...described,
          fields: [...(described.fields ?? []), ...burn],
          warnings: [...(described.warnings ?? []), ...warnings],
        }
      }

      const data = dataField(output.scriptPubKey)

      return {
        fields: [...(data === undefined ? [] : [data]), ...burn],
        intent: value > 0n ? BITCOIN_TEXTS.intent.burn : BITCOIN_TEXTS.intent.data,
        source: {decoder: 'op-return', kind: 'builtin'},
        summary: value > 0n ? text(BITCOIN_TEXTS.summary.burn, {amount: btc(value)}) : text(BITCOIN_TEXTS.summary.data),
        warnings,
      }
    }

    if (reached.length > 0 && role !== 'change' && role !== 'self') {
      warnings.push(
        warning(WARNINGS.ASSET_OWNERSHIP_TRANSFER, {fields: [to === undefined ? 'amount' : 'to'], params: assetParams})
      )
    }

    if (role === 'script' || to === undefined) {
      return {
        fields: [amount],
        intent: BITCOIN_TEXTS.intent.unknownScript,
        raw: [rawField({id: 'script', label: LABEL.script, value: output.scriptPubKey})],
        source: {kind: 'unknown'},
        summary: text(BITCOIN_TEXTS.summary.unknownScript, {amount: btc(value)}),
        warnings: [...warnings, warning(BITCOIN_WARNINGS.NO_ADDRESS_OUTPUT, {fields: ['amount']})],
      }
    }

    const address = to.value

    if (role === 'payment') {
      if (to.relation === 'unknown') {
        warnings.push(warning(WARNINGS.UNKNOWN_DESTINATION, {fields: ['to']}))
      }

      const validation = chain.validateAddress(address)

      if (validation.valid && validation.type === 'witness') {
        warnings.push(warning(BITCOIN_WARNINGS.UNKNOWN_SCRIPT_TYPE, {fields: ['to']}))
      }
    }

    if (owner?.falseClaim) {
      warnings.push(warning(BITCOIN_WARNINGS.FALSE_DERIVATION, {fields: ['to']}))
    }

    if (owner?.own && !owner.verified) {
      warnings.push(warning(BITCOIN_WARNINGS.UNVERIFIED_CHANGE, {fields: ['to']}))
    }

    try {
      const dust = chain.dustThreshold(address)

      if (value < dust) {
        warnings.push(warning(BITCOIN_WARNINGS.DUST_OUTPUT, {fields: ['amount'], params: {limit: btc(dust)}}))
      }
    } catch {
      // An address the adapter has no dust limit for: nothing to compare with.
    }

    const same = byAddress.get(address) ?? []

    if (same.length > 1) {
      warnings.push(warning(BITCOIN_WARNINGS.DUPLICATE_OUTPUT, {fields: ['to'], params: {outputs: same.join(', ')}}))
    }

    if (inputAddresses.has(address)) {
      warnings.push(warning(BITCOIN_WARNINGS.ADDRESS_REUSE, {fields: ['to']}))
    }

    const fields: Field[] = [
      to,
      amount,
      ...(owner?.path === undefined
        ? []
        : [textField({id: 'derivation', label: LABEL.derivation, secondary: true, value: owner.path})]),
    ]
    const source = {decoder: 'psbt', kind: 'builtin'} as const

    if (asked.has(index) && (role === 'change' || role === 'self')) {
      return {
        fields,
        intent: BITCOIN_TEXTS.intent.receive,
        source,
        summary: text(BITCOIN_TEXTS.summary.receive, {amount: btc(value)}),
        warnings,
      }
    }

    switch (role) {
      case 'change':
        return {
          fields,
          intent: BITCOIN_TEXTS.intent.change,
          source,
          summary: text(BITCOIN_TEXTS.summary.change, {amount: btc(value)}),
          warnings,
        }
      case 'self':
        return {
          fields,
          intent: BITCOIN_TEXTS.intent.selfTransfer,
          source,
          summary: text(BITCOIN_TEXTS.summary.selfTransfer, {amount: btc(value)}),
          warnings,
        }
      default:
        return {
          fields,
          intent: INTENTS.send,
          source,
          summary: text(SUMMARIES.send, {amount: btc(value), recipient: to.name ?? address}),
          warnings,
        }
    }
  }

  const actions = await Promise.all(outputs.map(describeOutput))

  // The inputs, as fields of the root.
  const inputFields = await Promise.all(
    inputs.map(async ({index, input, owner, sighash}): Promise<Field> => {
      const id = `input-${index}`
      const items: Field[] = []

      if (input.address !== undefined) {
        const named = owner.own ? await context.name(input.address) : undefined

        items.push(
          owner.own
            ? addressField({
                id: `${id}-from`,
                label: LABELS.from,
                name: named?.name,
                relation: 'self',
                value: input.address,
              })
            : await context.address({id: `${id}-from`, label: LABELS.from, value: input.address})
        )
      } else if (input.spent !== undefined) {
        items.push(rawField({id: `${id}-script`, label: LABEL.script, value: input.spent.scriptPubKey}))
      }

      if (input.spent !== undefined) {
        items.push(
          bitcoin({id: `${id}-amount`, label: LABELS.amount, value: input.spent.value}),
          booleanField({id: `${id}-verified`, label: LABEL.valueVerified, secondary: true, value: input.verifiedValue})
        )
      }

      if (sighash.explicit) {
        items.push(
          textField({id: `${id}-sighash`, label: LABEL.sighash, secondary: sighash.commitsToAll, value: sighash.name})
        )
      }

      const lock = relativeLock(input.sequence, decoded.version)

      if (lock !== undefined) {
        items.push(
          'blocks' in lock
            ? numberField({
                id: `${id}-relativeLock`,
                label: LABEL.relativeLock,
                unit: BITCOIN_TEXTS.unit.blocks,
                value: lock.blocks,
              })
            : durationField({id: `${id}-relativeLock`, label: LABEL.relativeLock, value: lock.seconds * 1000})
        )
      }

      const coin = assets.coins[index]

      if ((coin?.inscriptions ?? []).length > 0) {
        items.push(
          numberField({id: `${id}-inscriptions`, label: LABEL.inscriptions, value: coin?.inscriptions?.length ?? 0})
        )
      }

      if ((coin?.runes ?? []).length > 0) {
        items.push(numberField({id: `${id}-runes`, label: LABEL.runes, value: coin?.runes?.length ?? 0}))
      }

      items.push(
        textField({id: `${id}-outpoint`, label: LABEL.outpoint, secondary: true, value: `${input.txid}:${input.vout}`}),
        ...(owner.path === undefined
          ? []
          : [textField({id: `${id}-derivation`, label: LABEL.derivation, secondary: true, value: owner.path})])
      )

      return listField({id, items, label: text(LABEL.input, {index})})
    })
  )

  const fields: Field[] = []
  const warnings: WarningInput[] = []
  const mine = inputs.filter(input => input.owner.own)
  const foreign = ownership.known ? inputs.filter(input => !input.owner.own) : []

  // An unfinished transaction's payments are a draft others complete: what is sent is not the signer's to say.
  if (sent > 0n && !unfinished) {
    fields.push(bitcoin({id: 'amount', label: LABELS.amount, value: sent}))
  }

  // An offer: what the signer gives (its coins, and what they hold), what it asks in return, and what others still
  // have to put in.
  const offer = unfinished && signing.length > 0 ? offerOf(signing, assets.coins, outputs, asked) : undefined

  if (offer !== undefined) {
    fields.push(bitcoin({id: 'yourCoins', label: LABEL.yourCoins, value: offer.given}))

    if (offer.inscriptions > 0) {
      fields.push(numberField({id: 'inscriptions', label: LABEL.inscriptions, value: offer.inscriptions}))
    }

    if (offer.runes > 0) {
      fields.push(numberField({id: 'runes', label: LABEL.runes, value: offer.runes}))
    }

    fields.push(
      bitcoin({id: 'inReturn', label: LABEL.inReturn, value: offer.asked}),
      bitcoin({id: 'unfunded', label: LABEL.unfunded, secondary: true, value: -(decoded.balance ?? 0n)})
    )
  } else if (foreign.length > 0 && mine.length > 0 && !unfinished) {
    // With others' coins in it, what the user's accounts put in and get back is what this signature costs them.
    const values = mine.map(({input}) => input.spent?.value)

    if (values.every(value => value !== undefined)) {
      const spent = sum(values as bigint[])
      const net = spent - kept

      fields.push(
        bitcoin({id: 'yourCoins', label: LABEL.yourCoins, value: spent}),
        bitcoin({id: 'backToYou', label: LABEL.backToYou, value: kept}),
        net >= 0n
          ? bitcoin({id: 'net', label: LABEL.youPay, value: net})
          : bitcoin({id: 'net', label: LABEL.youReceive, value: -net})
      )
    }
  }

  const fee = decoded.fee
  const size = transactionSize(chain, bytes, decoded)
  const rate = fee === undefined || size === undefined ? undefined : feeRate(fee, size.vsize)

  if (fee !== undefined) {
    fields.push(bitcoin({id: 'fee', label: LABELS.fee, value: fee}))
  }

  if (rate !== undefined) {
    fields.push(numberField({id: 'feeRate', label: LABEL.feeRate, unit: BITCOIN_TEXTS.unit.satPerVbyte, value: rate}))
  }

  if (lockTimeEnforced(decoded)) {
    const {locktime} = decoded
    let ahead: number | undefined

    if (locktime < LOCKTIME_THRESHOLD) {
      fields.push(numberField({id: 'lockTime', label: LABEL.notBeforeBlock, value: locktime}))

      if (options.tipHeight !== undefined && locktime > options.tipHeight) {
        ahead = (locktime - options.tipHeight) * BLOCK_MS
      }
    } else {
      const moment = fromUnixSeconds(locktime) as number
      fields.push(dateTimeField({id: 'lockTime', label: LABELS.notBefore, now: context.now, value: moment}))

      if (moment > context.now) {
        ahead = moment - context.now
      }
    }

    if (ahead !== undefined) {
      warnings.push(
        warning(ahead > LONG_LIVED_AFTER ? BITCOIN_WARNINGS.FAR_FUTURE_LOCKTIME : BITCOIN_WARNINGS.TIMELOCKED, {
          fields: ['lockTime'],
        })
      )
    }
  }

  fields.push(...inputFields)

  if (size !== undefined) {
    fields.push(
      numberField({
        id: 'size',
        label: size.exact ? LABEL.size : LABEL.estimatedSize,
        secondary: true,
        unit: BITCOIN_TEXTS.unit.vbytes,
        value: size.vsize,
      })
    )
  }

  fields.push(
    booleanField({id: 'replaceable', label: LABEL.replaceable, secondary: true, value: signalsReplaceable(decoded)}),
    textField({id: 'txid', label: LABEL.txid, secondary: true, value: decoded.txid})
  )

  // Whose coins these are.
  if (ownership.known && mine.length === 0) {
    warnings.push(warning(BITCOIN_WARNINGS.NO_OWN_INPUTS))
  } else if (foreign.length > 0) {
    warnings.push(
      warning(BITCOIN_WARNINGS.FOREIGN_INPUTS, {
        fields: foreign.map(({index}) => `input-${index}`),
        params: {count: foreign.length},
      })
    )
  }

  for (const {index, owner} of inputs) {
    if (owner.falseClaim) {
      warnings.push(warning(BITCOIN_WARNINGS.FALSE_DERIVATION, {fields: [`input-${index}`]}))
    }
  }

  // What the signatures commit to.
  for (const {index, sighash, signs} of inputs) {
    if (signs && sighash.warning !== undefined) {
      warnings.push(
        warning(sighash.warning.definition, {fields: [`input-${index}-sighash`], params: sighash.warning.params})
      )
    }
  }

  // A SegWit v0 signature commits to its own coin's value only; a Taproot one without ANYONECANPAY to every input's.
  const committed = signing.some(input => input.taproot && input.sighash.commitsToInputs)
  const unverified = signing.filter(({input, taproot}) => input.spent !== undefined && !input.verifiedValue && !taproot)

  if (unverified.length > 0 && !committed) {
    warnings.push(
      warning(BITCOIN_WARNINGS.UNVERIFIED_VALUES, {fields: unverified.map(({index}) => `input-${index}-amount`)})
    )
  }

  // A signature that does not commit to every input and output leaves the transaction open: others complete it, so
  // its fee is not this one's, and it is part of a transaction rather than the whole.
  const open = signing.some(input => !input.sighash.commitsToAll)

  // The fee: none yet while the transaction is unfinished, and nothing to judge.
  if (fee === undefined) {
    if (unfinished) {
      // Every coin's value is known: the outputs ask for more. Others' inputs, still to come, make the fee.
    } else {
      warnings.push(
        warning(BITCOIN_WARNINGS.UNKNOWN_FEE, {
          fields: inputs.filter(({input}) => input.spent === undefined).map(({index}) => `input-${index}`),
        })
      )
    }
  } else {
    const base = sent > 0n ? sent : kept
    const high =
      (rate !== undefined && rate > limits.rate) ||
      fee > limits.fee ||
      (base > 0n && fee > PERCENT_FLOOR && Number(fee) * 100 > limits.percent * Number(base))

    if (high && !open) {
      warnings.push(
        warning(WARNINGS.HIGH_FEE, {
          fields: rate === undefined ? ['fee'] : ['fee', 'feeRate'],
          params: {fee: btc(fee), ...(rate === undefined ? {} : {feeRate: rate})},
        })
      )
    }
  }

  // Inscriptions and runes the signer's coins hold.
  for (const flow of flows) {
    const id = `input-${flow.input}`
    const params = {input: flow.input}

    if (flow.undecided) {
      const sighashField = inputs[flow.input]?.sighash.explicit ? [`${id}-sighash`] : []
      warnings.push(warning(WARNINGS.ASSET_OWNERSHIP_TRANSFER, {fields: [id, ...sighashField], params}))
      continue
    }

    if (flow.unknown) {
      warnings.push(warning(BITCOIN_WARNINGS.ASSET_DESTINATION_UNKNOWN, {fields: [id], params}))
    }

    if (flow.fee) {
      warnings.push(
        warning(WARNINGS.ASSET_OWNERSHIP_TRANSFER, {fields: fee === undefined ? [id] : [id, 'fee'], params})
      )
    }

    if (flow.burned) {
      warnings.push(warning(BITCOIN_WARNINGS.ASSET_BURNED, {fields: [id], params}))
    }

    const reached = [...flow.outputs].map(index => outputs[index])

    if (!flow.unknown && !flow.fee && !flow.burned && reached.every(output => output !== undefined && isOwn(output))) {
      warnings.push(warning(BITCOIN_WARNINGS.ASSET_KEPT, {fields: [id], params}))
    }
  }

  const failures = [...context.failures(), ...(assets.failed ? ['assets'] : [])]

  if (failures.length > 0) {
    warnings.push(warning(WARNINGS.RESOLVER_FAILED, {params: {resolvers: failures.join(', ')}}))
  }

  const [intent, summary] = rootIntent({
    actions,
    artifact,
    btc,
    foreign,
    inputs,
    kept,
    mine,
    offer,
    open,
    outputs,
    own,
    ownership,
    payments,
    sent,
  })

  return createClearSigning({
    actions,
    chain: ref,
    fields,
    intent,
    kind: 'psbt',
    source: {decoder: 'psbt', kind: 'builtin'},
    summary,
    warnings,
  })
}

type Offer = {
  /** The signer's coins in it. */
  readonly given: bigint
  /** The inscriptions and rune balances those coins hold, by the `assets` option. */
  readonly inscriptions: number
  readonly runes: number
  /** What the outputs it asks for pay. */
  readonly asked: bigint
}

const offerOf = (
  signing: readonly Input[],
  coins: readonly (BitcoinCoinAssets | undefined)[],
  outputs: readonly Output[],
  asked: ReadonlySet<number>
): Offer => ({
  asked: sum(outputs.filter(({index}) => asked.has(index)).map(({output}) => output.value)),
  given: sum(signing.map(({input}) => input.spent?.value ?? 0n)),
  inscriptions: signing.reduce((count, {index}) => count + (coins[index]?.inscriptions?.length ?? 0), 0),
  runes: signing.reduce((count, {index}) => count + (coins[index]?.runes?.length ?? 0), 0),
})

/** What the whole does, when one thing does dominate. */
const rootIntent = ({
  actions,
  artifact,
  btc,
  foreign,
  inputs,
  kept,
  mine,
  offer,
  open,
  outputs,
  own,
  ownership,
  payments,
  sent,
}: {
  readonly actions: readonly ActionInput[]
  readonly artifact: ReturnType<typeof decipher>
  readonly btc: (value: bigint) => string
  readonly foreign: readonly Input[]
  readonly inputs: readonly Input[]
  readonly kept: bigint
  readonly mine: readonly Input[]
  readonly offer: Offer | undefined
  readonly open: boolean
  readonly outputs: readonly Output[]
  readonly own: readonly Output[]
  readonly ownership: {readonly known: boolean}
  readonly payments: readonly Output[]
  readonly sent: bigint
}): [DisplayText, DisplayText | undefined] => {
  const part: [DisplayText, DisplayText] = [
    BITCOIN_TEXTS.intent.signPart,
    text(BITCOIN_TEXTS.summary.signPart, {count: ownership.known ? mine.length : inputs.length, total: inputs.length}),
  ]

  if (ownership.known && mine.length === 0) {
    return part
  }

  if (offer !== undefined) {
    const params = {asked: btc(offer.asked), given: btc(offer.given)}
    const summary =
      offer.asked === 0n
        ? text(BITCOIN_TEXTS.summary.offerNothing, {given: params.given})
        : offer.inscriptions + offer.runes > 0
          ? text(BITCOIN_TEXTS.summary.offerAssets, params)
          : text(BITCOIN_TEXTS.summary.offer, params)

    return [BITCOIN_TEXTS.intent.offer, summary]
  }

  if (foreign.length > 0 || open) {
    return part
  }

  const [payment] = payments

  if (payment !== undefined) {
    if (payments.length > 1) {
      return [INTENTS.send, text(BITCOIN_TEXTS.summary.sendMany, {amount: btc(sent), count: payments.length})]
    }

    return [
      INTENTS.send,
      payment.to === undefined
        ? text(BITCOIN_TEXTS.summary.unknownScript, {amount: btc(sent)})
        : text(SUMMARIES.send, {amount: btc(sent), recipient: payment.to.name ?? payment.to.value}),
    ]
  }

  if (artifact?.kind === 'runestone' && (artifact.etching !== undefined || artifact.mint !== undefined)) {
    const runestone = actions[artifact.output]

    return [runestone?.intent ?? BITCOIN_TEXTS.intent.runestone, runestone?.summary]
  }

  if (own.length > 0) {
    return own.length === 1 && own[0]?.role === 'change' && inputs.length > 1 && actions.length === 1
      ? [
          BITCOIN_TEXTS.intent.consolidate,
          text(BITCOIN_TEXTS.summary.consolidate, {amount: btc(kept), count: inputs.length}),
        ]
      : [BITCOIN_TEXTS.intent.selfTransfer, text(BITCOIN_TEXTS.summary.selfTransfer, {amount: btc(kept)})]
  }

  const [first] = actions

  return actions.length === 1 && first !== undefined ? [first.intent, first.summary] : [INTENTS.unknown, undefined]
}

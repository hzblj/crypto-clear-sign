import assert from 'node:assert/strict'
import {describe, test} from 'node:test'

import {type ClearSigningAction, type Field, plainText, type Warning, warningsAt} from '@hzblj/crypto-clear-sign'
import {
  AccountRole,
  type Address,
  appendTransactionMessageInstructions,
  type Blockhash,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  getTransactionEncoder,
  type Instruction,
  type Nonce,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  setTransactionMessageLifetimeUsingDurableNonce,
} from '@solana/kit'
import {getSetComputeUnitLimitInstruction, getSetComputeUnitPriceInstruction} from '@solana-program/compute-budget'
import {getTransferSolInstruction} from '@solana-program/system'
import {
  AuthorityType,
  getCloseAccountInstruction,
  getCreateAssociatedTokenIdempotentInstruction,
  getSetAuthorityInstruction,
  getSyncNativeInstruction,
} from '@solana-program/token'

import {clearSignMessage, clearSignTransaction, createIdlResolver, SOLANA_PROGRAMS, type SolanaIdl} from '../src'
import {
  address,
  addressOf,
  BLOCKHASH,
  chain,
  clock,
  codes,
  codesAt,
  field,
  first,
  NOW,
  STRANGER,
  signer,
  TOKEN,
  USDC,
  WALLET,
  warningOf,
} from './support'

const as = (value: string) => value as Address
const JUPITER = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'
const WSOL = 'So11111111111111111111111111111111111111112'
const TABLE = address(90)
const POOLS = Array.from({length: 12}, (_, index) => address(91, index))
const ata = (owner: string, mint: string) => chain.associatedTokenAddress({mint, owner, tokenProgram: TOKEN})
const ROUTE = [229, 23, 203, 151, 122, 227, 173, 42]

/** The wire bytes kit makes of instructions: v0 with a lookup table, or legacy with a durable nonce. */
const kitTransaction = (
  instructions: Instruction[],
  lifetime: {
    readonly tables?: Record<string, Address[]>
    readonly nonce?: {account: string; authority: string; value: string}
  } = {}
) => {
  const base = pipe(createTransactionMessage({version: 0}), message =>
    setTransactionMessageFeePayer(as(WALLET), message)
  )
  const timed =
    lifetime.nonce === undefined
      ? setTransactionMessageLifetimeUsingBlockhash({blockhash: BLOCKHASH as Blockhash, lastValidBlockHeight: 0n}, base)
      : setTransactionMessageLifetimeUsingDurableNonce(
          {
            nonce: lifetime.nonce.value as Nonce,
            nonceAccountAddress: as(lifetime.nonce.account),
            nonceAuthorityAddress: as(lifetime.nonce.authority),
          },
          base
        )
  const full = appendTransactionMessageInstructions(instructions, timed)
  const compressed =
    lifetime.tables === undefined
      ? full
      : compressTransactionMessageUsingAddressLookupTables(full, lifetime.tables as never)

  return new Uint8Array(getTransactionEncoder().encode(compileTransaction(compressed)))
}

/** Borsh `u64` and `u16`. */
const u64 = (value: bigint) => Array.from({length: 8}, (_, index) => Number((value >> BigInt(index * 8)) & 0xffn))
const u16 = (value: number) => [value & 0xff, value >> 8]

/** A hand-written IDL in the shape of an aggregator's route instruction (not any project's own IDL). */
const ROUTER_IDL: SolanaIdl = {
  address: JUPITER,
  instructions: [
    {
      accounts: [
        {address: TOKEN, name: 'token_program'},
        {name: 'user_transfer_authority', signer: true},
        {name: 'user_source_token_account', writable: true},
        {name: 'user_destination_token_account', writable: true},
        {name: 'destination_mint'},
      ],
      args: [
        {
          name: 'route_plan',
          type: {vec: {defined: {name: 'RoutePlanStep'}}},
        },
        {name: 'in_amount', type: 'u64'},
        {name: 'quoted_out_amount', type: 'u64'},
        {name: 'slippage_bps', type: 'u16'},
        {name: 'platform_fee_bps', type: 'u8'},
      ],
      discriminator: ROUTE,
      name: 'route',
    },
  ],
  metadata: {name: 'router', spec: '0.1.0', version: '0.1.0'},
  types: [
    {
      name: 'RoutePlanStep',
      type: {
        fields: [
          {name: 'swap', type: {defined: {name: 'Swap'}}},
          {name: 'percent', type: 'u8'},
          {name: 'input_index', type: 'u8'},
          {name: 'output_index', type: 'u8'},
        ],
        kind: 'struct',
      },
    },
    {
      name: 'Swap',
      type: {
        kind: 'enum',
        variants: [{name: 'Raydium'}, {fields: [{name: 'a_to_b', type: 'bool'}], name: 'Whirlpool'}],
      },
    },
  ],
}

/** Wrap 0.1 SOL, swap it through a router for USDC (its pools in a lookup table), unwrap what is left. */
const swap = () => {
  const wrapped = ata(WALLET, WSOL)
  const usdc = ata(WALLET, USDC)
  const route: Instruction = {
    accounts: [
      {address: as(TOKEN), role: AccountRole.READONLY},
      {address: as(WALLET), role: AccountRole.READONLY_SIGNER},
      {address: as(wrapped), role: AccountRole.WRITABLE},
      {address: as(usdc), role: AccountRole.WRITABLE},
      {address: as(USDC), role: AccountRole.READONLY},
      ...POOLS.map((pool, index) => ({
        address: as(pool),
        role: index % 2 === 0 ? AccountRole.WRITABLE : AccountRole.READONLY,
      })),
    ],
    data: Uint8Array.from([
      ...ROUTE,
      ...[2, 0, 0, 0],
      ...[1, 1, 50, 0, 1],
      ...[0, 50, 0, 1],
      ...u64(100_000_000n),
      ...u64(15_000_000n),
      ...u16(50),
      0,
    ]),
    programAddress: as(JUPITER),
  }

  return kitTransaction(
    [
      getSetComputeUnitLimitInstruction({units: 400_000}),
      getSetComputeUnitPriceInstruction({microLamports: 100_000n}),
      getCreateAssociatedTokenIdempotentInstruction({
        ata: as(wrapped),
        mint: as(WSOL),
        owner: as(WALLET),
        payer: signer(WALLET),
      }),
      getTransferSolInstruction({amount: 100_000_000n, destination: as(wrapped), source: signer(WALLET)}),
      getSyncNativeInstruction({account: as(wrapped)}),
      getCreateAssociatedTokenIdempotentInstruction({
        ata: as(usdc),
        mint: as(USDC),
        owner: as(WALLET),
        payer: signer(WALLET),
      }),
      route,
      getCloseAccountInstruction({account: as(wrapped), destination: as(WALLET), owner: signer(WALLET)}),
    ],
    {tables: {[TABLE]: POOLS.map(as)}}
  )
}

/** Who an address is to the review, by the names this file gives them. */
const NAMES: Readonly<Record<string, string>> = {
  [BLOCKHASH]: 'BLOCKHASH',
  [JUPITER]: 'ROUTER',
  [STRANGER]: 'STRANGER',
  [TABLE]: 'TABLE',
  [TOKEN]: 'TOKEN_PROGRAM',
  [USDC]: 'USDC',
  [WALLET]: 'WALLET',
  [WSOL]: 'WSOL',
  [ata(WALLET, USDC)]: 'WALLET_USDC',
  [ata(WALLET, WSOL)]: 'WALLET_WSOL',
  [address(97)]: 'NONCE_VALUE',
  [address(98)]: 'NONCE_ACCOUNT',
  [address(99)]: 'WSOL_ACCOUNT',
  ...Object.fromEntries(POOLS.map((pool, index) => [pool, `POOL_${index}`])),
  ...Object.fromEntries(
    Object.entries(SOLANA_PROGRAMS).map(([program]) => [program, `program:${SOLANA_PROGRAMS[program]}`])
  ),
}

/**
 * The whole model of an action, as plain data to compare: intent, summary and source; each field by id with its kind,
 * value and what matters of it (an address's relation and name, an amount's symbol and decimals); raw fields; warnings
 * with severity and fields; nested actions, and the risk of each.
 */
const shape = (field: Field): unknown => {
  const name = (value: string) => NAMES[value] ?? value
  const label = field.label.code === 'external' ? [`label:${field.label.text}`] : []

  switch (field.kind) {
    case 'address':
      return [
        field.id,
        'address',
        name(field.value),
        field.relation,
        ...(field.name === undefined ? [] : [field.name]),
        ...label,
      ]
    case 'amount':
      return [
        field.id,
        'amount',
        field.value,
        field.symbol ?? null,
        field.decimals ?? null,
        ...(field.unlimited ? ['unlimited'] : []),
      ]
    case 'list':
      return [field.id, 'list', field.items.map(shape), ...label]
    case 'datetime':
      return [field.id, 'datetime', field.never ? 'never' : field.value, ...(field.expired ? ['expired'] : [])]
    case 'number':
      return [field.id, 'number', field.value, ...(field.unit === undefined ? [] : [field.unit.code]), ...label]
    case 'text':
      return [field.id, 'text', name(field.value), ...label]
    default:
      return [field.id, field.kind, 'value' in field ? field.value : null, ...label]
  }
}

const model = (action: ClearSigningAction, warnings: readonly Warning[]): unknown => ({
  actions: action.actions.map(child => model(child, warnings)),
  fields: action.fields.map(shape),
  intent: action.intent.code === 'external' ? `external:${action.intent.text}` : action.intent.code,
  raw: action.raw.map(shape),
  risk: action.risk,
  source:
    action.source.kind === 'builtin'
      ? action.source.decoder
      : action.source.kind === 'descriptor'
        ? `${action.source.format}:${action.source.id}`
        : 'unknown',
  summary: action.summary?.code ?? null,
  warnings: warnings
    .filter(entry => entry.action.join() === action.path.join())
    .map(entry => [entry.code, entry.severity, entry.fields.join()]),
})

// What each sample reads as, whole. Built-in names are `program:<name>`, this file's accounts by their names above.
const contract = (id: string, name: string) => [id, 'address', `program:${name}`, 'contract', name]
const sol = (id: string, value: bigint) => [id, 'amount', value, 'SOL', 9]
const wallet = (id: string) => [id, 'address', 'WALLET', 'self']
const expect = (input: Record<string, unknown>) => ({
  actions: [],
  raw: [],
  risk: 'none',
  summary: null,
  warnings: [],
  ...input,
})

const BUDGET = [
  expect({
    fields: [
      ['computeUnitLimit', 'number', 400_000, 'solana.unit.computeUnits'],
      contract('program', 'Compute Budget Program'),
    ],
    intent: 'solana.intent.setComputeUnitLimit',
    source: 'compute-budget',
    summary: 'solana.summary.setComputeUnitLimit',
  }),
  expect({
    fields: [
      ['computeUnitPrice', 'number', 100_000n, 'solana.unit.microLamports'],
      contract('program', 'Compute Budget Program'),
    ],
    intent: 'solana.intent.setComputeUnitPrice',
    source: 'compute-budget',
    summary: 'solana.summary.setComputeUnitPrice',
  }),
]

const createAccount = (token: string, name: string, account: string) =>
  expect({
    fields: [
      wallet('owner'),
      ['token', 'address', token, 'token', name],
      ['account', 'address', account, 'own'],
      wallet('from'),
      contract('account-4', 'System Program'),
      contract('account-5', 'Token Program'),
      contract('program', 'Associated Token Account Program'),
    ],
    intent: 'solana.intent.createTokenAccount',
    source: 'associated-token-account',
    summary: 'solana.summary.createTokenAccount',
  })

/** Wrapping SOL (the transfer is what the wallet sends) and making room for USDC: own accounts, nothing to warn. */
const WRAP = [
  createAccount('WSOL', 'Wrapped SOL', 'WALLET_WSOL'),
  expect({
    fields: [
      ['recipient', 'address', 'WALLET_WSOL', 'own'],
      sol('amount', 100_000_000n),
      wallet('from'),
      contract('program', 'System Program'),
    ],
    intent: 'intent.send',
    source: 'system-program',
    summary: 'summary.send',
  }),
  expect({
    fields: [
      ['account', 'address', 'WALLET_WSOL', 'own'],
      contract('account-1', 'Rent Sysvar'),
      contract('program', 'Token Program'),
    ],
    intent: 'solana.intent.syncNative',
    source: 'spl-token',
    summary: 'solana.summary.syncNative',
  }),
  createAccount('USDC', 'USD Coin', 'WALLET_USDC'),
]

const UNWRAP = expect({
  fields: [
    ['account', 'address', 'WALLET_WSOL', 'own'],
    wallet('recipient'),
    wallet('owner'),
    contract('program', 'Token Program'),
  ],
  intent: 'solana.intent.closeAccount',
  source: 'spl-token',
  summary: 'solana.summary.closeAccount',
})

/** The route's own accounts, whoever reads it. */
const ROUTE_ACCOUNTS = [
  wallet('account-1'),
  ['account-2', 'address', 'WALLET_WSOL', 'own'],
  ['account-3', 'address', 'WALLET_USDC', 'own'],
  ['account-4', 'address', 'USDC', 'token', 'USD Coin'],
]

const swapRoot = (route: unknown, risk: string) =>
  expect({
    actions: [...BUDGET, ...WRAP, route, UNWRAP],
    fields: [
      ['sent', 'list', [sol('sent-0', 100_000_000n)]],
      wallet('feePayer'),
      sol('fee', 5_000n),
      sol('priorityFee', 40_000n),
      ['recentBlockhash', 'text', 'BLOCKHASH'],
      ['computeUnitLimit', 'number', 400_000, 'solana.unit.computeUnits'],
      ['computeUnitPrice', 'number', 100_000n, 'solana.unit.microLamports'],
      ['version', 'text', 'v0'],
      ['lookupTables', 'list', [['lookupTable-0', 'address', 'TABLE', 'unknown']]],
    ],
    intent: 'intent.batch',
    risk,
    source: 'solana-transaction',
    summary: 'summary.batch',
  })

const SWAP_UNREAD = swapRoot(
  expect({
    fields: [['program', 'address', 'ROUTER', 'unknown']],
    intent: 'intent.contractCall',
    raw: [
      ['data', 'raw', '0xe517cb977ae3ad2a0200000001013200010032000100e1f50500000000c0e1e40000000000320000'],
      contract('account-0', 'Token Program'),
      ...ROUTE_ACCOUNTS,
      ...POOLS.map((_, index) => [
        `account-${index + 5}`,
        'list',
        [
          [`account-${index + 5}.lookupTable`, 'address', 'TABLE', 'unknown'],
          [`account-${index + 5}.lookupIndex`, 'number', index],
        ],
      ]),
    ],
    risk: 'high',
    source: 'unknown',
    summary: 'summary.contractCall',
    warnings: [
      ['UNKNOWN_CONTRACT_CALL', 'high', 'program'],
      ['solana.UNRESOLVED_LOOKUPS', 'medium', POOLS.map((_, index) => `account-${index + 5}`).join()],
    ],
  }),
  'high'
)

const external = (row: unknown[], name: string) => [...row, `label:${name}`]

const SWAP_READ = swapRoot(
  expect({
    fields: [
      external(
        [
          'arg-0',
          'list',
          [
            [
              'arg-0.0',
              'list',
              [
                external(
                  [
                    'arg-0.0.0',
                    'list',
                    [['arg-0.0.0.variant', 'text', 'Whirlpool'], external(['arg-0.0.0.0', 'boolean', true], 'a_to_b')],
                  ],
                  'swap'
                ),
                external(['arg-0.0.1', 'number', 50], 'percent'),
                external(['arg-0.0.2', 'number', 0], 'input_index'),
                external(['arg-0.0.3', 'number', 1], 'output_index'),
              ],
            ],
            [
              'arg-0.1',
              'list',
              [
                external(['arg-0.1.0', 'text', 'Raydium'], 'swap'),
                external(['arg-0.1.1', 'number', 50], 'percent'),
                external(['arg-0.1.2', 'number', 0], 'input_index'),
                external(['arg-0.1.3', 'number', 1], 'output_index'),
              ],
            ],
          ],
        ],
        'route_plan'
      ),
      external(['arg-1', 'number', 100_000_000n], 'in_amount'),
      external(['arg-2', 'number', 15_000_000n], 'quoted_out_amount'),
      external(['arg-3', 'number', 50], 'slippage_bps'),
      external(['arg-4', 'number', 0], 'platform_fee_bps'),
      external(contract('account-0', 'Token Program'), 'token_program'),
      ...ROUTE_ACCOUNTS.map((row, index) =>
        external(
          row,
          [
            'user_transfer_authority',
            'user_source_token_account',
            'user_destination_token_account',
            'destination_mint',
          ][index] ?? ''
        )
      ),
      ...POOLS.map((_, index) => [`account-${index + 5}`, 'address', `POOL_${index}`, 'unknown']),
      ['program', 'address', 'ROUTER', 'contract', 'router'],
    ],
    intent: 'external:route',
    source: `idl:${JUPITER}`,
    summary: 'summary.contractCall',
  }),
  'none'
)

const DRAINER = expect({
  actions: [
    expect({
      fields: [
        ['newAuthority', 'address', 'STRANGER', 'unknown'],
        ['account', 'address', 'WALLET_USDC', 'unknown'],
        ['authorityType', 'text', 'accountOwner'],
        wallet('authority'),
        contract('program', 'Token Program'),
      ],
      intent: 'intent.transferOwnership',
      risk: 'critical',
      source: 'spl-token',
      summary: 'summary.transferOwnership',
      warnings: [['ASSET_OWNERSHIP_TRANSFER', 'critical', 'newAuthority,account']],
    }),
    expect({
      fields: [
        ['account', 'address', 'WSOL_ACCOUNT', 'unknown'],
        ['recipient', 'address', 'STRANGER', 'unknown'],
        wallet('owner'),
        contract('program', 'Token Program'),
      ],
      intent: 'solana.intent.closeAccount',
      risk: 'high',
      source: 'spl-token',
      summary: 'solana.summary.closeAccount',
      warnings: [['solana.CLOSE_TO_OTHER', 'high', 'recipient,owner']],
    }),
    expect({
      fields: [
        ['recipient', 'address', 'STRANGER', 'unknown'],
        sol('amount', 5_000_000_000n),
        wallet('from'),
        contract('program', 'System Program'),
      ],
      intent: 'intent.send',
      risk: 'low',
      source: 'system-program',
      summary: 'summary.send',
      warnings: [['UNKNOWN_DESTINATION', 'low', 'recipient']],
    }),
  ],
  fields: [
    ['sent', 'list', [sol('sent-0', 5_000_000_000n)]],
    ['feePayer', 'address', 'STRANGER', 'unknown'],
    sol('fee', 10_000n),
    ['signers', 'list', [['signer-0', 'address', 'STRANGER', 'unknown'], wallet('signer-1')]],
    ['recentBlockhash', 'text', 'BLOCKHASH'],
    ['computeUnitLimit', 'number', 403_000, 'solana.unit.computeUnits'],
    ['version', 'text', 'legacy'],
  ],
  intent: 'intent.batch',
  risk: 'critical',
  source: 'solana-transaction',
  summary: 'summary.batch',
  warnings: [
    ['solana.NOT_FEE_PAYER', 'low', 'feePayer'],
    ['solana.OTHER_SIGNERS', 'low', 'signers'],
  ],
})

const DURABLE = expect({
  actions: [
    expect({
      fields: [
        ['nonceAccount', 'address', 'NONCE_ACCOUNT', 'unknown'],
        wallet('nonceAuthority'),
        contract('account-1', 'Recent Blockhashes Sysvar'),
        contract('program', 'System Program'),
      ],
      intent: 'solana.intent.advanceNonce',
      source: 'system-program',
      summary: 'solana.summary.advanceNonce',
    }),
    expect({
      fields: [
        ['recipient', 'address', 'STRANGER', 'unknown'],
        sol('amount', 1n),
        wallet('from'),
        contract('program', 'System Program'),
      ],
      intent: 'intent.send',
      risk: 'low',
      source: 'system-program',
      summary: 'summary.send',
      warnings: [['UNKNOWN_DESTINATION', 'low', 'recipient']],
    }),
  ],
  fields: [
    ['sent', 'list', [sol('sent-0', 1n)]],
    wallet('feePayer'),
    sol('fee', 5_000n),
    ['nonceAccount', 'address', 'NONCE_ACCOUNT', 'unknown'],
    ['nonce', 'text', 'NONCE_VALUE'],
    ['expiry', 'datetime', 'never'],
    ['computeUnitLimit', 'number', 6_000, 'solana.unit.computeUnits'],
    ['version', 'text', 'v0'],
  ],
  intent: 'intent.send',
  risk: 'high',
  source: 'solana-transaction',
  summary: 'summary.send',
  warnings: [['solana.DURABLE_NONCE', 'high', 'nonceAccount,nonce,expiry']],
})

const signInModel = (risk: string, warnings: unknown[]) =>
  expect({
    fields: [
      ['domain', 'text', 'app.example.com'],
      wallet('account'),
      ['statement', 'text', 'Click Sign or Approve only means you have proved this wallet is owned by you.'],
      ['uri', 'text', 'https://app.example.com'],
      ['network', 'text', 'solana:mainnet'],
      ['issuedAt', 'datetime', NOW - 5_000],
      ['nonce', 'text', '6YsaZW5Fy3zg'],
      ['version', 'text', '1'],
      ['resources', 'list', [['resource-0', 'text', 'https://app.example.com/tos']]],
    ],
    intent: 'intent.signIn',
    risk,
    source: 'siws',
    summary: 'summary.signIn',
    warnings,
  })

describe('real-world samples', () => {
  test('an aggregator swap, v0 with its pools in a lookup table, without the table: unknown and unresolved', async () => {
    const result = await clearSignTransaction(chain, swap(), {resolvers: {clock}, signer: WALLET})
    const route = result.actions[6]
    assert.ok(route)

    assert.deepEqual(model(result, result.warnings), SWAP_UNREAD)

    assert.equal(field(result, 'version', 'text').value, 'v0')
    assert.equal(result.intent.code, 'intent.batch')
    assert.deepEqual(codesAt(result, [6]).sort(), ['UNKNOWN_CONTRACT_CALL', 'solana.UNRESOLVED_LOOKUPS'])
    assert.equal(route.raw.filter(entry => entry.kind === 'list').length, POOLS.length)
    // Wrapping SOL is a transfer to the signer's own wrapped SOL account, and unwrapping closes it back to the signer.
    assert.equal(addressOf(result.actions[3] ?? route, 'recipient').relation, 'own')
    assert.deepEqual(codesAt(result, [3]), [])
    assert.deepEqual(codesAt(result, [7]), [])
    assert.equal(field(result, 'priorityFee', 'amount').value, 40_000n)
    assert.equal(result.risk, 'high')
  })

  test('the same swap, with its table and an IDL for the router: every instruction read', async () => {
    const result = await clearSignTransaction(chain, swap(), {
      resolvers: {
        clock,
        descriptors: createIdlResolver([{idl: ROUTER_IDL, publisher: 'Test registry'}]),
        lookupTables: {lookupTable: ({address: table}) => (table === TABLE ? POOLS : undefined)},
      },
      signer: WALLET,
    })
    const route = result.actions[6]
    assert.ok(route)

    assert.deepEqual(model(result, result.warnings), SWAP_READ)
    assert.deepEqual(route.source, {format: 'idl', id: JUPITER, kind: 'descriptor', publisher: 'Test registry'})
    assert.equal(route.intent.text, 'route')
    assert.equal(field(route, 'arg-1', 'number').value, 100_000_000n)
    assert.equal(field(route, 'arg-2', 'number').value, 15_000_000n)
    assert.equal(field(route, 'arg-3', 'number').value, 50)
    assert.equal(field(route, 'arg-0.0.0.variant', 'text').value, 'Whirlpool')
    assert.equal(field(route, 'arg-0.1.0', 'text').value, 'Raydium')
    assert.equal(addressOf(route, 'account-3').relation, 'own')
    assert.equal(addressOf(route, 'account-5').value, POOLS[0])
    assert.deepEqual(codes(result), [])
    assert.equal(result.risk, 'none')

    const sent = field(result, 'sent', 'list').items
    assert.equal(sent.length, 1)
    assert.equal(sent[0]?.kind === 'amount' && sent[0].value, 100_000_000n)
  })

  test('a drainer: the token account handed over, wrapped SOL closed to the attacker, SOL sent, fees paid for', async () => {
    const attacker = STRANGER
    const message = pipe(
      createTransactionMessage({version: 'legacy'}),
      message => setTransactionMessageFeePayer(as(attacker), message),
      message =>
        setTransactionMessageLifetimeUsingBlockhash(
          {blockhash: BLOCKHASH as Blockhash, lastValidBlockHeight: 0n},
          message
        ),
      message =>
        appendTransactionMessageInstructions(
          [
            getSetAuthorityInstruction({
              authorityType: AuthorityType.AccountOwner,
              newAuthority: as(attacker),
              owned: as(ata(WALLET, USDC)),
              owner: signer(WALLET),
            }),
            getCloseAccountInstruction({account: as(address(99)), destination: as(attacker), owner: signer(WALLET)}),
            getTransferSolInstruction({amount: 5_000_000_000n, destination: as(attacker), source: signer(WALLET)}),
          ],
          message
        )
    )
    const bytes = new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)))
    const result = await clearSignTransaction(chain, bytes, {resolvers: {clock}, signer: WALLET})

    assert.deepEqual(model(result, result.warnings), DRAINER)
    assert.equal(result.risk, 'critical')
    assert.deepEqual(
      result.warnings.map(entry => [entry.code, entry.severity]),
      [
        ['ASSET_OWNERSHIP_TRANSFER', 'critical'],
        ['solana.CLOSE_TO_OTHER', 'high'],
        ['solana.NOT_FEE_PAYER', 'low'],
        ['solana.OTHER_SIGNERS', 'low'],
        ['UNKNOWN_DESTINATION', 'low'],
      ]
    )
    assert.deepEqual(warningOf(result, 'ASSET_OWNERSHIP_TRANSFER').action, [0])
    assert.equal(warningsAt(result, [1]).length, 1)
    assert.match(plainText(result), /^Batch: 3 actions in one signature\nTransaction on Solana\. Risk: critical\./)
  })

  test('a durable nonce transaction, as kit builds one: it never expires', async () => {
    const nonce = {account: address(98), authority: WALLET, value: address(97)}
    const bytes = kitTransaction(
      [getTransferSolInstruction({amount: 1n, destination: as(STRANGER), source: signer(WALLET)})],
      {nonce}
    )
    const result = await clearSignTransaction(chain, bytes, {resolvers: {clock}, signer: WALLET})

    assert.deepEqual(model(result, result.warnings), DURABLE)
    assert.equal(warningOf(result, 'solana.DURABLE_NONCE').severity, 'high')
    assert.equal(field(result, 'nonce', 'text').value, nonce.value)
    assert.equal(addressOf(result, 'nonceAccount').value, nonce.account)
    assert.equal(first(result).intent.code, 'solana.intent.advanceNonce')
    assert.equal(result.intent.code, 'intent.send')
  })

  test('a Sign In With Solana request, as a dApp sends one', async () => {
    const message = [
      `app.example.com wants you to sign in with your Solana account:`,
      WALLET,
      '',
      'Click Sign or Approve only means you have proved this wallet is owned by you.',
      '',
      'URI: https://app.example.com',
      'Version: 1',
      'Chain ID: solana:mainnet',
      'Nonce: 6YsaZW5Fy3zg',
      `Issued At: ${new Date(NOW - 5_000).toISOString()}`,
      'Resources:',
      '- https://app.example.com/tos',
    ].join('\n')
    const honest = await clearSignMessage(chain, message, {
      origin: 'https://app.example.com',
      resolvers: {clock},
      signer: WALLET,
    })
    const phished = await clearSignMessage(chain, message, {
      origin: 'https://app-example.co',
      resolvers: {clock},
      signer: WALLET,
    })

    assert.equal(honest.kind, 'message')
    assert.deepEqual(model(honest, honest.warnings), signInModel('none', []))
    assert.deepEqual(
      model(phished, phished.warnings),
      signInModel('high', [['solana.SIGN_IN_DOMAIN_MISMATCH', 'high', 'domain']])
    )
    assert.equal(honest.summary?.text, 'Sign in to app.example.com')
    assert.equal(honest.risk, 'none')
    assert.deepEqual(codes(phished), ['solana.SIGN_IN_DOMAIN_MISMATCH'])
    assert.equal(phished.risk, 'high')
  })
})

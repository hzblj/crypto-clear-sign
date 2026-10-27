import assert from 'node:assert/strict'
import {describe, test} from 'node:test'

import {plainText, warningsAt} from '@hzblj/crypto-clear-sign'
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

import {clearSignMessage, clearSignTransaction, createIdlResolver, type SolanaIdl} from '../src'
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

describe('real-world samples', () => {
  test('an aggregator swap, v0 with its pools in a lookup table, without the table: unknown and unresolved', async () => {
    const result = await clearSignTransaction(chain, swap(), {resolvers: {clock}, signer: WALLET})
    const route = result.actions[6]
    assert.ok(route)

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

    assert.equal(honest.summary?.text, 'Sign in to app.example.com')
    assert.equal(honest.risk, 'none')
    assert.deepEqual(codes(phished), ['solana.SIGN_IN_DOMAIN_MISMATCH'])
    assert.equal(phished.risk, 'high')
  })
})

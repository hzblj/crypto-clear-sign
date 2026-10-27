import {createIdlResolver, type SolanaIdl} from '@hzblj/crypto-clear-sign-solana'
import {
  COMPUTE_BUDGET_PROGRAM,
  type SolanaAddressLookupTables,
  type SolanaInstruction,
  SYSTEM_PROGRAM,
  TOKEN_PROGRAM,
} from '@hzblj/crypto-solana'
import {base58, utf8} from '@hzblj/nitro-crypto/adapter'

import {JUP} from '../directory'
import {HOUR, type Sample, type SampleEnv} from './types'

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const WRAPPED_SOL = 'So11111111111111111111111111111111111111112'
const JUPITER = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'
const RECENT_BLOCKHASHES = 'SysvarRecentB1ockHashes11111111111111111111'
const LAMPORTS = 1_000_000_000n

type Role = '' | 's' | 'w' | 'sw'

/** A name made into an address: 32 bytes of its SHA-256, so every sample's made-up accounts stay the same. */
const named = (env: SampleEnv, name: string) => base58.encode(env.crypto.hash.sha256(utf8.encode(name)))

/** An instruction by hand: a program, its accounts (`s` signs, `w` is writable) and its data. */
const instruction = (
  programId: string,
  accounts: readonly (readonly [string, Role])[],
  data: readonly number[] | Uint8Array
): SolanaInstruction => ({
  accounts: accounts.map(([address, role]) => ({
    address,
    isSigner: role.includes('s'),
    isWritable: role.includes('w'),
  })),
  data: Uint8Array.from(data),
  programId,
})

/** Little-endian bytes of an unsigned integer, as Solana's programs read their arguments. */
const le = (value: bigint | number, size: number) =>
  Array.from({length: size}, (_, index) => Number((BigInt(value) >> BigInt(index * 8)) & 0xffn))

/** The token account the signer holds `mint` in. */
const ata = (env: SampleEnv, owner: string, mint: string) =>
  env.crypto.chains.solana.associatedTokenAddress({mint, owner, tokenProgram: TOKEN_PROGRAM})

/**
 * A wire transaction as a dApp hands it to a wallet: the message, compiled by the adapter, after a signature slot per
 * signer, every one still empty.
 */
const wire = (
  env: SampleEnv,
  instructions: readonly SolanaInstruction[],
  {
    feePayer = env.accounts.solana.address,
    lookupTables,
    recentBlockhash = named(env, 'recent blockhash'),
  }: {feePayer?: string; lookupTables?: SolanaAddressLookupTables; recentBlockhash?: string} = {}
) => {
  const chain = env.crypto.chains.solana
  const message = chain.compileMessage({
    feePayer,
    instructions,
    recentBlockhash,
    ...(lookupTables === undefined ? {} : {addressLookupTables: lookupTables, version: 0 as const}),
  })
  const signers = chain.decodeMessage(message, lookupTables === undefined ? {} : {addressLookupTables: lookupTables})
    .signers.length

  return Uint8Array.from([signers, ...new Uint8Array(64 * signers), ...message])
}

const transactionOf = (payload: Uint8Array) => ({request: {chain: 'solana', kind: 'transaction', payload} as const})

const setComputeUnitLimit = (units: number) => instruction(COMPUTE_BUDGET_PROGRAM, [], [2, ...le(units, 4)])
const setComputeUnitPrice = (microLamports: bigint) =>
  instruction(COMPUTE_BUDGET_PROGRAM, [], [3, ...le(microLamports, 8)])

/** A deposit into a vault program no built-in decoder reads: the same bytes with and without its IDL. */
const deposit = (env: SampleEnv) => {
  const user = env.accounts.solana.address
  const vault = named(env, 'demo vault')
  const program = named(env, 'demo vault program')

  return {
    instruction: instruction(
      program,
      [
        [vault, 'w'],
        [ata(env, vault, USDC), 'w'],
        [ata(env, user, USDC), 'w'],
        [user, 'sw'],
        [TOKEN_PROGRAM, ''],
      ],
      [...discriminator(env, 'deposit'), ...le(1_000_000_000n, 8), ...le(90, 2)]
    ),
    program,
  }
}

/** Anchor's instruction discriminator: the first 8 bytes of `sha256("global:<name>")`. */
const discriminator = (env: SampleEnv, name: string) =>
  Array.from(env.crypto.hash.sha256(utf8.encode(`global:${name}`)).subarray(0, 8))

/** The vault program's IDL, as its authors would publish it (Anchor 0.30): what the app chose to trust. */
export const demoVaultIdl = (env: SampleEnv): SolanaIdl => ({
  address: deposit(env).program,
  instructions: [
    {
      accounts: [
        {name: 'vault', writable: true},
        {name: 'vault_token_account', writable: true},
        {name: 'user_token_account', writable: true},
        {name: 'user', signer: true, writable: true},
        {address: TOKEN_PROGRAM, name: 'token_program'},
      ],
      args: [
        {name: 'amount', type: 'u64'},
        {name: 'lock_days', type: 'u16'},
      ],
      discriminator: discriminator(env, 'deposit'),
      name: 'deposit',
    },
  ],
  metadata: {name: 'demo_vault', spec: '0.1.0', version: '0.1.0'},
})

/** Sign In With Solana, as the wallet standard lays it out. */
const siws = (env: SampleEnv) =>
  [
    'app.example.com wants you to sign in with your Solana account:',
    env.accounts.solana.address,
    '',
    'Sign in to the example app.',
    '',
    'URI: https://app.example.com',
    'Version: 1',
    'Chain ID: mainnet',
    'Nonce: 6YsaZW5Fy3zg',
    `Issued At: ${new Date(env.now - 5_000).toISOString()}`,
    `Expiration Time: ${new Date(env.now + HOUR).toISOString()}`,
  ].join('\n')

export const SOLANA_SAMPLES: readonly Sample[] = [
  {
    build: env =>
      transactionOf(
        wire(env, [
          env.crypto.chains.solana.instructions.transfer({
            from: env.accounts.solana.address,
            lamports: (LAMPORTS * 3n) / 2n,
            to: env.accounts.strangers.solanaOther,
          }),
        ])
      ),
    caption: '1.5 SOL to a contact. Offline, the contact is an address nobody knows.',
    chain: 'solana',
    id: 'sol-transfer',
    title: 'SOL transfer',
  },
  {
    build: env =>
      transactionOf(
        wire(
          env,
          env.crypto.chains.solana.instructions.transferToken({
            amount: 420_000_000n,
            decimals: 6,
            from: env.accounts.solana.address,
            mint: JUP,
            to: env.accounts.strangers.solana,
          })
        )
      ),
    caption:
      '420 JUP by transferChecked, the recipient’s token account created first. Offline, JUP is an unknown mint: its decimals still show, its symbol does not.',
    chain: 'solana',
    id: 'spl-transfer-checked',
    title: 'SPL token transfer',
  },
  {
    build: env => {
      const user = env.accounts.solana.address
      const wrapped = ata(env, user, WRAPPED_SOL)
      const usdc = ata(env, user, USDC)
      const table = named(env, 'route lookup table')
      const pools = Array.from({length: 12}, (_, index) => named(env, `pool ${index}`))
      const route = instruction(
        JUPITER,
        [
          [TOKEN_PROGRAM, ''],
          [user, 's'],
          [wrapped, 'w'],
          [usdc, 'w'],
          [USDC, ''],
          ...pools.map((pool, index) => [pool, index % 2 === 0 ? 'w' : ''] as const),
        ],
        [229, 23, 203, 151, 122, 227, 173, 42, 1, 0, 0, 0, 7, 100, 0, 1, ...le(LAMPORTS / 4n, 8), ...le(38_000_000n, 8)]
      )
      const lookupTables = {[table]: pools}

      return {
        context: {lookupTables},
        request: {
          chain: 'solana',
          kind: 'transaction',
          payload: wire(
            env,
            [
              setComputeUnitLimit(400_000),
              setComputeUnitPrice(250_000n),
              env.crypto.chains.solana.instructions.createAssociatedTokenAccountIdempotent({
                mint: WRAPPED_SOL,
                owner: user,
                payer: user,
              }),
              env.crypto.chains.solana.instructions.transfer({from: user, lamports: LAMPORTS / 4n, to: wrapped}),
              instruction(TOKEN_PROGRAM, [[wrapped, 'w']], [17]),
              env.crypto.chains.solana.instructions.createAssociatedTokenAccountIdempotent({
                mint: USDC,
                owner: user,
                payer: user,
              }),
              route,
              instruction(
                TOKEN_PROGRAM,
                [
                  [wrapped, 'w'],
                  [user, 'w'],
                  [user, 's'],
                ],
                [9]
              ),
            ],
            {lookupTables}
          ),
        },
      }
    },
    caption:
      'A v0 swap of 0.25 SOL for USDC in an aggregator’s shape: SOL wrapped, a route through 12 pools named by a lookup table the app fetched, the rest unwrapped. The router has no decoder.',
    chain: 'solana',
    id: 'jupiter-swap',
    title: 'Aggregator swap (v0)',
  },
  {
    build: env => {
      const user = env.accounts.solana.address
      const attacker = env.accounts.strangers.solana

      return transactionOf(
        wire(
          env,
          [
            instruction(
              TOKEN_PROGRAM,
              [
                [ata(env, user, USDC), 'w'],
                [user, 's'],
              ],
              [6, 2, 1, ...base58.decode(attacker)]
            ),
            instruction(
              TOKEN_PROGRAM,
              [
                [ata(env, user, WRAPPED_SOL), 'w'],
                [attacker, 'w'],
                [user, 's'],
              ],
              [9]
            ),
            env.crypto.chains.solana.instructions.transfer({from: user, lamports: 5n * LAMPORTS, to: attacker}),
          ],
          {feePayer: attacker}
        )
      )
    },
    caption:
      'A "claim airdrop" that hands the USDC token account to an attacker, closes the wrapped SOL account to them and sends 5 SOL. The attacker even pays the fee.',
    chain: 'solana',
    id: 'set-authority-drainer',
    title: 'setAuthority drainer',
  },
  {
    build: env => {
      const user = env.accounts.solana.address

      return transactionOf(
        wire(env, [
          instruction(
            TOKEN_PROGRAM,
            [
              [ata(env, user, USDC), 'w'],
              [env.accounts.strangers.solana, 'w'],
              [user, 's'],
            ],
            [9]
          ),
        ])
      )
    },
    caption: 'Closing the USDC token account, its rent to someone else than the owner.',
    chain: 'solana',
    id: 'close-account-stranger',
    title: 'closeAccount to a stranger',
  },
  {
    build: env => {
      const user = env.accounts.solana.address
      const nonce = named(env, 'durable nonce value')

      return transactionOf(
        wire(
          env,
          [
            instruction(
              SYSTEM_PROGRAM,
              [
                [named(env, 'nonce account'), 'w'],
                [RECENT_BLOCKHASHES, ''],
                [user, 's'],
              ],
              le(4, 4)
            ),
            env.crypto.chains.solana.instructions.transfer({
              from: user,
              lamports: LAMPORTS / 10n,
              to: env.accounts.strangers.solana,
            }),
          ],
          {recentBlockhash: nonce}
        )
      )
    },
    caption: 'A transfer on a durable nonce: it never expires, and whoever holds it signed can send it at any time.',
    chain: 'solana',
    id: 'durable-nonce',
    title: 'Durable nonce',
  },
  {
    build: env => ({
      context: {origin: 'https://app.example.com'},
      request: {chain: 'solana', kind: 'message', payload: siws(env)},
    }),
    caption: 'Sign In With Solana from the site it names, for the signing account, on mainnet.',
    chain: 'solana',
    id: 'siws',
    title: 'Sign In With Solana',
  },
  {
    build: env => ({
      request: {
        chain: 'solana',
        kind: 'message',
        payload: env.crypto.chains.solana.encodeOffchainMessage({
          applicationDomain: named(env, 'example app'),
          signers: [env.accounts.solana.address],
          text: 'I accept the example app terms of service, version 3 (2026-10-01).',
          version: 0,
        }),
      },
    }),
    caption: 'Solana’s off-chain message format, version 0: an application domain, the signers, restricted ASCII text.',
    chain: 'solana',
    id: 'offchain-message',
    title: 'Off-chain message',
  },
  {
    build: env => transactionOf(wire(env, [deposit(env).instruction])),
    caption: 'A deposit into a program nothing here reads: its accounts by role and its data as bytes.',
    chain: 'solana',
    id: 'unknown-program',
    title: 'Unknown program',
  },
  {
    build: env => ({
      context: {idls: createIdlResolver([{id: 'demo-vault@0.1.0', idl: demoVaultIdl(env), publisher: 'Demo Vault'}])},
      request: {chain: 'solana', kind: 'transaction', payload: wire(env, [deposit(env).instruction])},
    }),
    caption:
      'The same bytes, with the program’s Anchor IDL given through createIdlResolver: the instruction, its arguments and its accounts by name.',
    chain: 'solana',
    id: 'unknown-program-idl',
    title: 'Same program, with its IDL',
  },
]

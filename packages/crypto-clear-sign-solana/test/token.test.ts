import assert from 'node:assert/strict'
import {describe, test} from 'node:test'

import {actionAt, findField, maxUint} from '@hzblj/crypto-clear-sign'
import {type Address, none, some} from '@solana/kit'
import {
  AuthorityType,
  getAmountToUiAmountInstruction,
  getApproveCheckedInstruction,
  getApproveInstruction,
  getBatchInstruction,
  getBurnCheckedInstruction,
  getBurnInstruction,
  getCloseAccountInstruction,
  getCreateAssociatedTokenIdempotentInstruction,
  getFreezeAccountInstruction,
  getGetAccountDataSizeInstruction,
  getInitializeAccount2Instruction,
  getInitializeAccount3Instruction,
  getInitializeAccountInstruction,
  getInitializeImmutableOwnerInstruction,
  getInitializeMint2Instruction,
  getInitializeMintInstruction,
  getInitializeMultisig2Instruction,
  getInitializeMultisigInstruction,
  getMintToCheckedInstruction,
  getMintToInstruction,
  getRevokeInstruction,
  getSetAuthorityInstruction,
  getSyncNativeInstruction,
  getThawAccountInstruction,
  getTransferCheckedInstruction,
  getTransferInstruction,
  getUiAmountToAmountInstruction,
  getUnwrapLamportsInstruction,
  getWithdrawExcessLamportsInstruction,
} from '@solana-program/token'
import * as token2022 from '@solana-program/token-2022'

import {
  address,
  addressOf,
  chain,
  clear,
  codes,
  codesAt,
  field,
  first,
  fromKit,
  OTHER,
  raw,
  STRANGER,
  signer,
  syncResolvers,
  TEST_MINT,
  TOKEN,
  TOKEN_2022,
  USDC,
  WALLET,
  warningOf,
} from './support'

const as = (value: string) => value as Address
const SOURCE = address(30)
const DESTINATION = address(31)
const UNKNOWN_MINT = address(32)
const ata = (owner: string, mint: string, tokenProgram = TOKEN) =>
  chain.associatedTokenAddress({mint, owner, tokenProgram})
const T22 = {programAddress: as(TOKEN_2022)}

describe('SPL Token', () => {
  test('transferChecked: what @solana-program/token encodes, read back with the instruction`s decimals', async () => {
    const result = await clear([
      getTransferCheckedInstruction({
        amount: 2_500_000n,
        authority: signer(WALLET),
        decimals: 6,
        destination: as(DESTINATION),
        mint: as(USDC),
        source: as(SOURCE),
      }),
    ])
    const action = first(result)
    const amount = field(action, 'amount', 'amount')

    assert.deepEqual(action.source, {decoder: 'spl-token', kind: 'builtin'})
    assert.equal(action.intent.code, 'intent.send')
    assert.equal(amount.value, 2_500_000n)
    assert.equal(amount.decimals, 6)
    assert.equal(amount.symbol, 'USDC')
    assert.equal(amount.token, USDC)
    assert.equal(addressOf(action, 'destinationAccount').value, DESTINATION)
    assert.equal(addressOf(action, 'sourceAccount').value, SOURCE)
    assert.equal(addressOf(action, 'owner').relation, 'self')
    assert.equal(addressOf(action, 'mint').relation, 'token')
    assert.deepEqual(codesAt(result, [0]), ['UNKNOWN_DESTINATION'])
    assert.deepEqual(warningOf(result, 'UNKNOWN_DESTINATION').fields, ['destinationAccount'])

    const sent = field(result, 'sent', 'list').items[0]
    assert.equal(sent?.kind === 'amount' && sent.value, 2_500_000n)
    assert.equal(sent?.kind === 'amount' && sent.symbol, 'USDC')
  })

  test('the decimals are the instruction`s even when the token list says otherwise', async () => {
    const result = await clear(
      [
        getTransferCheckedInstruction({
          amount: 1n,
          authority: signer(WALLET),
          decimals: 9,
          destination: as(DESTINATION),
          mint: as(TEST_MINT),
          source: as(SOURCE),
        }),
      ],
      {resolvers: syncResolvers}
    )
    const amount = field(first(result), 'amount', 'amount')

    assert.equal(amount.decimals, 9)
    assert.equal(amount.symbol, 'TST')
  })

  test('a transfer to the recipient`s associated account created alongside names the recipient', async () => {
    const result = await clear(
      [
        getCreateAssociatedTokenIdempotentInstruction({
          ata: as(ata(OTHER, USDC)),
          mint: as(USDC),
          owner: as(OTHER),
          payer: signer(WALLET),
        }),
        getTransferCheckedInstruction({
          amount: 5n,
          authority: signer(WALLET),
          decimals: 6,
          destination: as(ata(OTHER, USDC)),
          mint: as(USDC),
          source: as(ata(WALLET, USDC)),
        }),
      ],
      {resolvers: syncResolvers}
    )
    const action = result.actions[1]
    assert.ok(action)

    assert.equal(addressOf(action, 'recipient').value, OTHER)
    assert.equal(addressOf(action, 'recipient').name, 'Savings')
    assert.deepEqual(codesAt(result, [1]), [])
    assert.equal(result.intent.code, 'intent.send')
    assert.equal(first(result).intent.code, 'solana.intent.createTokenAccount')
  })

  test('a transfer to the signer`s own associated account is to self', async () => {
    const result = await clear([
      getTransferCheckedInstruction({
        amount: 5n,
        authority: signer(WALLET),
        decimals: 6,
        destination: as(ata(WALLET, USDC)),
        mint: as(USDC),
        source: as(SOURCE),
      }),
    ])

    assert.equal(addressOf(first(result), 'recipient').relation, 'self')
    assert.deepEqual(codesAt(result, [0]), [])
  })

  test('transfer without a mint: base units and UNKNOWN_TOKEN, unless the transaction says which mint', async () => {
    const plain = await clear([
      getTransferInstruction({amount: 7n, authority: signer(WALLET), destination: as(DESTINATION), source: as(SOURCE)}),
    ])
    const amount = field(first(plain), 'amount', 'amount')

    assert.equal(amount.value, 7n)
    assert.equal(amount.decimals, undefined)
    assert.equal(amount.token, undefined)
    assert.ok(codesAt(plain, [0]).includes('UNKNOWN_TOKEN'))
    assert.equal(warningOf(plain, 'UNKNOWN_TOKEN').severity, 'medium')

    const known = await clear([
      getCreateAssociatedTokenIdempotentInstruction({
        ata: as(ata(OTHER, USDC)),
        mint: as(USDC),
        owner: as(OTHER),
        payer: signer(WALLET),
      }),
      getTransferInstruction({
        amount: 7n,
        authority: signer(WALLET),
        destination: as(ata(OTHER, USDC)),
        source: as(SOURCE),
      }),
    ])
    const learned = actionAt(known, [1])
    assert.ok(learned)
    assert.equal(field(learned, 'amount', 'amount').symbol, 'USDC')
    assert.ok(!codesAt(known, [1]).includes('UNKNOWN_TOKEN'))
  })

  test('UNKNOWN_TOKEN: a mint no token list knows, and USDC once the built-in list is off', async () => {
    const transfer = (mint: string) =>
      getTransferCheckedInstruction({
        amount: 1n,
        authority: signer(WALLET),
        decimals: 6,
        destination: as(ata(WALLET, mint)),
        mint: as(mint),
        source: as(SOURCE),
      })

    assert.deepEqual(codesAt(await clear([transfer(UNKNOWN_MINT)]), [0]), ['UNKNOWN_TOKEN'])
    assert.deepEqual(codesAt(await clear([transfer(USDC)]), [0]), [])
    assert.deepEqual(codesAt(await clear([transfer(USDC)], {builtinTokens: false}), [0]), ['UNKNOWN_TOKEN'])
    assert.deepEqual(codesAt(await clear([transfer(TEST_MINT)], {resolvers: syncResolvers}), [0]), [])
  })

  test('the app`s token list comes before the built-in one', async () => {
    const result = await clear(
      [
        getTransferCheckedInstruction({
          amount: 1n,
          authority: signer(WALLET),
          decimals: 6,
          destination: as(DESTINATION),
          mint: as(USDC),
          source: as(SOURCE),
        }),
      ],
      {resolvers: {tokens: {token: () => ({decimals: 6, symbol: 'USDC.e'})}}}
    )

    assert.equal(field(first(result), 'amount', 'amount').symbol, 'USDC.e')
  })

  test('UNLIMITED_APPROVAL: an approval of the largest u64 is critical and shows as unlimited', async () => {
    const result = await clear([
      getApproveCheckedInstruction({
        amount: maxUint(64),
        decimals: 6,
        delegate: as(STRANGER),
        mint: as(USDC),
        owner: signer(WALLET),
        source: as(SOURCE),
      }),
    ])
    const action = first(result)
    const raised = warningOf(result, 'UNLIMITED_APPROVAL')

    assert.equal(action.intent.code, 'intent.approve')
    assert.equal(action.summary?.code, 'summary.approveUnlimited')
    assert.equal(field(action, 'amount', 'amount').unlimited, true)
    assert.equal(addressOf(action, 'spender').value, STRANGER)
    assert.equal(raised.severity, 'critical')
    assert.deepEqual(raised.fields, ['amount', 'spender'])
    assert.equal(result.risk, 'critical')
  })

  test('UNLIMITED_APPROVAL: not for one less than the largest u64', async () => {
    const result = await clear([
      getApproveCheckedInstruction({
        amount: maxUint(64) - 1n,
        decimals: 6,
        delegate: as(STRANGER),
        mint: as(USDC),
        owner: signer(WALLET),
        source: as(SOURCE),
      }),
    ])

    assert.equal(field(first(result), 'amount', 'amount').unlimited, false)
    assert.equal(first(result).summary?.code, 'summary.approve')
    assert.deepEqual(codesAt(result, [0]), [])
  })

  test('approve without a mint: unlimited and an unknown token', async () => {
    const result = await clear([
      getApproveInstruction({amount: maxUint(64), delegate: as(STRANGER), owner: signer(WALLET), source: as(SOURCE)}),
    ])

    assert.deepEqual(codesAt(result, [0]).sort(), ['UNKNOWN_TOKEN', 'UNLIMITED_APPROVAL'])
  })

  test('revoke', async () => {
    const result = await clear([getRevokeInstruction({owner: signer(WALLET), source: as(SOURCE)})])

    assert.equal(first(result).intent.code, 'intent.revoke')
    assert.equal(first(result).summary?.code, 'solana.summary.revoke')
    assert.equal(result.risk, 'none')
  })

  test('ASSET_OWNERSHIP_TRANSFER: setAuthority of a token account`s owner to a stranger, the common drainer', async () => {
    const result = await clear([
      getSetAuthorityInstruction({
        authorityType: AuthorityType.AccountOwner,
        newAuthority: as(STRANGER),
        owned: as(SOURCE),
        owner: signer(WALLET),
      }),
    ])
    const action = first(result)
    const raised = warningOf(result, 'ASSET_OWNERSHIP_TRANSFER')

    assert.equal(action.intent.code, 'intent.transferOwnership')
    assert.equal(action.summary?.code, 'summary.transferOwnership')
    assert.equal(field(action, 'authorityType', 'text').value, 'accountOwner')
    assert.equal(addressOf(action, 'newAuthority').value, STRANGER)
    assert.equal(raised.severity, 'critical')
    assert.deepEqual(raised.fields, ['newAuthority', 'account'])
  })

  test('ASSET_OWNERSHIP_TRANSFER: every authority type, to someone else; none to the user`s own account', async () => {
    for (const authorityType of [AuthorityType.MintTokens, AuthorityType.FreezeAccount, AuthorityType.CloseAccount]) {
      const away = await clear([
        getSetAuthorityInstruction({
          authorityType,
          newAuthority: as(STRANGER),
          owned: as(SOURCE),
          owner: signer(WALLET),
        }),
      ])
      assert.deepEqual(codesAt(away, [0]), ['ASSET_OWNERSHIP_TRANSFER'])

      const own = await clear(
        [
          getSetAuthorityInstruction({
            authorityType,
            newAuthority: as(OTHER),
            owned: as(SOURCE),
            owner: signer(WALLET),
          }),
        ],
        {resolvers: syncResolvers}
      )
      assert.deepEqual(codesAt(own, [0]), [])
      assert.equal(first(own).intent.code, 'solana.intent.setAuthority')
    }
  })

  test('setAuthority to none removes the authority, with no handover', async () => {
    const result = await clear([
      getSetAuthorityInstruction({
        authorityType: AuthorityType.MintTokens,
        newAuthority: none(),
        owned: as(UNKNOWN_MINT),
        owner: signer(WALLET),
      }),
    ])

    assert.equal(first(result).intent.code, 'solana.intent.removeAuthority')
    assert.deepEqual(codesAt(result, [0]), [])
  })

  test('closeAccount: CLOSE_TO_OTHER when what it holds goes to a stranger', async () => {
    const result = await clear([
      getCloseAccountInstruction({account: as(SOURCE), destination: as(STRANGER), owner: signer(WALLET)}),
    ])
    const raised = warningOf(result, 'solana.CLOSE_TO_OTHER')

    assert.equal(first(result).intent.code, 'solana.intent.closeAccount')
    assert.equal(raised.severity, 'high')
    assert.deepEqual(raised.fields, ['recipient', 'owner'])
  })

  test('closeAccount: not when it goes back to the owner or the user`s own account', async () => {
    const back = await clear([
      getCloseAccountInstruction({account: as(SOURCE), destination: as(WALLET), owner: signer(WALLET)}),
    ])
    assert.deepEqual(codesAt(back, [0]), [])

    const own = await clear(
      [getCloseAccountInstruction({account: as(SOURCE), destination: as(OTHER), owner: signer(WALLET)})],
      {resolvers: syncResolvers}
    )
    assert.deepEqual(codesAt(own, [0]), [])
  })

  test('mintTo and mintToChecked, burn and burnChecked (counted as sent)', async () => {
    const minted = first(
      await clear([
        getMintToCheckedInstruction({
          amount: 100n,
          decimals: 6,
          mint: as(USDC),
          mintAuthority: signer(WALLET),
          token: as(SOURCE),
        }),
      ])
    )
    assert.equal(minted.intent.code, 'solana.intent.mintTokens')
    assert.equal(field(minted, 'amount', 'amount').symbol, 'USDC')

    const plain = first(
      await clear([
        getMintToInstruction({amount: 100n, mint: as(USDC), mintAuthority: signer(WALLET), token: as(SOURCE)}),
      ])
    )
    assert.equal(field(plain, 'amount', 'amount').decimals, 6)

    const burned = await clear([
      getBurnCheckedInstruction({
        account: as(SOURCE),
        amount: 3n,
        authority: signer(WALLET),
        decimals: 6,
        mint: as(USDC),
      }),
      getBurnInstruction({account: as(SOURCE), amount: 4n, authority: signer(WALLET), mint: as(USDC)}),
    ])
    assert.equal(first(burned).intent.code, 'solana.intent.burnTokens')
    const sent = field(burned, 'sent', 'list').items

    assert.equal(sent.length, 1)
    assert.equal(sent[0]?.kind === 'amount' && sent[0].value, 7n)
  })

  test('freeze, thaw, syncNative, initialize mints, accounts and multisigs', async () => {
    const intents = async (...instructions: Parameters<typeof clear>[0]) =>
      (await clear(instructions)).actions.map(action => action.intent.code)

    assert.deepEqual(
      await intents(
        getFreezeAccountInstruction({account: as(SOURCE), mint: as(USDC), owner: signer(WALLET)}),
        getThawAccountInstruction({account: as(SOURCE), mint: as(USDC), owner: signer(WALLET)}),
        getSyncNativeInstruction({account: as(SOURCE)})
      ),
      ['solana.intent.freezeAccount', 'solana.intent.thawAccount', 'solana.intent.syncNative']
    )

    const mint = await clear([
      getInitializeMintInstruction({
        decimals: 9,
        freezeAuthority: some(as(OTHER)),
        mint: as(UNKNOWN_MINT),
        mintAuthority: as(WALLET),
      }),
      getInitializeMint2Instruction({decimals: 2, mint: as(UNKNOWN_MINT), mintAuthority: as(WALLET)}),
    ])
    assert.equal(field(first(mint), 'decimals', 'number').value, 9)
    assert.equal(addressOf(first(mint), 'freezeAuthority').value, OTHER)
    assert.equal(addressOf(first(mint), 'mintAuthority').relation, 'self')
    assert.equal(mint.actions[1]?.intent.code, 'solana.intent.initializeMint')

    const account = await clear([
      getInitializeAccountInstruction({account: as(SOURCE), mint: as(USDC), owner: as(WALLET)}),
      getInitializeAccount3Instruction({account: as(SOURCE), mint: as(USDC), owner: as(OTHER)}),
    ])
    assert.equal(addressOf(first(account), 'owner').relation, 'self')
    assert.equal(first(account).summary?.params?.token, 'USDC')
    assert.equal(account.actions[1] && addressOf(account.actions[1], 'owner').value, OTHER)

    const multisig = first(
      await clear([
        getInitializeMultisigInstruction({m: 2, multisig: as(SOURCE), signers: [as(WALLET), as(OTHER), as(STRANGER)]}),
      ])
    )
    assert.equal(field(multisig, 'requiredSigners', 'number').value, 2)
    assert.equal(field(multisig, 'signers', 'list').items.length, 3)
  })

  test('a multisig authority`s signers are listed as signers', async () => {
    const result = await clear([
      getTransferCheckedInstruction({
        amount: 1n,
        authority: as(SOURCE),
        decimals: 6,
        destination: as(DESTINATION),
        mint: as(USDC),
        multiSigners: [signer(WALLET), signer(OTHER)],
        source: as(SOURCE),
      }),
    ])
    const action = first(result)

    assert.equal(field(action, 'account-4', 'address').label.code, 'solana.label.signer')
    assert.equal(field(action, 'account-5', 'address').value, OTHER)
  })

  test('unwrapLamports and withdrawExcessLamports: SOL out of token accounts, UNKNOWN_DESTINATION to a stranger', async () => {
    const unwrap = await clear([
      getUnwrapLamportsInstruction({
        amount: 50n,
        authority: signer(WALLET),
        destination: as(STRANGER),
        source: as(SOURCE),
      }),
    ])
    assert.equal(first(unwrap).intent.code, 'solana.intent.unwrapSol')
    assert.equal(field(first(unwrap), 'amount', 'amount').value, 50n)
    assert.deepEqual(codesAt(unwrap, [0]), ['UNKNOWN_DESTINATION'])

    const all = await clear([
      getUnwrapLamportsInstruction({
        amount: none(),
        authority: signer(WALLET),
        destination: as(WALLET),
        source: as(SOURCE),
      }),
    ])
    assert.deepEqual(codesAt(all, [0]), [])

    const excess = await clear([
      getWithdrawExcessLamportsInstruction({authority: signer(WALLET), destination: as(WALLET), source: as(SOURCE)}),
    ])
    assert.equal(first(excess).intent.code, 'solana.intent.withdrawExcessLamports')
  })

  test('batch: one nested action per instruction, their risk and paths', async () => {
    const result = await clear([
      getBatchInstruction([
        getTransferCheckedInstruction({
          amount: 1n,
          authority: signer(WALLET),
          decimals: 6,
          destination: as(ata(WALLET, USDC)),
          mint: as(USDC),
          source: as(SOURCE),
        }),
        getApproveInstruction({amount: maxUint(64), delegate: as(STRANGER), owner: signer(WALLET), source: as(SOURCE)}),
      ]),
    ])
    const batch = first(result)

    assert.equal(batch.intent.code, 'solana.intent.tokenBatch')
    assert.equal(batch.actions.length, 2)
    assert.deepEqual(batch.actions[1]?.path, [0, 1])
    assert.equal(batch.actions[0]?.risk, 'none')
    assert.equal(batch.actions[1]?.risk, 'critical')
    assert.equal(batch.risk, 'critical')
    assert.deepEqual(warningOf(result, 'UNLIMITED_APPROVAL').action, [0, 1])
  })

  test('a batch that names more accounts than its instructions take is shown raw', async () => {
    const result = await clear([
      raw(
        TOKEN,
        [
          [SOURCE, 'w'],
          [WALLET, 's'],
        ],
        [255, 1, 1, 17]
      ),
    ])

    assert.deepEqual(first(result).source, {kind: 'unknown'})
  })

  test('initializeImmutableOwner and the amount conversions, on the Token program: read, nothing moved', async () => {
    const result = await clear([
      getInitializeImmutableOwnerInstruction({account: as(SOURCE)}),
      getAmountToUiAmountInstruction({amount: 1_500_000n, mint: as(USDC)}),
      getUiAmountToAmountInstruction({mint: as(USDC), uiAmount: '1.5'}),
      getGetAccountDataSizeInstruction({mint: as(USDC)}),
    ])
    const [immutable, toUi, fromUi, size] = result.actions

    assert.ok(immutable && toUi && fromUi && size)
    assert.deepEqual(
      result.actions.map(action => [action.source.kind === 'builtin' && action.source.decoder, action.intent.code]),
      [
        ['spl-token', 'solana.intent.initializeTokenAccount'],
        ['spl-token', 'solana.intent.readToken'],
        ['spl-token', 'solana.intent.readToken'],
        ['spl-token', 'solana.intent.readToken'],
      ]
    )
    assert.equal(addressOf(immutable, 'account').value, SOURCE)
    assert.equal(field(toUi, 'amount', 'number').value, 1_500_000n)
    assert.equal(addressOf(toUi, 'mint').relation, 'token')
    assert.equal(field(fromUi, 'amount', 'text').value, '1.5')
    assert.equal(findField(size, 'extensions'), undefined)
    assert.equal(findField(result, 'sent'), undefined)
    assert.deepEqual(codes(result), [])

    // The near miss: text that is not UTF-8, or bytes the instruction does not take, are what the program refuses.
    const refused = await clear([
      raw(TOKEN, [[USDC, '']], [24, 0xff]),
      raw(TOKEN, [[SOURCE, 'w']], [22, 0]),
      raw(TOKEN, [[USDC, '']], [23, 1, 2]),
    ])
    assert.deepEqual(
      refused.actions.map(action => action.source.kind),
      ['unknown', 'unknown', 'unknown']
    )
  })

  test('getAccountDataSize names the extensions Token-2022 is asked to size; the Token program takes none', async () => {
    const result = await clear([
      raw(TOKEN_2022, [[UNKNOWN_MINT, '']], [21, 1, 0, 7, 0, 14, 0]),
      fromKit(getGetAccountDataSizeInstruction({mint: as(UNKNOWN_MINT)}, T22)),
    ])
    const [sized, bare] = result.actions

    assert.ok(sized && bare)
    assert.deepEqual(sized.source, {decoder: 'spl-token-2022', kind: 'builtin'})
    assert.deepEqual(
      field(sized, 'extensions', 'list').items.map(item => [item.id, item.kind === 'number' && item.value]),
      [
        ['extension-0', 1],
        ['extension-1', 7],
        ['extension-2', 14],
      ]
    )
    assert.equal(findField(bare, 'extensions'), undefined)
    assert.deepEqual(codes(result), [])

    // Half an extension type, or an extension asked of the Token program, is refused.
    const refused = await clear([
      raw(TOKEN_2022, [[UNKNOWN_MINT, '']], [21, 1, 0, 7]),
      raw(TOKEN, [[UNKNOWN_MINT, '']], [21, 1, 0]),
    ])
    assert.deepEqual(codesAt(refused, [0]), ['UNKNOWN_CONTRACT_CALL'])
    assert.deepEqual(codesAt(refused, [1]), ['UNKNOWN_CONTRACT_CALL'])
  })

  test('initializeAccount2 and initializeMultisig2: the owner in the data, the signers without the rent sysvar', async () => {
    const result = await clear([
      getInitializeAccount2Instruction({account: as(SOURCE), mint: as(USDC), owner: as(OTHER)}),
      getInitializeMultisig2Instruction({
        m: 2,
        multisig: as(DESTINATION),
        signers: [as(WALLET), as(OTHER), as(STRANGER)],
      }),
      getInitializeMultisigInstruction({m: 1, multisig: as(DESTINATION), signers: [as(WALLET)]}),
    ])
    const [account, multisig2, multisig] = result.actions

    assert.ok(account && multisig2 && multisig)
    assert.equal(account.intent.code, 'solana.intent.initializeTokenAccount')
    assert.equal(addressOf(account, 'owner').value, OTHER)
    assert.equal(addressOf(account, 'mint').value, USDC)
    assert.equal(account.summary?.params?.token, 'USDC')
    // The rent sysvar the instruction still passes is shown by its role, named.
    assert.equal(addressOf(account, 'account-2').name, 'Rent Sysvar')

    assert.equal(multisig2.intent.code, 'solana.intent.initializeMultisig')
    assert.equal(field(multisig2, 'requiredSigners', 'number').value, 2)
    assert.deepEqual(
      field(multisig2, 'signers', 'list').items.map(item => [item.id, item.kind === 'address' && item.value]),
      [
        ['signer-0', WALLET],
        ['signer-1', OTHER],
        ['signer-2', STRANGER],
      ]
    )
    assert.equal(findField(multisig2, 'account-1'), undefined)
    // The first version passes the rent sysvar before its signers.
    assert.equal(addressOf(multisig, 'account-1').name, 'Rent Sysvar')
    assert.equal(field(multisig, 'signers', 'list').items.length, 1)
    assert.deepEqual(codes(result), [])
  })
  test('a batch inside a batch: the inner one is what the program refuses, raw; the rest still read', async () => {
    const transfer = fromKit(
      getTransferCheckedInstruction({
        amount: 3n,
        authority: signer(WALLET),
        decimals: 6,
        destination: as(DESTINATION),
        mint: as(USDC),
        source: as(SOURCE),
      })
    )
    const inner = [255, 0, 1, 17]
    const result = await clear([
      {
        accounts: [...transfer.accounts, {address: SOURCE, isSigner: false, isWritable: true}],
        data: Uint8Array.from([255, 4, transfer.data.length, ...transfer.data, 1, inner.length, ...inner]),
        programId: TOKEN,
      },
    ])
    const batch = first(result)

    assert.equal(batch.intent.code, 'solana.intent.tokenBatch')
    assert.equal(batch.actions.length, 2)
    assert.equal(batch.actions[0]?.intent.code, 'intent.send')
    assert.deepEqual(batch.actions[1]?.source, {kind: 'unknown'})
    assert.equal(batch.actions[1] && field(batch.actions[1], 'data', 'raw').value, '0xff000111')
    assert.deepEqual(warningOf(result, 'UNKNOWN_CONTRACT_CALL').action, [0, 1])
    assert.equal(batch.risk, 'high')
  })

  test('a batch shown raw counts nothing as sent, though an instruction in it would have', async () => {
    const transfer = fromKit(
      getTransferCheckedInstruction({
        amount: 3n,
        authority: signer(WALLET),
        decimals: 6,
        destination: as(DESTINATION),
        mint: as(USDC),
        source: as(SOURCE),
      })
    )
    const batch = (extra: number) => ({
      accounts: [
        ...transfer.accounts,
        ...Array.from({length: extra}, () => ({address: OTHER, isSigner: false, isWritable: false})),
      ],
      data: Uint8Array.from([255, 4, transfer.data.length, ...transfer.data]),
      programId: TOKEN,
    })

    const read = await clear([batch(0)])
    assert.equal(field(read, 'sent', 'list').items.length, 1)

    const refused = await clear([batch(1)])
    assert.deepEqual(first(refused).source, {kind: 'unknown'})
    assert.equal(findField(refused, 'sent'), undefined)
  })

  test('Token-2022 instructions on the Token program are not read, nor unknown tags', async () => {
    for (const data of [[25, 0], [26, 1], [200]]) {
      const result = await clear([raw(TOKEN, [[UNKNOWN_MINT, 'w']], data)])
      assert.deepEqual(codesAt(result, [0]), ['UNKNOWN_CONTRACT_CALL'])
    }
  })
})

describe('Token-2022', () => {
  test('transferChecked and transferCheckedWithFee, as @solana-program/token-2022 encodes them', async () => {
    const result = await clear(
      [
        token2022.getTransferCheckedWithFeeInstruction(
          {
            amount: 1_000n,
            authority: signer(WALLET),
            decimals: 2,
            destination: as(DESTINATION),
            fee: 10n,
            mint: as(TEST_MINT),
            source: as(SOURCE),
          },
          T22
        ),
      ],
      {resolvers: syncResolvers}
    )
    const action = first(result)

    assert.deepEqual(action.source, {decoder: 'spl-token-2022', kind: 'builtin'})
    assert.equal(field(action, 'amount', 'amount').value, 1_000n)
    assert.equal(field(action, 'fee', 'amount').value, 10n)
    assert.equal(field(action, 'fee', 'amount').symbol, 'TST')
  })

  test('setAuthority for Token-2022`s own authority types', async () => {
    const result = await clear([
      token2022.getSetAuthorityInstruction(
        {
          authorityType: token2022.AuthorityType.TransferHookProgramId,
          newAuthority: as(STRANGER),
          owned: as(UNKNOWN_MINT),
          owner: signer(WALLET),
        },
        T22
      ),
    ])

    assert.equal(field(first(result), 'authorityType', 'text').value, 'transferHookProgramId')
    assert.deepEqual(codesAt(result, [0]), ['ASSET_OWNERSHIP_TRANSFER'])
  })

  test('extensions are described as the token`s configuration, with what they set', async () => {
    const mint = as(UNKNOWN_MINT)
    type Case = readonly [
      Parameters<typeof clear>[0][number],
      string,
      'address' | 'boolean' | 'number' | 'text',
      unknown,
    ]
    const cases: readonly Case[] = [
      [
        token2022.getInitializeMintCloseAuthorityInstruction({closeAuthority: some(as(WALLET)), mint}, T22),
        'closeAuthority',
        'address',
        WALLET,
      ],
      [
        token2022.getInitializeTransferFeeConfigInstruction(
          {
            maximumFee: 5_000n,
            mint,
            transferFeeBasisPoints: 25,
            transferFeeConfigAuthority: some(as(WALLET)),
            withdrawWithheldAuthority: none(),
          },
          T22
        ),
        'feeRate',
        'number',
        25,
      ],
      [
        token2022.getSetTransferFeeInstruction(
          {maximumFee: 1n, mint, transferFeeBasisPoints: 7, transferFeeConfigAuthority: signer(WALLET)},
          T22
        ),
        'feeRate',
        'number',
        7,
      ],
      [
        token2022.getInitializeDefaultAccountStateInstruction({mint, state: token2022.AccountState.Frozen}, T22),
        'accountState',
        'text',
        'frozen',
      ],
      [
        token2022.getUpdateDefaultAccountStateInstruction(
          {freezeAuthority: signer(WALLET), mint, state: token2022.AccountState.Initialized},
          T22
        ),
        'accountState',
        'text',
        'initialized',
      ],
      [
        token2022.getInitializeInterestBearingMintInstruction({mint, rate: -15, rateAuthority: as(WALLET)}, T22),
        'rate',
        'number',
        -15,
      ],
      [
        token2022.getUpdateRateInterestBearingMintInstruction({mint, rate: 300, rateAuthority: signer(WALLET)}, T22),
        'rate',
        'number',
        300,
      ],
      [
        token2022.getInitializePermanentDelegateInstruction({delegate: as(STRANGER), mint}, T22),
        'permanentDelegate',
        'address',
        STRANGER,
      ],
      [
        token2022.getInitializeTransferHookInstruction({authority: as(WALLET), mint, programId: as(OTHER)}, T22),
        'pointer',
        'address',
        OTHER,
      ],
      [
        token2022.getUpdateTransferHookInstruction({authority: signer(WALLET), mint, programId: as(STRANGER)}, T22),
        'pointer',
        'address',
        STRANGER,
      ],
      [
        token2022.getInitializeMetadataPointerInstruction(
          {authority: as(WALLET), metadataAddress: as(OTHER), mint},
          T22
        ),
        'pointer',
        'address',
        OTHER,
      ],
      [
        token2022.getUpdateMetadataPointerInstruction(
          {metadataAddress: as(STRANGER), metadataPointerAuthority: signer(WALLET), mint},
          T22
        ),
        'pointer',
        'address',
        STRANGER,
      ],
      [
        token2022.getInitializeGroupPointerInstruction({authority: as(WALLET), groupAddress: as(OTHER), mint}, T22),
        'pointer',
        'address',
        OTHER,
      ],
      [
        token2022.getUpdateGroupMemberPointerInstruction(
          {groupMemberPointerAuthority: signer(WALLET), memberAddress: as(OTHER), mint},
          T22
        ),
        'pointer',
        'address',
        OTHER,
      ],
      [
        token2022.getInitializeScaledUiAmountMintInstruction({authority: as(WALLET), mint, multiplier: 1.5}, T22),
        'multiplier',
        'number',
        1.5,
      ],
      [
        token2022.getUpdateMultiplierScaledUiMintInstruction(
          {authority: signer(WALLET), effectiveTimestamp: 1_800_000_000n, mint, multiplier: 2},
          T22
        ),
        'multiplier',
        'number',
        2,
      ],
      [
        token2022.getInitializePausableConfigInstruction({authority: as(WALLET), mint}, T22),
        'pauseAuthority',
        'address',
        WALLET,
      ],
      [token2022.getPauseInstruction({authority: signer(WALLET), mint}, T22), 'paused', 'boolean', true],
      [token2022.getResumeInstruction({authority: signer(WALLET), mint}, T22), 'paused', 'boolean', false],
      [
        token2022.getEnableMemoTransfersInstruction({owner: signer(WALLET), token: as(SOURCE)}, T22),
        'memoRequired',
        'boolean',
        true,
      ],
      [
        token2022.getDisableCpiGuardInstruction({owner: signer(WALLET), token: as(SOURCE)}, T22),
        'cpiGuard',
        'boolean',
        false,
      ],
      [token2022.getInitializeNonTransferableMintInstruction({mint}, T22), 'nonTransferable', 'boolean', true],
      [
        token2022.getInitializePermissionedBurnInstruction({authority: as(WALLET), mint}, T22),
        'burnAuthority',
        'address',
        WALLET,
      ],
    ]

    for (const [instruction, id, kind, expected] of cases) {
      const action = first(await clear([instruction]))

      assert.equal(action.intent.code, 'solana.intent.configureToken', id)
      assert.equal(field(action, id, kind).value, expected, id)
    }
  })

  test('the rest of Token-2022: reallocate, native mint, withheld fees, permissioned burn, data size', async () => {
    const mint = as(UNKNOWN_MINT)
    const result = await clear([
      token2022.getReallocateInstruction(
        {
          newExtensionTypes: [token2022.ExtensionType.MemoTransfer],
          owner: signer(WALLET),
          payer: signer(WALLET),
          token: as(SOURCE),
        },
        T22
      ),
      token2022.getCreateNativeMintInstruction({nativeMint: as(DESTINATION), payer: signer(WALLET)}, T22),
      token2022.getWithdrawWithheldTokensFromMintInstruction(
        {feeReceiver: as(STRANGER), mint, withdrawWithheldAuthority: signer(WALLET)},
        T22
      ),
      token2022.getHarvestWithheldTokensToMintInstruction({mint, sources: [as(SOURCE)]}, T22),
      token2022.getPermissionedBurnCheckedInstruction(
        {
          account: as(SOURCE),
          amount: 9n,
          authority: signer(WALLET),
          decimals: 0,
          mint,
          permissionedBurnAuthority: signer(WALLET),
        },
        T22
      ),
      token2022.getGetAccountDataSizeInstruction({mint}, T22),
    ])

    assert.deepEqual(
      result.actions.map(action => action.intent.code),
      [
        'solana.intent.configureToken',
        'solana.intent.initializeMint',
        'solana.intent.withdrawTokenFees',
        'solana.intent.withdrawTokenFees',
        'solana.intent.burnTokens',
        'solana.intent.readToken',
      ]
    )
    assert.deepEqual(codesAt(result, [2]), ['UNKNOWN_DESTINATION'])
    assert.equal(result.actions[4] && field(result.actions[4], 'amount', 'amount').value, 9n)
  })

  test('withdrawWithheldTokensFromAccounts: the mint, the receiver, the authority, the accounts harvested by role', async () => {
    const sources = [address(33), address(34)]
    const result = await clear([
      token2022.getWithdrawWithheldTokensFromAccountsInstruction({
        feeReceiver: as(STRANGER),
        mint: as(UNKNOWN_MINT),
        numTokenAccounts: 2,
        sources: sources.map(as),
        withdrawWithheldAuthority: signer(WALLET),
      }),
    ])
    const action = first(result)

    assert.deepEqual(action.source, {decoder: 'spl-token-2022', kind: 'builtin'})
    assert.equal(action.intent.code, 'solana.intent.withdrawTokenFees')
    assert.equal(addressOf(action, 'mint').value, UNKNOWN_MINT)
    assert.equal(addressOf(action, 'recipient').value, STRANGER)
    assert.equal(addressOf(action, 'authority').relation, 'self')
    assert.deepEqual(
      ['account-3', 'account-4'].map(id => [addressOf(action, id).value, addressOf(action, id).label.code]),
      sources.map(value => [value, 'solana.label.writableAccount'])
    )
    assert.deepEqual(warningOf(result, 'UNKNOWN_DESTINATION').fields, ['recipient'])
    assert.equal(findField(result, 'sent'), undefined)

    // The near miss: to the user's own account, nothing is warned about.
    const own = await clear(
      [
        token2022.getWithdrawWithheldTokensFromAccountsInstruction({
          feeReceiver: as(OTHER),
          mint: as(UNKNOWN_MINT),
          numTokenAccounts: 0,
          sources: [],
          withdrawWithheldAuthority: signer(WALLET),
        }),
      ],
      {resolvers: syncResolvers}
    )
    assert.deepEqual(codesAt(own, [0]), [])
  })

  test('confidential transfers are not read: UNKNOWN_CONTRACT_CALL with the raw data', async () => {
    const result = await clear([
      raw(
        TOKEN_2022,
        [
          [SOURCE, 'w'],
          [WALLET, 's'],
        ],
        [27, 7, 1, 2, 3]
      ),
    ])

    assert.deepEqual(codesAt(result, [0]), ['UNKNOWN_CONTRACT_CALL'])
    assert.equal(field(first(result), 'data', 'raw').value, '0x1b07010203')
  })
})

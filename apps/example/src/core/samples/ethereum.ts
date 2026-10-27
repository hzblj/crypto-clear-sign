import {maxUint} from '@hzblj/crypto-clear-sign'
import {PERMIT2} from '@hzblj/crypto-clear-sign-ethereum'
import type {EthereumTransactionRequest, Hex, TypedDataDefinition} from '@hzblj/crypto-ethereum'
import {hex} from '@hzblj/nitro-crypto/adapter'

import {METAMASK_DELEGATOR, ONEINCH_ROUTER, SEAPORT, UNI, UNIVERSAL_ROUTER} from '../directory'
import {address, bool, bytesArray, encodeCall, uint} from './abi'
import {DAY, HOUR, MINUTE, type Sample, type SampleEnv, seconds} from './types'

/** Mainnet contracts the samples call, as dApps name them. */
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const UNISWAP_V3_ROUTER_2 = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45'
const ONEINCH_ROUTER_V5 = '0x1111111254EEB25477B68fb85Ed929f73A960582'
const BORED_APES = '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D'
/** OpenSea's fee recipient and conduit key, as its listings carry them. */
const OPENSEA_FEES = '0x0000a26b00c1F0DF003000390027140000fAa719'
const OPENSEA_CONDUIT_KEY = '0x0000007b02230091a7ed01230072f7006a004d60a8d4e71d599b8104250f0000'
/** A contract nobody's address book names: where an all-chains delegation sends the account. */
const UNKNOWN_DELEGATE = '0x5a0b54d5dc17e0aadc383d2db43b0a0d3e029c4c'

const ETHER = 10n ** 18n
const GWEI = 10n ** 9n

/** An EIP-1559 transaction from the demo account, with the fees a wallet would fill in, serialized as it is signed. */
const transaction = (env: SampleEnv, fields: {to: string; data?: Hex; value?: bigint; gas: bigint}): Hex =>
  env.crypto.chains.ethereum.serializeTransaction({
    maxFeePerGas: 24n * GWEI,
    maxPriorityFeePerGas: 1n * GWEI,
    nonce: 42,
    ...fields,
  } as EthereumTransactionRequest)

const call = (env: SampleEnv, signature: string, values: Parameters<typeof encodeCall>[2]) =>
  encodeCall(env.crypto.hash.keccak256, signature, values)

const transactionOf = (payload: Hex) => ({request: {chain: 'ethereum', kind: 'transaction', payload} as const})
const typedDataOf = (payload: TypedDataDefinition) => ({
  request: {chain: 'ethereum', kind: 'typed-data', payload} as const,
})

const PERMIT2_TYPES = {
  EIP712Domain: [
    {name: 'name', type: 'string'},
    {name: 'chainId', type: 'uint256'},
    {name: 'verifyingContract', type: 'address'},
  ],
  PermitDetails: [
    {name: 'token', type: 'address'},
    {name: 'amount', type: 'uint160'},
    {name: 'expiration', type: 'uint48'},
    {name: 'nonce', type: 'uint48'},
  ],
  PermitSingle: [
    {name: 'details', type: 'PermitDetails'},
    {name: 'spender', type: 'address'},
    {name: 'sigDeadline', type: 'uint256'},
  ],
}

const EIP2612_TYPES = {
  EIP712Domain: [
    {name: 'name', type: 'string'},
    {name: 'version', type: 'string'},
    {name: 'chainId', type: 'uint256'},
    {name: 'verifyingContract', type: 'address'},
  ],
  Permit: [
    {name: 'owner', type: 'address'},
    {name: 'spender', type: 'address'},
    {name: 'value', type: 'uint256'},
    {name: 'nonce', type: 'uint256'},
    {name: 'deadline', type: 'uint256'},
  ],
}

const SEAPORT_TYPES = {
  ConsiderationItem: [
    {name: 'itemType', type: 'uint8'},
    {name: 'token', type: 'address'},
    {name: 'identifierOrCriteria', type: 'uint256'},
    {name: 'startAmount', type: 'uint256'},
    {name: 'endAmount', type: 'uint256'},
    {name: 'recipient', type: 'address'},
  ],
  EIP712Domain: [
    {name: 'name', type: 'string'},
    {name: 'version', type: 'string'},
    {name: 'chainId', type: 'uint256'},
    {name: 'verifyingContract', type: 'address'},
  ],
  OfferItem: [
    {name: 'itemType', type: 'uint8'},
    {name: 'token', type: 'address'},
    {name: 'identifierOrCriteria', type: 'uint256'},
    {name: 'startAmount', type: 'uint256'},
    {name: 'endAmount', type: 'uint256'},
  ],
  OrderComponents: [
    {name: 'offerer', type: 'address'},
    {name: 'zone', type: 'address'},
    {name: 'offer', type: 'OfferItem[]'},
    {name: 'consideration', type: 'ConsiderationItem[]'},
    {name: 'orderType', type: 'uint8'},
    {name: 'startTime', type: 'uint256'},
    {name: 'endTime', type: 'uint256'},
    {name: 'zoneHash', type: 'bytes32'},
    {name: 'salt', type: 'uint256'},
    {name: 'conduitKey', type: 'bytes32'},
    {name: 'counter', type: 'uint256'},
  ],
}

/** An ERC-4361 message as a site asks for one: the domain it says, the signer's address, a nonce, an hour to use it. */
const siwe = (env: SampleEnv) =>
  [
    'app.example.com wants you to sign in with your Ethereum account:',
    env.accounts.ethereum.address,
    '',
    'Sign in to the example app. This request will not trigger a blockchain transaction or cost any gas fees.',
    '',
    'URI: https://app.example.com/login',
    'Version: 1',
    'Chain ID: 1',
    'Nonce: 8Kd3sQf02Lx7',
    `Issued At: ${new Date(env.now - 5_000).toISOString()}`,
    `Expiration Time: ${new Date(env.now + HOUR).toISOString()}`,
  ].join('\n')

export const ETHEREUM_SAMPLES: readonly Sample[] = [
  {
    build: env =>
      transactionOf(
        transaction(env, {
          data: call(env, 'transfer(address,uint256)', [
            address(env.accounts.strangers.ethereumOther),
            uint(250_000_000n),
          ]),
          gas: 65_000n,
          to: USDC,
        })
      ),
    caption: 'An ERC-20 transfer of 250 USDC to a contact. Offline, the contact is an unknown address.',
    chain: 'ethereum',
    id: 'usdc-transfer',
    title: 'USDC transfer',
  },
  {
    build: env =>
      transactionOf(transaction(env, {gas: 21_000n, to: env.accounts.ethereumSavings.address, value: ETHER / 2n})),
    caption: 'Half an ether to the demo key’s second account, which the address book calls Savings.',
    chain: 'ethereum',
    id: 'native-transfer',
    title: 'Ether transfer',
  },
  {
    build: env =>
      transactionOf(
        transaction(env, {
          data: call(env, 'approve(address,uint256)', [address(PERMIT2), uint(maxUint(256))]),
          gas: 56_000n,
          to: USDC,
        })
      ),
    caption: 'USDC approves Permit2 for the largest amount there is, as Uniswap asks once per token.',
    chain: 'ethereum',
    id: 'unlimited-approve',
    title: 'Unlimited approval',
  },
  {
    build: env =>
      transactionOf(
        transaction(env, {
          data: call(env, 'approve(address,uint256)', [address(ONEINCH_ROUTER_V5), uint(0)]),
          gas: 46_000n,
          to: USDC,
        })
      ),
    caption: 'An approval of zero: an old router can no longer spend USDC.',
    chain: 'ethereum',
    id: 'revoke',
    title: 'Revoke an approval',
  },
  {
    build: env =>
      typedDataOf({
        domain: {chainId: 1, name: 'Permit2', verifyingContract: PERMIT2},
        message: {
          details: {
            amount: maxUint(160).toString(),
            expiration: seconds(env.now + 30 * DAY).toString(),
            nonce: '0',
            token: USDC,
          },
          sigDeadline: seconds(env.now + 30 * MINUTE).toString(),
          spender: UNIVERSAL_ROUTER,
        },
        primaryType: 'PermitSingle',
        types: PERMIT2_TYPES,
      } as TypedDataDefinition),
    caption:
      'A signature, not a transaction: Uniswap’s Universal Router may spend any amount of USDC through Permit2 for 30 days.',
    chain: 'ethereum',
    id: 'permit2',
    title: 'Permit2 signature',
  },
  {
    build: env =>
      typedDataOf({
        domain: {chainId: 1, name: 'USD Coin', verifyingContract: USDC, version: '2'},
        message: {
          deadline: maxUint(256).toString(),
          nonce: '0',
          owner: env.accounts.ethereum.address,
          spender: ONEINCH_ROUTER,
          value: '1000000000',
        },
        primaryType: 'Permit',
        types: EIP2612_TYPES,
      } as TypedDataDefinition),
    caption: 'USDC’s own permit for 1,000 USDC to the 1inch router, with a deadline that never comes.',
    chain: 'ethereum',
    id: 'eip2612-permit',
    title: 'EIP-2612 permit',
  },
  {
    build: env => {
      const swap = call(env, 'exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))', [
        address(WETH),
        address(UNI),
        uint(3000),
        address(env.accounts.ethereum.address),
        uint(ETHER / 2n),
        uint(180n * ETHER),
        uint(0),
      ])

      return transactionOf(
        transaction(env, {
          data: call(env, 'multicall(uint256,bytes[])', [uint(seconds(env.now + 20 * MINUTE)), bytesArray([swap])]),
          gas: 180_000n,
          to: UNISWAP_V3_ROUTER_2,
        })
      )
    },
    caption:
      'Uniswap’s router, as its app calls it: a multicall with a deadline around one swap, described by the registry’s ERC-7730 descriptor.',
    chain: 'ethereum',
    id: 'uniswap-swap',
    title: 'Uniswap swap',
  },
  {
    build: env =>
      transactionOf(
        transaction(env, {
          data: call(env, 'setApprovalForAll(address,bool)', [address(env.accounts.strangers.ethereum), bool(true)]),
          gas: 48_000n,
          to: BORED_APES,
        })
      ),
    caption: 'Every Bored Ape the account holds, now and later, to an operator nobody knows: a drainer’s favourite.',
    chain: 'ethereum',
    id: 'set-approval-for-all',
    title: 'Approval for all',
  },
  {
    build: env => {
      const start = seconds(env.now)

      return typedDataOf({
        domain: {chainId: 1, name: 'Seaport', verifyingContract: SEAPORT, version: '1.6'},
        message: {
          conduitKey: OPENSEA_CONDUIT_KEY,
          consideration: [
            {
              endAmount: (ETHER / 100n) * 975n,
              identifierOrCriteria: '0',
              itemType: '0',
              recipient: env.accounts.ethereum.address,
              startAmount: (ETHER / 100n) * 975n,
              token: '0x0000000000000000000000000000000000000000',
            },
            {
              endAmount: (ETHER / 100n) * 25n,
              identifierOrCriteria: '0',
              itemType: '0',
              recipient: OPENSEA_FEES,
              startAmount: (ETHER / 100n) * 25n,
              token: '0x0000000000000000000000000000000000000000',
            },
          ].map(item => ({...item, endAmount: item.endAmount.toString(), startAmount: item.startAmount.toString()})),
          counter: '0',
          endTime: (start + seconds(30 * DAY)).toString(),
          offer: [
            {
              endAmount: '1',
              identifierOrCriteria: '1234',
              itemType: '2',
              startAmount: '1',
              token: BORED_APES,
            },
          ],
          offerer: env.accounts.ethereum.address,
          orderType: '0',
          salt: '24446860302761739304752683030156737591518664810215442929816744412044034915209',
          startTime: start.toString(),
          zone: '0x0000000000000000000000000000000000000000',
          zoneHash: `0x${'00'.repeat(32)}`,
        },
        primaryType: 'OrderComponents',
        types: SEAPORT_TYPES,
      } as TypedDataDefinition)
    },
    caption:
      'An OpenSea listing: Seaport has no built-in decoder and no bundled descriptor, so every member is shown as it is, with a warning.',
    chain: 'ethereum',
    id: 'seaport-order',
    title: 'Seaport order',
  },
  {
    build: env => ({
      context: {origin: 'app.example.com'},
      request: {chain: 'ethereum', kind: 'message', payload: siwe(env)},
    }),
    caption: 'Sign-In with Ethereum on the site it names: the account, the chain and the domain all match.',
    chain: 'ethereum',
    id: 'siwe',
    title: 'Sign-In with Ethereum',
  },
  {
    build: env => ({
      context: {origin: 'app-example.co'},
      request: {chain: 'ethereum', kind: 'message', payload: siwe(env)},
    }),
    caption: 'The same message, asked for by another site: a phishing page signing the user in elsewhere.',
    chain: 'ethereum',
    id: 'siwe-mismatch',
    title: 'Sign-in for another site',
  },
  {
    build: async env => {
      // The account's own authorization, signed by the engine for the nonce after this transaction's.
      const authorization = await env.accounts.ethereum.signAuthorization({address: METAMASK_DELEGATOR, nonce: 43})

      return transactionOf(
        env.crypto.chains.ethereum.serializeTransaction({
          authorizationList: [authorization],
          gas: 90_000n,
          maxFeePerGas: 24n * GWEI,
          maxPriorityFeePerGas: GWEI,
          nonce: 42,
          to: env.accounts.ethereum.address,
          type: 'eip7702',
        })
      )
    },
    caption:
      'A type 4 transaction upgrading the account to MetaMask’s smart account. The address book knows the delegate, so it is high rather than critical.',
    chain: 'ethereum',
    id: 'eip7702-delegation',
    title: 'EIP-7702 delegation',
  },
  {
    build: () => ({
      request: {chain: 'ethereum', kind: 'authorization', payload: {address: UNKNOWN_DELEGATE, chainId: 0, nonce: 0}},
    }),
    caption:
      'An authorization for chain id 0: the account’s balances on every EVM chain, behind a contract nobody names.',
    chain: 'ethereum',
    id: 'eip7702-all-chains',
    title: 'Delegation on every chain',
  },
  {
    build: env => ({
      request: {
        chain: 'ethereum',
        kind: 'message',
        payload: env.crypto.hash.keccak256(hex.decode('0x19457468657265756d')),
      },
    }),
    caption: 'personal_sign of 32 bytes that are not text: a hash that could be anything, an order or a transaction.',
    chain: 'ethereum',
    id: 'blind-message',
    title: 'Blind message',
  },
]

import type {NameInfo, NameResolver, TokenInfo, TokenResolver} from '@hzblj/crypto-clear-sign'

import type {ChainId, DemoAccounts} from './chains'

/**
 * What this app knows besides the bytes, as a wallet would have it: an address book (the user's other accounts, a
 * contact, contracts it trusts by name) and a token list. Both are trust boundaries: a chain package shows what they
 * answer as fact, so a wallet loads them from sources it trusts, never from the dApp that asks.
 */

/** Uniswap's Universal Router, which Permit2 signatures name as the spender. */
export const UNIVERSAL_ROUTER = '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD'
/** 1inch's Aggregation Router V6. */
export const ONEINCH_ROUTER = '0x111111125421cA6dc452d289314280a0f8842A65'
/** Seaport 1.6. */
export const SEAPORT = '0x0000000000000068F116a894984e2DB1123eB395'
/** MetaMask's EIP-7702 smart account implementation (EIP7702StatelessDeleGator). */
export const METAMASK_DELEGATOR = '0x63c0c19a282a1b52b07dd5a65b58948a07dae32b'
/** Uniswap's token, which the built-in list does not have. */
export const UNI = '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984'

/** Jupiter's token and Bonk, which the Solana package's built-in list does not have. */
export const JUP = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN'
export const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'

/** The rune DOG•GO•TO•THE•MOON, by its id: block 840000, transaction 3. */
export const DOG_RUNE = '840000:3'

/** The name the address book gives the contact in every chain's samples. */
export const CONTACT = 'Alice'

type Entries = Readonly<Record<string, NameInfo>>

/** The address book of each chain: the demo key's second account, a contact, and contracts by name. */
export const addressBook = (accounts: DemoAccounts): {readonly [Id in ChainId]: Entries} => ({
  bitcoin: {
    [accounts.strangers.bitcoinTaproot]: {name: CONTACT, relation: 'contact'},
  },
  ethereum: {
    [accounts.ethereumSavings.address.toLowerCase()]: {name: 'Savings', relation: 'own'},
    [accounts.strangers.ethereumOther.toLowerCase()]: {name: CONTACT, relation: 'contact'},
    [UNIVERSAL_ROUTER.toLowerCase()]: {name: 'Uniswap Universal Router', relation: 'contract'},
    [ONEINCH_ROUTER.toLowerCase()]: {name: '1inch Router', relation: 'contract'},
    [SEAPORT.toLowerCase()]: {name: 'Seaport 1.6', relation: 'contract'},
    [METAMASK_DELEGATOR]: {name: 'MetaMask Smart Account', relation: 'contract'},
  },
  solana: {
    [accounts.solanaSavings.address]: {name: 'Savings', relation: 'own'},
    [accounts.strangers.solanaOther]: {name: CONTACT, relation: 'contact'},
  },
})

/** Each chain's token list, beyond the chain package's built-in one. Ethereum's is keyed by the lowercase address. */
export const TOKEN_LISTS: {readonly [Id in ChainId]: Readonly<Record<string, TokenInfo>>} = {
  bitcoin: {[DOG_RUNE]: {decimals: 5, name: 'DOG•GO•TO•THE•MOON', symbol: 'DOG'}},
  ethereum: {[UNI.toLowerCase()]: {decimals: 18, name: 'Uniswap', symbol: 'UNI'}},
  solana: {
    [BONK]: {decimals: 5, name: 'Bonk', symbol: 'BONK'},
    [JUP]: {decimals: 6, name: 'Jupiter', symbol: 'JUP'},
  },
}

/** Ethereum compares addresses by case; Solana's Base58 and Bitcoin's Bech32 as they are. */
const keyOf = (chain: ChainId, address: string) => (chain === 'ethereum' ? address.toLowerCase() : address)

/** The address book as a names resolver. */
export const namesResolver = (chain: ChainId, entries: Entries): NameResolver => ({
  name: ({address}) => entries[keyOf(chain, address)],
})

/** The token list as a tokens resolver. */
export const tokensResolver = (chain: ChainId): TokenResolver => ({
  token: ({address}) => TOKEN_LISTS[chain][keyOf(chain, address)],
})

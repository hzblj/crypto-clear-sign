import type {RiskLevel, Translations} from '@hzblj/crypto-clear-sign'

/** The languages the Settings tab offers: English is the model's own text, Czech a table by code. */
export type Language = 'en' | 'cs'

export const LANGUAGES: readonly {readonly value: Language; readonly label: string}[] = [
  {label: 'English', value: 'en'},
  {label: 'Čeština', value: 'cs'},
]

/**
 * A small Czech table, by the library's stable codes: shared intents, summaries (with the same `{params}` the English
 * fills), labels and warning codes. `localize` falls back to the English for every code it does not have, and never
 * translates a descriptor's or an IDL's words (`external`). That is the whole of localization: the model is the same
 * in every language.
 */
export const CZECH: Translations = {
  ALL_CHAINS: 'Tento podpis platí na všech sítích, nejen na této.',
  ASSET_OWNERSHIP_TRANSFER:
    'Předává kontrolu nad aktivy, nebo nad celým účtem, někomu jinému, kdo k jejich použití už další podpis nepotřebuje.',
  BLIND_SIGNING: 'Nedá se přečíst, co se podepisuje. Podepište to, jen pokud věříte tomu, odkud to přišlo.',
  EXPIRED: 'Lhůta už uplynula, takže by to mělo selhat. Taková žádost je neobvyklá.',
  HIGH_FEE: 'Poplatek je neobvykle vysoký.',
  'intent.approve': 'Schválit',
  'intent.batch': 'Dávka',
  'intent.contractCall': 'Volání kontraktu',
  'intent.delegate': 'Delegovat účet',
  'intent.revoke': 'Odvolat',
  'intent.send': 'Odeslat',
  'intent.signIn': 'Přihlásit se',
  'intent.signMessage': 'Podepsat zprávu',
  LONG_LIVED: 'Zůstává platné dlouho, nebo dokud to nezrušíte.',
  'label.account': 'Účet',
  'label.amount': 'Částka',
  'label.contract': 'Kontrakt',
  'label.deadline': 'Lhůta',
  'label.domain': 'Doména',
  'label.expiry': 'Platí do',
  'label.fee': 'Poplatek',
  'label.from': 'Od',
  'label.maxFee': 'Nejvyšší poplatek',
  'label.message': 'Zpráva',
  'label.owner': 'Vlastník',
  'label.recipient': 'Příjemce',
  'label.spender': 'Kdo smí utrácet',
  'label.to': 'Komu',
  'label.token': 'Token',
  'summary.approve': 'Povolit {spender} utratit {amount}',
  'summary.approveUnlimited': 'Povolit {spender} utratit neomezené množství {token}',
  'summary.batch': 'Akcí v jednom podpisu: {count}',
  'summary.blind': 'Podepsat data, která se nedají přečíst',
  'summary.delegate': 'Nechat {delegate} spouštět kód jako váš účet',
  'summary.revoke': 'Zakázat {spender} utrácet {token}',
  'summary.send': 'Odeslat {amount} na {recipient}',
  'summary.signIn': 'Přihlásit se na {domain}',
  'summary.signMessage': 'Podepsat zprávu',
  UNKNOWN_CONTRACT_CALL: 'Volá kontrakt způsobem, který tu nic nepřečte, takže není známo, co udělá.',
  UNKNOWN_DESTINATION: 'Příjemce není váš účet, kontakt ani známý kontrakt.',
  UNKNOWN_TOKEN:
    'Token je neznámý: jeho symbol ani desetinná místa nejsou k dispozici, částka je v základních jednotkách.',
  UNLIMITED_APPROVAL: 'Oprávněný si může vzít všechny tyto tokeny, které máte, teď i později, aniž by se znovu ptal.',
}

/** The table for `language`: none for English, which the model carries itself. */
export const translationsFor = (language: Language): Translations | undefined => (language === 'cs' ? CZECH : undefined)

/** The app's own words for each risk level, in each language: what `RiskBadge` shows. */
export const RISK_LABELS: {readonly [L in Language]: {readonly [Level in RiskLevel]: string}} = {
  cs: {critical: 'Kritické', high: 'Vysoké', info: 'Informace', low: 'Nízké', medium: 'Střední', none: 'Bez varování'},
  en: {critical: 'Critical', high: 'High', info: 'Info', low: 'Low', medium: 'Medium', none: 'No warnings'},
}

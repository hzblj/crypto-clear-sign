import {VERSION as CORE_VERSION} from '@hzblj/crypto-clear-sign'
import {VERSION as BITCOIN_VERSION} from '@hzblj/crypto-clear-sign-bitcoin'
import {VERSION as ETHEREUM_VERSION} from '@hzblj/crypto-clear-sign-ethereum'
import {VERSION as SOLANA_VERSION} from '@hzblj/crypto-clear-sign-solana'
import {Box, Button, HStack, Island, LabeledContent, SegmentedControl, Switch, TextField, VStack} from '@hzblj/kara-ui'
import {VERSION as ENGINE_VERSION} from '@hzblj/nitro-crypto'
import {Fragment, useState} from 'react'

import {Lead, Page, RowDivider, Rows, Section} from '../../components'
import {LANGUAGES} from '../../config'
import {CHAIN_IDS, type ChainId, demoSigners} from '../../core'
import {useDemo} from '../../hooks'
import {useSettingsStore} from '../../store'
import {shortAddress} from '../../utils'

const CHAINS: {readonly [Id in ChainId]: string} = {bitcoin: 'Bitcoin', ethereum: 'Ethereum', solana: 'Solana'}

/** One chain's signer: the field, and the two ways back to a known state. */
const SignerField = ({chain, demoAddress}: {chain: ChainId; demoAddress: string}) => {
  const custom = useSettingsStore(state => state.signers[chain])
  const setSigner = useSettingsStore.use.setSigner()
  // The native field is uncontrolled: a button that sets its value remounts it, typing does not.
  const [revision, setRevision] = useState(0)
  const set = (signer: string | undefined) => {
    setSigner(chain, signer)
    setRevision(revision + 1)
  }

  return (
    <Island>
      <VStack key={revision} spacing="s8" wide>
        <TextField
          defaultValue={custom ?? demoAddress}
          label={CHAINS[chain]}
          onChangeText={text => setSigner(chain, text.trim() === demoAddress ? undefined : text.trim())}
          testID={`signer-${chain}`}
        />
        <HStack spacing="s8">
          <Button disabled={custom === undefined} label="Demo key" onPress={() => set(undefined)} variant="secondary" />
          <Button disabled={custom === ''} label="No signer" onPress={() => set('')} variant="secondary" />
        </HStack>
      </VStack>
    </Island>
  )
}

/**
 * What every review depends on besides the bytes: who signs on each chain (so `self` means something), whether the
 * app's resolvers and the packages' built-in lists answer (offline against resolved), and the language the codes are
 * translated into.
 */
export const SettingsScreen = () => {
  const demo = useDemo()
  const resolvers = useSettingsStore.use.resolvers()
  const builtins = useSettingsStore.use.builtins()
  const language = useSettingsStore.use.language()
  const setResolvers = useSettingsStore.use.setResolvers()
  const setBuiltins = useSettingsStore.use.setBuiltins()
  const setLanguage = useSettingsStore.use.setLanguage()
  const resetSettings = useSettingsStore.use.resetSettings()

  return (
    <Page testID="settings">
      <Lead>
        Every gallery and the Paste tab review with these. The model is the same in every setting: only what is known
        about the addresses and tokens, and the words, change.
      </Lead>
      <Section
        caption="The address that signs on each chain: shown as You wherever it appears. The demo key is BIP-39's published test phrase. On Bitcoin, the demo key's addresses bring its account keys, so change is verified by derivation; another address is the signer alone. Change one to see sign-ins fail and change become a payment."
        title="Signer"
      >
        {demo.status === 'ready' ? (
          <Box gap="s12">
            {CHAIN_IDS.map(chain => (
              <SignerField chain={chain} demoAddress={demoSigners(demo.accounts)[chain]} key={chain} />
            ))}
          </Box>
        ) : null}
      </Section>
      <Section
        caption="Resolvers are the app's token list (UNI, JUP, BONK, the DOG rune) and address book (Savings, Alice, a few contracts). Built-in lists are each package's own tokens and contract names. With both off, a review says only what the bytes say: watch the risk go up."
        title="What the app knows"
      >
        <Island>
          <Rows>
            <Switch label="Resolvers" onValueChange={setResolvers} value={resolvers} />
            <RowDivider />
            <Switch label="Built-in lists" onValueChange={setBuiltins} value={builtins} />
          </Rows>
        </Island>
      </Section>
      <Section
        caption="Czech translates a few dozen codes (intents, summaries, labels, warnings) through localize, with the same params. Anything else stays English, and a descriptor's words are never translated."
        title="Language"
      >
        <SegmentedControl
          onChange={index => setLanguage(LANGUAGES[index]?.value ?? 'en')}
          selectedIndex={Math.max(
            0,
            LANGUAGES.findIndex(option => option.value === language)
          )}
          testID="language"
          values={LANGUAGES.map(option => option.label)}
        />
      </Section>
      <Section caption="The packages run from this repository's source; the engine from npm." title="Versions">
        <Island>
          <Rows>
            {[
              ['@hzblj/crypto-clear-sign', CORE_VERSION],
              ['-ethereum', ETHEREUM_VERSION],
              ['-solana', SOLANA_VERSION],
              ['-bitcoin', BITCOIN_VERSION],
              ['@hzblj/nitro-crypto', ENGINE_VERSION],
            ].map(([name, version], index) => (
              <Fragment key={name}>
                {index > 0 ? <RowDivider /> : null}
                <LabeledContent label={name ?? ''} value={version} />
              </Fragment>
            ))}
            {demo.status === 'ready' ? (
              <>
                <RowDivider />
                <LabeledContent
                  label="Demo key fingerprint"
                  value={demo.accounts.fingerprint.toString(16).padStart(8, '0')}
                />
                <RowDivider />
                <LabeledContent label="Ethereum signer" value={shortAddress(demo.accounts.ethereum.address)} />
              </>
            ) : null}
          </Rows>
        </Island>
      </Section>
      <Island>
        <Button label="Reset every setting" onPress={resetSettings} testID="reset-settings" variant="secondary" />
      </Island>
    </Page>
  )
}

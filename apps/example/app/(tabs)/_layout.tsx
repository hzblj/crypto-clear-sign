import {Tabs} from '@hzblj/kara-ui/router'

export default function TabLayout() {
  return (
    <Tabs>
      <Tabs.Screen icon="layers" name="ethereum" selectedIcon="layers-filled" testID="tab-ethereum" title="Ethereum" />
      <Tabs.Screen icon="bolt" name="solana" selectedIcon="bolt-filled" testID="tab-solana" title="Solana" />
      <Tabs.Screen icon="toll" name="bitcoin" selectedIcon="toll" testID="tab-bitcoin" title="Bitcoin" />
      <Tabs.Screen icon="content-paste" name="paste" selectedIcon="content-paste" testID="tab-paste" title="Paste" />
      <Tabs.Screen
        icon="settings"
        name="settings"
        selectedIcon="settings-filled"
        testID="tab-settings"
        title="Settings"
      />
    </Tabs>
  )
}

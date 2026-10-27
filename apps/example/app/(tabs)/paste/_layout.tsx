import {Stack} from 'expo-router'

import {TabStack} from '../../../src/components'

export default function PasteLayout() {
  return (
    <TabStack title="Paste">
      <Stack.Screen name="index" />
      <Stack.Screen name="review" options={{title: 'Review'}} />
    </TabStack>
  )
}

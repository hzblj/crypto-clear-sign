import {Redirect} from 'expo-router'

/** The app opens on the first gallery. */
export default function Index() {
  return <Redirect href="/ethereum" />
}

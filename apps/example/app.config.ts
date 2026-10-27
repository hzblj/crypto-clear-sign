import type {ExpoConfig} from 'expo/config'

// The generated Xcode target and scheme are `ClearSignExample`: apart from the other examples', so all install.
const NAME = 'Clear Sign Example'
const BUNDLE_ID = 'com.hzblj.cryptoclearsign.example'
// The sky blue of the iOS icon's gradient: what the Android icon's request card sits on.
const ICON_BACKGROUND = '#0284c7'

export default {
  android: {
    adaptiveIcon: {
      backgroundColor: ICON_BACKGROUND,
      foregroundImage: './assets/adaptive-icon.png',
    },
    package: BUNDLE_ID,
  },
  experiments: {
    typedRoutes: true,
  },
  icon: './assets/icon.png',
  ios: {
    bundleIdentifier: BUNDLE_ID,
    // An Icon Composer document: iOS renders its Liquid Glass, dark and tinted appearances itself.
    icon: './assets/app.icon',
    supportsTablet: true,
  },
  name: NAME,
  orientation: 'portrait',
  plugins: [
    'expo-router',
    // The example's icons (Material Symbols): every SVG in assets/icons becomes a native asset on both platforms, and
    // its name a type in native-icons.d.ts.
    ['@hzblj/kara-ui', {icons: {source: './assets/icons'}}],
    // The scene life cycle, which apps built with the iOS 27 SDK need or they stop at launch: Expo 57's template has
    // none, so React Native starts from Expo's scene delegate instead. Remove it with the move to Expo 58.
    ['expo-build-properties', {ios: {enableSceneSupport: true}}],
  ],
  scheme: 'crypto-clear-sign-example',
  slug: 'crypto-clear-sign-example',
  userInterfaceStyle: 'automatic',
  version: '1.0.0',
} satisfies ExpoConfig

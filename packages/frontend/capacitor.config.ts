import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor targets: iOS + Android.
 *
 * Workflow:
 *   pnpm --filter @osvald/frontend build     # emits dist/
 *   pnpm --filter @osvald/frontend cap:sync  # copies dist/ into both projects
 *
 * The native projects are generated on demand (`cap:add:ios` / `cap:add:android`)
 * and are intentionally not committed yet.
 */
const config: CapacitorConfig = {
  appId: 'app.osvald.rehearsal',
  appName: 'Osvald',
  webDir: 'dist',

  server: {
    androidScheme: 'https',
    // TODO(native): while testing against an API running on your machine, load
    // the dev server over the LAN instead of the bundled assets:
    //   url: 'http://192.168.0.10:5173',
    //   cleartext: true,
  },

  ios: {
    contentInset: 'always',
  },

  android: {
    allowMixedContent: false,
  },

  // TODO(plugins): add Capacitor plugins as features land, e.g.
  //   @capacitor/splash-screen, @capacitor/status-bar,
  //   @capacitor/filesystem (offline scripts),
  //   @capacitor-community/keep-awake (playback must not sleep the screen).
  // Each one is a new dependency — decide before installing.
};

export default config;

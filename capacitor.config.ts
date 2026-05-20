import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ashbi.familyplanner',
  appName: 'Family Planner',
  webDir: 'public',
  server: {
    url: 'https://family.ashbi.ca',
    cleartext: true,
    allowNavigation: ['family.ashbi.ca'],
  },
  android: {
    buildOptions: {
      keystorePath: undefined,
      keystoreAlias: undefined,
    },
  },
};

export default config;

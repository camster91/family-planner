import { FlatCompat } from '@eslint/eslintrc'

const compat = new FlatCompat({ baseDirectory: import.meta.dirname })

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'out/**',
      'coverage/**',
      // Playwright output (#155)
      'playwright-report/**',
      'test-results/**',
      'blob-report/**',
      // Generated Android/Capacitor output (Gradle build, cap sync copies)
      'android/**/build/**',
      'android/app/src/main/assets/public/**',
    ],
  },
  ...compat.extends('next/core-web-vitals'),
]

export default config

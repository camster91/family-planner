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
    ],
  },
  ...compat.extends('next/core-web-vitals'),
]

export default config

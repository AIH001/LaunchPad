import { defineConfig } from 'vitest/config'

// Kept separate from vite.config.ts on purpose: importing `defineConfig` from
// `vitest/config` pulls in vitest's bundled (rollup-based) Vite, whose plugin
// types clash with this project's Vite 8 (rolldown). Isolating the test config
// here keeps vite.config.ts — and the `tsc -b` production build — clean.
//
// Pure-logic tests only for now (node env, no jsdom). Component/hook tests would
// need jsdom + testing-library and aren't part of this pass.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
  },
})

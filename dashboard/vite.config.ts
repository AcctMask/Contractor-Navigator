import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

/** Fail the isolated dashboard build closed before any browser bundle is emitted.
 * Production and ordinary development builds retain their existing behavior. */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  if (env.VITE_PASHLOC_ACCEPTANCE_ONLY === 'yes') {
    const api = env.VITE_API_BASE || ''
    const expected = env.VITE_PASHLOC_ACCEPTANCE_API_ORIGIN || ''
    let parsed: URL
    try { parsed = new URL(api) }
    catch { throw new Error('Acceptance dashboard requires an explicit isolated HTTPS API') }
    if (!expected || api !== expected || parsed.protocol !== 'https:' ||
        parsed.origin !== api || parsed.username || parsed.password ||
        /(?:^|[.-])(?:contractor-navigator|good2go)(?:[.-]|$)/i.test(parsed.hostname) ||
        !parsed.hostname.endsWith('.onrender.com')) {
      throw new Error('Acceptance dashboard API origin is not an approved isolated Render endpoint')
    }
  }
  return { plugins: [react()] }
})

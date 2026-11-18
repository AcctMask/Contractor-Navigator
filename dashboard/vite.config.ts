import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// A protected acceptance build must never target a production or noncanonical API.
// Ordinary Navigator builds remain unchanged when acceptance mode is not enabled.
export default defineConfig(() => {
  if (process.env.VITE_PASHLOC_ACCEPTANCE_ONLY === 'yes') {
    const expected = process.env.VITE_PASHLOC_ACCEPTANCE_API_ORIGIN
    const actual = process.env.VITE_API_BASE
    if (!expected || !actual || !expected.startsWith('https://') ||
        new URL(expected).origin !== expected || actual !== expected) {
      throw new Error('Protected Navigator acceptance API origin mismatch')
    }
  }
  return { plugins: [react()] }
})

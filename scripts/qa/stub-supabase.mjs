// Test-only Node hook for the QA scripts in scripts/ -- lets plain `node`
// load src/lib files that the browser build normally handles:
//   - any import of ./supabaseClient gets a dummy client (no network, no
//     .env needed), so pure functions next to Supabase calls can be tested;
//   - extensionless relative imports ('./tripCost') resolve to the .ts file.
// Use: node --import ./scripts/qa/stub-supabase.mjs scripts/<test>.ts
// Doesn't touch the app: it only exists while that node process runs.
import { registerHooks } from 'node:module'

const STUB = 'data:text/javascript,export const supabase = new Proxy({}, { get() { throw new Error("supabase is stubbed in QA tests") } })'

registerHooks({
  resolve(specifier, context, next) {
    if (/(^|\/)supabaseClient(\.ts)?$/.test(specifier)) return { url: STUB, shortCircuit: true }
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
      try {
        return next(`${specifier}.ts`, context)
      } catch {
        // fall through to the normal lookup
      }
    }
    return next(specifier, context)
  },
})

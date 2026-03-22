import { config } from 'dotenv'
import path from 'path'

// Load .env.local (Next.js convention) so ANTHROPIC_API_KEY etc. are available in tests.
// Why override: if the shell has a var exported as empty, dotenv skips it by default.
// override: true ensures .env.local always wins in the test environment.
config({ path: path.resolve(__dirname, '.env.local'), override: true })

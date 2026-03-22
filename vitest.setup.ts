import { config } from 'dotenv'
import path from 'path'

// Load .env.local (Next.js convention) so ANTHROPIC_API_KEY etc. are available in tests
config({ path: path.resolve(__dirname, '.env.local') })

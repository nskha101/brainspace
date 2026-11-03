// Only used by `npx auth generate` to produce src/server/db/auth-schema.ts.
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { jwt, magicLink } from 'better-auth/plugins'
import { mcp } from '@better-auth/mcp'

export const auth = betterAuth({
  baseURL: 'http://localhost:3000',
  database: drizzleAdapter({} as never, { provider: 'sqlite' }),
  user: { additionalFields: { defaultWorkspaceId: { type: 'string', required: false, input: false } } },
  socialProviders: { google: { clientId: 'x', clientSecret: 'x' } },
  plugins: [
    jwt(),
    magicLink({ sendMagicLink: async () => {} }),
    mcp({ loginPage: '/login', consentPage: '/consent', resource: 'http://localhost:3000/mcp' }),
  ],
})

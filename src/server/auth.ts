import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { jwt, magicLink } from 'better-auth/plugins'
import { mcp } from '@better-auth/mcp'
import { createDb, schema } from './db'
import { getEnv, type AppEnv } from './env'
import { magicLinkEmail, sendEmail } from './email'

export const MCP_SCOPES = ['openid', 'profile', 'email', 'offline_access']

export function createAuth(env: AppEnv) {
  const baseURL = env.APP_URL.replace(/\/$/, '')
  const db = createDb(env.DB)
  return betterAuth({
    appName: 'Brainspace',
    baseURL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [baseURL],
    database: drizzleAdapter(db, { provider: 'sqlite', schema }),
    disabledPaths: ['/token'],
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      cookieCache: { enabled: true, maxAge: 60 * 5 },
    },
    databaseHooks: {
      session: {
        create: {
          // Join workspaces that auto-add this user's company email domain.
          after: async (session) => {
            const { autoJoinOnSignIn } = await import('./services/workspaces')
            await autoJoinOnSignIn(session.userId).catch((err) => console.error('[auto-join]', err))
          },
        },
      },
      user: {
        create: {
          // Magic-link sign-ups arrive without a name. Use the email's local part
          // so activity and history always show someone.
          before: async (u) => {
            if (u.name?.trim()) return { data: u }
            const local = u.email.split('@')[0] ?? 'Teammate'
            const name = local
              .split(/[._-]+/)
              .filter(Boolean)
              .map((p) => p[0]!.toUpperCase() + p.slice(1))
              .join(' ')
            return { data: { ...u, name: name || local } }
          },
        },
      },
    },
    account: {
      accountLinking: { enabled: true, trustedProviders: ['google'] },
    },
    user: {
      additionalFields: {
        defaultWorkspaceId: { type: 'string', required: false, input: false },
      },
    },
    socialProviders:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
              prompt: 'select_account',
            },
          }
        : undefined,
    plugins: [
      jwt(),
      magicLink({
        expiresIn: 600,
        sendMagicLink: async ({ email, url }) => {
          const sent = await sendEmail({ to: email, ...magicLinkEmail(url) })
          if (!sent) console.log(`[magic-link] ${email}: ${url}`)
        },
      }),
      mcp({
        loginPage: '/login',
        consentPage: '/consent',
        resource: `${baseURL}/mcp`,
        scopes: MCP_SCOPES,
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        clientRegistrationDefaultApplicationType: 'infer',
        accessTokenExpiresIn: 60 * 60,
        refreshTokenExpiresIn: 60 * 60 * 24 * 90,
      }),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>

let cached: { env: AppEnv; auth: Auth } | undefined

export function getAuth(): Auth {
  const env = getEnv()
  if (cached?.env !== env) cached = { env, auth: createAuth(env) }
  return cached.auth
}

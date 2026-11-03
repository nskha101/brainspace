import { env as cfEnv, waitUntil as cfWaitUntil } from 'cloudflare:workers'

export type AppEnv = Env & {
  BETTER_AUTH_SECRET: string
  ENCRYPTION_KEY: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  RESEND_API_KEY?: string
}

export function getEnv(): AppEnv {
  return cfEnv as AppEnv
}

export function appUrl(): string {
  return getEnv().APP_URL.replace(/\/$/, '')
}

/** Run work after the response is sent. Falls back to fire-and-forget. */
export function background(p: Promise<unknown>) {
  const guarded = p.catch((err) => console.error('[background]', err))
  try {
    cfWaitUntil(guarded)
  } catch {
    void guarded
  }
}

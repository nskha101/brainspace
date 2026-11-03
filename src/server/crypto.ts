import { getEnv } from './env'

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

export function newId(prefix = ''): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let id = ''
  for (const b of bytes) id += ALPHABET[b % 36]
  return prefix ? `${prefix}_${id}` : id
}

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

export function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64(s: string): Uint8Array {
  const norm = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(norm + '='.repeat((4 - (norm.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function sha256Hex(input: string | ArrayBuffer | Uint8Array): Promise<string> {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

let keyPromise: Promise<CryptoKey> | undefined
let keySource: string | undefined

function getKey(): Promise<CryptoKey> {
  const raw = getEnv().ENCRYPTION_KEY
  if (!raw) throw new Error('ENCRYPTION_KEY is not configured')
  if (!keyPromise || keySource !== raw) {
    keySource = raw
    keyPromise = crypto.subtle.importKey('raw', fromB64(raw) as BufferSource, 'AES-GCM', false, [
      'encrypt',
      'decrypt',
    ])
  }
  return keyPromise
}

export async function encryptJson(value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = new TextEncoder().encode(JSON.stringify(value))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await getKey(), data)
  return `v1.${b64url(iv)}.${b64url(new Uint8Array(ct))}`
}

export async function decryptJson<T>(blob: string | null | undefined): Promise<T | undefined> {
  if (!blob) return undefined
  const [v, iv, ct] = blob.split('.')
  if (v !== 'v1' || !iv || !ct) throw new Error('Unrecognized secret format')
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(iv) as BufferSource },
    await getKey(),
    fromB64(ct) as BufferSource,
  )
  return JSON.parse(new TextDecoder().decode(pt)) as T
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(getEnv().BETTER_AUTH_SECRET) as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

export async function hmacSign(payload: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(), new TextEncoder().encode(payload))
  return b64url(new Uint8Array(sig))
}

export async function hmacVerify(payload: string, signature: string): Promise<boolean> {
  const expected = await hmacSign(payload)
  if (expected.length !== signature.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  return diff === 0
}

export type ErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'invalid'
  | 'too_large'
  | 'upstream'

const STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  invalid: 400,
  too_large: 413,
  upstream: 502,
}

/**
 * Errors carry a `hint` written for whoever reads them next, usually an
 * agent. Say what to do, not just what went wrong.
 */
export class AppError extends Error {
  code: ErrorCode
  hint?: string
  data?: Record<string, unknown>
  constructor(code: ErrorCode, message: string, opts?: { hint?: string; data?: Record<string, unknown> }) {
    super(message)
    this.code = code
    this.hint = opts?.hint
    this.data = opts?.data
  }
  get status() {
    return STATUS[this.code]
  }
  toJSON() {
    return { error: this.code, message: this.message, hint: this.hint, ...this.data }
  }
}

export const notFound = (what: string, hint?: string) =>
  new AppError('not_found', `${what} not found`, { hint })
export const forbidden = (message: string, hint?: string) =>
  new AppError('forbidden', message, { hint })
export const invalid = (message: string, hint?: string) => new AppError('invalid', message, { hint })

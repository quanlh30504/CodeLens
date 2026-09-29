/**
 * Keys whose values must never reach logs, audit entries or API responses.
 * Shared by the logger (redact) and the audit writer (assertNoSecretKeys).
 */
export const SECRET_KEY_PATTERN =
  /(private[_-]?key|secret|token|password|authorization|cookie|set-cookie|api[_-]?key|credential|signature|code_verifier|^code$)/i;

export const REDACTED = '[REDACTED]';

/** Returns a deep copy with the values of secret-looking keys replaced. */
export function redact<T>(value: T, depth = 0): T {
  if (depth > 8 || value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : redact(val, depth + 1);
  }
  return out as T;
}

/** Throws if any key (at any depth) looks like a secret. Used to guard audit metadata. */
export function assertNoSecretKeys(value: unknown, path = 'metadata', depth = 0): void {
  if (depth > 8 || value === null || typeof value !== 'object') {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoSecretKeys(item, `${path}[${i}]`, depth + 1));
    return;
  }
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      throw new Error(`Refusing to store secret-looking key "${key}" at ${path}`);
    }
    assertNoSecretKeys(val, `${path}.${key}`, depth + 1);
  }
}

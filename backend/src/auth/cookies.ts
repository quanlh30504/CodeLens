import type { Response } from 'express';
import { ABSOLUTE_LIFETIME_SECONDS, SESSION_COOKIE_NAME } from './session.service';

/** Parses the Cookie header without third-party code; values are not URL-decoded beyond base64url. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

export function setSessionCookie(res: Response, value: string, secure: boolean): void {
  res.cookie(SESSION_COOKIE_NAME, value, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: ABSOLUTE_LIFETIME_SECONDS * 1000,
  });
}

export function clearSessionCookie(res: Response, secure: boolean): void {
  res.clearCookie(SESSION_COOKIE_NAME, { httpOnly: true, secure, sameSite: 'lax', path: '/' });
}

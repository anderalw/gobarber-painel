import { createHmac, timingSafeEqual } from 'crypto';
import { Request, Response, NextFunction } from 'express';

import { config } from './config';

const COOKIE = 'painel_session';
const TTL_MS = 12 * 60 * 60 * 1000;

// Tentativas de login erradas por IP (trava por alguns minutos)
const MAX_FAILURES = 5;
const LOCK_MS = 5 * 60 * 1000;
const failures = new Map<string, { count: number; until: number }>();

const sign = (payload: string): string =>
  createHmac('sha256', config.sessionSecret).update(payload).digest('base64url');

function same(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  return left.length === right.length && timingSafeEqual(left, right);
}

export function createSession(): string {
  const payload = Buffer.from(
    JSON.stringify({ email: config.panelEmail, exp: Date.now() + TTL_MS }),
  ).toString('base64url');

  return `${payload}.${sign(payload)}`;
}

function readCookie(request: Request): string | null {
  const header = request.headers.cookie || '';
  const found = header
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith(`${COOKIE}=`));

  return found ? decodeURIComponent(found.slice(COOKIE.length + 1)) : null;
}

export function isAuthenticated(request: Request): boolean {
  const value = readCookie(request);

  if (!value) return false;

  const [payload, signature] = value.split('.');

  if (!payload || !signature || !same(signature, sign(payload))) return false;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());

    return data.email === config.panelEmail && data.exp > Date.now();
  } catch {
    return false;
  }
}

export function setSessionCookie(request: Request, response: Response): void {
  const secure =
    request.secure || request.headers['x-forwarded-proto'] === 'https';

  response.cookie(COOKIE, createSession(), {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    maxAge: TTL_MS,
    path: '/',
  });
}

export function clearSessionCookie(response: Response): void {
  response.clearCookie(COOKIE, { path: '/' });
}

// Confere e-mail e senha do dono (com trava contra tentativas repetidas)
export function checkLogin(
  ip: string,
  email: string,
  password: string,
): 'ok' | 'invalid' | 'locked' {
  const entry = failures.get(ip);

  if (entry && entry.until > Date.now()) return 'locked';

  const ok =
    same(email.trim().toLowerCase(), config.panelEmail) &&
    same(password, config.panelPassword);

  if (ok) {
    failures.delete(ip);
    return 'ok';
  }

  const count = (entry && entry.until === 0 ? entry.count : 0) + 1;

  failures.set(ip, {
    count,
    until: count >= MAX_FAILURES ? Date.now() + LOCK_MS : 0,
  });

  return 'invalid';
}

export function requireAuth(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (!isAuthenticated(request)) {
    response.status(401).json({ message: 'Entre no painel.' });
    return;
  }

  next();
}

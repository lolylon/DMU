import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { resolveIinPepper } from './runtime-secrets';

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function hashIin(iin: string): string {
  return sha256(`${resolveIinPepper()}:${iin}`);
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

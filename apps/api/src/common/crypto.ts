import { createHash, randomBytes, timingSafeEqual } from 'crypto';

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function hashIin(iin: string): string {
  const pepper = process.env.IIN_PEPPER ?? 'miru_dev_iin_pepper_change_me';
  return sha256(`${pepper}:${iin}`);
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

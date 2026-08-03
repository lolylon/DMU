import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { safeEqual } from './crypto';

/**
 * Bootstrap is for local/pilot seed only.
 * In production / when REQUIRE_BOOTSTRAP_SECRET=true, callers must send
 * header `x-bootstrap-secret` matching BOOTSTRAP_SECRET (≥24 chars).
 */
export function assertBootstrapEnabled(
  headers?: Record<string, string | string[] | undefined>,
): void {
  if (process.env.ALLOW_BOOTSTRAP !== 'true') {
    throw new BadRequestException('Bootstrap disabled');
  }

  const mustSecret =
    process.env.NODE_ENV === 'production' || process.env.REQUIRE_BOOTSTRAP_SECRET === 'true';
  if (!mustSecret) return;

  const expected = process.env.BOOTSTRAP_SECRET ?? '';
  if (expected.length < 24) {
    throw new BadRequestException('Bootstrap misconfigured: set BOOTSTRAP_SECRET (≥24 chars)');
  }

  const raw = headers?.['x-bootstrap-secret'];
  const provided = Array.isArray(raw) ? raw[0] : raw;
  if (!provided || !safeEqual(provided, expected)) {
    throw new ForbiddenException('Invalid or missing x-bootstrap-secret');
  }
}

const DEV_IIN_PEPPER = 'miru_dev_iin_pepper_change_me';

/** Fail closed when production-like deploy is missing crypto peppers / weak defaults. */
export function assertRuntimeSecrets(): void {
  const strict =
    process.env.NODE_ENV === 'production' || process.env.MIRU_REQUIRE_SECRETS === 'true';
  if (!strict) return;

  const pepper = process.env.IIN_PEPPER ?? '';
  if (!pepper || pepper === DEV_IIN_PEPPER || pepper.length < 24) {
    // eslint-disable-next-line no-console
    console.error('FATAL: IIN_PEPPER must be set to a unique value (≥24 chars) outside local dev');
    process.exit(1);
  }

  const session = process.env.SESSION_SECRET ?? '';
  if (!session || session.length < 24) {
    // eslint-disable-next-line no-console
    console.error('FATAL: SESSION_SECRET must be set (≥24 chars) outside local dev');
    process.exit(1);
  }

  if (process.env.ALLOW_BOOTSTRAP === 'true') {
    const bootstrapSecret = process.env.BOOTSTRAP_SECRET ?? '';
    if (bootstrapSecret.length < 24) {
      // eslint-disable-next-line no-console
      console.error(
        'FATAL: ALLOW_BOOTSTRAP=true in production requires BOOTSTRAP_SECRET (≥24 chars). Disable after seed.',
      );
      process.exit(1);
    }
    // eslint-disable-next-line no-console
    console.warn(
      'WARN: ALLOW_BOOTSTRAP=true — seed once with x-bootstrap-secret, then set ALLOW_BOOTSTRAP=false and restart',
    );
  }
}

export function resolveIinPepper(): string {
  const pepper = process.env.IIN_PEPPER;
  if (pepper && pepper.length > 0) return pepper;

  if (process.env.NODE_ENV === 'production' || process.env.MIRU_REQUIRE_SECRETS === 'true') {
    throw new Error('IIN_PEPPER is required');
  }
  return DEV_IIN_PEPPER;
}

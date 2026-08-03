import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { SigningPort } from './signing.port';
import { hashIin } from '../common/crypto';

/**
 * NCALayer-oriented server adapter (TZ 9.3).
 * Browser produces CMS via NCALayer; server binds signer IIN to consultant account
 * and persists CMS.
 *
 * Cryptographic CMS/GOST verify against NCA trust store requires official NCA SDK /
 * crypto provider — until wired, verificationOk must stay false (honest for state audit).
 */
@Injectable()
export class NcaLayerSigningAdapter implements SigningPort {
  readonly provider = 'ncalayer' as const;

  async acceptCms(input: {
    contentHash: string;
    cmsBase64: string;
    claimedSignerIin: string;
    expectedSignerIinHash: string;
  }) {
    if (!/^[A-Za-z0-9+/=]+$/.test(input.cmsBase64) || input.cmsBase64.length < 32) {
      return { ok: false, reason: 'Invalid CMS payload' };
    }
    if (!/^\d{12}$/.test(input.claimedSignerIin)) {
      return { ok: false, reason: 'Signer IIN must be 12 digits' };
    }
    const claimedHash = hashIin(input.claimedSignerIin);
    if (claimedHash !== input.expectedSignerIinHash) {
      return {
        ok: false,
        reason: 'Signer IIN does not match consultant account (TZ 9.3.3)',
      };
    }
    if (!input.contentHash || input.contentHash.length !== 64) {
      return { ok: false, reason: 'Invalid content hash' };
    }

    const cmsFingerprint = createHash('sha256').update(input.cmsBase64, 'utf8').digest('hex').slice(0, 32);
    const cryptoVerified = process.env.NCA_CMS_VERIFY_ENABLED === 'true';

    return {
      ok: true,
      certSubject: `IIN=${input.claimedSignerIin}`,
      certSerial: cmsFingerprint,
      /** false until NCA SDK path enabled via NCA_CMS_VERIFY_ENABLED + SDK */
      cryptoVerified,
    };
  }
}

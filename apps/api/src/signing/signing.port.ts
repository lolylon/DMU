import { createHash } from 'crypto';

/** Canonical payload that is hashed and signed (TZ 6.4 / 9.3) */
export type ConclusionSignPayload = {
  conclusionId: string;
  caseId: string;
  organizationId: string;
  versionNumber: number;
  complaints: string;
  anamnesis: string;
  examination: string;
  conclusionText: string;
  recommendations: string;
  authorUserId: string;
  authorDisplayName: string;
  authorPosition: string;
  authoredAt: string;
};

export function canonicalizeConclusion(payload: ConclusionSignPayload): string {
  // Stable key order for deterministic hash
  const ordered = {
    anamnesis: payload.anamnesis,
    authorDisplayName: payload.authorDisplayName,
    authorPosition: payload.authorPosition,
    authorUserId: payload.authorUserId,
    authoredAt: payload.authoredAt,
    caseId: payload.caseId,
    complaints: payload.complaints,
    conclusionId: payload.conclusionId,
    conclusionText: payload.conclusionText,
    examination: payload.examination,
    organizationId: payload.organizationId,
    recommendations: payload.recommendations,
    versionNumber: payload.versionNumber,
  };
  return JSON.stringify(ordered);
}

export function hashConclusionPayload(payload: ConclusionSignPayload): string {
  return createHash('sha256').update(canonicalizeConclusion(payload), 'utf8').digest('hex');
}

export function payloadToBase64(payload: ConclusionSignPayload): string {
  return Buffer.from(canonicalizeConclusion(payload), 'utf8').toString('base64');
}

/**
 * Signing port — replaceable adapter (TZ 9.3.8: NCALayer now, mobile EDS later).
 */
export interface SigningPort {
  readonly provider: 'ncalayer' | 'mis' | 'dev';
  /**
   * Server-side acceptance of a client-produced CMS.
   * Full GOST CMS crypto-verify needs NCA SDK; we enforce integrity + signer IIN bind.
   */
  acceptCms(input: {
    contentHash: string;
    cmsBase64: string;
    claimedSignerIin: string;
    expectedSignerIinHash: string;
  }): Promise<{
    ok: boolean;
    reason?: string;
    certSubject?: string;
    certSerial?: string;
    /** true only after real CMS/GOST verify against NCA roots */
    cryptoVerified?: boolean;
  }>;
}

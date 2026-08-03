export type MisPushResult = {
  ok: boolean;
  externalRef?: string;
  error?: string;
  /** When true, registrar must complete manual entry */
  requiresManual?: boolean;
};

export type MisCaseCompletedPayload = {
  caseId: string;
  organizationId: string;
  status: string;
  profileCode: string | null;
  closedAt: string;
  referralNumber?: string | null;
};

/**
 * Replaceable MIS adapter (architecture §5.1).
 * Zhetysu/Damumed production adapters plug in without touching cases/conclusion.
 */
export interface MisPort {
  readonly name: 'manual' | 'mock' | 'zhetysu' | 'damumed';
  pushCaseCompleted(payload: MisCaseCompletedPayload): Promise<MisPushResult>;
}

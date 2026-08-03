import { Injectable } from '@nestjs/common';
import type { MisCaseCompletedPayload, MisPort, MisPushResult } from './mis.port';

/** Default per-MO when API specs are absent (architecture §5.2 / risks) */
@Injectable()
export class ManualBridgeAdapter implements MisPort {
  readonly name = 'manual' as const;

  async pushCaseCompleted(_payload: MisCaseCompletedPayload): Promise<MisPushResult> {
    return {
      ok: true,
      requiresManual: true,
      externalRef: undefined,
    };
  }
}

/** Dev/test adapter — simulates successful MIS write */
@Injectable()
export class MockMisAdapter implements MisPort {
  readonly name = 'mock' as const;

  async pushCaseCompleted(payload: MisCaseCompletedPayload): Promise<MisPushResult> {
    return {
      ok: true,
      requiresManual: false,
      externalRef: `MOCK-${payload.caseId.slice(0, 8)}-${Date.now()}`,
    };
  }
}

/**
 * Placeholders — replace body when customer provides API specs.
 * Until then they behave like manual bridge (safe fail-closed accounting).
 */
@Injectable()
export class ZhetysuAdapter implements MisPort {
  readonly name = 'zhetysu' as const;

  async pushCaseCompleted(payload: MisCaseCompletedPayload): Promise<MisPushResult> {
    if (!process.env.MIS_ZHETYSU_BASE_URL) {
      return {
        ok: true,
        requiresManual: true,
        error: 'Zhetysu API not configured — fall back to manual bridge',
      };
    }
    // Specs pending — do not invent HTTP contract
    return {
      ok: false,
      requiresManual: true,
      error: `Zhetysu adapter stub for case ${payload.caseId}`,
    };
  }
}

@Injectable()
export class DamumedAdapter implements MisPort {
  readonly name = 'damumed' as const;

  async pushCaseCompleted(payload: MisCaseCompletedPayload): Promise<MisPushResult> {
    if (!process.env.MIS_DAMUMED_BASE_URL) {
      return {
        ok: true,
        requiresManual: true,
        error: 'Damumed API not configured — fall back to manual bridge',
      };
    }
    return {
      ok: false,
      requiresManual: true,
      error: `Damumed adapter stub for case ${payload.caseId}`,
    };
  }
}

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { TIMEZONE } from '@miru/shared';
import { CaseStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators';
import { CasesService } from '../cases/cases.service';

function contentHash(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

@Injectable()
export class ConsentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cases: CasesService,
  ) {}

  async publishDocument(input: {
    kind: string;
    version: string;
    language: string;
    body: string;
    organizationId?: string;
  }) {
    return this.prisma.consentDocument.create({
      data: {
        kind: input.kind,
        version: input.version,
        language: input.language,
        body: input.body,
        contentHash: contentHash(input.body),
        organizationId: input.organizationId ?? null,
      },
    });
  }

  async accept(
    actor: AuthUser,
    input: {
      consentDocumentId: string;
      caseId: string;
      method: 'mini_app' | 'sms' | 'via_worker';
      mediatorName?: string;
      ip?: string;
      deviceId?: string;
    },
  ) {
    const doc = await this.prisma.consentDocument.findUnique({
      where: { id: input.consentDocumentId },
    });
    if (!doc) throw new NotFoundException('Consent document not found');

    if (input.method === 'via_worker' && !input.mediatorName?.trim()) {
      throw new BadRequestException('Mediator name required for via_worker acceptance (TZ 7.1.5)');
    }

    // Object-level access check (and PMD journal via interceptor on GET is separate)
    const caseView = await this.cases.getCase(actor, input.caseId);

    if (caseView.status !== CaseStatus.AWAITING_CONSENT) {
      throw new BadRequestException(
        `Consent can only be accepted in AWAITING_CONSENT, current=${caseView.status}`,
      );
    }

    // Append-only insert — never update previous acceptances
    const acceptance = await this.prisma.consentAcceptance.create({
      data: {
        consentDocumentId: doc.id,
        caseId: input.caseId,
        patientId: caseView.patientId,
        method: input.method,
        acceptedAtTz: TIMEZONE,
        ip: input.ip,
        deviceId: input.deviceId,
        mediatorName: input.mediatorName,
        contentHash: doc.contentHash,
      },
    });

    await this.cases.transition(
      actor,
      input.caseId,
      CaseStatus.AWAITING_BOOKING,
      'consent_accepted',
    );

    return {
      id: acceptance.id,
      caseId: acceptance.caseId,
      method: acceptance.method,
      acceptedAt: acceptance.acceptedAt,
      contentHash: acceptance.contentHash,
    };
  }

  listPublished(kind?: string) {
    return this.prisma.consentDocument.findMany({
      where: kind ? { kind } : undefined,
      orderBy: { publishedAt: 'desc' },
      select: {
        id: true,
        kind: true,
        version: true,
        language: true,
        contentHash: true,
        publishedAt: true,
        organizationId: true,
        body: true,
      },
    });
  }
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type AccessLogInput = {
  userId?: string;
  role?: string;
  organizationId?: string;
  objectType: string;
  objectId: string;
  action: string;
  ip?: string;
};

/**
 * PMD access journal. Fail-closed callers should abort the business operation
 * if this write fails for sensitive reads.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async logAccess(input: AccessLogInput) {
    return this.prisma.accessLog.create({
      data: {
        userId: input.userId,
        role: input.role,
        organizationId: input.organizationId,
        objectType: input.objectType,
        objectId: input.objectId,
        action: input.action,
        ip: input.ip,
      },
    });
  }

  async logTechAction(actorUserId: string, action: string, organizationId?: string, payloadMeta?: object) {
    return this.prisma.techActionLog.create({
      data: {
        actorUserId,
        action,
        organizationId,
        payloadMeta: payloadMeta ?? undefined,
      },
    });
  }
}

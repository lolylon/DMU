import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** TZ 6.5 — journal always; Telegram/SMS when credentials present */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async enqueue(input: {
    organizationId?: string;
    caseId?: string;
    channel: 'telegram' | 'sms' | 'web' | 'stub';
    templateKey: string;
    recipientRef: string;
    payloadMeta?: Prisma.InputJsonValue;
  }) {
    let status = 'queued_stub';
    let deliveryNote: string | undefined;

    if (input.channel === 'telegram' && process.env.TELEGRAM_BOT_TOKEN) {
      try {
        await this.sendTelegram(
          input.recipientRef,
          `[Miru] ${input.templateKey}`,
        );
        status = 'sent';
      } catch (e) {
        status = 'failed';
        deliveryNote = e instanceof Error ? e.message : 'telegram_failed';
        this.logger.warn(`Telegram send failed: ${deliveryNote}`);
      }
    } else if (input.channel === 'sms' && process.env.SMS_PROVIDER_URL && process.env.SMS_PROVIDER_TOKEN) {
      try {
        await this.sendSms(input.recipientRef, input.templateKey);
        status = 'sent';
      } catch (e) {
        status = 'failed';
        deliveryNote = e instanceof Error ? e.message : 'sms_failed';
      }
    }

    return this.prisma.notificationLog.create({
      data: {
        organizationId: input.organizationId,
        caseId: input.caseId,
        channel: input.channel,
        templateKey: input.templateKey,
        recipientRef: input.recipientRef,
        payloadMeta: {
          ...(typeof input.payloadMeta === 'object' && input.payloadMeta
            ? (input.payloadMeta as object)
            : {}),
          ...(deliveryNote ? { deliveryNote } : {}),
        },
        status,
      },
    });
  }

  async notifyBookingChange(input: {
    organizationId: string;
    caseId: string;
    templateKey: 'booking_confirmed' | 'booking_cancelled' | 'booking_rescheduled' | 'session_ended';
    patientRef: string;
    consultantRef: string;
    meta?: Prisma.InputJsonValue;
  }) {
    const patientChannel =
      process.env.TELEGRAM_BOT_TOKEN ? 'telegram' : process.env.SMS_PROVIDER_URL ? 'sms' : 'stub';

    await this.enqueue({
      organizationId: input.organizationId,
      caseId: input.caseId,
      channel: patientChannel,
      templateKey: input.templateKey,
      recipientRef: input.patientRef,
      payloadMeta: input.meta,
    });
    await this.enqueue({
      organizationId: input.organizationId,
      caseId: input.caseId,
      channel: 'web',
      templateKey: input.templateKey,
      recipientRef: input.consultantRef,
      payloadMeta: input.meta,
    });
  }

  private async sendTelegram(chatId: string, text: string) {
    const token = process.env.TELEGRAM_BOT_TOKEN!;
    // recipientRef may be chat id or @username — bot must already know chat
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Telegram HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
  }

  private async sendSms(to: string, templateKey: string) {
    const url = process.env.SMS_PROVIDER_URL!;
    const token = process.env.SMS_PROVIDER_TOKEN!;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        to,
        // NFR: no medical content in SMS
        text: `Miru: ${templateKey}. Код/статус — в приложении.`,
      }),
    });
    if (!res.ok) throw new Error(`SMS HTTP ${res.status}`);
  }
}

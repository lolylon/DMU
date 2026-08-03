import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const HUMAN: Record<string, string> = {
  patient_auth_code: 'Код подтверждения входа в Miru',
  booking_confirmed: 'Запись на ДМУ подтверждена. Откройте приложение для деталей.',
  booking_cancelled: 'Запись на ДМУ отменена. Откройте приложение.',
  booking_rescheduled: 'Запись на ДМУ перенесена. Откройте приложение.',
  session_ended: 'Консультация завершена. Заключение появится в приложении.',
};

/** TZ 6.5 — journal always; Telegram/SMS when credentials present. No ПМД in messages. */
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
    /** Ephemeral body (e.g. OTP) — never written to NotificationLog */
    messageText?: string;
  }) {
    let status = 'queued_stub';
    let deliveryNote: string | undefined;
    const text =
      input.messageText ??
      HUMAN[input.templateKey] ??
      `Miru: ${input.templateKey}. Подробности — в приложении.`;

    if (input.channel === 'telegram' && process.env.TELEGRAM_BOT_TOKEN) {
      try {
        await this.sendTelegram(input.recipientRef, text);
        status = 'sent';
      } catch (e) {
        status = 'failed';
        deliveryNote = e instanceof Error ? e.message : 'telegram_failed';
        this.logger.warn(`Telegram send failed: ${deliveryNote}`);
      }
    } else if (
      input.channel === 'sms' &&
      process.env.SMS_PROVIDER_URL &&
      process.env.SMS_PROVIDER_TOKEN
    ) {
      try {
        await this.sendSms(input.recipientRef, text);
        status = 'sent';
      } catch (e) {
        status = 'failed';
        deliveryNote = e instanceof Error ? e.message : 'sms_failed';
      }
    } else if (input.channel === 'web') {
      status = 'queued_web';
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
    /** Case.patientId — resolved to telegramChatId / phone */
    patientRef: string;
    consultantRef: string;
    meta?: Prisma.InputJsonValue;
  }) {
    const patient = await this.prisma.patient.findUnique({
      where: { id: input.patientRef },
      select: { telegramChatId: true, phone: true },
    });

    if (patient?.telegramChatId && process.env.TELEGRAM_BOT_TOKEN) {
      await this.enqueue({
        organizationId: input.organizationId,
        caseId: input.caseId,
        channel: 'telegram',
        templateKey: input.templateKey,
        recipientRef: patient.telegramChatId,
        payloadMeta: input.meta,
      });
    } else if (patient?.phone && process.env.SMS_PROVIDER_URL) {
      await this.enqueue({
        organizationId: input.organizationId,
        caseId: input.caseId,
        channel: 'sms',
        templateKey: input.templateKey,
        recipientRef: patient.phone,
        payloadMeta: input.meta,
      });
    } else {
      await this.enqueue({
        organizationId: input.organizationId,
        caseId: input.caseId,
        channel: 'stub',
        templateKey: input.templateKey,
        recipientRef: input.patientRef,
        payloadMeta: input.meta,
      });
    }

    await this.enqueue({
      organizationId: input.organizationId,
      caseId: input.caseId,
      channel: 'web',
      templateKey: input.templateKey,
      recipientRef: input.consultantRef,
      payloadMeta: input.meta,
    });
  }

  /** Configure BotFather Mini App as default menu button (call once after deploy). */
  async configureBotMenuButton(webAppUrl: string) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN missing');
    const res = await fetch(`https://api.telegram.org/bot${token}/setChatMenuButton`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        menu_button: {
          type: 'web_app',
          text: 'Miru Remote',
          web_app: { url: webAppUrl },
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`setChatMenuButton failed: ${body.slice(0, 300)}`);
    }
    return res.json();
  }

  private async sendTelegram(chatId: string, text: string) {
    const token = process.env.TELEGRAM_BOT_TOKEN!;
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

  private async sendSms(to: string, text: string) {
    const url = process.env.SMS_PROVIDER_URL!;
    const token = process.env.SMS_PROVIDER_TOKEN!;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ to, text }),
    });
    if (!res.ok) throw new Error(`SMS HTTP ${res.status}`);
  }
}

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';
import type { Environment } from '../../common/config/environment.js';
import {
  CapaMonitoringNotifier,
  type CapaMonitoringMessage,
} from '../../modules/capas/domain/ports/capa-monitoring-notifier.js';

@Injectable()
export class SmtpCapaMonitoringNotifier extends CapaMonitoringNotifier {
  private readonly transporter: Transporter;
  private readonly from: string;
  private readonly webBaseUrl: string;

  constructor(config: ConfigService<Environment, true>) {
    super();
    const user = config.get('SMTP_USER', { infer: true });
    const password = config.get('SMTP_PASSWORD', { infer: true });
    const port = config.getOrThrow('SMTP_PORT', { infer: true });
    this.transporter = nodemailer.createTransport({
      host: config.getOrThrow('SMTP_HOST', { infer: true }),
      port,
      secure: port === 465,
      requireTLS: config.getOrThrow('SMTP_REQUIRE_TLS', { infer: true }),
      auth: user && password ? { user, pass: password } : undefined,
    });
    this.from = config.getOrThrow('SMTP_FROM', { infer: true });
    this.webBaseUrl = config.getOrThrow('WEB_BASE_URL', { infer: true });
  }

  async send(message: CapaMonitoringMessage): Promise<void> {
    const state = stateLabels[message.dueState];
    const subject =
      message.subjectType === 'ACTION'
        ? 'acción CAPA / CAPA action'
        : 'verificación de efectividad / effectiveness review';
    const url = `${this.webBaseUrl}/app?section=capas&capa=${encodeURIComponent(message.capaId)}`;
    await this.transporter.sendMail({
      messageId: message.deliveryId
        ? `<qualyra-${message.deliveryId}@notifications.local>`
        : undefined,
      from: this.from,
      to: message.email,
      subject: `[${state.es}] ${message.capaCode} · ${message.subjectTitle}`,
      text: [
        `Hola ${message.displayName},`,
        `${message.tenantName}: la ${subject} “${message.subjectTitle}” está ${state.es.toLowerCase()}.`,
        `Fecha objetivo: ${message.dueAt.toISOString()}`,
        `CAPA: ${message.capaCode} · ${message.capaTitle}`,
        url,
        '',
        `Hello ${message.displayName},`,
        `The ${subject} “${message.subjectTitle}” is ${state.en.toLowerCase()}.`,
      ].join('\n'),
    });
  }
}

const stateLabels = {
  DUE_SOON: { es: 'Próxima a vencer', en: 'Due soon' },
  OVERDUE: { es: 'Vencida', en: 'Overdue' },
  ESCALATED: { es: 'Escalada', en: 'Escalated' },
} as const;

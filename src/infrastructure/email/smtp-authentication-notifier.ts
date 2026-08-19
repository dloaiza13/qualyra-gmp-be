import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';
import type { Environment } from '../../common/config/environment.js';
import {
  AuthenticationNotifier,
  type AuthenticationEmail,
  type InvitationEmail,
} from '../../modules/authentication/domain/ports/authentication-notifier.js';

@Injectable()
export class SmtpAuthenticationNotifier extends AuthenticationNotifier {
  private readonly transporter: Transporter;
  private readonly from: string;
  private readonly webBaseUrl: string;

  constructor(configService: ConfigService<Environment, true>) {
    super();
    const user = configService.get('SMTP_USER', { infer: true });
    const password = configService.get('SMTP_PASSWORD', { infer: true });
    const port = configService.getOrThrow('SMTP_PORT', { infer: true });
    this.transporter = nodemailer.createTransport({
      host: configService.getOrThrow('SMTP_HOST', { infer: true }),
      port,
      secure: port === 465,
      requireTLS: configService.getOrThrow('SMTP_REQUIRE_TLS', { infer: true }),
      auth: user && password ? { user, pass: password } : undefined,
    });
    this.from = configService.getOrThrow('SMTP_FROM', { infer: true });
    this.webBaseUrl = configService.getOrThrow('WEB_BASE_URL', { infer: true });
  }

  async sendEmailVerification(message: AuthenticationEmail): Promise<void> {
    const url = `${this.webBaseUrl}/verify-email?token=${encodeURIComponent(message.token)}`;
    await this.transporter.sendMail({
      messageId: message.deliveryId
        ? `<qualyra-${message.deliveryId}@notifications.local>`
        : undefined,
      from: this.from,
      to: message.email,
      subject: 'Verify your Qualyra GMP email',
      text: `Hello ${message.displayName}, verify your email for ${message.tenantSlug}: ${url}`,
    });
  }

  async sendPasswordReset(message: AuthenticationEmail): Promise<void> {
    const url = `${this.webBaseUrl}/reset-password?token=${encodeURIComponent(message.token)}`;
    await this.transporter.sendMail({
      messageId: message.deliveryId
        ? `<qualyra-${message.deliveryId}@notifications.local>`
        : undefined,
      from: this.from,
      to: message.email,
      subject: 'Reset your Qualyra GMP password',
      text: `Hello ${message.displayName}, reset your password for ${message.tenantSlug}: ${url}`,
    });
  }

  async sendInvitation(message: InvitationEmail): Promise<void> {
    const url = `${this.webBaseUrl}/accept-invitation?token=${encodeURIComponent(message.token)}`;
    await this.transporter.sendMail({
      messageId: message.deliveryId
        ? `<qualyra-${message.deliveryId}@notifications.local>`
        : undefined,
      from: this.from,
      to: message.email,
      subject: `You're invited to ${message.tenantName} on Qualyra GMP`,
      text: `Hello, accept your invitation to ${message.tenantName} with the following roles: ${message.roles.join(', ')}. ${url}`,
    });
  }
}

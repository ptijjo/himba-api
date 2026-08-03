import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

/**
 * Envoi transactional via Mailjet REST v3.1.
 * Clés : MJ_APIKEY_PUBLIC / MJ_APIKEY_PRIVATE (jamais loguées).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly publicKey: string;
  private readonly privateKey: string;
  private readonly senderEmail: string;
  private readonly senderName: string;

  constructor(private readonly configService: ConfigService) {
    this.publicKey = (
      this.configService.get<string>('MJ_APIKEY_PUBLIC') ?? ''
    ).trim();
    this.privateKey = (
      this.configService.get<string>('MJ_APIKEY_PRIVATE') ?? ''
    ).trim();
    this.senderEmail = (
      this.configService.get<string>('MAILJET_SENDER_EMAIL') ?? ''
    ).trim();
    this.senderName = (
      this.configService.get<string>('MAILJET_SENDER_NAME') ?? 'Himba'
    ).trim();
  }

  isConfigured(): boolean {
    return Boolean(
      this.publicKey && this.privateKey && this.senderEmail,
    );
  }

  async send(input: SendEmailInput): Promise<void> {
    if (!this.isConfigured()) {
      this.logger.warn(
        'Mailjet non configuré (MJ_APIKEY_* / MAILJET_SENDER_EMAIL) — email non envoyé',
      );
      if (this.configService.get<string>('NODE_ENV') === 'production') {
        throw new Error('Mailjet non configuré en production');
      }
      // Dev : log sans secrets ni destinataire sensible en clair si besoin debug
      this.logger.debug(`Email skip (dev) sujet="${input.subject}"`);
      return;
    }

    const auth = Buffer.from(
      `${this.publicKey}:${this.privateKey}`,
    ).toString('base64');

    const response = await fetch('https://api.mailjet.com/v3.1/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        Messages: [
          {
            From: {
              Email: this.senderEmail,
              Name: this.senderName,
            },
            To: [{ Email: input.to }],
            Subject: input.subject,
            TextPart: input.text,
            HTMLPart: input.html,
          },
        ],
      }),
    });

    if (!response.ok) {
      // Ne pas logger le corps (peut contenir PII) — statut seulement
      this.logger.error(`Mailjet HTTP ${response.status}`);
      throw new Error('Échec envoi email');
    }
  }
}

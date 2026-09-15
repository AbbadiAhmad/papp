import { Injectable, Logger } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';

export interface OutboundEmail {
  to: string;
  subject: string;
  html: string;
  /** Plain-text alternative (the Markdown source, placeholders applied). */
  text: string;
}

/**
 * The email channel's transport (BUILD_PLAN.md Phase 4 [PLANNER CALL]):
 * an external SMTP relay configured entirely via env vars — SMTP_HOST /
 * SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM (see .env.example). No 4th
 * docker-compose service (D5 keeps exactly db/api/web).
 *
 * When SMTP_HOST is unset (local dev), a dev-capture transport is used
 * instead: nodemailer's streamTransport renders the complete RFC822
 * message in-memory and this service logs it LOUDLY, so "did the email go
 * out and what did it say" is answerable from the api logs without any
 * mail infrastructure.
 *
 * Env vars are the right home here (vs system_settings) because transport
 * credentials are deployment infrastructure, not admin-tunable policy —
 * the admin-tunable parts (which categories email, what the templates
 * say) DO live in system_settings.
 */
@Injectable()
export class NotificationEmailService {
  private readonly logger = new Logger(NotificationEmailService.name);
  private readonly transporter: Transporter;
  private readonly devCapture: boolean;
  private readonly from: string;

  constructor() {
    const host = process.env.SMTP_HOST;
    this.from = process.env.SMTP_FROM ?? 'papp <no-reply@papp.local>';
    this.devCapture = !host;

    if (host) {
      const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587;
      this.transporter = createTransport({
        host,
        port,
        secure: port === 465,
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
      });
      this.logger.log(`Email channel: SMTP relay ${host}:${port} (from: ${this.from})`);
    } else {
      // Renders the full message to an in-memory buffer instead of a socket.
      this.transporter = createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
      this.logger.warn(
        'Email channel: SMTP_HOST is not set — using the DEV-CAPTURE transport. ' +
          'Outbound mail is rendered and logged below instead of being delivered.',
      );
    }
  }

  /**
   * Returns true when the message was handed to the transport (or captured
   * in dev) successfully. Never throws: an email failure must not fail the
   * send that triggered it — the in-app row already exists, and the
   * recipient's emailed_at simply stays null (loudly logged).
   */
  async send(mail: OutboundEmail): Promise<boolean> {
    try {
      const info: unknown = await this.transporter.sendMail({
        from: this.from,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      });
      if (this.devCapture) {
        const rendered = (info as { message?: Buffer }).message?.toString('utf8') ?? '(no message buffer)';
        this.logger.log(
          `\n========== DEV-CAPTURED EMAIL (not delivered — SMTP_HOST unset) ==========\n` +
            `${rendered}\n` +
            `===========================================================================`,
        );
      }
      return true;
    } catch (error) {
      this.logger.error(
        `FAILED to send notification email to ${mail.to} (subject: ${mail.subject}) — the in-app ` +
          'notification row exists, but emailed_at will stay null for this recipient.',
        error instanceof Error ? error.stack : String(error),
      );
      return false;
    }
  }
}

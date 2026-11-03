import { createTransport } from 'nodemailer';

import type { EmailSender } from '../ports/email-sender.js';

export interface SmtpEmailSenderOptions {
  /** e.g. `smtp://localhost:1025`, or `smtps://user:pass@host:465`. */
  url: string;
  from: string;
}

/**
 * `EmailSender` over SMTP, through nodemailer.
 *
 * The timeouts are short because invitations are sent during the request: a
 * mail server that hangs must not hold the editor's request for minutes.
 */
export function createSmtpEmailSender(options: SmtpEmailSenderOptions): EmailSender & {
  close(): void;
} {
  const transport = createTransport(
    {
      url: options.url,
      connectionTimeout: 5_000,
      greetingTimeout: 5_000,
      socketTimeout: 10_000,
    },
    { from: options.from },
  );

  return {
    async send(message): Promise<void> {
      await transport.sendMail(message);
    },
    close(): void {
      transport.close();
    },
  };
}

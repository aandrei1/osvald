export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Where outgoing e-mail goes (SMTP in production, Mailpit in development). */
export interface EmailSender {
  /** Resolves once the server accepted the message; rejects when it did not. */
  send(message: EmailMessage): Promise<void>;
}

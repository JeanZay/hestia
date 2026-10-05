// Only this fixed category crosses the provider boundary. Never retain its body.
export class MailDeliveryError extends Error {
  readonly retryAfterSeconds?: number;
  constructor(readonly retryable: boolean, retryAfterSeconds?: number) {
    super("MAIL_DELIVERY_FAILED");
    this.name = "MailDeliveryError";
    this.retryAfterSeconds = retryAfterSeconds !== undefined && Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
      ? Math.min(3600, Math.ceil(retryAfterSeconds)) : undefined;
  }
}

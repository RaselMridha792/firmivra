import { Inject, Injectable } from '@nestjs/common';

// The seam between the campaign and the company that carries it. A connected provider (Gmail,
// Outlook for email; Textmagic for text messages) is sent through an adapter registered under its
// provider code. A provider with no adapter is not ready: the channel says so and a production
// send is blocked, so nothing is queued that nobody will deliver. Adapters get a rendered message
// and an address; they never see the campaign, the audience or another firm's data.

export interface DeliveryMessage {
  channel: 'EMAIL' | 'SMS';
  /** The connection's own settings and secret reference are read by the adapter, never passed on. */
  connectionId: string;
  businessId: string;
  /** The recipient's address (an email address, or a number in +E.164). */
  to: string;
  fromName: string | null;
  replyTo: string | null;
  /** Email only. */
  subject: string | null;
  /** HTML for an email, plain text for a text message. */
  body: string;
  /** Echoed back on the provider's events. */
  reference: string;
}

/** A provider's refusal: `retry` says whether the same message may be tried again later. */
export class DeliveryError extends Error {
  constructor(
    readonly code: string,
    readonly retry: boolean,
  ) {
    super(code);
  }
}

export interface CommunicationProvider {
  /** The integration provider code this adapter carries ("gmail"). */
  readonly provider: string;
  readonly channel: 'EMAIL' | 'SMS';
  /** Which engagement the provider reports; the results say so when it does not. */
  readonly supports: { opens: boolean; clicks: boolean };
  send(message: DeliveryMessage): Promise<{ messageId: string }>;
}

/** Nest token for the registered adapters. */
export const COMMUNICATION_PROVIDERS = Symbol('COMMUNICATION_PROVIDERS');

@Injectable()
export class CommunicationProviders {
  private readonly byCode: Map<string, CommunicationProvider>;

  constructor(@Inject(COMMUNICATION_PROVIDERS) adapters: CommunicationProvider[]) {
    this.byCode = new Map(adapters.map((a) => [a.provider, a]));
  }

  has(provider: string): boolean {
    return this.byCode.has(provider);
  }

  get(provider: string): CommunicationProvider | undefined {
    return this.byCode.get(provider);
  }

  supports(provider: string | null): { opens: boolean; clicks: boolean } {
    return (provider && this.byCode.get(provider)?.supports) || { opens: false, clicks: false };
  }
}

/**
 * Development only (AUTH_MODE=local, which the API refuses outside NODE_ENV=development): accepts
 * every message and delivers nothing, so the screens can be walked through end to end.
 */
export class LocalLogProvider implements CommunicationProvider {
  readonly supports = { opens: true, clicks: true };
  private n = 0;

  constructor(
    readonly provider: string,
    readonly channel: 'EMAIL' | 'SMS',
  ) {}

  send(): Promise<{ messageId: string }> {
    this.n += 1;
    return Promise.resolve({ messageId: `local-${this.provider}-${Date.now()}-${this.n}` });
  }
}

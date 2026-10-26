import {
  type SupportMessagesClient,
  SendSupportMessageRequest,
  SupportMessageSent,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';

/** `api.supportMessages` in mock mode: each new key is a new ticket number; a retry answers it. */
export function createSupportMessagesMock(): SupportMessagesClient {
  const sent = new Map<string, SupportMessageSent>();
  return {
    send: async (body) => {
      await mockDelay();
      const { requestId } = SendSupportMessageRequest.parse(body);
      const known = sent.get(requestId);
      if (known) return known;
      const answer = SupportMessageSent.parse({
        number: 1041 + sent.size,
        sentAt: new Date().toISOString(),
      });
      sent.set(requestId, answer);
      return answer;
    },
  };
}

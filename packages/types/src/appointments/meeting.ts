import { z } from 'zod';
import { type LocationKind, MeetingUrl } from './schemas.js';

// Meeting links (R14): which video service a link is for, and how an appointment's place reads in
// the firm calendar and the portal ('Virtual (Zoom)', 'LVP Office', 'Phone call'). The firm
// workspace and the portal use these helpers, never their own host parsing.

export const VideoProvider = z.enum(['ZOOM', 'TEAMS', 'GOOGLE_MEET', 'OTHER']);
export type VideoProvider = z.infer<typeof VideoProvider>;

/** The label after 'Virtual'; OTHER has none. */
export const VIDEO_PROVIDER_LABELS: Record<VideoProvider, string> = {
  ZOOM: 'Zoom',
  TEAMS: 'Microsoft Teams',
  GOOGLE_MEET: 'Google Meet',
  OTHER: '',
};

/** Each service's domains: the domain itself or any subdomain of it (us02web.zoom.us). */
const PROVIDER_DOMAINS: [VideoProvider, string[]][] = [
  ['ZOOM', ['zoom.us']],
  ['TEAMS', ['teams.microsoft.com', 'teams.live.com']],
  ['GOOGLE_MEET', ['meet.google.com']],
];

/** The link normalized by MeetingUrl, or null when there is none or it is not one. */
function meetingLink(url: string | null): string | null {
  if (url === null) return null;
  const parsed = MeetingUrl.safeParse(url);
  return parsed.success ? parsed.data : null;
}

/**
 * The video service of a link: null when it is not a valid MeetingUrl (http, credentials, an IP
 * host, a trailing dot...). The parsed host name (lower case, IDN as punycode) must equal a
 * service's domain or end with '.' + it, never just contain it: zoom.us.evil.example,
 * evilzoom.us and a Cyrillic 'zооm.us' are OTHER. OTHER links still get Join: staff entered them.
 */
export function videoProvider(url: string | null): VideoProvider | null {
  const link = meetingLink(url);
  if (link === null) return null;
  const host = new URL(link).hostname;
  const found = PROVIDER_DOMAINS.find(([, domains]) =>
    domains.some((domain) => host === domain || host.endsWith(`.${domain}`)),
  );
  return found ? found[0] : 'OTHER';
}

export type AppointmentPlace = {
  icon: 'video' | 'pin' | 'phone';
  label: string;
  /** VIDEO with a valid https link only; open it in a new tab (rel="noopener noreferrer"). */
  joinUrl: string | null;
};

/**
 * Where an appointment happens, for one line under its time. VIDEO: 'Virtual (Zoom)',
 * 'Virtual (Microsoft Teams)', 'Virtual (Google Meet)', 'Virtual' for another service, or
 * 'Virtual (link coming)' without a valid link. IN_PERSON: the details staff typed ('LVP Office')
 * or 'In person'. PHONE: 'Phone call'.
 */
export function appointmentPlace(appointment: {
  locationKind: LocationKind;
  locationDetails: string | null;
}): AppointmentPlace {
  const details = appointment.locationDetails?.trim() || null;
  switch (appointment.locationKind) {
    case 'VIDEO': {
      const joinUrl = meetingLink(details);
      const provider = videoProvider(joinUrl);
      if (joinUrl === null || provider === null) {
        return { icon: 'video', label: 'Virtual (link coming)', joinUrl: null };
      }
      const name = VIDEO_PROVIDER_LABELS[provider];
      return { icon: 'video', label: name ? `Virtual (${name})` : 'Virtual', joinUrl };
    }
    case 'IN_PERSON':
      return { icon: 'pin', label: details ?? 'In person', joinUrl: null };
    case 'PHONE':
      return { icon: 'phone', label: 'Phone call', joinUrl: null };
  }
}

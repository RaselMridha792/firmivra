import { describe, expect, it } from 'vitest';
import {
  ApiRequestError,
  Availability,
  appointmentPlace,
  createAppointmentsClient,
  createAvailabilityClient,
  createRequest,
  MeetingUrl,
  MemberAvailability,
  SetMeetingLinkRequest,
  UpdateAppointmentRequest,
  VIDEO_PROVIDER_LABELS,
  videoProvider,
} from '../../src/index.js';

// Synthetic links only: fake meeting ids, and example or invalid hosts for the lookalikes.

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      body: init.body === undefined ? undefined : JSON.parse(init.body as string),
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const id = '0199b6a0-0000-7000-8000-000000000001';
const at = '2026-10-13T14:00:00.000Z';
const member = { userId: '0199b6a0-0000-7000-8000-0000000000f1', name: 'Sam Staff' };
const zoom = 'https://zoom.us/j/0000000000';
const appointment = {
  id,
  client: { id: '0199b6a1-0000-7000-8000-000000000001', displayName: 'Jamie Sample' },
  staff: member,
  type: null,
  engagementId: null,
  startsAt: at,
  endsAt: '2026-10-13T14:30:00.000Z',
  status: 'SCHEDULED',
  locationKind: 'VIDEO',
  locationDetails: zoom,
  bookedByClient: false,
  rescheduleCount: 0,
  cancelledAt: null,
  cancelReason: null,
  createdAt: at,
};
const refused = (url: string) => [url, MeetingUrl.safeParse(url).success];

describe('MeetingUrl', () => {
  it('takes https links to any domain, normalized, and reads blank as none', () => {
    for (const url of [
      zoom,
      'https://us02web.zoom.us/j/0000000000?pwd=example',
      'https://teams.microsoft.com/l/meetup-join/example',
      'https://meet.google.com/aaa-bbbb-ccc',
      'https://video.example.com/room/1',
    ]) {
      expect(MeetingUrl.parse(url)).toBe(url);
    }
    expect(MeetingUrl.parse('HTTPS://ZOOM.US/j/0000000000')).toBe(zoom);
    expect(MeetingUrl.parse(`  ${zoom}  `)).toBe(zoom);
    expect(MeetingUrl.parse('https://zoom.us:443/j/0000000000')).toBe(zoom);
    expect(MeetingUrl.parse('')).toBeNull();
    expect(MeetingUrl.parse('   ')).toBeNull();
  });

  it('refuses http, other schemes, credentials, IP and local hosts, and ports', () => {
    for (const url of [
      'http://zoom.us/j/0000000000',
      'javascript:alert(1)',
      'ftp://zoom.us/j/1',
      'zoom.us/j/0000000000',
      'https://user:pw@zoom.us/j/1',
      'https://zoom.us@evil.example/j/1',
      'https://zoom.us:pw@evil.example/j/1',
      'https://1.2.3.4/j/1',
      'https://[::1]/j/1',
      'https://localhost/j/1',
      'https://zoom.us:8443/j/1',
      'https://zoom.us./j/1',
    ]) {
      expect(refused(url)).toEqual([url, false]);
    }
  });

  it('refuses control characters and lone surrogates, and anything over 500 characters', () => {
    for (const url of [
      'https://zoom.us/j\n/0000000000',
      'https://zo\tom.us/j/1',
      'https://zoom.us/j/1\u0000',
      'https://zoom.us/j/1\u007f',
      'https://zoom.us/j/\ud800',
    ]) {
      expect(refused(url)).toEqual([url, false]);
    }
    const base = 'https://zoom.us/j/';
    expect(MeetingUrl.safeParse(base + 'a'.repeat(500 - base.length)).success).toBe(true);
    expect(MeetingUrl.safeParse(base + 'a'.repeat(501 - base.length)).success).toBe(false);
    // The cap is on the stored (normalized) link: a space becomes three characters.
    expect(MeetingUrl.safeParse(base + ' x'.repeat(170)).success).toBe(false);
  });
});

describe('videoProvider', () => {
  it('matches a service by its exact domain or a subdomain', () => {
    const cases: [string, string][] = [
      [zoom, 'ZOOM'],
      ['https://us02web.zoom.us/j/0000000000', 'ZOOM'],
      ['https://ZOOM.US/j/0000000000', 'ZOOM'],
      ['https://teams.microsoft.com/l/meetup-join/example', 'TEAMS'],
      ['https://teams.live.com/meet/0000000000', 'TEAMS'],
      ['https://meet.google.com/aaa-bbbb-ccc', 'GOOGLE_MEET'],
      ['https://video.example.com/room/1', 'OTHER'],
    ];
    for (const [url, provider] of cases) expect([url, videoProvider(url)]).toEqual([url, provider]);
  });

  it('labels lookalike hosts OTHER, never by substring', () => {
    for (const url of [
      'https://zoom.us.evil.example/j/1',
      'https://evilzoom.us/j/1',
      'https://zoom-us.example/j/1',
      'https://example.com/zoom.us/j/1',
      'https://example.com/?u=https://zoom.us/j/1',
      'https://example.com#zoom.us',
      'https://meet.google.com.evil.example/aaa-bbbb-ccc',
      'https://evilmeet.google.com.example/x',
      'https://google.com/meet',
      'https://microsoft.com/teams',
      'https://teams.microsoft.com.evil.example/l/1',
      'https://microsoft.com.teams.example/l/1',
      'https://evil.example\\@zoom.us/j/1',
      // IDN lookalikes: Cyrillic o in 'zoom', Cyrillic e in 'meet'; compared as punycode.
      'https://zооm.us/j/1',
      'https://mеet.google.com/aaa-bbbb-ccc',
    ]) {
      expect([url, videoProvider(url)]).toEqual([url, 'OTHER']);
    }
  });

  it('gives none for no link, an invalid one or a userinfo trick', () => {
    for (const url of [
      null,
      '',
      'Link sent by email',
      'http://zoom.us/j/1',
      'https://zoom.us@evil.example/j/1',
      'https://zoom.us./j/1',
      'https://zoom.us:8443/j/1',
    ]) {
      expect([url, videoProvider(url)]).toEqual([url, null]);
    }
  });
});

describe('appointmentPlace', () => {
  const place = (locationKind: 'VIDEO' | 'IN_PERSON' | 'PHONE', locationDetails: string | null) =>
    appointmentPlace({ locationKind, locationDetails });

  it('labels video by its service, with Join only for a valid link', () => {
    expect(place('VIDEO', zoom)).toEqual({ icon: 'video', label: 'Virtual (Zoom)', joinUrl: zoom });
    expect(place('VIDEO', 'https://teams.live.com/meet/0000000000').label).toBe(
      'Virtual (Microsoft Teams)',
    );
    expect(place('VIDEO', 'https://meet.google.com/aaa-bbbb-ccc').label).toBe(
      'Virtual (Google Meet)',
    );
    expect(place('VIDEO', 'https://zoom.us.evil.example/j/1')).toEqual({
      icon: 'video',
      label: 'Virtual',
      joinUrl: 'https://zoom.us.evil.example/j/1',
    });
    expect(place('VIDEO', 'HTTPS://ZOOM.US/j/0000000000').joinUrl).toBe(zoom);
    for (const details of [null, '', '  ', 'Link sent by email', 'http://zoom.us/j/1']) {
      expect(place('VIDEO', details)).toEqual({
        icon: 'video',
        label: 'Virtual (link coming)',
        joinUrl: null,
      });
    }
    expect(VIDEO_PROVIDER_LABELS.OTHER).toBe('');
  });

  it('shows the details for in person, and never a Join for in person or phone', () => {
    expect(place('IN_PERSON', 'Example Office, Suite 100')).toEqual({
      icon: 'pin',
      label: 'Example Office, Suite 100',
      joinUrl: null,
    });
    expect(place('IN_PERSON', null)).toEqual({ icon: 'pin', label: 'In person', joinUrl: null });
    expect(place('IN_PERSON', ' ').label).toBe('In person');
    expect(place('IN_PERSON', zoom).joinUrl).toBeNull();
    expect(place('PHONE', '555-0100')).toEqual({
      icon: 'phone',
      label: 'Phone call',
      joinUrl: null,
    });
    expect(place('PHONE', null).label).toBe('Phone call');
  });
});

describe('meeting-link requests', () => {
  it('sets, clears and refuses a link; strict body', () => {
    expect(SetMeetingLinkRequest.parse({ meetingUrl: zoom })).toEqual({ meetingUrl: zoom });
    expect(SetMeetingLinkRequest.parse({ meetingUrl: null })).toEqual({ meetingUrl: null });
    expect(SetMeetingLinkRequest.parse({ meetingUrl: '' })).toEqual({ meetingUrl: null });
    for (const body of [
      {},
      { meetingUrl: 'http://zoom.us/j/1' },
      { meetingUrl: 42 },
      { meetingUrl: zoom, userId: member.userId },
    ]) {
      expect(SetMeetingLinkRequest.safeParse(body).success).toBe(false);
    }
  });

  it('changes the location with at least one field; null or blank clears the details', () => {
    expect(UpdateAppointmentRequest.parse({ locationKind: 'PHONE' })).toEqual({
      locationKind: 'PHONE',
    });
    expect(UpdateAppointmentRequest.parse({ locationDetails: '' })).toEqual({
      locationDetails: null,
    });
    expect(UpdateAppointmentRequest.parse({ locationDetails: null })).toEqual({
      locationDetails: null,
    });
    expect(UpdateAppointmentRequest.parse({ locationDetails: ' Example Office ' })).toEqual({
      locationDetails: 'Example Office',
    });
    for (const body of [
      {},
      { locationKind: 'ONLINE' },
      { locationDetails: 'a'.repeat(501) },
      { locationDetails: 'x\u0000' },
      { locationDetails: '\ud800' },
      { locationKind: 'VIDEO', startsAt: at },
    ]) {
      expect(UpdateAppointmentRequest.safeParse(body).success).toBe(false);
    }
  });

  it('reads meetingUrl in availability, and needs it', () => {
    const row = { member, hours: [], meetingUrl: zoom };
    expect(Availability.parse({ timezone: 'America/New_York', members: [row] }).members[0]).toEqual(
      row,
    );
    expect(MemberAvailability.parse({ ...row, meetingUrl: null }).meetingUrl).toBeNull();
    expect(MemberAvailability.safeParse({ member, hours: [] }).success).toBe(false);
  });
});

describe('meeting-link clients', () => {
  it('PUTs a member link and PATCHes a location, with checked bodies', async () => {
    const set = fakeFetch(200, { member, hours: [], meetingUrl: zoom });
    const availability = createAvailabilityClient(createRequest({ baseUrl: '', fetch: set.fn }));
    await availability.setMeetingLink(member.userId, { meetingUrl: ` ${zoom}` });
    await availability.setMeetingLink(member.userId, { meetingUrl: '' });
    expect(set.calls).toEqual([
      {
        url: `/business/availability/${member.userId}/meeting-link`,
        method: 'PUT',
        body: { meetingUrl: zoom },
      },
      {
        url: `/business/availability/${member.userId}/meeting-link`,
        method: 'PUT',
        body: { meetingUrl: null },
      },
    ]);

    const patched = fakeFetch(200, appointment);
    const appointments = createAppointmentsClient(
      createRequest({ baseUrl: '', fetch: patched.fn }),
    );
    expect(await appointments.update(id, { locationKind: 'VIDEO' })).toMatchObject({
      locationDetails: zoom,
    });
    expect(patched.calls[0]).toEqual({
      url: `/business/appointments/${id}`,
      method: 'PATCH',
      body: { locationKind: 'VIDEO' },
    });
  });

  it('rejects bad input before sending', async () => {
    const none = fakeFetch(200, {});
    const request = createRequest({ baseUrl: '', fetch: none.fn });
    const attempts = [
      createAvailabilityClient(request).setMeetingLink(member.userId, {
        meetingUrl: 'http://zoom.us/j/1',
      }),
      createAvailabilityClient(request).setMeetingLink('not-an-id', { meetingUrl: zoom }),
      createAppointmentsClient(request).update(id, {}),
      createAppointmentsClient(request).update('not-an-id', { locationKind: 'PHONE' }),
    ];
    for (const attempt of attempts) {
      const err = await attempt.catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiRequestError);
      expect(err).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    }
    expect(none.calls).toHaveLength(0);
  });
});

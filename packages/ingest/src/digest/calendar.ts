/**
 * The weekly brief's two dates, as a calendar file the editor can import.
 *
 * Two recurring events:
 *  - **Review**, every Tuesday at 09:00 Zurich time, after the brief Routine
 *    drafts the issue at 08:37. The Routine runs on Zurich time
 *    (CRON_TZ=Europe/Zurich), so the event carries that zone too and moves with
 *    daylight saving exactly as the Routine does.
 *  - **Sent**, every Wednesday at 05:47 UTC. The send is a GitHub schedule, and
 *    GitHub schedules are UTC only: 07:47 in Zurich in summer, 06:47 in
 *    winter. So this event is written in UTC and the calendar shows the right
 *    local time in both seasons.
 *
 * METHOD:PUBLISH, not REQUEST: it is a file to add to a calendar, not a meeting
 * anyone has to answer. Pure, so the output can be asserted on.
 */

const CRLF = '\r\n';

/** RFC 5545: long lines are folded at 75 octets with a leading space. */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) { out.push(rest.slice(0, 74)); rest = ` ${rest.slice(74)}`; }
  out.push(rest);
  return out.join(CRLF);
}

const escapeText = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

export interface CalendarOptions {
  dashboardUrl: string;
  /** The first Tuesday, YYYY-MM-DD. */
  firstReview: string;
  /** The first Wednesday, YYYY-MM-DD. */
  firstSend: string;
  /** Stamp for DTSTAMP, e.g. `20260928T130000Z`. */
  stamp: string;
}

const compact = (d: string) => d.replace(/-/g, '');

/**
 * Windows' own name for Zurich time. Outlook for Windows writes this TZID in
 * the files it exports and maps it without guessing; every other client reads
 * the VTIMEZONE block that travels with it, whatever it is called.
 */
const TZID = 'W. Europe Standard Time';

const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  `TZID:${TZID}`,
  'BEGIN:STANDARD',
  'DTSTART:16010101T030000',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10',
  'END:STANDARD',
  'BEGIN:DAYLIGHT',
  'DTSTART:16010101T020000',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3',
  'END:DAYLIGHT',
  'END:VTIMEZONE',
];

export interface Invite { filename: string; ics: string }

/**
 * One file per event.
 *
 * The first version put both events in one file with a calendar name, and
 * Outlook for Windows opens a file like that as a new, separate calendar
 * rather than adding the entries to the editor's own. A file holding a single
 * event opens as an ordinary appointment with Save & Close, which is what was
 * wanted. No X-WR-CALNAME for the same reason.
 */
export function weeklyInvites(o: CalendarOptions): Invite[] {
  const review = [
    'The weekly email was drafted at 08:37 and a preview is in your inbox.',
    `Open the tracker: ${o.dashboardUrl}`,
    'Go to Review Queue, then This week\'s email. Untick anything that should not go to colleagues, then press Approve for Wednesday.',
    'Nothing is sent unless you approve before Wednesday morning.',
  ].join('\n');
  const sent = [
    'The approved Synpulse AI in Banking Weekly Brief goes to the list now, exactly as you approved it.',
    'If nothing was approved, nothing is sent and you get a note saying so.',
    `The tracker: ${o.dashboardUrl}`,
  ].join('\n');

  const file = (event: string[], zone: boolean) => [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Synpulse AI Banking Tracker//Weekly brief//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...(zone ? VTIMEZONE : []),
    'BEGIN:VEVENT',
    ...event,
    'END:VEVENT',
    'END:VCALENDAR',
  ].map(fold).join(CRLF) + CRLF;

  // A resent entry carries the same UID, so Outlook updates the one already in
  // the calendar instead of adding a second. A higher SEQUENCE is what tells it
  // this copy is the newer one: minutes since 2026, from the stamp, so every
  // resend counts up without anything to remember between runs.
  const sequenceOf = (stamp: string): number => {
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/.exec(stamp);
    if (!m) return 0;
    const [, y, mo, d, h, mi] = m.map(Number) as number[];
    const t = Date.UTC(y!, mo! - 1, d!, h!, mi!);
    return Math.max(0, Math.floor((t - Date.UTC(2026, 0, 1)) / 60000));
  };

  return [
    {
      filename: 'review-ai-banking-weekly-brief.ics',
      ics: file([
        'UID:ai-banking-brief-review@ai-banking-market-news',
        `DTSTAMP:${o.stamp}`,
        `SEQUENCE:${sequenceOf(o.stamp)}`,
        `DTSTART;TZID=${TZID}:${compact(o.firstReview)}T090000`,
        `DTEND;TZID=${TZID}:${compact(o.firstReview)}T093000`,
        'RRULE:FREQ=WEEKLY;BYDAY=TU',
        'SUMMARY:Review the AI Banking Weekly Brief',
        `DESCRIPTION:${escapeText(review)}`,
        `URL:${o.dashboardUrl}`,
        'TRANSP:OPAQUE',
        'X-MICROSOFT-CDO-BUSYSTATUS:BUSY',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'DESCRIPTION:Review the AI Banking Weekly Brief',
        'TRIGGER:-PT10M',
        'END:VALARM',
      ], true),
    },
    {
      filename: 'ai-banking-weekly-brief-goes-out.ics',
      // In UTC: the send is a GitHub schedule, and those are UTC only.
      ics: file([
        'UID:ai-banking-brief-sent@ai-banking-market-news',
        `DTSTAMP:${o.stamp}`,
        `SEQUENCE:${sequenceOf(o.stamp)}`,
        `DTSTART:${compact(o.firstSend)}T054700Z`,
        `DTEND:${compact(o.firstSend)}T060200Z`,
        'RRULE:FREQ=WEEKLY;BYDAY=WE',
        'SUMMARY:AI Banking Weekly Brief goes out',
        `DESCRIPTION:${escapeText(sent)}`,
        'TRANSP:TRANSPARENT',
        'X-MICROSOFT-CDO-BUSYSTATUS:FREE',
      ], false),
    },
  ];
}

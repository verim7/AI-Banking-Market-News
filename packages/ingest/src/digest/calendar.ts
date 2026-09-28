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

export function weeklyCalendar(o: CalendarOptions): string {
  const review = [
    'The weekly email was drafted at 08:37 and a preview is in your inbox.',
    `Open the tracker: ${o.dashboardUrl}`,
    'Go to Review Queue, then This week\'s email. Untick anything that should not go to colleagues, then press Approve for Wednesday.',
    'Nothing is sent unless you approve before Wednesday morning.',
  ].join('\n');
  const sent = [
    'The approved AI in Banking Weekly Brief goes to the list now, exactly as you approved it.',
    'If nothing was approved, nothing is sent and you get a note saying so.',
    `The tracker: ${o.dashboardUrl}`,
  ].join('\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Synpulse AI Banking Tracker//Weekly brief//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:AI Banking Weekly Brief',
    // Europe/Zurich, so the review moves with daylight saving as the Routine does.
    'BEGIN:VTIMEZONE',
    'TZID:Europe/Zurich',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:+0100',
    'TZOFFSETTO:+0200',
    'TZNAME:CEST',
    'DTSTART:19700329T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0200',
    'TZOFFSETTO:+0100',
    'TZNAME:CET',
    'DTSTART:19701025T030000',
    'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
    'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    'UID:ai-banking-brief-review@ai-banking-market-news',
    `DTSTAMP:${o.stamp}`,
    `DTSTART;TZID=Europe/Zurich:${compact(o.firstReview)}T090000`,
    `DTEND;TZID=Europe/Zurich:${compact(o.firstReview)}T093000`,
    'RRULE:FREQ=WEEKLY;BYDAY=TU',
    'SUMMARY:Review the AI Banking Weekly Brief',
    `DESCRIPTION:${escapeText(review)}`,
    `URL:${o.dashboardUrl}`,
    'TRANSP:OPAQUE',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Review the AI Banking Weekly Brief',
    'TRIGGER:-PT10M',
    'END:VALARM',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:ai-banking-brief-sent@ai-banking-market-news',
    `DTSTAMP:${o.stamp}`,
    `DTSTART:${compact(o.firstSend)}T054700Z`,
    `DTEND:${compact(o.firstSend)}T060200Z`,
    'RRULE:FREQ=WEEKLY;BYDAY=WE',
    'SUMMARY:AI Banking Weekly Brief goes out',
    `DESCRIPTION:${escapeText(sent)}`,
    'TRANSP:TRANSPARENT',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join(CRLF) + CRLF;
}

// calendar-invite.ts — A CALENDAR INVITE to an agent's conversation, built in the page: a link to
// Google Calendar's form for a new event, and an .ics file (RFC 5545). Pure: no DOM.
//
// `link` is the agent's page, for members, or a guest's share link with its secret: whoever holds
// the invite holds the link.

export type CalendarInvite = {
  title: string;
  start: Date;
  minutes: number;
  link: string;
  /** The event's id in a calendar: the same invite sent again updates the one event. */
  uid: string;
  /** When the invite was made. */
  stamp: Date;
};

const QUARTER_MS = 15 * 60_000;

/** The first start an invite offers: `now` rounded up to the next quarter hour. */
export const nextQuarter = (now: Date) =>
  new Date(Math.ceil(now.getTime() / QUARTER_MS) * QUARTER_MS);

/** A time in UTC as both formats write it: 20261119T103000Z. */
const utcStamp = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");

/** A local time as a `datetime-local` input shows it: 2026-11-19T10:30. */
export function localInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const endOf = ({ start, minutes }: CalendarInvite) => new Date(start.getTime() + minutes * 60_000);
const detailsOf = ({ link }: CalendarInvite) => `Join the conversation: ${link}`;

/** Google Calendar's form for a new event, filled in. */
export function googleCalendarUrl(invite: CalendarInvite) {
  const query = {
    action: "TEMPLATE",
    text: invite.title,
    dates: `${utcStamp(invite.start)}/${utcStamp(endOf(invite))}`,
    details: detailsOf(invite),
    location: invite.link,
  };
  const pairs = Object.entries(query).map(
    ([key, value]) => `${key}=${encodeURIComponent(value).replaceAll("%2F", "/")}`,
  );
  return `https://calendar.google.com/calendar/render?${pairs.join("&")}`;
}

/** A TEXT value of RFC 5545 (3.3.11): a backslash, a semicolon, a comma and a line end escaped, so
 *  no text can end its line and add one of its own. */
const escapeText = (text: string) =>
  text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");

/** One content line, folded at 75 octets of UTF-8 (RFC 5545 3.1): each line after the first starts
 *  with a space, which counts. A character is never split. */
function fold(line: string) {
  const encoder = new TextEncoder();
  const lines: string[] = [];
  let current = "";
  let octets = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (octets + size > 75) {
      lines.push(current);
      current = " ";
      octets = 1;
    }
    current += character;
    octets += size;
  }
  lines.push(current);
  return lines.join("\r\n");
}

/** The .ics file's text: one event, its lines ended by CRLF. */
export function icsOf(invite: CalendarInvite) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//iterate//Dash//EN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${invite.uid}`,
    `DTSTAMP:${utcStamp(invite.stamp)}`,
    `DTSTART:${utcStamp(invite.start)}`,
    `DTEND:${utcStamp(endOf(invite))}`,
    `SUMMARY:${escapeText(invite.title)}`,
    `DESCRIPTION:${escapeText(detailsOf(invite))}`,
    `LOCATION:${escapeText(invite.link)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

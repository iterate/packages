// The Dash's calendar invite: Google's form filled in, and an .ics whose text cannot add a line of
// its own, with CRLF and lines folded at 75 octets.
import { expect, test } from "vitest";
import { googleCalendarUrl, icsOf, nextQuarter } from "./calendar-invite.ts";

test("the invite: Google's form, and an .ics with escaped text, CRLF and folded lines", () => {
  const start = nextQuarter(new Date("2026-11-19T10:31:00Z"));
  expect(start.toISOString()).toBe("2026-11-19T10:45:00.000Z");
  const invite = {
    title: "Plan; budget, Q1\r\nATTENDEE:mailto:x@example.com",
    start,
    minutes: 30,
    link: "https://meet.example.org/join/agents/x#secret",
    uid: "u1@dash.example.org",
    stamp: new Date("2026-11-19T10:31:00Z"),
  };
  expect(Object.fromEntries(new URL(googleCalendarUrl(invite)).searchParams)).toEqual({
    action: "TEMPLATE",
    text: invite.title,
    dates: "20261119T104500Z/20261119T111500Z",
    details: `Join the conversation: ${invite.link}`,
    location: invite.link,
  });
  const lines = icsOf(invite).split("\r\n");
  expect(lines).toContain("SUMMARY:Plan\\; budget\\, Q1\\nATTENDEE:mailto:x@example.com");
  expect(lines.filter((line) => line.startsWith("ATTENDEE"))).toEqual([]);
  expect(lines).toContain("DTEND:20261119T111500Z");
  const long = icsOf({ ...invite, title: "ä".repeat(100) });
  for (const line of long.split("\r\n"))
    expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  expect(long.replace(/\r\n /g, "")).toContain(`SUMMARY:${"ä".repeat(100)}\r\n`);
});

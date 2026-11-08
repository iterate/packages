// cloud-connection/contract.ts — THE EVENTS of a project's connection to the Iterate Cloud, on the
// project's `/iterate-cloud` context. Unprefixed, as a package's own types are (core/lib
// README.md#event-types): a fact is past tense, `-requested` asks, and its offset names the ask.
import { z } from "zod";

/** The context the connection's events live on. */
export const ITERATE_CLOUD_PATH = "/iterate-cloud";

/** What a project asks the Cloud to send: one message from its own address. */
export const EmailRequest = z
  .object({
    to: z.array(z.email()).min(1),
    cc: z.array(z.email()).optional(),
    subject: z.string(),
    text: z.string().optional(),
    html: z.string().optional(),
  })
  .refine((request) => request.text || request.html, {
    message: "a message has a text or an html body",
  });
export type EmailRequest = z.infer<typeof EmailRequest>;

/** A message as it arrived, in the shape of the platform's `email/received` payload as far as the
 *  router fills it: no attachments, nothing vouched for. */
export const ReceivedEmail = z.looseObject({
  messageId: z.string().nullable(),
  from: z.string(),
  to: z.array(z.string()),
  cc: z.array(z.string()),
  subject: z.string(),
  text: z.string().nullable(),
  html: z.string().nullable(),
});
export type ReceivedEmail = z.infer<typeof ReceivedEmail>;

export const IterateCloudEvents = {
  "iterate-cloud/email-requested": {
    description:
      "The project asked the Cloud to send a message from its address (`iterateCloud(itx).email.send`). The Cloud's router receives it as a signed webhook; its offset names the ask.",
    payloadSchema: z.object({ from: z.email() }).and(EmailRequest),
  },
  "iterate-cloud/email-sent": {
    description:
      "The Cloud's router sent the message `requestOffset` asked for, as `id` names it. Appended by the router through the deployment's admin API.",
    payloadSchema: z.object({ requestOffset: z.number().int(), id: z.string() }),
  },
  "iterate-cloud/email-failed": {
    description:
      "The Cloud's router will never send the message `requestOffset` asked for: a bad shape, or an address that is not this project's. Appended by the router.",
    payloadSchema: z.object({ requestOffset: z.number().int(), error: z.string() }),
  },
  "iterate-cloud/email-received": {
    description:
      "A message to the project's address arrived at the Cloud's router, which appended it here. The platform's own `email/received` is its alone to append, so this is the Cloud's fact.",
    payloadSchema: ReceivedEmail,
  },
} as const;

/** What a person's X account said to @iterate, as the Cloud's router lands it on the project's
 *  `/iterate-cloud/integrations/x/<account>` context. */
export const XMessage = z.object({
  kind: z.enum(["dm", "mention"]),
  /** X's id of the direct message event or the post. */
  id: z.string(),
  text: z.string(),
  at: z.string(),
  from: z.object({ xUserId: z.string(), username: z.string() }),
  conversationId: z.string().nullable(),
});
export type XMessage = z.infer<typeof XMessage>;

/** An answer the project asks @iterate to send: a direct message to the person, or a post in the
 *  mention's thread. */
export const XReply = z.union([
  z.object({ kind: z.literal("dm"), to: z.string(), text: z.string().min(1).max(10_000) }),
  z.object({ kind: z.literal("mention"), inReplyTo: z.string(), text: z.string().min(1).max(280) }),
]);
export type XReply = z.infer<typeof XReply>;

/** The events of a project's X context, `/iterate-cloud/integrations/x/<account>`: what the
 *  Cloud's router lands there and answers there, and what the project asks. */
export const XEvents = {
  "x/message-received": {
    description:
      "The connected X account wrote to @iterate, by direct message or by mention; the Cloud's router landed it here within a minute. Keyed by X's id of the message.",
    payloadSchema: XMessage,
  },
  "x/reply-requested": {
    description:
      "The project asks @iterate to answer: a direct message to the person, or a post in the mention's thread. The router sends it; its offset names the ask.",
    payloadSchema: XReply,
  },
  "x/reply-sent": {
    description: "@iterate sent the reply `requestOffset` asked for, as `id` names it on X.",
    payloadSchema: z.object({ requestOffset: z.number().int(), id: z.string() }),
  },
  "x/reply-failed": {
    description: "@iterate will not send the reply `requestOffset` asked for, and why.",
    payloadSchema: z.object({ requestOffset: z.number().int(), error: z.string() }),
  },
} as const;

export type IterateCloudEventType = keyof typeof IterateCloudEvents;
export const EMAIL_REQUESTED: IterateCloudEventType = "iterate-cloud/email-requested";

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

export type IterateCloudEventType = keyof typeof IterateCloudEvents;
export const EMAIL_REQUESTED: IterateCloudEventType = "iterate-cloud/email-requested";

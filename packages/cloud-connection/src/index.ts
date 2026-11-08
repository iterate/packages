// @iterate-com/cloud-connection — a project of a deployment the Iterate Cloud made, connected to the
// Cloud (README.md). A project's config worker installs it once (`installIterateCloud`), and code
// anywhere in the project sends mail with it (`iterateCloud(itx).email.send`): the ask is an event
// on `/iterate-cloud`, which a fan-out row delivers to the Cloud's router as a signed webhook.
import type { IterateContextApi } from "iterate/api";
import { EMAIL_REQUESTED, EmailRequest, ITERATE_CLOUD_PATH, XReply } from "./contract.ts";

export {
  EMAIL_REQUESTED,
  EmailRequest,
  ITERATE_CLOUD_PATH,
  IterateCloudEvents,
  ReceivedEmail,
  XEvents,
  XMessage,
  XReply,
} from "./contract.ts";

/** The secret the webhook is signed with: the project's, pinned to the router's origin (README.md,
 *  "The signing secret"). */
export const SIGNING_SECRET = "/secrets/iterate-cloud";

/** The fan-out row's name on `/iterate-cloud`. */
export const HOOK_ROW = "iterate-cloud";

/** THE CONNECTION'S ROW, for a project's config worker on `project/worker-updated`: one fan-out
 *  subscription on `/iterate-cloud` that sends each `iterate-cloud/email-requested` to
 *  `<router>/.cloud/hooks/<hook>`, signed with `SIGNING_SECRET`. The target goes through the
 *  project's root (`cd('/')`), where a webhook may name a signing secret and the project's egress
 *  is. Keyed by where it sends, so a second install appends nothing, and one that names another
 *  router or hook replaces the row. */
export async function installIterateCloud(
  itx: Pick<IterateContextApi, "cd">,
  options: { router: string; hook: string },
): Promise<void> {
  const url = `${new URL(options.router).origin}/.cloud/hooks/${encodeURIComponent(options.hook)}`;
  await itx.cd(ITERATE_CLOUD_PATH).append({
    type: "events.iterate.com/itx/subscription-configured",
    idempotencyKey: `iterate-cloud/hook:${url}`,
    payload: {
      name: HOOK_ROW,
      target: [
        "itx",
        ["cd", "/"],
        "webhooks",
        ["get", { url, signingSecret: SIGNING_SECRET }],
        "deliverEvent",
      ],
      consumes: [EMAIL_REQUESTED],
      ordered: false,
    },
  });
}

/** The Cloud, as project code uses it. `domain` is the hostname the Cloud serves the deployment's
 *  projects under: a project's address is `<slug>@<domain>`. */
export function iterateCloud(
  itx: Pick<IterateContextApi, "cd" | "whoami">,
  { domain = "iterate2.app" }: { domain?: string } = {},
) {
  return {
    /** The project's X context for one connected account, `/iterate-cloud/integrations/x/<account>`:
     *  where the Cloud's router lands what that account said to @iterate (`x/message-received`),
     *  and where a reply is asked for. */
    x: {
      pathOf: (account: string) => `${ITERATE_CLOUD_PATH}/integrations/x/${account.toLowerCase()}`,
      /** Ask @iterate to answer a message: `x/reply-requested` on the account's context, keyed by
       *  the message it answers, so a second reaction to the same message asks once. */
      async reply(account: string, inReplyTo: string, input: XReply): Promise<{ offset: number }> {
        const reply = XReply.parse(input);
        const [requested] = await itx
          .cd(`${ITERATE_CLOUD_PATH}/integrations/x/${account.toLowerCase()}`)
          .append({
            type: "x/reply-requested",
            idempotencyKey: `x/reply:${reply.kind}:${inReplyTo}`,
            payload: reply,
          });
        return { offset: requested!.offset };
      },
    },
    email: {
      /** Ask the Cloud to send a message from the project's address: `iterate-cloud/email-requested`
       *  on `/iterate-cloud`, its offset answered. The router records what happened on the same
       *  context, `iterate-cloud/email-sent` or `email-failed` with that offset (README.md). */
      async send(input: EmailRequest): Promise<{ offset: number }> {
        const request = EmailRequest.parse(input);
        const { projectSlug } = await itx.whoami();
        if (!projectSlug) throw new Error("iterateCloud: only a project's code sends its mail");
        const [requested] = await itx.cd(ITERATE_CLOUD_PATH).append({
          type: EMAIL_REQUESTED,
          payload: { ...request, from: `${projectSlug}@${domain}` },
        });
        return { offset: requested!.offset };
      },
    },
  };
}

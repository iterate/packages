// cloud/wizard.ts — THE FIRST DEPLOYMENT, as a state machine the Cloud app's `/new` page only draws
// (the shape of Appflare's deploy flow, appflare/appflare apps/docs/src/deploy/flow.ts):
//
//   how it runs (your Cloudflare account; the others are to come) → connect Cloudflare → account
//   (a choice only when the grant reaches several) → whether the account is ready (Workers Paid,
//   R2, Containers) → name → the first project → its hostname (one of the account's zones, or
//   workers.dev) → review → the deployment's page, which shows the install from the deployment's
//   own live state and ends with what the person can do with it
//
// Every call to the Cloud, the browser's storage and its address bar goes through `WizardDeps`, so
// the whole journey runs in a test. RESUMABLE: what the person chose lives in the browser's storage
// (`Draft`) and the connect's return names its connection in the URL (`/new?connection=<id>`), so a
// closed tab, a reload or the round trip to Cloudflare lands on the step it left. A creation keeps
// its request id in the draft, so pressing Install again after a lost answer is the same deployment
// (durable-object.ts `createDeployment`). Once created, the draft is cleared and the browser goes to the deployment's page:
// the address bar finds an install again. Browser-safe: no import but records.ts.
import {
  DEFAULT_PROJECT,
  DeploymentName,
  Domain,
  ProjectSlug,
  WIZARD_SCOPES,
  type AccountReadiness,
  type CloudflareAccount,
  type PersonView,
  type Zone,
} from "./records.ts";

/** What the wizard reads of the person: their live state, as the browser sees it (no nonces). */
export type { PersonView };

/** One account the person may deploy into, through one connection. */
export type Choice = {
  connection: string;
  account: CloudflareAccount;
  cloudflareUser: string | null;
};

/** How iterate can run for the person. Only `cloudflare` is offered today. */
export const HOW = [
  { id: "cloudflare", label: "In my Cloudflare account", available: true },
  { id: "hosted", label: "Hosted by iterate", available: false },
  { id: "machine", label: "On my own machine", available: false },
] as const;
export type How = (typeof HOW)[number]["id"];

export type WizardView =
  | { step: "loading" }
  | { step: "how" }
  | {
      step: "connect";
      /** The person has a connection, made before the wizard asked for its plan and DNS: the
       *  same consent again, with more access. */
      again: boolean;
      /** The last connect, when it did not end connected: still pending, or failed and why. */
      last: { status: "pending" | "failed"; error: string | null } | null;
      busy: boolean;
      error: string | null;
    }
  | { step: "account"; choices: Choice[] }
  | {
      step: "ready";
      choice: Choice;
      readiness: AccountReadiness | null;
      checking: boolean;
      error: string | null;
    }
  | { step: "name"; choice: Choice; value: string; checking: boolean; error: string | null }
  | { step: "project"; choice: Choice; name: string; value: string; error: string | null }
  | {
      step: "domain";
      choice: Choice;
      name: string;
      project: string;
      /** The account's active zones; null while Cloudflare is asked. */
      zones: Zone[] | null;
      /** The chosen zone's id, or "" for workers.dev alone. The deployment owns the whole zone:
       *  `os.<zone>`, `<project>.<zone>` (records.ts `Domain`). */
      zoneId: string;
      checking: boolean;
      error: string | null;
    }
  | {
      step: "review";
      choice: Choice;
      name: string;
      project: string;
      domain: Domain | null;
      busy: boolean;
      error: string | null;
    };

/** What the tab keeps between visits. */
export type Draft = {
  how?: How;
  connection?: string;
  accountId?: string;
  name?: string;
  project?: string;
  /** The zone's id; "" for workers.dev alone. */
  zoneId?: string;
  request?: string;
};

export type WizardDeps = {
  connect(): Promise<{ url: string }>;
  create(input: {
    request: string;
    connection: string;
    accountId: string;
    name: string;
    project: string;
    domain: Domain | null;
  }): Promise<{ id: string }>;
  /** Whether the account can hold a deployment (durable-object.ts `checkAccount`). */
  checkAccount(input: { connection: string; accountId: string }): Promise<AccountReadiness>;
  /** The account's active zones (durable-object.ts `listZones`). */
  listZones(input: { connection: string; accountId: string }): Promise<Zone[]>;
  /** Whether the hostname is free on its zone (durable-object.ts `checkHostname`). */
  checkHostname(input: { connection: string; accountId: string; domain: Domain }): Promise<{
    status: "free" | "taken" | "unknown";
    message: string;
  }>;
  /** Settle the connect that just came back (`search` names it): what became of it, on the
   *  person's context, whose live state then says it. */
  settle(connection: string): Promise<unknown>;
  /** Whether the name is free in the account (durable-object.ts `checkName`): `create` checks it again. */
  checkName(input: { connection: string; accountId: string; name: string }): Promise<{
    status: "free" | "taken" | "unknown";
    message: string;
  }>;
  /** Leave for `url`: Cloudflare's consent through the platform's start link, or the new
   *  deployment's page (`/deployments/<id>`). */
  navigate(url: string): void;
  storage: { read(): Draft; write(draft: Draft): void };
  /** The page's query: `connection` names the connect that just came back. */
  search: string;
  newRequestId(): string;
};

export const DEFAULT_NAME = "iterate";

export class Wizard {
  #view: WizardView = { step: "loading" };
  #person: PersonView | null = null;
  readonly #listeners = new Set<() => void>();
  readonly #deps: WizardDeps;
  /** The connect the page came back from, by its id, until `settleReturn` has settled it: the
   *  wizard draws no step from a state that may still call it pending. */
  #unsettled: string | null;
  #settleError: string | null = null;

  constructor(deps: WizardDeps) {
    this.#deps = deps;
    this.#unsettled = this.#returned();
  }

  view() {
    return this.#view;
  }

  /** Why settling the connect the page came back from failed, or null: shown above whatever step
   *  the wizard resumes at, since an older connected account lets it go on past the connect. */
  returnError() {
    return this.#settleError;
  }

  subscribe(listener: () => void) {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }

  /** The person's live state, first and on every change: the wizard moves on when it allows, and
   *  when the connect it came back from changes (its settlement lands after `settleReturn` has
   *  answered). */
  update(person: PersonView) {
    const before = this.#returnedIn(this.#person);
    this.#person = person;
    const moved = before !== this.#returnedIn(person);
    if (!before || moved || this.#view.step === "loading" || this.#view.step === "connect")
      this.#resume();
  }

  /** Settle the connect the page came back from, before the wizard draws a step from it. Once:
   *  a page with no connect in its query has nothing to settle. */
  async settleReturn() {
    const connection = this.#unsettled;
    if (!connection) return;
    try {
      await this.#deps.settle(connection);
    } catch (error) {
      this.#settleError = messageOf(error);
    }
    this.#unsettled = null;
    this.#resume();
  }

  /** How iterate runs: only an available way moves on. */
  chooseHow(how: How) {
    if (!HOW.some((known) => known.id === how && known.available)) return;
    this.#save({ how });
    this.#resume();
  }

  async connect() {
    if (this.#view.step !== "connect") return;
    this.#set({ ...this.#view, busy: true, error: null });
    try {
      const { url } = await this.#deps.connect();
      this.#deps.navigate(url);
    } catch (error) {
      this.#set({
        step: "connect",
        again: false,
        last: null,
        busy: false,
        error: messageOf(error),
      });
    }
  }

  /** The account: then whether it can hold a deployment, asked of Cloudflare. */
  choose(choice: Choice) {
    this.#save({ connection: choice.connection, accountId: choice.account.id });
    void this.checkAccount(choice);
  }

  /** Ask Cloudflare again whether the account is ready (after the person added a card). A ready
   *  account goes straight on to the name. */
  async checkAccount(choice?: Choice) {
    const chosen = choice || (this.#view.step === "ready" ? this.#view.choice : null);
    if (!chosen) return;
    this.#set({ step: "ready", choice: chosen, readiness: null, checking: true, error: null });
    const input = { connection: chosen.connection, accountId: chosen.account.id };
    const answer = await this.#deps.checkAccount(input).then(
      (readiness) => ({ readiness, error: null }),
      (error: unknown) => ({ readiness: null, error: messageOf(error) }),
    );
    if (this.#view.step !== "ready" || this.#view.choice !== chosen) return;
    const { readiness } = answer;
    if (readiness && readiness.workersPaid && readiness.r2 && readiness.containers)
      return this.#toName(chosen);
    this.#set({ step: "ready", choice: chosen, checking: false, ...answer });
  }

  /** Go on from an account Cloudflare did not fully answer for: the install says what it lacks. */
  continueReady() {
    const view = this.#view;
    if (view.step !== "ready" || view.checking || !view.readiness) return;
    const { workersPaid, r2, containers } = view.readiness;
    if (workersPaid === false || r2 === false || containers === false) return;
    this.#toName(view.choice);
  }

  #toName(choice: Choice) {
    this.#set({
      step: "name",
      choice,
      value: this.#draft().name ?? DEFAULT_NAME,
      checking: false,
      error: null,
    });
  }

  type(value: string) {
    const view = this.#view;
    if (view.step === "name" && !view.checking) this.#set({ ...view, value, error: null });
    if (view.step === "project") this.#set({ ...view, value, error: null });
  }

  /** Continue from the name: its shape here, then the account asked whether it is free. */
  async submitName() {
    if (this.#view.step !== "name" || this.#view.checking) return;
    const { choice, value } = this.#view;
    const name = value.trim();
    const error = this.#nameError(choice, name);
    if (error) return this.#set({ ...this.#view, error });
    this.#set({ ...this.#view, checking: true, error: null });
    const checked = await this.#deps
      .checkName({ connection: choice.connection, accountId: choice.account.id, name })
      .catch((failure: unknown) => ({ status: "unknown" as const, message: messageOf(failure) }));
    if (this.#view.step !== "name") return;
    if (checked.status !== "free")
      return this.#set({ ...this.#view, checking: false, error: checked.message });
    this.#save({ name });
    this.#set({
      step: "project",
      choice,
      name,
      value: this.#draft().project ?? DEFAULT_PROJECT,
      error: null,
    });
  }

  /** Continue from the first project's slug, to its hostname. */
  submitProject() {
    const view = this.#view;
    if (view.step !== "project") return;
    const parsed = ProjectSlug.safeParse(view.value.trim());
    if (!parsed.success) return this.#set({ ...view, error: parsed.error.issues[0]!.message });
    this.#save({ project: parsed.data });
    void this.#toDomain(view.choice, view.name, parsed.data);
  }

  async #toDomain(choice: Choice, name: string, project: string) {
    const draft = this.#draft();
    const base = {
      step: "domain" as const,
      choice,
      name,
      project,
      zoneId: draft.zoneId || "",
      checking: false,
    };
    this.#set({ ...base, zones: null, error: null });
    const input = { connection: choice.connection, accountId: choice.account.id };
    const answer = await this.#deps.listZones(input).then(
      (zones) => ({ zones, error: null }),
      (error: unknown) => ({ zones: [], error: messageOf(error) }),
    );
    if (this.#view.step !== "domain" || this.#view.zones !== null) return;
    const known = answer.zones.some((zone) => zone.id === base.zoneId);
    // a zone of the account by default: the first, when the person has not chosen workers.dev
    const zoneId = known ? base.zoneId : draft.zoneId === "" ? "" : answer.zones[0]?.id || "";
    this.#set({ ...this.#view, zones: answer.zones, zoneId, error: answer.error });
  }

  /** A zone of the account, or "" for workers.dev alone. */
  chooseZone(zoneId: string) {
    const view = this.#view;
    if (view.step !== "domain" || view.checking) return;
    if (zoneId && !view.zones?.some((zone) => zone.id === zoneId)) return;
    this.#set({ ...view, zoneId, error: null });
  }

  /** Continue from the hostname: its shape here, then its zone asked whether it is free. */
  async submitDomain() {
    const view = this.#view;
    if (view.step !== "domain" || view.checking || !view.zones) return;
    const { choice, name, project, zoneId } = view;
    const zone = view.zones.find((known) => known.id === zoneId);
    if (!zone) {
      this.#save({ zoneId: "" });
      return this.#set({
        step: "review",
        choice,
        name,
        project,
        domain: null,
        busy: false,
        error: null,
      });
    }
    const parsed = Domain.safeParse({ hostname: zone.name, zone });
    if (!parsed.success) return this.#set({ ...view, error: parsed.error.issues[0]!.message });
    this.#set({ ...view, checking: true, error: null });
    const checked = await this.#deps
      .checkHostname({
        connection: choice.connection,
        accountId: choice.account.id,
        domain: parsed.data,
      })
      .catch((failure: unknown) => ({ status: "unknown" as const, message: messageOf(failure) }));
    if (this.#view.step !== "domain") return;
    if (checked.status !== "free")
      return this.#set({ ...this.#view, checking: false, error: checked.message });
    this.#save({ zoneId });
    this.#set({
      step: "review",
      choice,
      name,
      project,
      domain: parsed.data,
      busy: false,
      error: null,
    });
  }

  /** One step back: review, hostname, project, name, account, how. */
  back() {
    const view = this.#view;
    if (view.step === "review") void this.#toDomain(view.choice, view.name, view.project);
    else if (view.step === "domain")
      this.#set({
        step: "project",
        choice: view.choice,
        name: view.name,
        value: view.project,
        error: null,
      });
    else if (view.step === "project")
      this.#set({
        step: "name",
        choice: view.choice,
        value: view.name,
        checking: false,
        error: null,
      });
    else if (view.step === "name" || view.step === "ready") {
      this.#save({ accountId: undefined });
      this.#resume();
    } else if (view.step === "connect" || view.step === "account") {
      this.#save({ how: undefined });
      this.#resume();
    }
  }

  /** Connect another Cloudflare login: a new grant, chosen at Cloudflare's consent. */
  connectAnother() {
    this.#save({ connection: undefined, accountId: undefined });
    this.#set({ step: "connect", again: false, last: null, busy: false, error: null });
  }

  async install() {
    if (this.#view.step !== "review") return;
    const { choice, name, project, domain } = this.#view;
    const request = this.#draft().request ?? this.#deps.newRequestId();
    this.#save({ request });
    this.#set({ ...this.#view, busy: true, error: null });
    try {
      const { id } = await this.#deps.create({
        request,
        connection: choice.connection,
        accountId: choice.account.id,
        name,
        project,
        domain,
      });
      // the connection stays for the next one; the rest of the draft was this deployment's
      this.#deps.storage.write({ connection: choice.connection });
      this.#deps.navigate(`/deployments/${id}`);
    } catch (error) {
      this.#set({ ...this.#view, busy: false, error: messageOf(error) });
    }
  }

  #resume() {
    const person = this.#person;
    if (!person || this.#unsettled) return this.#set({ step: "loading" });
    const draft = this.#draft();
    // a connect the page came back from means the person already chose Cloudflare
    if (!draft.how && !this.#returned()) return this.#set({ step: "how" });
    if (!draft.how) this.#save({ how: "cloudflare" });
    const returned = this.#returned();
    const back = returned ? person.connections.find((known) => known.id === returned) : undefined;
    if (back?.status === "connected" && draft.connection !== back.id)
      this.#save({ connection: back.id, accountId: undefined });
    const choices = choicesOf(person, this.#draft().connection);
    if (choices.length === 0) {
      const last =
        back && back.status !== "connected" ? { status: back.status, error: back.error } : null;
      const again = person.connections.some((known) => known.status === "connected");
      return this.#set({ step: "connect", again, last, busy: false, error: null });
    }
    const chosen = choices.find((choice) => choice.account.id === this.#draft().accountId);
    if (chosen || choices.length === 1) return this.choose(chosen || choices[0]!);
    this.#set({ step: "account", choices });
  }

  /** The connect the page came back from, as its query names it. */
  #returned() {
    return new URLSearchParams(this.#deps.search).get("connection");
  }

  /** How the connect the page came back from stands in `person`: its status, or "" for none (no
   *  person yet, or no such connect). */
  #returnedIn(person: PersonView | null) {
    const returned = this.#returned();
    if (!person) return "";
    return person.connections.find((known) => known.id === returned)?.status || "none";
  }

  #nameError(choice: Choice, name: string) {
    const parsed = DeploymentName.safeParse(name);
    if (!parsed.success) return parsed.error.issues[0]!.message;
    const taken = this.#person?.deployments.some(
      (known) => known.accountId === choice.account.id && known.name === name,
    );
    return taken ? `You already have a deployment named ${name} in ${choice.account.name}.` : null;
  }

  #draft() {
    return this.#deps.storage.read();
  }

  #save(patch: Partial<Draft>) {
    this.#deps.storage.write({ ...this.#draft(), ...patch });
  }

  #set(view: WizardView) {
    this.#view = view;
    for (const listener of this.#listeners) listener();
  }
}

/** The accounts the person may deploy into: through `connection` when it is one of theirs and
 *  connected, else through every connected connection, newest first. A connection that lacks the
 *  wizard's scopes (made before it asked for them) is not one. */
export function choicesOf(person: PersonView, connection?: string): Choice[] {
  const connected = person.connections
    .filter((known) => known.status === "connected" && hasWizardScopes(known.scopes))
    .reverse();
  const picked = connected.filter((known) => known.id === connection);
  return (picked.length ? picked : connected).flatMap((known) =>
    known.accounts.map((account) => ({
      connection: known.id,
      account,
      cloudflareUser: known.cloudflareUser,
    })),
  );
}

/** Whether a connection's granted scopes, as the platform recorded them, include the wizard's. */
export const hasWizardScopes = (scopes: string[]) => {
  const granted = new Set(scopes.flatMap((scope) => scope.split(/\s+/)));
  return WIZARD_SCOPES.every((scope) => granted.has(scope));
};

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

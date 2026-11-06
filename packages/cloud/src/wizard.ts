// cloud/wizard.ts — THE FIRST DEPLOYMENT, as a state machine the Cloud app's `/new` page only draws
// (the shape of Appflare's deploy flow, appflare/appflare apps/docs/src/deploy/flow.ts):
//
//   connect Cloudflare → account (a choice only when the grant reaches several) → name → review
//   → the deployment's page, which shows the install from the deployment's own live state
//
// Every call to the Cloud, the browser's storage and its address bar goes through `WizardDeps`, so
// the whole journey runs in a test. RESUMABLE: what the person chose lives in the browser's storage
// (`Draft`) and the connect's return names its connection in the URL (`/new?connection=<id>`), so a
// closed tab, a reload or the round trip to Cloudflare lands on the step it left. A creation keeps
// its request id in the draft, so pressing Install again after a lost answer is the same deployment
// (api.ts `create`). Once created, the draft is cleared and the browser goes to the deployment's page:
// the address bar finds an install again. Browser-safe: no import but records.ts.
import { DeploymentName, type CloudflareAccount, type PersonState } from "./records.ts";

/** What the wizard reads of the person: their live state, as the browser sees it (no nonces). */
export type PersonView = Omit<PersonState, "connections"> & {
  connections: Omit<PersonState["connections"][number], "nonce">[];
};

/** One account the person may deploy into, through one connection. */
export type Choice = {
  connection: string;
  account: CloudflareAccount;
  cloudflareUser: string | null;
};

export type WizardView =
  | { step: "loading" }
  | {
      step: "connect";
      /** The last connect, when it did not end connected: still pending, or failed and why. */
      last: { status: "pending" | "failed"; error: string | null } | null;
      busy: boolean;
      error: string | null;
    }
  | { step: "account"; choices: Choice[] }
  | { step: "name"; choice: Choice; value: string; checking: boolean; error: string | null }
  | { step: "review"; choice: Choice; name: string; busy: boolean; error: string | null };

/** What the tab keeps between visits. */
export type Draft = { connection?: string; accountId?: string; name?: string; request?: string };

export type WizardDeps = {
  connect(): Promise<{ url: string }>;
  create(input: {
    request: string;
    connection: string;
    accountId: string;
    name: string;
  }): Promise<{ id: string }>;
  /** Whether the name is free in the account (api.ts `checkName`): `create` checks it again. */
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

  constructor(deps: WizardDeps) {
    this.#deps = deps;
  }

  view() {
    return this.#view;
  }

  subscribe(listener: () => void) {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }

  /** The person's live state, first and on every change: the wizard moves on when it allows. */
  update(person: PersonView) {
    const first = !this.#person;
    this.#person = person;
    if (first || this.#view.step === "loading" || this.#view.step === "connect") this.#resume();
  }

  async connect() {
    if (this.#view.step !== "connect") return;
    this.#set({ ...this.#view, busy: true, error: null });
    try {
      const { url } = await this.#deps.connect();
      this.#deps.navigate(url);
    } catch (error) {
      this.#set({ step: "connect", last: null, busy: false, error: messageOf(error) });
    }
  }

  choose(choice: Choice) {
    this.#save({ connection: choice.connection, accountId: choice.account.id });
    this.#set({
      step: "name",
      choice,
      value: this.#draft().name ?? DEFAULT_NAME,
      checking: false,
      error: null,
    });
  }

  type(value: string) {
    if (this.#view.step === "name" && !this.#view.checking)
      this.#set({ ...this.#view, value, error: null });
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
    this.#set({ step: "review", choice, name, busy: false, error: null });
  }

  /** One step back: from the review to the name, from the name to the account. */
  back() {
    const view = this.#view;
    if (view.step === "review")
      this.#set({
        step: "name",
        choice: view.choice,
        value: view.name,
        checking: false,
        error: null,
      });
    else if (view.step === "name") {
      this.#save({ accountId: undefined });
      this.#resume();
    }
  }

  /** Connect another Cloudflare login: a new grant, chosen at Cloudflare's consent. */
  connectAnother() {
    this.#save({ connection: undefined, accountId: undefined });
    this.#set({ step: "connect", last: null, busy: false, error: null });
  }

  async install() {
    if (this.#view.step !== "review") return;
    const { choice, name } = this.#view;
    const request = this.#draft().request ?? this.#deps.newRequestId();
    this.#save({ request });
    this.#set({ ...this.#view, busy: true, error: null });
    try {
      const { id } = await this.#deps.create({
        request,
        connection: choice.connection,
        accountId: choice.account.id,
        name,
      });
      // the connection stays for the next one; the rest of the draft was this deployment's
      this.#deps.storage.write({ connection: choice.connection });
      this.#deps.navigate(`/deployments/${id}`);
    } catch (error) {
      this.#set({ step: "review", choice, name, busy: false, error: messageOf(error) });
    }
  }

  #resume() {
    const person = this.#person;
    if (!person) return this.#set({ step: "loading" });
    const draft = this.#draft();
    const returned = new URLSearchParams(this.#deps.search).get("connection");
    const back = returned ? person.connections.find((known) => known.id === returned) : undefined;
    if (back?.status === "connected" && draft.connection !== back.id)
      this.#save({ connection: back.id, accountId: undefined });
    const choices = choicesOf(person, this.#draft().connection);
    if (choices.length === 0) {
      const last =
        back && back.status !== "connected" ? { status: back.status, error: back.error } : null;
      return this.#set({ step: "connect", last, busy: false, error: null });
    }
    const chosen = choices.find((choice) => choice.account.id === this.#draft().accountId);
    if (chosen || choices.length === 1) return this.choose(chosen || choices[0]!);
    this.#set({ step: "account", choices });
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
 *  connected, else through every connected connection, newest first. */
export function choicesOf(person: PersonView, connection?: string): Choice[] {
  const connected = person.connections.filter((known) => known.status === "connected").reverse();
  const picked = connected.filter((known) => known.id === connection);
  return (picked.length ? picked : connected).flatMap((known) =>
    known.accounts.map((account) => ({
      connection: known.id,
      account,
      cloudflareUser: known.cloudflareUser,
    })),
  );
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

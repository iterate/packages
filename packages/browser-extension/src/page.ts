import { RpcTarget } from "capnweb";

type MatchOptions = { exact?: boolean };
type RoleOptions = MatchOptions & {
  name?: string;
  disabled?: boolean;
  includeHidden?: boolean;
  checked?: boolean;
  expanded?: boolean;
  level?: number;
  pressed?: boolean;
  selected?: boolean;
};
export type Step =
  | { kind: "css"; selector: string }
  | { kind: "role"; role: string; options: RoleOptions }
  | { kind: "text" | "label"; text: string; options: MatchOptions }
  | { kind: "nth"; index: number };
export type Probe =
  | { status: "ready"; id: number; box: number[] }
  | { status: "wait" | "fatal"; detail: string }
  | { status: "value"; value: number | string | null };
type CdpReply = {
  frameTree?: { frame: { id: string; loaderId: string } };
  executionContextId?: number;
  result?: { value?: unknown };
  exceptionDetails?: { text: string; exception?: { description?: string } };
};
export type Cdp = (method: string, params: Record<string, unknown>) => Promise<CdpReply>;
type Options = { timeout?: number };
class DeadlineError extends Error {}

/** Each tab has one page handle and one input queue; queue wait counts toward its deadline. */
export class ChromePage extends RpcTarget {
  #cdp: Cdp;
  #source: string;
  #queue: Promise<unknown> = Promise.resolve();
  constructor(cdp: Cdp, source: string) {
    super();
    this.#cdp = cdp;
    this.#source = source;
  }
  locator(selector: string) {
    return new ChromeLocator(this, [{ kind: "css", selector }]);
  }
  getByRole(role: string, options: RoleOptions = {}) {
    return new ChromeLocator(this, [{ kind: "role", role, options }]);
  }
  getByText(text: string, options: MatchOptions = {}) {
    return new ChromeLocator(this, [{ kind: "text", text, options }]);
  }
  getByLabel(text: string, options: MatchOptions = {}) {
    return new ChromeLocator(this, [{ kind: "label", text, options }]);
  }

  /** Internal calls stay off the RPC target's public method table. */
  static run(page: ChromePage, steps: Step[], action: string, value: string, options: Options) {
    const timeout = options.timeout ?? 5_000;
    if (!Number.isFinite(timeout) || timeout < 1 || timeout > 30_000)
      throw new Error("timeout must be between 1 and 30000 ms");
    const deadline = performance.now() + timeout;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waiting = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Timed out in page queue: ${action} ${JSON.stringify(steps)}`)),
        timeout,
      );
    });
    const task = page.#queue.then(() => {
      clearTimeout(timer);
      return page.#act(steps, action, value, deadline);
    });
    page.#queue = task.catch(() => {});
    return Promise.race([task, waiting]);
  }

  async #command(
    method: string,
    params: Record<string, unknown>,
    deadline: number,
  ): Promise<CdpReply> {
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw new DeadlineError("action deadline exceeded");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.#cdp(method, params),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new DeadlineError(`CDP ${method} exceeded action deadline`)),
            remaining,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async #frame(deadline: number) {
    const reply = await this.#command("Page.getFrameTree", {}, deadline);
    if (!reply.frameTree) throw new Error("CDP did not return the main frame");
    return reply.frameTree.frame;
  }

  async #probe(
    contextId: number,
    steps: Step[],
    action: string,
    deadline: number,
    commitId?: number,
  ) {
    const reply = await this.#command(
      "Runtime.evaluate",
      {
        contextId,
        expression: `if (!globalThis.__iterateControls) { ${this.#source}\n }; globalThis.__iterateControls.probe(${JSON.stringify(steps)}, ${JSON.stringify(action)}, ${JSON.stringify(commitId)})`,
        returnByValue: true,
      },
      deadline,
    );
    if (reply.exceptionDetails)
      throw new Error(
        `Locator evaluation failed (navigation may have replaced the document): ${reply.exceptionDetails.exception?.description || reply.exceptionDetails.text}`,
      );
    const result = reply.result?.value;
    if (!isLocatorProbeReply(result)) throw new Error("Invalid locator runtime reply");
    if (result.status === "fatal") throw new Error(result.detail);
    return result;
  }

  async #act(steps: Step[], action: string, value: string, deadline: number) {
    if (action === "press" && !Object.hasOwn(keys, value))
      throw new Error(`Unsupported key ${value}; supported: ${Object.keys(keys).join(", ")}`);
    let last = "no match";
    let previous = "";
    try {
      for (;;) {
        if (performance.now() >= deadline)
          throw new Error(`Timed out: ${action} ${JSON.stringify(steps)}: ${last}`);
        const frame = await this.#frame(deadline);
        const world = await this.#command(
          "Page.createIsolatedWorld",
          { frameId: frame.id, worldName: "iterate-controls" },
          deadline,
        );
        if (!world.executionContextId) throw new Error("CDP did not return an isolated world");
        const result = await this.#probe(world.executionContextId, steps, action, deadline);
        if (result.status === "value") return result.value;
        if (result.status === "ready") {
          const signature = JSON.stringify([frame.loaderId, world.executionContextId, result]);
          if (signature === previous) {
            if (action === "click")
              await this.#command(
                "Input.dispatchMouseEvent",
                {
                  type: "mouseMoved",
                  x: result.box[0],
                  y: result.box[1],
                  button: "none",
                },
                deadline,
              );
            const checked = await this.#probe(
              world.executionContextId,
              steps,
              action,
              deadline,
              result.id,
            );
            if (checked.status === "ready" && JSON.stringify(checked) === JSON.stringify(result)) {
              const current = await this.#frame(deadline);
              if (current.id !== frame.id || current.loaderId !== frame.loaderId)
                throw new Error(
                  "Navigation changed the document before input; action was not retried",
                );
              await this.#input(action, value, result.box, deadline);
              return;
            }
            last = checked.status === "wait" ? checked.detail : "element changed before input";
            previous = "";
          } else {
            previous = signature;
            last = "waiting for a stable element";
          }
        } else {
          previous = "";
          last = result.detail;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(50, Math.max(0, deadline - performance.now()))),
        );
      }
    } catch (error) {
      if (error instanceof DeadlineError)
        throw new Error(`Timed out: ${action} ${JSON.stringify(steps)}: ${last}; ${error.message}`);
      throw error;
    }
  }

  async #input(action: string, value: string, box: number[], deadline: number) {
    if (action === "click") {
      const params = { x: box[0], y: box[1], button: "left", clickCount: 1 };
      try {
        await this.#command(
          "Input.dispatchMouseEvent",
          { ...params, type: "mousePressed", buttons: 1 },
          deadline,
        );
      } finally {
        await this.#command(
          "Input.dispatchMouseEvent",
          { ...params, type: "mouseReleased", buttons: 0 },
          performance.now() + 1_000,
        );
      }
    } else if (action === "fill" && value) {
      await this.#command("Input.insertText", { text: value }, deadline);
    } else {
      const key = keys[action === "fill" ? "Backspace" : value];
      const { text: _text, ...released } = key;
      try {
        await this.#command("Input.dispatchKeyEvent", { type: "keyDown", ...key }, deadline);
      } finally {
        await this.#command(
          "Input.dispatchKeyEvent",
          { type: "keyUp", ...released },
          performance.now() + 1_000,
        );
      }
    }
  }
}

class ChromeLocator extends RpcTarget {
  #page: ChromePage;
  #steps: Step[];
  constructor(page: ChromePage, steps: Step[]) {
    super();
    this.#page = page;
    this.#steps = steps;
  }
  #chain(step: Step) {
    return new ChromeLocator(this.#page, [...this.#steps, step]);
  }
  locator(selector: string) {
    return this.#chain({ kind: "css", selector });
  }
  getByRole(role: string, options: RoleOptions = {}) {
    return this.#chain({ kind: "role", role, options });
  }
  getByText(text: string, options: MatchOptions = {}) {
    return this.#chain({ kind: "text", text, options });
  }
  getByLabel(text: string, options: MatchOptions = {}) {
    return this.#chain({ kind: "label", text, options });
  }
  nth(index: number) {
    if (!Number.isInteger(index) || index < 0)
      throw new Error("nth requires a nonnegative integer");
    return this.#chain({ kind: "nth", index });
  }
  first() {
    return this.nth(0);
  }
  click(options: Options = {}) {
    return ChromePage.run(this.#page, this.#steps, "click", "", options);
  }
  fill(value: string, options: Options = {}) {
    // RPC callers can pass values that do not match the TypeScript signature.
    // oxlint-disable-next-line iterate/simple-truthiness-check
    if (typeof value !== "string") throw new Error("fill requires a string");
    return ChromePage.run(this.#page, this.#steps, "fill", value, options);
  }
  press(key: string, options: Options = {}) {
    return ChromePage.run(this.#page, this.#steps, "press", key, options);
  }
  count() {
    return ChromePage.run(this.#page, this.#steps, "count", "", {});
  }
  textContent(options: Options = {}) {
    return ChromePage.run(this.#page, this.#steps, "textContent", "", options);
  }
}

const keys: Record<
  string,
  { key: string; code: string; windowsVirtualKeyCode: number; text?: string }
> = {
  Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
  Tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
  Backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
  Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 },
};

// The Runtime.evaluate result crosses a CDP boundary; validate its discriminated payload.
// oxlint-disable iterate/simple-truthiness-check
function isLocatorProbeReply(value: unknown): value is Probe {
  if (!value || typeof value !== "object" || !("status" in value)) return false;
  if (value.status === "fatal" || value.status === "wait")
    return "detail" in value && typeof value.detail === "string";
  if (value.status === "value")
    return (
      "value" in value &&
      (value.value === null || typeof value.value === "string" || typeof value.value === "number")
    );
  return (
    value.status === "ready" &&
    "id" in value &&
    typeof value.id === "number" &&
    "box" in value &&
    Array.isArray(value.box) &&
    value.box.length === 4 &&
    value.box.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

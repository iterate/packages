# A Bun box behind the Cloud's router

A deployment with no public origin: a Bun server on a laptop gets `https://<slug>.iterate2.app/`
and `<slug>@iterate2.app`. Proven on 2026-11-09 with the slug `bunbox`.

```
visitor ─▶ <slug>.iterate2.app ─▶ cloud-router ─▶ the project host on os.iterate.com
                                   (stamps x-iterate-cloud-deployment)  └─ fetch route ─▶ lent stub ─▶ Bun
mail    ─▶ <slug>@iterate2.app ─▶ cloud-router.email() ─▶ os.iterate.com /api, as the operator:
                                   projects.get(<box's project>).invoke(itx.boxes.<id>.projects.get(…).cd(…).append(…)) ─▶ Bun
```

The box dials out once. `server.ts` opens a capnweb WebSocket to `os.iterate.com/api` with a
personal access token and `provide`s one live stub on its project's root at `itx.boxes.<id>`, with
a fetch route that matches the router's `x-iterate-cloud-deployment` header. This is the lend that
`iterate tunnel` makes, in plain capnweb: the edge relay holds the socket, the project's Durable
Object keeps a hibernatable pager and borrows the stub only when a call needs it (core/os
`context/rpc-stubs.ts`). The stub answers `fetch(request)` and the part of a deployment's API the
router calls, `projects.get(id).cd(path).append(event)`, so mail in arrives as
`iterate-cloud/email-received`, as it does for a core/os deployment.

The router knows the box as a deployment with `provided: { project, host, at }` instead of an
origin and bearer (`src/registry.ts`).

## Run it

```sh
cd packages/cloud-router/examples/bun-box && bun install
iterate --config prd tokens create --name bun-box --project <your project> --never-expires   # its bearer
ITERATE_PROJECT=<your project> ITERATE_BEARER_TOKEN=<bearer> bun server.ts   # dials, provides, writes .box.json
bun enrol.ts <slug>             # registers the box and claims <slug>: Doppler os/prd (an operator)
```

Then open `https://<slug>.iterate2.app/` and send mail to `<slug>@iterate2.app`: it shows on the page.

## Not real yet

- Enrolment is an operator's script with the router's KV credentials. The real one is the
  deployment's own call to the Cloud.
- The box's projects and its inbox are in memory and `.box.json`.
- The visitor's `authorization` header is dropped: the platform's edge refuses a bearer it did not
  mint on its project hosts. Anyone who sends the header to the project host itself reaches the box,
  as anyone reaches it through the router: the box trusts nothing the header says.
- WebSockets through the fetch route are untested.

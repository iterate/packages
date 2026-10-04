# iterate's project templates

Templates that depend on packages outside core. Core's own, which depend on nothing outside it,
are in [iterate/core's core/configs](https://github.com/iterate/core/tree/main/core/configs), which also
says how a template works.

- `voice/` — core's `default` plus the voice app. `voice.ts` re-exports the voice service and its
  relay class from the npm package `@iterate-com/voice`, and the init case of `worker.ts` calls
  `installVoice(itx)` as well as `installAgents(itx)`.

iterate's deploys, previews and test runs give the platform's build every folder here
(`scripts/os/config-templates.ts`, core/os's `scripts/build.ts` `--template`), each under its
GitHub reference at the checkout's commit in the repository its `origin` names
(`github:iterate/private#<sha>&path:configs/<name>`). A template lists `@iterate-com/voice` at
`main`, npm's dist-tag for main's newest build: production keeps it, and a seed writes the version
npm names then; previews and test runs list this checkout's own pkg.pr.new build instead
(`scripts/os/published-package-commit.ts`). Any other template may list `main` of one of our
packages, or a pkg.pr.new dependency at a branch (`…@main`): the seed pins either, because a
project's source names one build (`pinDependencies` in `core/lib/src/package-builds.ts`).

These are copied to [iterate/packages](https://github.com/iterate/packages) with the packages they
use, so a self-host can offer one with
`--template "github:iterate/packages#main&path:configs/voice"`.

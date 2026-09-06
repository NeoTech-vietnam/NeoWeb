# Deploying NeoLearning

NeoWeb produces a static learning portal from selected NeoLearning revisions. The expected project Pages address is [NeoLearning on GitHub Pages](https://neotech-vietnam.github.io/NeoWeb/). That address is a deployment target, not evidence that publication has succeeded.

## Current release prerequisites

The owner explicitly approved public NeoWeb source on 2026-09-05. NeoWeb is now public, Pages is configured for GitHub Actions, and `main` blocks force-pushes and deletion. The last accessible runner inventory was empty; the two required secrets were absent.

Public Pages from a private organization repository requires an eligible paid plan. Keep repository visibility unchanged unless the owner separately chooses to publish its source. See [GitHub Pages availability](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).

Complete these setup steps before expecting a live release:

1. Keep the approved public repository visibility, or arrange an eligible paid organization plan before making it private again.
2. Protect NeoWeb's `main` branch, require the `TypeScript, tests, and static export` check, and require review for workflow/compiler changes.
3. Register a dedicated runner for NeoWeb with the custom label `neoweb-content`. Use runner version 2.327.1 or later, Git with HTTPS support, and outbound access to GitHub and the npm registry. The workflow installs Node.js 24. Limit its runner group to the publication workflow where the organization plan supports that restriction.
4. Configure `NEOLEARNING_READ_TOKEN` in NeoWeb as described below.
5. In NeoWeb Settings > Pages, select GitHub Actions as the source and public website visibility. Configure the `github-pages` environment to allow only the protected `main` branch.
6. Merge the tested website and workflows into NeoWeb `main`, then run `Publish NeoLearning` from that branch.
7. Install the NeoLearning validator integration and dispatch credential after its reviewed bundle is available.

The hosted preflight reports missing protection, source credentials, or Pages configuration before any job reaches the dedicated runner. It never changes repository settings or suppresses setup failures.

## Credentials and repository access

`NEOLEARNING_READ_TOKEN` is a fine-grained personal token, or equivalent GitHub App installation token, with Contents:read for the learning repository and every private nested example repository:

- `NeoTech-vietnam/NeoLearning`
- `NeoTech-vietnam/NeoExamples`
- `NeoTech-vietnam/NeoExamples-Window`
- `NeoTech-vietnam/NeoExamples-Linux`
- `NeoTech-vietnam/NeoExamples-ESP32`
- `NeoTech-vietnam/NeoExamples-STM32`
- `NeoTech-vietnam/NeoExamples-ESP32-FreeRTOS`
- `NeoTech-vietnam/NeoExamples-ESP32-Zephyr`

Check the recursive `.gitmodules` graph when adding submodules and extend the token's repository allowlist if necessary. Public upstream submodules need no additional private repository grant. Configure an expiry and rotate credentials before it. The default NeoWeb `GITHUB_TOKEN` cannot read private repositories outside NeoWeb.

The checkout action uses HTTPS and removes persisted credentials. All historical submodule objects must already be available in the recursive checkout; the v1 compiler fails explicitly if an object is missing and does not fetch it itself. Never put a credential into a clone URL, committed configuration, generated content, or frontend environment variable.

### Windows runner paths

The publication job sets Git's `core.longpaths=true` through its job environment
before either checkout. Windows' `LongPathsEnabled` registry setting alone does
not enable Git's separate long-path support. This is needed for deeply nested
curriculum files under runner paths such as `D:\workspace\actions-runner\_work`.
The setting is inherited by recursive submodule processes and does not require
administrator access, a global Git configuration change, or a runner restart.
The Windows regression test checks the reported algorithm filename both without
long-path support (expected failure) and with the actual job configuration.
See [Git for Windows long paths](https://gitforwindows.org/git-cannot-create-a-file-or-directory-with-a-long-path.html)
and [Git runtime configuration](https://git-scm.com/docs/git-config#Documentation/git-config.txt-GITCONFIGCOUNT).

The Pages upload action also requires Bash and GNU tar on Windows. Before upload,
the workflow validates the tools supplied with Git for Windows and adds their
directory to `GITHUB_PATH` for subsequent action steps. This prevents Windows'
WSL `bash.exe` alias or BSD tar from being selected. No WSL distribution, runner
restart, or machine-wide PATH edit is required. Changing `defaults.run.shell`
alone does not override a composite action's explicitly selected shell.
See the [pinned Pages archive action](https://github.com/actions/upload-pages-artifact/blob/7b1f4a764d45c48632c6b24a0339c27f5614fb0b/action.yml).

The website intentionally publishes curated learning material, including selected example content. Exclusion rules remove tooling directories, binaries, build outputs, and vendor archives. Review the generated inventory before the first public release.

## Workflows and trust boundaries

`.github/workflows/ci.yml` runs type checks, unit/integration tests, and a static export on GitHub-hosted runners. Pull requests receive no source-read or dispatch secrets.

`.github/workflows/pages.yml` runs only on the protected NeoWeb default branch. Its hosted preflight checks prerequisites; its dedicated runner installs the locked website dependencies and reads pinned source revisions; its hosted deployment job receives only Pages and OpenID Connect write permissions. The build never executes learning example code.

Every successful publication regenerates the latest 20 commits reachable from NeoLearning `dev`, the current `main` revision, and tagged releases. Source selection comes from trusted repository refs; the browser and dispatch request cannot supply arbitrary Git commands, repository URLs, or mixed submodule revisions.

The scheduled recovery build runs every six hours at minute 17. Manual publication uses the same checks. Publication jobs are serialized, so one artifact is deployed at a time. A failed build leaves the previously deployed Pages site available.

Action references are pinned to verified immutable commits. Review action updates together with the runner's supported version.

## Install the NeoLearning integration

The integration carries a reviewed, self-contained bundle built from `web/scripts/check-markdown.ts`. It works without package installation or cross-repository credentials on public fork pull requests and does not maintain a second validator implementation.

After reviewing a NeoWeb revision:

1. Generate the standalone validator with the repository's bundle command. The output must be `integration/neolearning/.github/neoweb/check-markdown.mjs` and must include its required parsing dependencies/configuration.
2. Copy the integration's `.github/neoweb` directory and `.github/workflows/neoweb.yml` into NeoLearning. Review and merge the bundle into both the default branch and the branch targeted by documentation pull requests before relying on the new check.
3. Set `NEOWEB_DISPATCH_TOKEN` in NeoLearning to a fine-grained token with Actions:write on NeoWeb only. It needs no write access to NeoLearning.
4. Require `Validate changed Markdown` in NeoLearning branch protection.
5. Submit one valid and one deliberately invalid documentation change to confirm annotations and failure behavior, then remove the invalid test change.

The integration checks out the candidate source separately from the trusted validator. On pull requests it executes the bundle from the base commit; on `dev` pushes it executes the bundle from NeoLearning's default branch. Candidate source files are input data only. No dependencies or scripts from the candidate checkout are executed.

Fork validation does not authenticate to private submodules. The validator reports links into uninitialized submodules as deferred checks; the authenticated content build checks the actual pinned nested content. A missing validator bundle is an actionable installation error, not a successful validation.

The dispatch job runs only after validation succeeds on a push to `dev`, and requests `pages.yml` at `main` with no source-selection input. A missing/expired dispatch token causes a visible failure; the scheduled build can recover the content update. A [workflow dispatch](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event) permits the narrower Actions:write permission, whereas a repository dispatch requires Contents:write.

## Local build and verification

Run the following from the `web` directory with a local recursive NeoLearning checkout. Supply your own source path; machine-specific paths are never committed.

```sh
npm ci
npm run typecheck
npm test
npm run content:build -- --source /absolute/path/to/NeoLearning
npm run build
npm run artifact:check
```

For a Pages-equivalent build, set `NEOWEB_BASE_PATH=/NeoWeb` in the process environment before building. Without an explicit override, the build derives the project path from `GITHUB_REPOSITORY` in Actions and uses the root path locally.

The application uses `output: 'export'` in `web/next.config.ts`. The deployable directory is `web/dist/client`, including pre-rendered HTML and browser assets; server bundles are not deployed. This matches [Vinext's static-export test fixture](https://github.com/cloudflare/vinext/blob/main/playwright.config.ts). The artifact check must reject missing entry HTML, unsafe output, and a release larger than 750 MB.

After deployment, check the exact URL emitted by the deployment job. Verify a deep link with the `/NeoWeb/` prefix, a historical snapshot, a Markdown-to-Markdown link, a removed-file diff, a practice draft after reload, and progress export/import. Confirm disconnected widgets do not block learning.

## Spotify and Google Calendar setup

The app connects from the user's browser. It needs public OAuth client IDs, not client secrets. Enter the IDs in the portal's integration settings on each device.

For Spotify, create a developer application and register the portal's exact HTTPS callback URI shown by the app, including the `/NeoWeb/` path and trailing slash. Authorize only `user-read-currently-playing` and `user-read-playback-state`. PKCE does not require a client secret. Development-mode account restrictions and Spotify eligibility still apply; an unavailable account or expired connection must leave the widget usable in its disconnected state. See [Spotify PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow).

For Google Calendar, enable the Calendar API in a Google Cloud project, configure the OAuth consent screen, and create a Web application OAuth client. Add `https://neotech-vietnam.github.io` as an authorized JavaScript origin; origins do not include `/NeoWeb/`. Request only `https://www.googleapis.com/auth/calendar.events.readonly`. Add your account as a test user while the OAuth application is in testing. Google Identity Services obtains short-lived tokens through a user interaction. See [Google's browser token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model).

For local development, register the exact supported local origins/callback URIs separately. Never reuse a production callback with a different path or protocol.

OAuth tokens stay on the device and are excluded from progress exports. Disconnecting an integration must remove its local token state. GitHub Actions credentials have no role in either widget.

## Release status and recovery

A local build or prepared workflow does not establish a successful release. Record the GitHub workflow URL, source snapshot SHA, and the deployed URL only after the Pages deployment succeeds.

For a content regression, use the snapshot selector to inspect the previous published revision while correcting the source. For an application regression, revert the reviewed application change through a pull request and let the protected publication workflow rebuild. Do not move source refs or rewrite submodule histories to repair a website deployment.

If the dedicated runner remains queued, check its online state, custom label, repository access, and runner version. If source checkout fails, check token expiry, every private nested repository permission, and availability of the pinned commit. If Pages preflight fails, complete the reported repository prerequisite rather than removing the guard.

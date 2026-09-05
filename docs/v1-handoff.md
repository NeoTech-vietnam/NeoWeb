# Version one handoff

## Implemented

The browser application, immutable content compiler, Markdown validator, learning
state, C/C++ practice workspace, and read-only integration clients are implemented.
The real-source build produces 21 snapshots: 20 recent dev commits and main.
Generated JSON schemas are checked in under `web/schemas`.

## Deployment setup still required

The owner approved making NeoWeb public. GitHub Pages now uses GitHub Actions;
main is protected against force-pushes and deletion, including administrators.
The target is https://neotech-vietnam.github.io/NeoWeb/.

The following account/infrastructure requirements are not supplied by application code:

1. A dedicated online runner available to NeoWeb with the `neoweb-content` label.
2. NeoWeb secret `NEOLEARNING_READ_TOKEN`, Contents:read for NeoLearning and its
   seven private example repositories listed in `deployment.md`.
3. NeoLearning secret `NEOWEB_DISPATCH_TOKEN`, Actions:write on NeoWeb only.
4. Reviewed workflow/bundle installation on NeoLearning's main and dev branches.
5. Optional personal Spotify and Google OAuth client registrations for connected widgets.

Never paste tokens into chat or commit them. Enter them directly in GitHub's
repository-secret settings. Disconnected external widgets do not block learning.

## Known boundaries

- Only prebuilt snapshots are selectable; no arbitrary browser-triggered checkouts.
- The first parent of the oldest published commit may be outside the window.
  Deleted file content is preserved locally in its tombstone even then.
- Historical submodule objects must exist in the recursive source checkout. A
  missing object fails the build with its repository and SHA rather than mixing versions.
- Source frontmatter and exercise overrides are optional. New ambiguous note
  groups need explicit mapping; unrelated source files receive separate workspaces.
- Fresh installations begin with zero progress; there are no invented study hours.
- External OAuth success is covered by mocks; real-account consent still needs
  the owner's registered client IDs and approval in the browser.

## Verification

Local verification on 2026-09-06: all 64 tests and TypeScript checks passed;
lint passed with advisory warnings; the production dependency audit reported
zero known vulnerabilities. The real-source export contains 21 snapshots and
fits below the 750 MB limit. Mobile browser smoke checks covered dashboard,
exercise search, Cornell problem rendering, blank Monaco initialization, and hints.
This is not a claim of a completed WCAG audit or live OAuth account verification.

Run `npm run typecheck`, `npm test`, the real content build, `npm run build`, and
`npm run artifact:check` from `web`. The artifact check validates content references,
secret signatures, unsafe paths, and the 750 MB ceiling. Browser QA should cover
desktop/mobile reading and practice, draft persistence, historical switching,
and local backup/restore before accepting a live release.

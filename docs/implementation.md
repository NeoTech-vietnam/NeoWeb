# NeoLearning portal implementation

The approved plan is a public static GitHub Pages portal, implemented in `web/`.
NeoLearning remains the source of truth. Only the roadmap Learning Resources
headings define dashboard topics. Git/PR authoring, exact recursive snapshot
pins, local learning data with backup, blank C/C++ scratchpads, personal time
targets, Spotify remote playback controls, and read-only Google Calendar are the agreed defaults.

## Delivery checklist

- [x] Compile 20 recent dev commits, main, and tags from immutable Git objects.
- [x] Validate content schemas, links, safety, topic mapping, and exercises.
- [x] Build dashboard, documentation, library, versions, and practice workspace.
- [x] Store and export local progress, drafts, focus sessions, and review dates.
- [x] Add browser OAuth widgets with safe disconnected/error states.
- [x] Add trusted CI validation, snapshot publishing, and Pages deployment workflows.
- [x] Test real content/history and the production static export.
- [ ] Publish when GitHub credentials and repository Pages configuration allow it.

## Study soundtrack update

The [playback and automatic sync requirements](spotify-playback.md) supersede the original
read-only Spotify limitation. Google Calendar and learning features remain unchanged.

## Architecture

Git trees → curated source records → Markdown compiler → immutable manifest and
content-addressed blobs → static React portal → versioned local learning state.
Shared runtime schemas validate each persisted boundary. The public browser
cannot invoke a runner or mutate Git repositories. Node build scripts have no
dependency on firmware toolchains and never execute imported source code.

The accepted source workflow changes are staged under `integration/neolearning/`
for review and installation into NeoLearning. Its upstream default branch is
main; the learning content channel is dev. An authenticated dispatch improves
latency, with scheduled/manual builds as recovery.

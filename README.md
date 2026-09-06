# NeoWeb · NeoLearning Mission Control

A space-themed learning portal generated from NeoLearning. The roadmap defines
the curriculum; immutable Git snapshots keep notes and nested examples together.

## Run locally

Use Node.js 22.13+ and a recursive NeoLearning checkout:

```sh
cd web
npm ci
npm run content:build -- --source /absolute/path/to/NeoLearning
npm run dev
```

Open the local address printed by the server. No machine-specific source path is
stored in the repository. The generated content is excluded from Git.

After a production build, `npm start` serves the static artifact on port 4175.
Use the same `NEOWEB_BASE_PATH` for build and preview (set it to `/NeoWeb` for
the Pages release). This preview does not run a server-rendered application.

## Version one

- Roadmap dashboard, topic pages, searchable file tree, Markdown links and backlinks.
- 20 recent dev commits, main, and releases with exact recursive submodule pins.
- C/C++ scratchpads, side-by-side notes, staged hints, solution reveal and text diffs.
- Local progress and drafts, focus timer, review scheduling, JSON backup and restore.
- Optional Spotify remote playback controls and automatic track sync; read-only Google Calendar. Configure connections in Settings.

### Spotify soundtrack

Previous, Play/Pause, and Next control your currently active Spotify device (Premium required).
Existing connections keep displaying tracks: choose **Reconnect to enable controls** once to grant
the added playback permission. No `.env` changes or content rebuild are needed for this feature.
Track information updates every 5 seconds while playing and 15 seconds while paused/idle;
sync pauses when the dashboard is closed, hidden, or offline. Refresh remains optional.
See [Spotify setup and troubleshooting](docs/deployment.md#spotify-and-google-calendar-setup).
- Markdown validation, safe static compilation and protected-branch Pages workflows.

Learner code is never compiled, executed, or uploaded. Progress stays in this
browser; export it regularly. OAuth credentials are excluded from backups.

## Checks and authoring

```sh
cd web
npm run typecheck
npm test
npm run docs:check -- --source /absolute/path/to/NeoLearning --working-tree --base HEAD
npm run build
npm run artifact:check
```

The Markdown command checks saved, uncommitted notes against HEAD. CI instead
checks immutable base/head revisions. See the [Markdown guide](docs/markdown-guide.md),
[templates](docs/templates), and [deployment instructions](docs/deployment.md).

## Publishing

Target: [NeoLearning on GitHub Pages](https://neotech-vietnam.github.io/NeoWeb/).
The URL is not a guarantee of a completed deployment. The protected publication
workflow requires a dedicated `neoweb-content` runner and the source-read secret.
Automatic source updates also require the NeoLearning dispatch secret.

See [v1 verification and remaining setup](docs/v1-handoff.md).

# Writing NeoLearning Markdown

Write source notes in NeoLearning; the compiler produces website HTML, styles, links, and navigation. Dashboard topics come only from headings inside the `Learning Resources` section of `Embedded-Engineering-Roadmap.md`. A new note can join an existing topic without adding a dashboard category.

## Check a document before pushing

From NeoWeb's `web` directory, validate a local source checkout:

```sh
npm run docs:check -- --source /absolute/path/to/NeoLearning
```

For changes between two commits, pass immutable commit SHAs:

```sh
npm run docs:check -- --source /absolute/path/to/NeoLearning --base BASE_COMMIT_SHA --head HEAD_COMMIT_SHA
```

The check reports file and line guidance and uses GitHub annotations in Actions. Existing style problems are a baseline; new problems in changed Markdown fail validation. Newly introduced or modified broken links must be fixed before publication.

## Formatting rules

- Give each document exactly one meaningful `# Title`. Continue with `##` and `###` headings without skipping levels.
- Leave a blank line before lists and after headings. Use consistent list indentation; indent nested lists enough to belong to their parent.
- Name every fenced-code language, such as `c`, `cpp`, `sh`, `json`, `text`, or `mermaid`.
- Give every table a header separator row and the same number of cells in each row.
- Use descriptive link labels and image alternative text.
- Match filename, directory, and heading-anchor capitalization exactly. Windows may resolve incorrect path casing locally; the website and validator must not rely on that.
- Use relative links for other repository files. Parent-directory links are valid only when the resolved path remains inside the learning content root.
- Keep secrets, executable scripts, event-handler attributes, and unsafe URLs out of Markdown. Raw HTML is sanitized and cannot run JavaScript.

Example:

```md
# Ring buffers

## Purpose

A ring buffer reuses a fixed-size array.

## Operations

- Write at the tail.
- Read from the head.

| Operation | Cost |
| --- | --- |
| Push | O(1) |
| Pop | O(1) |
```

## Links, images, and related files

Use a link such as `[Queue operations](../Queues/README.md#operations)` after checking that the file and heading exist. The compiler rewrites published Markdown targets and preserves their heading fragments inside the selected snapshot. Repository-root links may begin with `/`; they refer to the learning root, not the host machine.

Keep supporting images beside the note or in a curated image directory and reference them relatively. Use ordinary HTTP(S) links for external sources. Links into excluded vendor archives or unpublished binary files cannot become learning pages.

The file explorer reflects published file paths. The related-files panel combines internal links, backlinks, and explicitly declared relationships. It does not infer that every neighboring file is a prerequisite.

## Optional metadata

Existing notes do not require frontmatter. Use only these keys when overriding inferred metadata:

```yaml
---
title: Ring buffers
summary: Reason about fixed-size queues without dynamic allocation.
kind: note
related: []
prerequisites: []
---
```

Allowed `kind` values are `document`, `note`, `exercise`, and `example`. The optional `topic` must identify an existing roadmap-derived topic; inspect `web/content/topic-map.json` and the generated topic records rather than inventing a new ID. `related` and `prerequisites` contain existing content references. `estimatedMinutes`, when provided, is a positive personal estimate, not a required universal learning duration.

Unknown metadata keys and invalid value types are errors. The title in frontmatter does not replace the document's visible H1.

## Practice notes and staged hints

Keep an algorithm note and its C/C++ repository solutions together. Prefer a shared basename such as `binary_search_note.md`, `binary_search.c`, and `binary_search.cpp`. Ambiguous groups require an explicit exercise mapping.

Use the [exercise template](templates/exercise.md) for progressive hints. The recognized sections are `### Cue Column`, `### Notes Section`, and `## Edge Cases` or `## Common Failure`. Put the unsolved problem before the cue section. Put strategy and complexity in the notes section and traps in the edge-case section.

The practice view opens the problem beside a blank scratchpad. The bulb reveals successive hints and then the repository solution; the diff compares the local attempt with that solution. Notes without the recognized sections open in full beside the editor and use one explicit solution-reveal step. The browser does not compile or execute examples.

Start other documents from the [topic template](templates/topic.md) or [note template](templates/note.md). Replace sample text and verify real links before committing.

# Changelog

## 1.0.0 — 2026-10-23

First stable GitHub release of Pi Session Viewer. Requires Node >=22.19.0 and Pi 1.4.x. MIT licensed; no npm publication.

### Features

- Full-terminal session list and details, project/all scope, search, five-at-a-time expansion, and Project/Recent/Model/Status grouping.
- Native Markdown reply preview, latest reply's corresponding prompt, model/reasoning/project information, and restrained terminal colors.
- Manual rename with `r`, shared local title cache, and best-effort background first-exchange naming using the current configured model with local fallback.
- Separate same-directory and cross-directory resume pages, explicit confirmation, preserved browser state on return, read-only bounded preflight, and task/queue/draft guards.

### Release hardening

- Strip terminal control sequences from historical model/provider/reasoning metadata before rendering, including OSC clipboard/title and cursor/screen escape sequences.
- Preserve literal trailing backslashes in POSIX directory names instead of conflating them with path separators.
- Add Windows/Ubuntu CI on Node 22.19 and 24, strict checks, regression tests, packed-source loader smoke, and isolated Git-source installation smoke.
- Add MIT license, pinned Git installation/update/uninstall instructions, privacy/cost notes, and packed documentation. Keep npm publication disabled.

### Validation boundary

Automated checks do not constitute a real-terminal compatibility guarantee. Native Linux terminals, SSH/tmux, macOS, other Pi versions, and interactive cross-project lifecycle still require manual verification. No multi-process daemon or cross-process running-state/control capability is provided.

## 0.6.0

Independent same/cross-directory resume pages, browser-state preservation, draft/queue guards, bounded read-only preflight, cancellation and lifecycle protections.

## 0.5.0

Project, Recent, Model, and Status grouping with lazy metadata and stable selection.

## 0.4.0

Background model titles with fallback; latest prompt/reply matching; search-on-demand, `r` rename and refined metadata/key styling.

## 0.3.0

Incremental project expansion, local title synchronization, native Markdown and refined keyboard/layout behavior.

## 0.2.0

Full-terminal dark browser redesign.

## 0.1.0

Initial project/all-scope session browser, search, preview and confirmed restore.

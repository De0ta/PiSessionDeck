# Changelog

## 1.0.1 — 2026-10-24

### Added

- Session management: `n` creates a session in the current cwd without a prompt; `f` forks the current saved session natively or creates a strict, read-only snapshot of historical v1/2/3 sessions before switching. Forks preserve the effective branch, reference closure and latest reply, receive a ` · Fork` suffix, and do not inherit pins. Created files remain available for retry if opening fails.
- `p` toggles a separate Pinned section in all four grouping modes, with filtering first, no duplicate entries, newest pins first and five-at-a-time expansion. Pin metadata uses independent SHA-256 records and atomic writes in the agent directory.
- `Delete` permanently removes one non-current session after confirmation, defaulting to Cancel. Identity and revision are rechecked; deletion does not remove projects or dependent forks, stop processes or provide cross-process locking.
- `a` opens the action menu while preserving input-mode text and existing `r` / `d` shortcuts. Unsaved sessions remain visible but cannot be pinned or forked; the current session cannot be deleted. Historical forks are limited to 16 MiB and deletion headers to 1 MiB; unknown formats are safely rejected. See [management boundaries and isolated acceptance](https://github.com/De0ta/PiSessionViewer/blob/main/docs/management.md).

### Fixed

- Strengthen automatic-title instructions and strip labels such as “短会话标题-”, “会话标题:” and “Short session title” with `cleanModelTitle`. Existing titles are unchanged and no extra model request is made.

### Documentation

- Add professional English and Chinese project introductions and update installation and management guidance for v1.0.1.
- Keep local workflow documents ignored and no longer tracked by Git.
- Retain GitHub-only distribution with `private: true`; no npm publication.

### Validation

- Isolated local validation on Windows: 165 tests, 164 passed, 1 skipped because the account lacked symlink privileges; type checks, working-tree package loading and independent review/fix verification passed.
- CI is configured for Windows/Ubuntu × Node 22.19/24. See the [v1.0.1 release](https://github.com/De0ta/PiSessionViewer/releases/tag/v1.0.1) for release-specific CI and installation evidence; the historical v1.0.0 results are recorded separately.
- Real-terminal behavior and full host-runtime switching still require manual acceptance. Validation used temporary state and synthetic sessions, without global installation, real-history changes or paid model actions.

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

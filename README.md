# PiSessionViewer

**English** | [简体中文](README.zh-CN.md)

**A keyboard-first session browser for Pi. Find the right conversation, inspect its context, and resume work in its original project.**

[![CI](https://github.com/De0ta/PiSessionViewer/actions/workflows/ci.yml/badge.svg)](https://github.com/De0ta/PiSessionViewer/actions/workflows/ci.yml)
[![GitHub release](https://img.shields.io/github/v/release/De0ta/PiSessionViewer)](https://github.com/De0ta/PiSessionViewer/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

PiSessionViewer brings a full-screen, project-oriented view of your local Pi conversations into the terminal. Search across sessions, preview the latest exchange, and return to a conversation without leaving Pi.

## Why PiSessionViewer

- **Find conversations across projects.** Group sessions by project, recent activity, model, or status. Search titles, project paths, session IDs, and message text; multiple terms use AND matching.
- **Preview before switching.** A split-pane layout shows session metadata, the latest reply, and its corresponding prompt, with native Pi Markdown rendering. Narrow terminals use a dedicated details view.
- **Stay on the keyboard.** Open from an empty editor with `←`, or use `/session-browser`. Search, navigation, renaming, and help have dedicated controls.
- **Keep titles useful.** New, unnamed conversations receive a local fallback title and can receive a model-generated title after the first successful exchange. Manual names take precedence.
- **Resume deliberately.** A separate confirmation page identifies the destination project. Drafts, running tasks, and queued work block session switches rather than being silently discarded.
- **Keep browsing local.** Browsing, searching, and previews do not call a model or modify session history. Automatic naming is the only model-backed feature; see [Privacy and safety](#privacy-and-safety).

This is a local session browser, not a background agent orchestrator or a live dashboard for other Pi processes.

## Install

Requires **Node.js 22.19.0+**, **Git**, and **Pi 1.4.x** from `@earendil-works/pi-coding-agent`.

```sh
pi install git:github.com/De0ta/PiSessionViewer@v1.0.0
```

Restart Pi, then run:

```text
/session-browser
```

Alternatively, press `←` when the main editor is completely empty. Normal cursor movement is preserved when the editor contains text, whitespace, or newlines, or when autocomplete is active. If another extension owns the custom editor, use the command instead.

Pi loads the TypeScript extension directly: no build step, manual file copying, or separate API key is required. Automatic naming uses your existing Pi model configuration and credentials.

The default personal installation keeps the extension available when changing projects. Avoid `--local` unless you specifically want a project-scoped installation. Do not load an installed copy and `pi -e .` at the same time.

**Distribution:** the stable release is available through GitHub, not npm. A pinned tag does not advance to a new release with `pi update --extensions`; remove the old source and install the new published tag when upgrading. See the [installation, update, and removal guide](https://github.com/De0ta/PiSessionViewer/blob/main/docs/install.md).

## Quick start

1. Open `/session-browser`. Sessions from all projects appear by default.
2. Press `F3` to search, `Tab` to limit results to the current project, or `g` to change grouping.
3. Select a conversation with `↑` / `↓` and inspect its latest exchange in the details pane.
4. Press `Enter` or `→` to open the resume confirmation page.
5. Confirm the destination. Pi switches to the session and its project runtime.

Press `Esc` to return without resuming. Returning from the confirmation page preserves your search, grouping, expanded groups, selection, and details scroll position.

### Grouping and previews

Each group initially shows five sessions; `Show more` reveals five more. Recent activity uses six non-overlapping intervals: under 5 hours, 5 hours–1 day, 1–7 days, 7–30 days, 30–90 days, and 90 days or more. Model groups use provider and model ID.

Previews follow the active branch and honor committed context edits. They show the latest reply and its corresponding prompt, or the latest prompt when no reply exists. Thinking and tool results are not displayed.

Only the current Pi process has observed runtime status. Other sessions are labeled `Saved`, which does **not** mean that another process has stopped using them.

## Session management · unreleased

The `main` branch includes the following enhancements. **They are not part of the published `v1.0.0` release.**

| Key | Action |
| --- | --- |
| `n` | Create an empty session in the current working directory; no prompt is sent. |
| `f` | Fork the selected conversation's effective branch, including its latest reply, and open the copy. |
| `p` | Pin or unpin a saved session in a separate `Pinned` section across all four grouping modes. |
| `Delete` | Open a confirmation dialog to permanently delete one non-current session file. |
| `a` | Open the action menu: New, Fork, Pin / Unpin, Rename, and Delete. |

These controls do not intercept letters while searching or renaming. An unsaved current session remains visible as `Unsaved` and cannot be pinned or forked. The current session cannot be deleted.

Forks receive an independent identity and a ` · Fork` title suffix; they do not inherit pins. Forking a historical session reads a validated snapshot without first resuming or rewriting the source. If the copy is created but cannot be opened, it is retained; retrying on the same confirmation page reuses that copy.

Deletion defaults to **Cancel**. Number keys change the selection; only `Enter` submits. Deletion affects one session file, not its project, forks, or other running processes. Pins and historical title aliases are stored separately from session history.

The enhancements have passed type checking, isolated tests, package-loading checks, and independent code review. **Real-terminal interaction and complete host runtime switching still require manual acceptance testing.** Implementation constraints and the acceptance checklist are documented in [Session management](https://github.com/De0ta/PiSessionViewer/blob/main/docs/management.md).

## Keyboard reference

The table below describes the published `v1.0.0` browser. Additional development-branch controls are listed above.

| Key | Action |
| --- | --- |
| `↑` / `↓` | Select a session; respects Pi's configured list-navigation bindings. |
| `PageUp` / `PageDown` | Move the selection by a page. |
| `Enter` / `→` | Open resume confirmation, return to the current session, or expand `Show more`. |
| `Tab` / `Shift+Tab` | Switch between all projects and the current project; `Ctrl+O` is also supported. |
| `F3` | Show or hide search. |
| `g` | Cycle Project → Recent → Model → Status. |
| `r` | Rename the selected session; `Enter` saves and `Esc` cancels. |
| `Shift+↑` / `Shift+↓` | Scroll the latest reply while keeping the prompt and metadata visible. |
| `d` / `←` | Open details / return to the list on narrow terminals. |
| `Ctrl+R` | Rescan sessions. |
| `?` | Open shortcut help. |
| `Esc` | Leave help or search; otherwise close the browser. |
| `Ctrl+C` | Close the browser without switching sessions. |

Search and rename modes retain normal text input and cursor movement rather than triggering letter shortcuts.

On the resume page, use `↑` / `↓` or `1` / `2` to select, `Enter` / `→` to confirm, and `Esc` / `Ctrl+C` to return. `PageUp` / `PageDown` scroll long paths or errors. Read-only preflight can be cancelled; once the switch is submitted to Pi, the public API cannot cancel it and the page waits for completion.

## Privacy and safety

### Local history

Browsing and previews read local files without uploading session history or contacting an author-operated service. Historical renames write extension-specific aliases; renaming the current session uses Pi's native name metadata. An alias is applied as a native name when that session is resumed.

Previews limit each displayed prompt and reply to 6,000 characters. Files over 16 MiB are skipped for preview and model-metadata reads, but can still be resumed. Pi's discovery API still scans history to build its search index; use the current-project filter for large collections.

### Automatic titles

After the first successful exchange, an eligible unnamed session receives a local fallback title, followed by at most one extra request to your configured model. The request includes up to 4,000 characters of the first prompt and 2,000 characters of its final text reply, after committed context edits and wrapper removal. It excludes thinking, tool results, and images.

The request has a 256-token output limit and a 15-second timeout. It may incur provider charges, and its usage is not automatically included in Pi's main conversation statistics. Failure leaves the fallback title in place without automatic retries. Existing names and manual renames are not overwritten; older conversations are not renamed in bulk. The development branch also removes generic title-label prefixes from new model results.

### Switching and destructive operations

Resuming replaces the current session and project runtime. Pi 1.4's public API does not support resuming another project's session while retaining the current project directory. Preflight validates the target's identity, revision, and accessible project directory; it does not repair paths or create missing projects.

There is no cross-process lock. Check that another Pi instance is not writing to a session before resuming or deleting it. Revision checks reduce risk but cannot eliminate filesystem races. Native Pi resume may migrate older session formats; browsing and preflight do not.

The extension does not provide background execution, remote connections, cross-process stop controls, archives, a recycle bin, or worktree management.

## Compatibility

| Environment | Validation scope |
| --- | --- |
| Windows and Ubuntu; Node 22.19 and 24 | The published v1.0 release passed the four-job CI matrix, 97 tests, package-loading checks, and Git-install smoke checks. |
| Management enhancements on Windows; Node 24 / Pi 1.4.0 | 164 tests passed; one symlink test was skipped because of Windows permissions. Type checking and isolated package loading passed. |
| Interactive terminals, SSH, and tmux | Full manual end-to-end acceptance remains outstanding. |
| macOS and Pi versions outside 1.4.x | Not validated. |

The historical release results do not establish platform coverage for the unreleased enhancements. Linux uses native POSIX paths; Windows project paths are not automatically translated to Linux or WSL paths. Legacy `@mariozechner/*` packages and other Pi forks are outside the compatibility commitment.

## Development

```sh
git clone https://github.com/De0ta/PiSessionViewer.git
cd PiSessionViewer
npm ci
npm run check
npm test
npm run smoke:package
npm run smoke:install
```

For an interactive source trial in a disposable project, use `pi -e /absolute/path/to/PiSessionViewer`. Do not simultaneously enable an installed copy.

Tests use temporary directories, synthetic sessions, and model substitutes. `smoke:package` checks the current working tree with the real Pi extension loader in isolation. The default Git-install smoke checks committed `HEAD` using a local transport redirect; it does not verify uncommitted changes or GitHub availability. To check a public release anonymously:

```sh
npm run smoke:install -- --public --ref v1.0.0
```

These checks do not attach to a live terminal, call a paid model, modify real session history, or install into your personal Pi configuration. Loader checks and controlled host substitutes are not a substitute for full runtime acceptance tests.

## Documentation and support

- [Installation, updates, removal, and troubleshooting](https://github.com/De0ta/PiSessionViewer/blob/main/docs/install.md)
- [Session management: implementation boundaries and manual acceptance](https://github.com/De0ta/PiSessionViewer/blob/main/docs/management.md)
- [Changelog](CHANGELOG.md)
- [v1.0 release validation](https://github.com/De0ta/PiSessionViewer/blob/main/docs/release-v1.0.md)
- [Project status and design records](https://github.com/De0ta/PiSessionViewer/blob/main/workflow/README.md)
- [Report an issue](https://github.com/De0ta/PiSessionViewer/issues)

When reporting a problem, include your OS, terminal, Node/Pi versions, and reproduction steps. Redact screenshots and logs; do not attach credentials or full private session files.

## License

[MIT](LICENSE). Session history, credentials, personal Pi configuration, and reference screenshots are not included in the distribution.

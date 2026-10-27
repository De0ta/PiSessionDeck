# PiSessionDeck

**English** | [简体中文](README.zh-CN.md)

**A keyboard-first session browser for Pi. Find the right conversation, inspect its context, and resume work in its original project.**

[![CI](https://github.com/De0ta/PiSessionDeck/actions/workflows/ci.yml/badge.svg)](https://github.com/De0ta/PiSessionDeck/actions/workflows/ci.yml)
[![GitHub release](https://img.shields.io/github/v/release/De0ta/PiSessionDeck)](https://github.com/De0ta/PiSessionDeck/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

PiSessionDeck brings a full-screen, project-oriented view of your local Pi conversations into the terminal. Search across sessions, preview the latest exchange, and return to a conversation without leaving Pi.

## Why PiSessionDeck

- **Find conversations across projects.** Group sessions by project, recent activity, model, or status. Search titles, project paths, session IDs, and message text; multiple terms use AND matching.
- **Preview before switching.** A split-pane layout shows session metadata, the latest reply, and its corresponding prompt, with native Pi Markdown rendering. Narrow terminals use a dedicated details view.
- **Stay on the keyboard.** Open from an empty editor with `←`, or use `/session-browser`. Search, navigation, renaming, and help have dedicated controls.
- **Organize your work.** Create conversations, fork a branch to explore another approach, pin frequently used sessions, and remove histories you no longer need.
- **Keep titles useful.** New, unnamed conversations receive a local fallback title and can receive a model-generated title after the first successful exchange. Manual names take precedence.
- **Continue in the right project.** A confirmation page identifies the destination project, with draft and task checks before switching.
- **Browse locally.** Search and previews use local session files. Automatic naming uses your configured Pi model; see [Data and model usage](#data-and-model-usage).

## Typical workflows

- **Pick up unfinished work.** Find a project or topic, review the latest exchange, and resume in the conversation's original project. This is useful when moving between repositories or returning after a break.
- **Explore an alternative without losing the original.** Select a conversation and press `f` to copy its effective branch into an independent session. Continue from the latest reply while keeping the source available for comparison.
- **Keep recurring work close at hand.** Give a session a recognizable title with `r`, then pin it with `p`. The `Pinned` section stays separate from the regular groups as you change how the list is organized.
- **Clean up completed work.** Preview a saved conversation before deleting it. The confirmation dialog identifies the session; its project directory and forked conversations remain in place.

## Install

Requires **Node.js 22.19.0+** and **Pi 1.4.x** from `@earendil-works/pi-coding-agent`.

```sh
pi install npm:@link17528/pi-session-deck
```

For a pinned version, use `npm:@link17528/pi-session-deck@1.0.3`. Git installation is also available and requires **Git**:

```sh
pi install git:github.com/De0ta/PiSessionDeck@v1.0.3
```

Restart Pi, then run:

```text
/session-browser
```

Alternatively, press `←` when the main editor is completely empty. Normal cursor movement is preserved when the editor contains text, whitespace, or newlines, or when autocomplete is active. If another extension owns the custom editor, use the command instead.

Pi loads the TypeScript extension directly: no build step, manual file copying, or separate API key is required. Automatic naming uses your existing Pi model configuration and credentials.

The default personal installation keeps the extension available when changing projects. Avoid `--local` unless you specifically want a project-scoped installation. Do not load an installed copy and `pi -e .` at the same time.

**Updates:** the unversioned npm source follows new releases with `pi update --extensions`. Explicit npm versions, Git tags, and commits stay pinned; remove the old source and install the desired version when upgrading. Keep only one installation source. See the [installation, update, and removal guide](https://github.com/De0ta/PiSessionDeck/blob/main/docs/install.md).

## Quick start

1. Open `/session-browser`. Sessions from all projects appear by default.
2. Press `F3` to search, `Tab` to limit results to the current project, or `g` to change grouping.
3. Select a conversation with `↑` / `↓` and inspect its latest exchange in the details pane.
4. Press `Enter` or `→` to open the resume confirmation page.
5. Confirm the destination. Pi switches to the session and its project runtime.

Press `Esc` to return without resuming. Returning from the confirmation page preserves your search, grouping, expanded groups, selection, and details scroll position.

### Interface layout

| Area | What it shows |
| --- | --- |
| Header | The current grouping mode, project scope, and number of matching sessions. |
| Session list | Grouped conversations, their titles, status, and last-update information. |
| Details pane | Metadata for the selected conversation, its latest reply, and the corresponding prompt. |
| Shortcut help | Press `?` to see the available navigation and management controls. |

Wide terminals show the list and details side by side. On narrow terminals, select a session and press `d` to open its details, then `←` to return. Use `Shift+↑` / `Shift+↓` to scroll a long reply.

### Theme and terminal colors

The canvas keeps the terminal's default background. Text, selection, search, confirmation panels, and session identity colors use Pi's active theme, including live theme changes. There is no fixed black background or terminal-specific configuration reader.

For terminal-matched colors (such as Catppuccin Mocha in Ghostty or Windows Terminal), select **system** under `/settings` → **Theme**. Pi queries the terminal's foreground, background, and ANSI palette; if a terminal does not report colors, Pi falls back to ANSI/default colors. Custom Pi themes are respected too.

### Grouping and previews

Press `g` to cycle through four views:

| View | Useful for |
| --- | --- |
| Project | Returning to conversations associated with the same working directory. |
| Recent | Finding work by how recently the conversation was updated. |
| Model | Reviewing conversations by provider and model ID. |
| Status | Separating the current session's runtime state from saved history. |

Each group initially shows five sessions; `Show more` reveals five more. Recent activity uses six non-overlapping intervals: under 5 hours, 5 hours–1 day, 1–7 days, 7–30 days, 30–90 days, and 90 days or more. Pinned sessions appear in their own section and still respect the current scope and search.

Previews follow the active branch and honor committed context edits. They show the latest reply and its corresponding prompt, or the latest prompt when no reply exists. Thinking and tool results are not displayed.

Runtime status is available for the current Pi process. Other sessions are labeled `Saved` to identify them as stored history.

### Finding a conversation

Press `F3` and enter a topic, project-path fragment, session ID, or text from the conversation. Search is case-insensitive, and all whitespace-separated terms must match. For example, `login api` narrows the list to sessions matching both terms. Press `Tab` to search only the current project, or switch back to all projects.

Search and grouping work together. Returning from a resume confirmation page keeps the query, selection, expanded groups, and preview scroll position, so you can inspect several candidates without starting over.

## Session management

Create, fork, pin, rename, and delete conversations directly from the browser.

| Key | Action |
| --- | --- |
| `n` | Create an empty session in the selected conversation's project directory; use the current directory if nothing is selected. No prompt is sent. |
| `f` | Fork the selected conversation's effective branch, including its latest reply, and open the copy. |
| `p` | Pin or unpin a saved session in a separate `Pinned` section across all four grouping modes. |
| `Delete` | Open a confirmation dialog to permanently delete one non-current session file. |
| `a` | Open the action menu: New, Fork, Pin / Unpin, Rename, and Delete. |

These controls do not intercept letters while searching or renaming. An unsaved current session remains visible as `Unsaved` and cannot be pinned or forked. The current session cannot be deleted.

New uses Pi's native New action within the current project. For another project, it creates a new file containing only a native session header, then switches to it. A selected conversation with a missing or invalid project directory is rejected without falling back to the current directory. New sends no prompt and copies no history; if opening a prepared file fails or is cancelled, retrying on the same confirmation page reuses it.

Forks receive an independent identity and a ` · Fork` title suffix; they do not inherit pins. Forking a historical session reads a validated snapshot without first resuming or rewriting the source. If the copy is created but cannot be opened, it is retained; retrying on the same confirmation page reuses that copy.

Deletion defaults to **Cancel**. Number keys change the selection; only `Enter` submits. Deletion affects one session file, not its project, forks, or other running processes. Pins and historical title aliases are stored separately from session history.

For file formats, storage limits, and operation details, see [Session management](https://github.com/De0ta/PiSessionDeck/blob/main/docs/management.md).

## Keyboard reference

The table below covers browser navigation. Session-management controls are listed above.

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

## Data and model usage

### Local history

Browsing, search, and previews run locally and read your Pi session files. Historical renames write extension-specific aliases; renaming the current session uses Pi's native name metadata. An alias is applied as a native name when that session is resumed.

Previews limit each displayed prompt and reply to 6,000 characters. Files over 16 MiB are skipped for preview and model-metadata reads, but can still be resumed. Pi's discovery API still scans history to build its search index; use the current-project filter for large collections.

### Automatic titles

After the first successful exchange, an eligible unnamed session receives a local fallback title, followed by at most one extra request to your configured model. The request includes up to 4,000 characters of the first prompt and 2,000 characters of its final text reply, after committed context edits and wrapper removal. It excludes thinking, tool results, and images.

The request has a 256-token output limit and a 15-second timeout. It may incur provider charges, and its usage is not automatically included in Pi's main conversation statistics. Failure leaves the fallback title in place without automatic retries. Existing names and manual renames are not overwritten; older conversations are not renamed in bulk. Generic title-label prefixes are removed from model-generated titles.

### Session switching and deletion

Resuming switches both the conversation and its project runtime. The target project must exist and be accessible. Before switching, the browser checks the session's identity and file revision. Pi may migrate older session formats when opening them.

Before resuming or deleting a session, close other Pi instances that are writing to it. Deletion permanently removes the selected session file; its project and forked conversations are kept.

## Compatibility

PiSessionDeck targets **Pi 1.4.x** and **Node.js 22.19.0+**.

| Check | Coverage |
| --- | --- |
| CI matrix | Windows and Ubuntu × Node 22.19 and 24. |
| Local regression suite | Windows / Node 24: 188 tests, 187 passed; one symlink test skipped because of account permissions. |
| Local package checks | Type checking passed; the 21-file package passed isolated Pi extension loading. |

Linux uses native POSIX paths. Use the project path for the environment running Pi; Windows paths are not automatically translated to Linux or WSL paths. Release-specific results are linked from the [GitHub releases](https://github.com/De0ta/PiSessionDeck/releases).

## Development

```sh
git clone https://github.com/De0ta/PiSessionDeck.git PiSessionDeck
cd PiSessionDeck
npm ci
npm run check
npm test
npm run smoke:package
npm run smoke:install
```

To run the source directly, use `pi -e /absolute/path/to/PiSessionDeck` with the installed copy disabled.

Tests use temporary session fixtures. `smoke:package` checks the working tree with Pi's extension loader; `smoke:install` verifies installation from committed `HEAD`. To check a public release anonymously:

```sh
npm run smoke:install -- --public --ref v1.0.3
```

## Documentation and support

- [Installation, updates, removal, and troubleshooting](https://github.com/De0ta/PiSessionDeck/blob/main/docs/install.md)
- [Session management and storage details](https://github.com/De0ta/PiSessionDeck/blob/main/docs/management.md)
- [Changelog](CHANGELOG.md)
- [Technical documentation and design records](https://github.com/De0ta/PiSessionDeck/tree/main/docs)
- [Report an issue](https://github.com/De0ta/PiSessionDeck/issues)

When reporting a problem, include your OS, terminal, Node/Pi versions, and reproduction steps. Redact screenshots and logs; do not attach credentials or full private session files.

## License

[MIT](LICENSE).

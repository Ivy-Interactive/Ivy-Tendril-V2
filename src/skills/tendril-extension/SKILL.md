---
name: tendril-extension
description: >-
  Build, test, package, install, verify, and debug the Ivy Tendril extension across the VS Code
  family: VS Code, VS Code Insiders, VSCodium, Cursor, Windsurf, Antigravity IDE, Trae, Positron,
  Kiro and friends. Use when the user asks to install, link, update, build, test, package, or
  troubleshoot the Ivy Tendril extension in any VS Code-based IDE.
---

# Ivy Tendril Extension Skill

The extension lives at `src/extensions/vscode` and is a single VSIX-shaped package that has to
install and activate in every VS Code-derived IDE, not only VS Code. All the tooling in this skill
is generic over the family; nothing is Antigravity-specific any more.

## Directory & Environment

- **Extension directory**: `src/extensions/vscode`
- **Installed directory name**: `<publisher>.<name>-<version>`, e.g. `ivy-interactive.ivy-tendril-0.1.0`
- **Package manager**: `pnpm` (exact versions, via `.npmrc`)
- **Scripts**: `src/skills/tendril-extension/scripts/`

| Script | Purpose |
| --- | --- |
| `list-ides.sh` | Which IDEs are present, their Code OSS version, and whether they clear the engine floor |
| `install-extension.sh` | Install into one IDE, several, or all detected ones |
| `uninstall-extension.sh` | Remove and deregister |
| `package-vsix.sh` | Validate the manifest, build, and produce a `.vsix` |
| `check-manifest.ts` | Standalone manifest compatibility check |
| `verify.ts` | Verify the manifest, the bundle, and the install in a chosen IDE |
| `ide-registry.sh` | Shared IDE table + detection helpers (sourced, not run) |
| `install-antigravity.sh`, `uninstall-antigravity.sh` | Thin shims kept for older references |
| `package.ts` | Thin Node wrapper over `package-vsix.sh` |

### Environment overrides

Every script accepts these, which is also how you test without touching a real IDE:

| Variable | Flag | Meaning |
| --- | --- | --- |
| `TENDRIL_IDE_HOME` | `--home` | Base directory searched instead of `$HOME` |
| `TENDRIL_EXTENSIONS_DIR` | `--extensions-dir` | Exact extensions directory; skips detection |
| `TENDRIL_EXTENSION_DIR` | – | Path to `src/extensions/vscode` |
| `TENDRIL_IDE` | `--ide` | Default target IDE id |

When the target is not the IDE's default location, the scripts pass `--extensions-dir` and
`--user-data-dir` to the IDE CLI, so a test run never reads or writes the developer's real profile.

---

## The engine floor

`engines.vscode` is the single field that decides whether the extension installs anywhere. It is
**`^1.90.0`**, and it is set from the APIs the code actually uses rather than from the newest VS
Code available:

| API used by `src/**` | Introduced |
| --- | --- |
| `vscode.chat.createChatParticipant`, `ChatRequest`, `ChatContext`, `ChatResponseStream`, `ChatRequestHandler`, and the `contributes.chatParticipants` point | **1.90.0** (chat participants finalised) |
| `vscode.ThemeIcon(id, ThemeColor)` (two-argument form) | 1.51.0 |
| `vscode.Uri.joinPath` | 1.45.0 |
| `vscode.window.onDidChangeActiveColorTheme`, `window.activeColorTheme` | 1.43.0 |
| `vscode.env.asExternalUri` | 1.40.0 |
| `webview.cspSource`, `asWebviewUri` | 1.39.0 |
| `activationEvents: ["onStartupFinished"]` | 1.36.0 |
| everything else (`commands`, `views`, `viewsContainers`, `TreeDataProvider`, `StatusBarItem`, `withProgress`, `workspace.updateWorkspaceFolders`) | ≤ 1.24.0 |

So chat participants set the floor, and nothing else comes close: drop the chat participant and the
floor would fall to about 1.51. `devDependencies["@types/vscode"]` is pinned to the **same** `1.90.0`
so the compiler cannot reference an API the floor does not guarantee — `check-manifest.ts` fails the
build if those two ever diverge.

Raising the floor to track the newest VS Code is the bug to avoid. See the worked example below.

---

## Workflows

### 1. See what is installed

```bash
src/skills/tendril-extension/scripts/list-ides.sh          # detected IDEs
src/skills/tendril-extension/scripts/list-ides.sh --all    # the whole registry
```

`ENGINE ok` means that IDE's Code OSS version clears the manifest floor. `TOO OLD` means a VSIX
install will be rejected and you need the symlink method or a lower floor.

### 2. Install (symlink — the default, best for development)

```bash
# the sole detected IDE
src/skills/tendril-extension/scripts/install-extension.sh

# a specific one
src/skills/tendril-extension/scripts/install-extension.sh --ide cursor

# first of a preference list that is actually installed
src/skills/tendril-extension/scripts/install-extension.sh --ide antigravity-ide,antigravity

# every detected IDE at once
src/skills/tendril-extension/scripts/install-extension.sh --all

# an IDE the registry does not know
src/skills/tendril-extension/scripts/install-extension.sh --extensions-dir ~/.someide/extensions
```

This builds the bundle, symlinks the checkout into the IDE's extensions directory, and registers it
in that directory's `extensions.json`. Then reload the window: `Cmd+Shift+P` → **Developer: Reload
Window**.

> [!IMPORTANT]
> The symlink on its own is not enough. Every modern VS Code fork treats
> `<extensions dir>/extensions.json` as the authoritative index and **ignores any directory that is
> not listed there**; it only rescans the folder when that file is absent. Verified on VS Code
> 1.137.0 and Antigravity IDE 1.107.0. `install-extension.sh` upserts the entry (preserving the
> metadata of every other extension), which is exactly the step a hand-rolled `ln -s` misses.

Equivalent by hand, for reference:

```bash
cd src/extensions/vscode
pnpm install && pnpm run build
ln -sfn "$(pwd)" ~/.cursor/extensions/ivy-interactive.ivy-tendril-0.1.0
# ...and then add the entry to ~/.cursor/extensions/extensions.json, or the IDE will not see it.
```

### 3. Install (VSIX — best for distribution)

```bash
src/skills/tendril-extension/scripts/package-vsix.sh --out /tmp/tendril.vsix
src/skills/tendril-extension/scripts/install-extension.sh --ide vscode --vsix /tmp/tendril.vsix
```

Or in one step: `install-extension.sh --ide vscode --method vsix`.

Before shelling out, the script compares the IDE's Code OSS version with the manifest floor and
refuses with an explanation rather than letting the CLI produce its own opaque error.

### 4. Package

```bash
src/skills/tendril-extension/scripts/package-vsix.sh              # <extension>/<slug>.vsix
src/skills/tendril-extension/scripts/package-vsix.sh --out <path>
pnpm tsx src/skills/tendril-extension/scripts/package.ts          # same thing from Node
```

The manifest is checked first, then the bundle is built, then the **workspace-local**
`@vscode/vsce` runs — packaging therefore works with no network. `vsce` refuses to package a
manifest with `main` but no `activationEvents`, and refuses to package without a `repository`
field; both are already satisfied.

Publishing is **not** automated: `vsce publish` needs a Marketplace PAT and `ovsx publish` needs an
Open VSX token, both over the network. `ovsx` is not a dependency of this repo, so publishing to
Open VSX would require installing it first.

### 5. Verify

```bash
pnpm tsx src/skills/tendril-extension/scripts/verify.ts                  # manifest + bundle
pnpm tsx src/skills/tendril-extension/scripts/verify.ts --ide cursor     # + that install
pnpm tsx src/skills/tendril-extension/scripts/verify.ts --all            # + every detected IDE
pnpm tsx src/skills/tendril-extension/scripts/verify.ts --all --typecheck
```

Per target it confirms: the directory exists, it is a link to this checkout (or a real install), it
carries a built bundle, it is registered in `extensions.json`, the IDE's version clears the floor,
and — when a CLI is available — that `--list-extensions` reports it.

`--tests` additionally runs the extension test suite. `@vscode/test-electron` **downloads a VS Code
build on first run**, so that flag needs network access and is off by default.

### 6. Uninstall

```bash
src/skills/tendril-extension/scripts/uninstall-extension.sh --ide cursor
src/skills/tendril-extension/scripts/uninstall-extension.sh --all
src/skills/tendril-extension/scripts/uninstall-extension.sh --all --all-versions
```

Symlinks are unlinked rather than followed, so the checkout is never at risk. A dangling
`extensions.json` entry is cleaned up even when the directory is already gone.

### 7. Test without touching a real IDE

```bash
FAKE=$(mktemp -d)
mkdir -p "$FAKE/.cursor/extensions" && printf '[]' > "$FAKE/.cursor/extensions/extensions.json"

src/skills/tendril-extension/scripts/list-ides.sh --home "$FAKE"
src/skills/tendril-extension/scripts/install-extension.sh --home "$FAKE" --all --no-build
pnpm tsx src/skills/tendril-extension/scripts/verify.ts --home "$FAKE" --all
src/skills/tendril-extension/scripts/uninstall-extension.sh --home "$FAKE" --all
```

---

## Worked example: the Antigravity engine pin

Antigravity IDE runs Code OSS **1.107.0** while VS Code on the same machine is **1.137.0**. Pinning
`engines.vscode` to the newest VS Code breaks Antigravity — reproduced exactly:

```
$ antigravity-ide --install-extension high-engine.vsix     # engines.vscode: ^1.137.0
Error: Unable to install extension 'ivy-interactive.ivy-tendril' as it is not compatible with the IDE '1.107.0'.
Failed Installing Extensions: .../high-engine.vsix
```

With `^1.90.0` the same VSIX installs on both:

```
$ antigravity-ide --install-extension tendril.vsix
Extension 'tendril.vsix' was successfully installed.
```

The symlink method sidesteps the CLI validator entirely — a symlinked extension is listed even when
its engine floor is above the IDE's version — but the extension host still applies the version check
at activation, so a too-high floor is a real bug rather than something to route around. Keep the
floor at what the APIs need.

Details, plus the full per-IDE table, are in `references/`:

- `references/ide-matrix.md` — data folders, CLI names, detection, and what was verified where
- `references/antigravity-integration.md` — the Antigravity worked example in full

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Extension directory is present but nothing loads and no commands appear | Missing `extensions.json` entry | Re-run `install-extension.sh` |
| `not compatible with the IDE '<version>'` | `engines.vscode` floor above the IDE's Code OSS version | Lower the floor if the APIs allow, else `--method symlink` |
| `@tendril` never appears in chat | `contributes.chatParticipants[]` used a proposal-gated property (`isDefault`, `modes`, `locations`); VS Code logs `CANNOT use API proposal` and skips the entry | Remove the property; `check-manifest.ts` catches this |
| Chat works in VS Code but not in a fork | The fork has no `vscode.chat` API | Expected: `registerChatParticipant` already no-ops when the API is absent; everything else still works |
| `--list-extensions` shows nothing after installing to a temp dir | The CLI read the real profile | Pass `--extensions-dir` (the scripts do this automatically when `--home`/`--extensions-dir` is set) |
| Symlink points at the wrong checkout | Stale link from an earlier clone | `uninstall-extension.sh --all --all-versions`, then reinstall |

# Antigravity IDE integration: the engine-pin worked example

Antigravity IDE is the sharpest case in the VS Code family for the Ivy Tendril extension, because it
runs an older Code OSS than the VS Code sitting next to it on the same machine. It is kept here as
the worked example behind the general procedure in `../SKILL.md`; nothing in the tooling is
Antigravity-specific.

## Architecture

Antigravity IDE is built on Code OSS with added AI/agentic features, so:

- extensions live in `~/.antigravity-ide/extensions`, named `<publisher>.<name>-<version>`;
- the CLI is `antigravity-ide`, installed per-user at
  `~/.antigravity-ide/antigravity-ide/bin/antigravity-ide` rather than on `PATH`;
- the VS Code CLI flags all carry over: `--install-extension`, `--uninstall-extension`,
  `--list-extensions`, `--extensions-dir`, `--user-data-dir`.

`/Applications/Antigravity IDE.app/Contents/Resources/app/package.json` reports:

```
Antigravity IDE 1.107.0
```

There is also a separate `~/.antigravity` data folder on this machine — a VS Code-family extensions
directory from an earlier build, with its own `argv.json` and `extensions.json`. The registry keeps
it as the `antigravity` id, and `install-antigravity.sh` targets `antigravity-ide,antigravity` so the
current folder wins when both exist. Note that `/Applications/Antigravity.app` is *not* this IDE: it
is an unrelated electron-builder app that would otherwise be mistaken for it (see
`ide-matrix.md`).

## The engine pin, reproduced

VS Code on this machine is **1.137.0**; Antigravity IDE is **1.107.0**. Pin `engines.vscode` to the
newer one and Antigravity's CLI validator refuses the VSIX:

```console
$ antigravity-ide --extensions-dir "$TMP/ext" --user-data-dir "$TMP/udd" \
    --install-extension high-engine.vsix        # engines.vscode: ^1.137.0
Installing extensions...
Error: Unable to install extension 'ivy-interactive.ivy-tendril' as it is not compatible with the IDE '1.107.0'.
Failed Installing Extensions: .../high-engine.vsix
```

With the floor at the value the APIs actually need, `^1.90.0`, the same VSIX installs on both IDEs:

```console
$ antigravity-ide --extensions-dir "$TMP/ext" --user-data-dir "$TMP/udd" \
    --install-extension tendril.vsix
Installing extensions...
Extension 'tendril.vsix' was successfully installed.

$ code --extensions-dir "$TMP/ext2" --user-data-dir "$TMP/udd2" \
    --install-extension tendril.vsix
Installing extensions...
Extension 'tendril.vsix' was successfully installed.
```

`install-extension.sh` performs this comparison itself before invoking any CLI, so the failure
arrives as an explanation rather than as the IDE's message.

## The symlink method, and its real caveat

Symlinking into the extensions directory does bypass the CLI's version validator — a symlinked
extension whose engine floor is *above* the IDE's version is still listed:

```console
$ ln -sfn "$PWD/src/extensions/vscode" "$TMP/ext3/ivy-interactive.ivy-tendril-0.1.0"
$ antigravity-ide --extensions-dir "$TMP/ext3" --list-extensions --show-versions
ivy-interactive.ivy-tendril@0.1.0
```

Two things to be clear about:

1. **Listing is not activating.** The extension host applies its own version check when loading, so
   a floor above the IDE's version remains a bug. The symlink is for live development against a
   compatible floor, not a way to ship an incompatible manifest.

2. **The symlink alone is not enough.** `~/.antigravity-ide/extensions/extensions.json` is the
   authoritative index. With a populated index that does not name the extension, it is invisible:

   ```console
   $ cat "$TMP/ext/extensions.json"
   [{"identifier":{"id":"someone.other"}, ...}]
   $ ls "$TMP/ext"
   extensions.json   ivy-interactive.ivy-tendril-0.1.0
   $ antigravity-ide --extensions-dir "$TMP/ext" --list-extensions
   someone.other
   ```

   Remove `extensions.json` and the folder is rescanned and the link found — but deleting it would
   discard every other extension's metadata, so `install-extension.sh` upserts the entry instead.
   The same behaviour was confirmed on VS Code 1.137.0, so this is family-wide rather than an
   Antigravity quirk.

## Commands the extension contributes

`tendril.openDashboard`, `tendril.openInBrowser`, `tendril.openWorktree`, `tendril.startServer`,
`tendril.stopServer`, `tendril.restartServer`, `tendril.addCurrentProject`, `tendril.createPlan`,
`tendril.executePlan`, `tendril.checkJobStatus`, `tendril.retryPlan`, plus the `@tendril` chat
participant with `/plan`, `/run`, `/status` and `/retry`.

The chat participant requires the `vscode.chat` API (Code OSS 1.90+). `registerChatParticipant`
checks for it at runtime and no-ops when it is absent, so on a fork that has removed chat the rest of
the extension still works.

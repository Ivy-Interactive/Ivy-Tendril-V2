# VS Code-family IDE matrix

Reference for `scripts/ide-registry.sh`. Each row is one entry in
`TENDRIL_IDE_REGISTRY`.

## Registry

| id | IDE | Data folder (under `$HOME`) | CLI candidates | macOS app bundle |
| --- | --- | --- | --- | --- |
| `vscode` | Visual Studio Code | `.vscode` | `code` | `Visual Studio Code.app` |
| `vscode-insiders` | VS Code Insiders | `.vscode-insiders` | `code-insiders` | `Visual Studio Code - Insiders.app` |
| `vscode-exploration` | VS Code Exploration | `.vscode-exploration` | `code-exploration` | `Visual Studio Code - Exploration.app` |
| `vscodium` | VSCodium | `.vscode-oss` | `codium`, `vscodium` | `VSCodium.app` |
| `vscodium-insiders` | VSCodium Insiders | `.vscode-oss-insiders` | `codium-insiders` | `VSCodium - Insiders.app` |
| `cursor` | Cursor | `.cursor` | `cursor` | `Cursor.app` |
| `windsurf` | Windsurf | `.windsurf` | `windsurf` | `Windsurf.app` |
| `windsurf-next` | Windsurf Next | `.windsurf-next` | `windsurf-next` | `Windsurf - Next.app` |
| `antigravity-ide` | Antigravity IDE | `.antigravity-ide` | `antigravity-ide` | `Antigravity IDE.app` |
| `antigravity` | Antigravity (legacy) | `.antigravity` | `antigravity` | – |
| `trae` | Trae | `.trae` | `trae` | `Trae.app` |
| `trae-cn` | Trae CN | `.trae-cn` | `trae-cn` | `Trae CN.app` |
| `positron` | Positron | `.positron` | `positron` | `Positron.app` |
| `kiro` | Kiro | `.kiro` | `kiro` | `Kiro.app` |
| `void` | Void | `.void-editor` | `void` | `Void.app` |
| `openvscode-server` | OpenVSCode Server | `.openvscode-server` | `openvscode-server` | – |
| `code-server` | code-server | `.local/share/code-server` | `code-server` | – |

## How detection works

An IDE counts as installed when **any** of these holds, checked in order:

1. Its extensions directory exists (`<home>/<data folder>/extensions`). This is the signal that
   matters for the symlink method, so it comes first.
2. A CLI is found, looked up in this order:
   - on `PATH`;
   - `<home>/<data folder>/<cli>/bin/<cli>` — the per-user layout Antigravity IDE uses
     (`~/.antigravity-ide/antigravity-ide/bin/antigravity-ide`);
   - `/Applications/<App>/Contents/Resources/app/bin/<cli>` and the same under `~/Applications`;
   - `/usr/share/<cli>/bin/<cli>`, `/opt/<cli>/bin/<cli>`, `/usr/lib/<cli>/bin/<cli>`.
3. A macOS app bundle exists **and** contains `Contents/Resources/app/product.json`.

That last condition matters. `/Applications/Antigravity.app` on this machine is an
electron-builder `app.asar` bundle (`Contents/Resources/bin` holds `language_server` and
`webm_encoder`) that merely shares a name with Antigravity IDE. Without the `product.json` check it
would be taken for the IDE and report its product version, `2.12.2`, where the engine comparison
expects a Code OSS version.

Because detection is evidence-based, a wrong guess in the table degrades to "not installed" rather
than to a bogus install. `tendril_ide_discover` additionally reports any other
`<home>/.*/extensions` directory that holds an `extensions.json`, so an IDE missing from the table
still shows up and can be targeted with `--extensions-dir`.

## Reading the Code OSS version

`engines.vscode` is matched against the **upstream Code OSS** version, not the fork's product
version. `tendril_ide_version` reads `Contents/Resources/app/package.json` from the app bundle,
which is exact and offline. It falls back to `<cli> --version`, whose first line is the product
version in some forks and so is only a hint; when neither yields an `x.y.z`, the tooling reports `?`
and recommends the symlink method rather than guessing.

## `extensions.json`

Every fork keeps `<extensions dir>/extensions.json`, an array of:

```json
{
  "identifier": { "id": "<publisher>.<name>" },
  "version": "0.1.0",
  "location": { "$mid": 1, "path": "<absolute path>", "scheme": "file" },
  "relativeLocation": "<publisher>.<name>-<version>"
}
```

A CLI install adds a `metadata` object (`installedTimestamp`, `pinned`, `source`, scoping flags).
The index is authoritative: an extension directory that is not listed is ignored, and the folder is
only rescanned when the file is absent. `tendril_extensions_json_add` therefore upserts, merging
into any existing entry so that other extensions' metadata survives, and writes via a temp file plus
rename.

## What was verified, and where

Verified on this machine (macOS 15, Darwin 25.6.0):

- **VS Code 1.137.0** — detection, symlink install, `extensions.json` authority, VSIX install into a
  temp extensions dir, `--list-extensions` cross-check.
- **Antigravity IDE 1.107.0** — the same, plus the engine-rejection reproduction.
- **`~/.antigravity` (legacy)** — detected via its data folder; no CLI or Code OSS bundle present, so
  its version reads as `?`.
- Synthetic `.cursor`, `.windsurf` and an unknown `.someide` extensions directory under a temp home
  — detection, symlink install, index registration, verification, uninstall.

Not verified here, and why:

- **Cursor, Windsurf, VSCodium, Trae, Positron, Kiro, Void, OpenVSCode Server, code-server** — not
  installed on this machine. Their data folder and CLI names come from each product's own
  documentation and installer. The symlink path is IDE-agnostic (a directory plus an
  `extensions.json` entry) so it should hold; the CLI/VSIX path depends on the fork keeping VS
  Code's `--install-extension` / `--extensions-dir` / `--list-extensions` flags, which they all
  inherit but none of which was exercised here. `void`'s data folder in particular is a guess.
- **Linux** — the `/usr/share`, `/opt` and `/usr/lib` CLI prefixes are untested. The scripts are
  otherwise POSIX-ish bash 3.2 with no macOS-only commands, so they should run, but the paths need
  confirming on a Linux box.
- **Windows** — not supported by these shell scripts. The equivalents would be
  `%USERPROFILE%\.vscode\extensions` and so on, and symlinking needs Developer Mode or elevation.
  Use the VSIX path there.

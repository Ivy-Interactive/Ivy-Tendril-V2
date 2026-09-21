## Commands

```bash
tendril wireframe setup <path>          # scaffold a project (fast, offline)
tendril wireframe serve <path>          # live preview on a free port; --open to launch a browser
tendril wireframe screenshot <path>     # -> <path>/screenshots/<width>x<height>.png
tendril wireframe agent-readme          # this document; --component <Name> for one component
```

`screenshot` takes `-w/--width` (default 1440) and `--height` (default 900) in CSS pixels, plus `-s/--scale` (default 2, so the PNG is 2880x1800) and `--full` for the whole page height. It builds and serves on its own; you do not need `serve` running.

**Working loop:** edit `src/App.tsx`, run `tendril wireframe screenshot <path>`, look at the PNG, adjust. `serve` is for a human watching; `screenshot` is how you check your own work.


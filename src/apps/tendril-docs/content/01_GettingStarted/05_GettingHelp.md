---
title: Getting Help
description: Stuck on something? Here is how to get support and connect with the Tendril community.
icon: LifeBuoy
searchHints:
  - help
  - support
  - discord
  - github issues
  - community
  - bug report
---

# Getting Help

## Doctor first

Before asking anyone, ask Tendril:

```bash
tendril doctor
```

It checks Tendril home, `config.yaml`, the SQLite database, the plans directory, `git` and `gh`, and
prints one `[OK]` / `[WARN]` / `[FAIL]` line per check. A surprising share of problems are a `[FAIL]`
line nobody had read yet.

## Troubleshooting

For known symptoms and their fixes, see [Troubleshooting](06_Troubleshooting.md).

## Discord

The fastest way to reach a human is the [Discord server](https://discord.gg/FHgxkDga3y). Ask questions,
share feedback, and talk to the team and other users.

## GitHub issues

Found a bug or want a feature? Open an issue on the
[GitHub repository](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/issues).

> [!TIP]
> Include the output of `tendril doctor` and `tendril version` in the report. If it is a failing job,
> attach its log from `$TENDRIL_HOME/Jobs/` — that folder holds the job log, the exact prompt the agent
> received and the raw agent transcript, which together answer most of the questions a maintainer would
> otherwise have to ask.

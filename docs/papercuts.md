# Papercuts

Anything that slowed development down, so the next session does not lose the
same hour. **Check this file first when tooling fails mysteriously.**

Format: `date · symptom · fix · project`.

Append when you lose time to one — while it is fresh, not at the end of the
session. An entry nobody writes down is an hour somebody pays for twice.

> **Why this lives in the repo and not in `~/code/`.**
> The original recipe puts it in the home directory so every session shares one
> global log. That works on a laptop. These sessions run in a container that is
> reclaimed after a period of inactivity, so a file under `$HOME` would be empty
> every time and the log would never accumulate — which is the one thing it
> exists to do. Committed to the repo it survives; the cost is that it is
> per-repo rather than global.

---

## Environment notes that apply to every repo here

These were measured in this sandbox and are not project-specific.

- **`cmd | tee log` hides failures in CI.** A bash pipeline returns the status
  of its *last* command, so a failing step goes green. `false | tee /dev/null;
  echo $?` prints `0`. Set `defaults: run: shell: bash` in the workflow, which
  is GitHub's shorthand for `-eo pipefail`.
- **The egress proxy blocks many hosts by organisation policy**, returning
  `403` to `CONNECT`. `curl -sS "$HTTPS_PROXY/__agentproxy/status"` lists recent
  denials. These are policy, not flakes — report them, do not retry or route
  around them. npm, PyPI and crates are exempt and work normally.
- **A blocked request still returns headers**, from the proxy's own error page.
  Do not read those as the application's response.

---

_No project-specific entries yet. Add the first one the next time something
costs you time._

# Headless sync (server / cron)

Keep a vault in sync with Google Calendar and Google Tasks on a machine that never opens
Obsidian — a home server, a VPS, a NAS. The headless runner applies the exact same rules
as the plugin (same code):

- **Import** creates and updates notes from Google (same note format, same folders).
- **Local edits push** as minimal field-level updates for notes that have a `googleId`.
- **Nothing is ever created or deleted in Google.** Deleted Google items file their notes
  into `orphaned/`; past events archive; completed/overdue tasks get filed.
- **Git**: each run pulls first, commits any changes, and pushes — so the server vault,
  your devices, and the git remote stay converged.

## Build

```bash
npm install
npm run build:headless
```

This produces three self-contained Node (>= 20) scripts in `dist/headless/` — no
`node_modules` needed at the destination:

| Script | Purpose |
| --- | --- |
| `sync.cjs` | The scheduled sync run |
| `authorize.cjs` | One-time OAuth bootstrap (writes the token file) |
| `cli.cjs` | Agent/scripting CLI for Google Tasks + Calendar (see [skill/google-tasks-calendar](../skill/google-tasks-calendar/SKILL.md)) |

## Configuration

One JSON file drives everything (`gsync.json`):

```jsonc
{
    // Vault directory on this machine (absolute, or relative to this file).
    "vaultPath": "/srv/vault",

    // OAuth tokens written by authorize. MUST live outside the vault, otherwise it
    // would be committed and pushed with your notes. Defaults to gsync-tokens.json
    // next to this config.
    "tokenFile": "/etc/gsync/gsync-tokens.json",

    // Same shape as the plugin's data.json "settings" — copy yours in verbatim.
    // Anything omitted uses the plugin defaults.
    "settings": {
        "clientId": "….apps.googleusercontent.com",
        "clientSecret": "…", // or omit and set GSYNC_CLIENT_SECRET in the environment
        "defaultCalendarId": "primary",
        "taskListId": "…",
        "defaultTimezone": "Pacific/Auckland",
        "eventsFolder": "events",
        "tasksFolder": "tasks",
        "importPastDays": 7,
        "importFutureDays": 90,
        "maxPatchesPerRun": 10
    },

    "git": {
        "enabled": true,
        "remote": "origin",
        "branch": "", // empty = the vault's current branch
        "authorName": "google-sync",
        "authorEmail": "google-sync@localhost"
    },

    // Port the one-time authorize listener binds on 127.0.0.1.
    "loopbackPort": 8765
}
```

`GSYNC_CLIENT_ID` / `GSYNC_CLIENT_SECRET` environment variables override the file values,
so secrets can stay out of it entirely.

## Authorize (one time)

The sync needs its own Google token. Two ways to get one:

**A. Browser flow (recommended).** On a machine with a browser:

1. In Google Cloud Console, open your existing OAuth client (the one the plugin uses) and
   add `http://127.0.0.1:8765/callback` as an **additional** authorized redirect URI
   (match your `loopbackPort`).
2. Run:

    ```bash
    node dist/headless/authorize.cjs --config gsync.json
    ```

    It prints (and tries to open) the consent URL, catches the redirect on the loopback
    listener, and writes the token file.

3. If the sync runs on a different machine, copy the token file there
   (`scp`, then `chmod 600`). The refresh token keeps the install alive indefinitely;
   rotated refresh tokens are persisted automatically.

**B. Copy the plugin's tokens.** If the vault on this machine already has a connected
plugin install:

```bash
node dist/headless/authorize.cjs --config gsync.json \
  --from-plugin-data /srv/vault/.obsidian/plugins/google-sync/data.json
```

## Running

```bash
node dist/headless/sync.cjs --config gsync.json
```

Flags:

- `--dry-run` — print what a push would change; no Google writes, no vault writes, no git.
- `--allow-mass-update` — override the mass-update circuit breaker for one run. Without
  it, more than `maxPatchesPerRun` pending local updates blocks the push phase (exit
  code 3) and lists the pending notes — the same template-rewrite protection the plugin
  has.
- `--no-git` — sync the working tree but skip pull/commit/push.

Exit codes: `0` ok, `1` partial failures (see log), `2` not authorized / bad config,
`3` blocked by the mass-update guard. A lock file (in the OS temp dir) makes overlapping
runs no-op, so a slow run and an eager timer can't collide.

### What a run does, in order

1. **Git pre-sync** — commit any leftover changes (crash recovery), fetch, fast-forward;
   if the branches diverged, rebase, and if the rebase conflicts, hard-reset to the
   remote (safe: everything Google-derived is regenerated in the next step).
2. **Push** local note edits as field-level diffs against the per-note baseline
   (`<vault>/.google-sync/state.json`, committed with the vault).
3. **Import** Google's current state into notes.
4. **Lifecycle + orphans** — archive/overdue/completed filing, auto-close linked tasks,
   orphan moves.
5. **Commit + push** the synced folders. A rejected push retries (up to 3×) by rebasing
   onto the remote with the fresh sync commit winning conflicting hunks. It never
   force-pushes; if it can't reconcile, it exits non-zero and the next run's pre-sync
   recovers.

## Scheduling

### cron

```cron
*/15 * * * * /usr/bin/node /opt/gsync/sync.cjs --config /etc/gsync/gsync.json >> /var/log/gsync.log 2>&1
```

### systemd timer

`/etc/systemd/system/gsync.service`:

```ini
[Unit]
Description=Obsidian Google sync
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/bin/node /opt/gsync/sync.cjs --config /etc/gsync/gsync.json
# Optional: keep the client secret out of the config file
# Environment=GSYNC_CLIENT_SECRET=…
```

`/etc/systemd/system/gsync.timer`:

```ini
[Unit]
Description=Run Obsidian Google sync every 15 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=15min

[Install]
WantedBy=timers.target
```

```bash
systemctl enable --now gsync.timer
journalctl -u gsync.service -f   # logs
```

### Windows (Task Scheduler)

```powershell
schtasks /Create /SC MINUTE /MO 15 /TN "gsync" /TR "node C:\gsync\sync.cjs --config C:\gsync\gsync.json"
```

## Smoke test

`scripts/smoke-headless.sh` runs the built bundle end-to-end against a throwaway git
vault and a mocked Google API (no network, no credentials):

```bash
npm run build:headless && ./scripts/smoke-headless.sh
```

## Troubleshooting

- **`not authorized`** — run `authorize.cjs`; check the token file path and permissions.
- **`mass-update guard`** — a lot of notes changed at once (or a script rewrote them).
  Inspect with `--dry-run`, then re-run with `--allow-mass-update` if intentional.
- **Push always rejected** — make sure the configured branch matches the remote's and the
  server's git credentials can push (deploy key / token in the remote URL / credential
  helper).
- **Wrong dates** — set `settings.defaultTimezone`; per-note `timezone` wins.

# Google Calendar/Tasks Sync (Obsidian plugin)

Treats a vault's `events/` and `tasks/` folders as the source of truth and mirrors them to
**Google Calendar** and **Google Tasks** (Obsidian → Google). Works on **desktop and iOS**.
See the product spec at `../obsidian-google-sync-spec.md`.

## Features

- **Events** (`events/*.md`): create / edit / delete a note → insert / patch / delete the
  Google Calendar event. Handles timezones (IANA), all-day events, attendees, recurrence.
- **Tasks** (`tasks/*.md`): create / edit / delete + completion → Google Tasks.
- **Lifecycle** (daily): past events → `events/archive/` (and close linked tasks), overdue
  tasks → `tasks/overdue/`, completed tasks → `tasks/completed/`.
- **Mobile-safe**: all network via Obsidian `requestUrl` (no CORS issues, no Node deps); all
  file I/O via the Vault API. OAuth is Authorization Code + PKCE via a self-hosted
  `obsidian://` bridge, so the same flow works on iOS.
- Exponential backoff on Google 429/5xx; `googleId` stored in frontmatter as the sync key.

## Setup

1. Create a Google OAuth client and host the redirect bridge — see
   [docs/google-setup.md](docs/google-setup.md).
2. Enter the client ID / secret / bridge URL in plugin settings, run **Connect to Google**.
3. On iPhone, follow [docs/ios-checklist.md](docs/ios-checklist.md).

Commands: **Connect to Google**, **Disconnect from Google**, **Sync now**,
**Run lifecycle scan**, **Test connection**.

## Note format

Frontmatter drives the sync (`title`, `date`/`end`/`allDay`/`timezone`, `location`,
`attendees`, `recurrence` for events; `title`, `due`, `completed`, `notes` for tasks).
`googleId` is filled in automatically. Body content stays local to Obsidian.

## Toolchain

| Concern    | Tool                                                    |
| ---------- | ------------------------------------------------------- |
| Bundler    | esbuild (`obsidian`/`electron`/CodeMirror externalized) |
| Types      | TypeScript (strict-ish, `tsc --noEmit` gate)            |
| Lint       | ESLint flat config + `eslint-plugin-obsidianmd`         |
| Format     | Prettier (`npm run format` / `format:check`)            |
| Unit tests | Mocha + chai (`test/unit/**/*.ts`, run via `tsx`)       |
| E2E tests  | WebdriverIO + `wdio-obsidian-service` (real Obsidian)   |

## Commands

```shell
npm install          # install toolchain
npm run dev          # esbuild watch -> main.js (use with hot-reload in a dev vault)
npm run build        # type-check + production bundle
npm run lint         # eslint
npm run format       # prettier --write
npm run format:check # prettier --check
npm run test:unit    # mocha unit tests
npm run test:e2e     # wdio e2e against a real (downloaded) Obsidian
npm test             # unit + e2e
```

### E2E on this (headless aarch64) box

`wdio-obsidian-service`/`obsidian-launcher` downloads a sandboxed Obsidian (arm64 build,
cached in `./.obsidian-cache`) and `@wdio/xvfb` provides a virtual display. Requires the
system packages installed by `scripts/setup-e2e-deps.sh` (xvfb + Electron runtime libs).
Pin versions with `OBSIDIAN_VERSIONS`, e.g.:

```shell
OBSIDIAN_VERSIONS='latest/latest' npm run test:e2e
```

## Dev loop with hot-reload

A dev vault lives at `../obsidian-google-sync-vault/` with the
[`hot-reload`](https://github.com/pjeby/hot-reload) plugin installed and this plugin's
build output symlinked into `.obsidian/plugins/google-sync/`. Run `npm run dev` and edits
rebuild + reload live.

---

Scaffolded from
[`wdio-obsidian-service-sample-plugin`](https://github.com/jesse-r-s-hines/wdio-obsidian-service-sample-plugin),
itself based on the [official Obsidian sample plugin](https://github.com/obsidianmd/obsidian-sample-plugin).

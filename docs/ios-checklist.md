# iOS manual test checklist

The iOS Obsidian app can't be automated, so on-device validation is manual. Automated tests
already cover the desktop + emulated-mobile code paths; this checklist confirms the real
iPhone end-to-end (real Obsidian iOS + real Google).

## Setup

- [ ] Vault syncs to the iPhone (iCloud, Obsidian Sync, or git) and opens in Obsidian iOS.
- [ ] Plugin installed: `main.js` + `manifest.json` in `<vault>/.obsidian/plugins/google-sync/`,
      enabled under **Settings → Community plugins**.
- [ ] Same OAuth client ID / secret / redirect bridge URL entered as on desktop
      (see [google-setup.md](./google-setup.md)).

## Auth (the iOS-critical path)

- [ ] Run command **Connect to Google** → the system browser opens the consent screen.
- [ ] Approve → the bridge page deep-links back via `obsidian://google-sync` → Obsidian shows
      **"Connected to Google."**
- [ ] **Test connection** reports OK.
- [ ] Force-quit and reopen Obsidian → still connected (tokens persisted in `data.json`).

## Events

- [ ] Create a note in `events/` with `title` + `date` (+ `timezone`), run **Sync now** →
      event appears in Google Calendar with the right time/zone.
- [ ] Edit the note's `title`/`time` → re-sync → Google updates (no duplicate).
- [ ] Delete the note → event removed from Google Calendar.
- [ ] All-day event (`allDay: true`) shows as all-day in Google.

## Tasks

- [ ] Create a note in `tasks/` with `title` (+ `due`), run **Sync now** → task appears in
      Google Tasks.
- [ ] Set `completed: true` → re-sync → task shows completed in Google.

## Lifecycle

- [ ] A past-dated event moves to `events/archive/` (run **Run lifecycle scan**).
- [ ] An overdue, incomplete task moves to `tasks/overdue/`; a completed one to
      `tasks/completed/`.

## Networking sanity

- [ ] No CORS / network errors in use (all requests go through Obsidian's `requestUrl`).
- [ ] Works on cellular as well as Wi-Fi.

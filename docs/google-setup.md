# Google setup (one-time)

The plugin uses **your own** Google OAuth client (BYO) so your data stays in your project.
Auth is Authorization Code + PKCE; the consent redirect returns to Obsidian through a tiny
static bridge page you host. This works on desktop **and** iOS.

## 1. Enable the APIs

1. Go to <https://console.cloud.google.com/> and create (or pick) a project.
2. **APIs & Services → Library** → enable **Google Calendar API** and **Google Tasks API**.

## 2. OAuth consent screen

1. **APIs & Services → OAuth consent screen** → User type **External** → create.
2. Add your Google account under **Test users** (keeps the app in "testing" mode so you don't
   need Google verification).
3. Scopes: you can leave the defaults; the plugin requests
   `https://www.googleapis.com/auth/calendar` and `https://www.googleapis.com/auth/tasks`
   at sign-in.

## 3. Host the redirect bridge

1. Deploy [`bridge/index.html`](../bridge/index.html) to any static host you control —
   GitHub Pages, Cloudflare Pages, or Netlify all work and are free.
2. Note its public URL, e.g. `https://you.github.io/obsidian-google-sync/` (this is your
   **redirect bridge URL**). The page only forwards a single-use code to
   `obsidian://google-sync`; with PKCE it can't use the code, so a static/shared host is safe.

## 4. Create the OAuth client

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application** (required to allow an https redirect).
3. **Authorized redirect URIs** → add your bridge URL from step 3 (exactly).
4. Copy the **Client ID** and **Client secret**.

## 5. Configure the plugin

In Obsidian → **Settings → Google Calendar/Tasks Sync**:

- **OAuth client ID** / **OAuth client secret**: paste from step 4.
- **Redirect bridge URL**: your bridge URL from step 3.
- **Default calendar ID**: `primary` (default) or a specific calendar ID.
- **Task list ID**: `@default` (default) targets your primary Google Tasks list.
- **Default timezone**: an IANA zone (e.g. `Pacific/Auckland`) for notes without a `timezone`.

Then run the command **Connect to Google**, approve in the browser, and you'll be returned
to Obsidian. Use **Test connection** to confirm, then **Sync now**.

## Notes

- Keep a **test calendar / task list** while trying things out to avoid touching real data.
- The client secret lives in the vault's `data.json`. That's acceptable for a personal BYO
  client; don't commit `data.json` or share the vault's plugin folder.

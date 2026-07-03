# Google auth UX improvement plan

Date: 2026-06-16

## Goal

Make first-time Google authentication for **Google Calendar and Tasks Sync** much easier without weakening the plugin's privacy posture or breaking mobile support.

## Current implementation

The plugin currently uses:

- Google OAuth 2.0 Authorization Code + PKCE.
- A user-owned **Web application** OAuth client.
- User-entered `clientId`, `clientSecret`, and `redirectUri` settings.
- A static HTTPS bridge in `bridge/` that forwards `code` + `state` to `obsidian://google-sync`.
- `registerObsidianProtocolHandler("google-sync", ...)` to complete the token exchange inside Obsidian.
- Google API calls through Obsidian `requestUrl`, with no shared backend and no telemetry.
- Tokens/settings stored in `.obsidian/plugins/google-sync/data.json`.

Important files:

- `src/google/auth.ts` — PKCE, token exchange, refresh.
- `src/main.ts` — connect flow, protocol handler, validate/test commands.
- `src/settings.ts` — credential fields and connection UI.
- `bridge/index.html` + `bridge/redirect.js` — static redirect bridge.
- `docs/google-setup.md` — current user setup guide.
- `.github/workflows/deploy-bridge.yaml` — GitHub Pages bridge deployment for forks.

Verification run while preparing this plan:

```text
npm run test:unit
184 passing
```

## Research summary

### Official Google constraints

- Google supports Authorization Code + PKCE for installed/native apps.
- Desktop installed apps can use loopback redirects such as `http://127.0.0.1:<port>`; Google says `localhost` may work but can hit firewall issues, and loopback is a desktop-oriented pattern.
- Manual copy/paste / out-of-band OAuth is deprecated and no longer supported.
- Custom URI schemes are restricted in some Google OAuth contexts because of impersonation risk; direct `obsidian://...` as the registered Google redirect is not a safe general solution.
- Google limited-input/device OAuth only supports a small scope allowlist. It does **not** support Calendar/Tasks write scopes, so it is not viable here.

### Comparable Obsidian/plugin patterns

1. **BYO OAuth + local loopback**
    - Example: TaskNotes tells users to create a Desktop OAuth client and click Connect.
    - Much easier than hosting a bridge, but desktop-first. Mobile cannot run a reliable local callback server.

2. **BYO OAuth + hosted/static bridge**
    - Current plugin approach.
    - Works cross-platform, including iOS, and avoids a developer-operated token backend.
    - Main pain: users must fork/deploy a bridge and exactly match redirect URI strings.

3. **Developer-owned OAuth app + developer-hosted bridge/backend**
    - Best possible UX: user clicks Connect.
    - Requires Google app verification for broad public use and careful privacy/security commitments.
    - If a backend handles token exchange, the project becomes an operated service with credentials, availability, abuse, logging, and data-protection responsibilities.

4. **Device authorization flow**
    - Nice UX for headless apps, but not supported for required Calendar/Tasks scopes.
    - Not recommended.

## Main user pain points in the current setup

1. **Too many separate consoles and terms**: Cloud project, APIs, consent screen, test users, OAuth client, bridge, redirect URI.
2. **Bridge hosting is the hardest step**: fork repo, enable Pages source, run workflow, wait, copy exact URL.
3. **Google UI drift**: docs say **OAuth consent screen**, but Google is increasingly presenting **Google Auth Platform** pages such as **Branding**, **Audience**, **Data access**, and **Clients**.
4. **Redirect URI exact-match failures**: the first GitHub issue was `Error 400: redirect_uri_mismatch`; users need visual guidance and preflight checks.
5. **Settings tab is too raw**: it asks for three OAuth fields with terse descriptions, but does not guide users through setup or detect common mistakes before Connect.
6. **Docs have one clear inconsistency**: `docs/ios-checklist.md` says deleting the test note should delete the Google event "if delete sync is enabled", but this plugin intentionally has no delete capability.

## Recommendation

Keep the current cross-platform BYO-web-client + static bridge as the **default public architecture** for now, but reduce the setup burden with a guided setup wizard, better preflight validation, and a dedicated screenshot-heavy guide.

Do **not** switch the default to a shared hosted backend yet. It would improve UX, but it changes the trust/compliance model substantially.

Add a desktop-only loopback helper as an **optional fast path** only if we are comfortable either:

- using desktop-only Electron/Node APIs lazily and handling Community scanner noise, or
- offering it as external/headless tooling rather than in the mobile runtime.

## Proposed improvement phases

### Phase 1 — Documentation quick win

Update `docs/google-setup.md` into two paths:

1. **Recommended cross-platform setup** — current bridge method, but clearer and screenshot-backed.
2. **Already have a bridge / advanced hosting** — short reference for Cloudflare Pages, Netlify, own domain.

Changes:

- Use Google’s newer labels where relevant: **Google Auth Platform → Branding / Audience / Data access / Clients** while also mentioning older **APIs & Services → OAuth consent screen / Credentials** labels.
- Put an estimated time beside each section.
- Add a one-page “copy exactly” checklist:
    - Bridge URL opens in browser.
    - Same bridge URL in Google client and plugin setting.
    - Includes/removes trailing slash consistently.
    - OAuth client type is **Web application**, not Desktop, for the bridge method.
    - Calendar API and Tasks API are enabled.
    - User email is listed under Test users / Audience.
- Add a troubleshooting table mapping exact Google errors to fixes:
    - `redirect_uri_mismatch` → URI mismatch/trailing slash/wrong OAuth client type.
    - `access_denied` / app not verified → add yourself as test user.
    - `invalid_client` → wrong client ID/secret or copied Desktop client into Web flow.
    - browser returns to bridge but not Obsidian → OS/deep-link handler issue.
- Fix `docs/ios-checklist.md` delete-sync line to match current “never delete Google items” model.

Recommended screenshots to include in `docs/assets/google-setup/`:

1. Google Cloud project picker with **New project** button.
2. API Library search result for **Google Calendar API**.
3. API Library search result for **Google Tasks API**.
4. Google Auth Platform / OAuth consent setup: **Branding** required fields.
5. Google Auth Platform / **Audience** page with **Test users** highlighted.
6. Google Auth Platform / **Data access** page showing Calendar + Tasks scopes.
7. Google Auth Platform / **Clients** or APIs & Services / **Credentials** page with **Create OAuth client**.
8. OAuth client type set to **Web application**.
9. **Authorized redirect URIs** with the GitHub Pages bridge URL, including trailing slash.
10. GitHub fork button for the repo.
11. GitHub repo **Settings → Pages** with **Source: GitHub Actions**.
12. GitHub **Actions → Deploy OAuth bridge to Pages → Run workflow**.
13. Successful GitHub Pages deployment showing the published URL.
14. Obsidian plugin settings with the three OAuth fields filled.
15. Browser Google consent page for Calendar/Tasks scopes.
16. Successful bridge page / `tap here` fallback.
17. Obsidian **Connected to Google** notice.
18. `redirect_uri_mismatch` Google error screenshot, annotated with “check exact bridge URL”.

### Phase 2 — In-app guided setup wizard

Add a **Setup Google account** button/section at the top of settings that walks users through setup without leaving them to interpret raw fields.

Suggested settings UI:

- **Connection status card**
    - Not configured / configured but not connected / connected.
    - Buttons: **Setup guide**, **Validate setup**, **Connect**, **Disconnect**.
- **Step 1: Google Cloud**
    - Buttons that open the relevant Google URLs:
        - Project selector: `https://console.cloud.google.com/projectselector2/home/dashboard`
        - API Library: `https://console.cloud.google.com/apis/library`
        - Google Auth Platform Audience: `https://console.cloud.google.com/auth/audience`
        - Clients/Credentials: `https://console.cloud.google.com/auth/clients`
- **Step 2: Redirect bridge**
    - Show the expected GitHub Pages URL pattern.
    - Field for bridge URL with normalization: trim whitespace; optionally warn about missing trailing slash.
    - Button: **Open bridge URL**.
- **Step 3: OAuth client values**
    - Paste Client ID / Secret.
    - Validate the client ID shape: should end with `.apps.googleusercontent.com`.
- **Step 4: Connect**
    - Disabled until required fields are present.

Implementation details:

- Make `Validate setup` return actionable messages, not just `[ok]`/`[--]`.
- Add a “Copy redirect URL” button next to the bridge field.
- On failed token exchange, parse `GoogleApiError` payloads and surface likely causes:
    - `redirect_uri_mismatch`, `invalid_client`, `invalid_grant`, `access_denied`.
- Make the Connect notice include “If the browser shows redirect_uri_mismatch, check that the bridge URL exactly matches Google Cloud.”

### Phase 3 — Bridge deployment simplification

Keep user-owned bridge, but remove the need to fork the whole plugin where possible.

Options:

1. **Tiny standalone bridge repo/template**
    - Create a separate minimal repo with only `index.html`, `redirect.js`, and a Pages workflow.
    - Docs say “Use this template” instead of “Fork the whole plugin.”
    - Less intimidating and fewer irrelevant files.

2. **One-file bridge copy/paste**
    - Provide `docs/bridge-one-file.html` so users can paste it into any static host.
    - Useful for Cloudflare Pages/Netlify/manual hosting.

3. **Use the plugin owner’s public static bridge for code forwarding only**
    - Technically the static bridge sees only single-use code+state and cannot exchange without PKCE verifier/client secret.
    - But users’ Google OAuth client would need to register the owner’s domain as redirect URI; this may feel less “self-owned” and introduces availability/trust questions.
    - If offered, label it as “convenience bridge” and keep self-hosted as privacy-first.

Recommended: start with the standalone template repo, then evaluate a convenience static bridge if users still struggle.

### Phase 4 — Optional desktop fast path

Investigate a desktop-only local loopback flow:

- User creates a **Desktop app** OAuth client instead of Web application.
- Plugin starts a temporary local server on `127.0.0.1:<random>`.
- Google redirects directly to the local server.
- No bridge hosting required.

Pros:

- Much easier desktop setup.
- Matches Google’s recommended native desktop loopback pattern.

Cons:

- Not mobile-compatible.
- Requires Node/Electron APIs or a companion CLI; this may trigger Community source scanner warnings and must be kept out of the mobile runtime.
- Users still need to sync resulting tokens/settings to mobile if they want mobile use.
- The settings UI must clearly distinguish **Desktop app OAuth client** from **Web application OAuth client**, otherwise it will create more confusion.

Safer implementation path:

- First implement as `headless/authorize`-style external helper documentation.
- Later consider in-plugin desktop helper behind platform checks if scanner/review impact is acceptable.

### Phase 5 — Long-term “one-click” hosted auth

Only pursue if the project is ready to operate a service.

Architecture:

- Developer-owned verified Google OAuth app.
- Hosted auth endpoint and static landing page.
- Backend token exchange, or a carefully designed public-client flow where possible.
- Plugin receives/stores refresh token locally.

Requirements/risks:

- Google OAuth verification for Calendar/Tasks scopes.
- Published privacy policy and support contact must exactly describe data handling.
- Backend must avoid logging auth codes/tokens.
- Operational uptime and abuse handling.
- Potential security assessment depending on scopes and Google policy changes.

Recommendation: not now. Treat as v1.0+ product decision, not a quick setup fix.

## Concrete backlog

### High priority

- [ ] Rewrite `docs/google-setup.md` with a short overview, two setup paths, screenshots, and error table.
- [ ] Add screenshots listed above under `docs/assets/google-setup/`.
- [ ] Fix `docs/ios-checklist.md` delete-sync inconsistency.
- [ ] Add in-app links to Google Cloud pages and the setup guide from settings.
- [ ] Improve `validateSetup()` output with actionable next steps.
- [ ] Improve OAuth error messages for `redirect_uri_mismatch`, `invalid_client`, `invalid_grant`, and `access_denied`.

### Medium priority

- [ ] Add bridge URL normalization/warnings: whitespace, non-HTTPS, probable missing trailing slash.
- [ ] Add `Open bridge URL` and `Copy bridge URL` controls.
- [ ] Create a tiny standalone bridge template repo or at least a one-file bridge artifact.
- [ ] Add an e2e/manual QA checklist specifically for first-time auth setup.

### Low priority / research spikes

- [ ] Spike desktop loopback OAuth helper and measure Community review/scanner impact.
- [ ] Research Google verification requirements for a developer-owned hosted OAuth app.
- [ ] Decide whether a convenience static bridge on an owner-controlled domain is acceptable.

## Acceptance criteria

A new user should be able to complete setup by following one guide without guessing:

- They can identify which OAuth client type to create.
- They can deploy or choose a bridge URL.
- They can paste settings into Obsidian.
- `Validate setup` tells them exactly what remains.
- Common Google errors point to the exact fix.
- Desktop and iOS/mobile flows are both documented accurately.

## Suggested next implementation PR

Scope a single PR to Phase 1 + small Phase 2 improvements:

1. Update `docs/google-setup.md` and `docs/ios-checklist.md`.
2. Add a setup guide link and clearer wording in `src/settings.ts`.
3. Improve `validateSetup()` messages.
4. Improve OAuth error mapping in `onOAuthCallback()` / token exchange error surfaces.
5. Add/adjust unit tests for validation/error message helpers.
6. Run:

```bash
npm run lint
npm run test:unit
npm run check:runtime-bundle
npm run check:release-metadata
```

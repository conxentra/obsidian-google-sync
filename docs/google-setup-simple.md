# Simple Google setup guide

This guide is for people who just want the plugin to work and do not normally use Google Cloud.

You will do three things:

1. Tell Google that this plugin is allowed to talk to your Calendar and Tasks.
2. Put a tiny return page online so Google can send you back to Obsidian after sign-in.
3. Copy three values into Obsidian and click **Connect**.

Plan for about **20 minutes** the first time. You only do this once.

## What you need

- Your Google account.
- Obsidian with **Google Calendar and Tasks Sync** installed.
- A free GitHub account for the easiest setup path.

## Important privacy note

There is no shared login server for this plugin. Your Google login tokens stay in your vault's local plugin data. That is more private, but it means Google asks you to create your own small "app" in Google Cloud.

## Step 1 — Create a Google Cloud project

1. Open <https://console.cloud.google.com/>.
2. At the top of the page, select the project picker.
3. Select **New project**.
4. Name it something like `Obsidian Google Sync`.
5. Select **Create**.
6. Make sure the new project is selected before you continue.

Done when: you can see your new project name at the top of Google Cloud.

## Step 2 — Turn on Calendar and Tasks

1. Open <https://console.cloud.google.com/apis/library>.
2. Search for **Google Calendar API**.
3. Open it and select **Enable**.
4. Go back to the API Library.
5. Search for **Google Tasks API**.
6. Open it and select **Enable**.

Done when: both APIs say they are enabled.

## Step 3 — Allow yourself to sign in

Google may call this area **OAuth consent screen** or **Google Auth Platform**.

1. Open <https://console.cloud.google.com/auth/branding>.
2. Fill in the required app information:
   - App name: `Obsidian Google Sync` is fine.
   - Support email: choose your email.
   - Developer contact email: enter your email.
3. Save/continue.
4. Open <https://console.cloud.google.com/auth/audience>.
5. Choose **External** if asked.
6. Under **Test users**, add the same Google email you will sign in with.
7. Save.

Done when: your email appears under **Test users**.

## Step 4 — Put the return page online

This is the weirdest part, but it is just a tiny web page that sends the Google sign-in result back to Obsidian. It contains no password, no token, and no secret.

### Easiest path: GitHub Pages

1. Open the plugin repository on GitHub: <https://github.com/Cordedmink2/obsidian-google-sync>.
2. Select **Fork**.
3. GitHub creates your own copy of the repository.
4. In your copy, open **Settings → Pages**.
5. Under **Build and deployment → Source**, choose **GitHub Actions**.
6. Open the **Actions** tab.
7. Select **Deploy OAuth bridge to Pages**.
8. Select **Run workflow**.
9. Wait about a minute for it to finish.
10. Go back to **Settings → Pages** and copy the website URL.

It should look like:

```text
https://YOUR-GITHUB-NAME.github.io/obsidian-google-sync/
```

Keep this URL. It is your **Redirect bridge URL**.

Done when: opening that URL in a browser shows a page. It may say it is missing a code — that is expected.

## Step 5 — Create the Google OAuth client

This is where Google gives you the two values Obsidian needs.

1. Open <https://console.cloud.google.com/auth/clients>.
2. Select **Create client** or **Create credentials → OAuth client ID**.
3. For application type, choose **Web application**.
4. Name it `Obsidian Google Sync`.
5. Find **Authorized redirect URIs**.
6. Select **Add URI**.
7. Paste your **Redirect bridge URL** from Step 4.
8. Make sure it matches exactly, including the final `/` if your URL has one.
9. Select **Create**.
10. Copy the **Client ID** and **Client secret**.

Done when: you have these three things ready:

- Client ID
- Client secret
- Redirect bridge URL

## Step 6 — Paste the values into Obsidian

1. Open Obsidian.
2. Go to **Settings → Google Calendar and Tasks Sync**.
3. Paste:
   - **OAuth client ID**
   - **OAuth client secret**
   - **Redirect bridge URL**
4. Leave **Default calendar** as `primary` for now.
5. Leave **Task list** as `@default` for now.
6. Select **Connect**.
7. Approve access in the browser.
8. Google should send you back to Obsidian.
9. Select **Test connection**.
10. Run **Validate setup** from the command palette if anything looks wrong.

Done when: Obsidian says **Connected to Google** or **Connection OK**.

## Common problems

### Google says `redirect_uri_mismatch`

The Redirect bridge URL is not exactly the same in Google Cloud and Obsidian.

Check:

- Is it `https://`, not `http://`?
- Is the spelling exactly the same?
- Is the final slash the same in both places?
- Did you choose **Web application**, not **Desktop app**?

### Google says `access_denied`

Your Google account probably is not listed as a test user.

Open <https://console.cloud.google.com/auth/audience> and add your email under **Test users**.

### Obsidian does not reopen after Google sign-in

Open your Redirect bridge URL directly. If it loads, the web page is working. Then make sure your device allows `obsidian://` links to open Obsidian.

### I am technical and want another hosting option

Use the advanced guide: [Google setup guide](google-setup.md). You can publish [`bridge/`](../bridge/) or the single-file bridge at [bridge-one-file.html](bridge-one-file.html) on any HTTPS static host.

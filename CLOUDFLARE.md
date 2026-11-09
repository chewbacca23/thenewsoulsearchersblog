# Cloudflare — thenewsoulsearchers.de

Live Worker: **`thenewsoulsearchersblogc`** — owns the domain, holds the OAuth secrets, and is the `name` in `wrangler.toml`. The GitHub repo is `thenewsoulsearchersblog` (no `c`); the two are deliberately different, so do not "fix" `wrangler.toml` to match the repo name.  
Git source: **`chewbacca23/thenewsoulsearchersblog`** (`main`)  
Admin: **https://thenewsoulsearchers.de/admin/** (not `www`)  
Kit: **https://thenewsoulsearchers.de/kit** (public)

---

## Easy editor (Login with GitHub)

The public site is on Cloudflare. `/admin` saves Markdown into GitHub; Cloudflare rebuilds; the new ride or note goes live.

**First time only** — one GitHub OAuth app, then two Cloudflare secrets.

### A. GitHub OAuth app

1. Open [github.com](https://github.com) as **`chewbacca23`**
2. Photo (top right) → **Settings**
3. Left list, scroll to the bottom → **Developer settings**
4. **OAuth Apps** → **New OAuth App**
5. Fill in:
   - Application name: `Soul Searchers CMS`
   - Homepage URL: `https://thenewsoulsearchers.de`
   - Authorization callback URL: `https://thenewsoulsearchers.de/callback`
6. **Register application**
7. Copy **Client ID**
8. **Generate a new client secret** → copy it (GitHub shows it once)

### B. Cloudflare secrets — from the terminal (recommended)

Five Workers are Git-connected to this repo, so the dashboard offers five wrong places to paste the keys. The CLI targets one Worker by name:

```sh
sh scripts/set-cms-secrets.sh
```

It logs you in, asks for the Client ID and the secret, then lists what landed on `thenewsoulsearchersblogc`.

Login uses `wrangler login --device`, which prints a code you type into Cloudflare. The default flow instead waits on a `localhost:8976` callback server that exists only while the command runs, so pausing before you click **Authorize** ends in `ERR_CONNECTION_REFUSED`.

To check any time, without revealing values:

```sh
npx wrangler secret list --name thenewsoulsearchersblogc
```

### B2. Cloudflare secrets — via the dashboard

1. [dash.cloudflare.com](https://dash.cloudflare.com)
2. **Workers & Pages** → **`thenewsoulsearchersblogc`** (the live journal Worker, the one with a **c** — not the shop, and not `thenewsoulsearchersblog` without the `c`)
3. **Settings** → **Variables and Secrets** — the runtime section. Values added under **Build** never reach the running site.
4. Name `GITHUB_OAUTH_CLIENT_ID` · type **Text** · paste the Client ID → Save
5. **Add** again: name `GITHUB_OAUTH_CLIENT_SECRET` · type **Secret** · paste the secret → Save

### Photos are kept under 1 MB automatically

The media library previews images through the GitHub contents API, which returns `"encoding": "none"` and no body for files over 1 MB. The upload still commits, so the photo works on the site while the thumbnail in the editor stays broken. iPhone photos are 2–5 MB and always hit this.

**The 1 MB is GitHub's, not a setting we chose.** Raising `MAX_BYTES` in `scripts/optimise-photos.py` does not raise GitHub's limit — it only stops photos being resized and brings the broken thumbnails back. The script also aims for a *web* target (~350 KB, long edge up to 1800px) so Now and home stay quick; `EDGE_STEPS` / `QUALITY_STEPS` try the largest detail that still fits that budget.

**You do not have to think about it.** `.github/workflows/keep-photos-small.yml` runs on every push that touches a photo, resizes anything over the limit, and commits the result. Upload straight from your phone; the next preview loads.

One-time repo setting for the robot to be able to commit: **Settings → Actions → General → Workflow permissions → Read and write permissions**.

Locally:

```sh
npm run photos:check   # report anything too big
npm run photos:fix     # resize them in place
npm run photos:enhance -- path/to/pic.jpg   # mild colour + sharpen → *_enhanced.jpg
npm run photos:enhance:check -- path        # dry-run enhance
```

Needs Pillow once: `pip3 install pillow`. Default enhance writes a sibling `*_enhanced.jpg`; add `--in-place` to overwrite. Enhance first, then `photos:fix` if the file is still heavy.

Before uploading, on a Mac:

```sh
sh scripts/shrink-photo.sh ~/Desktop/IMG_1234.HEIC
sh scripts/enhance-photo.sh ~/Desktop/IMG_1234.HEIC   # HEIC → enhance → *_enhanced.jpg
```

Two things to know about iPhone photos: they carry your **GPS location** in EXIF, and they store the image sideways with an orientation flag. The resizer rotates the pixels before stripping metadata — do it the other way round and the photo appears rotated 90° in every browser.

### C. Write a post

1. Open **https://thenewsoulsearchers.de/admin/** (apex, not www)
2. **Login with GitHub** → authorize **Soul Searchers CMS**
3. **Ride notes** or **Rides** → New → write → **Save this ride** / **Publish**
4. Open the ride page itself (not only the list) and hard-refresh

The editor writes GitHub immediately. If Cloudflare has not rebuilt yet, the Worker still
reads that ride, its photos, and the **Shop** products from GitHub so the public page is
not blank. If a photo URL still 404s, **Workers → thenewsoulsearchersblogc → Deployments → Retry**, then
`Cmd+Shift+R`.

If the GitHub popup says login is not wired yet, secrets from **B** are missing.

### Looks (how many people opened a page)

After **Login with GitHub** in `/admin/`, open the gold **Looks** chip (or bookmark
`/looks`). It stays private: no footer link, and strangers without the login cookie get a blank
gate page. Today, last 7 days, this year, all time, which pages, which country, and which site
sent them. No visitor names. Numbers start after this Worker is live. Your own clicks count.

A Worker-only HTML page for `/looks` was challenged by Bot Fight, so the count page never
opened. The Worker now fills the numbers into the real Astro page instead.

### Looks storage (so counts survive deploys)

Looks uses Cloudflare KV binding **`STATS`** → namespace **`soulsearchers-looks`**
(`id` is in `wrangler.toml`). After a Mac-push, open
**https://thenewsoulsearchers.de/cms-status** and confirm:

- `"looksStorage": "kv"`
- `"looksDurable": true`

If it says `"cache"` or `statsBinding.present` is false, the deploy landed on the wrong
Worker, or Bindings still need a Retry on **`thenewsoulsearchersblogc`**.

### Stuck? Ask the Worker instead of guessing

Open **https://thenewsoulsearchers.de/cms-status**. It reports the binding names the live Worker can see — never the values.

| What it says | What it means |
| --- | --- |
| `"textBindingsVisibleToWorker": []` | The Worker sees nothing. Keys went to another Worker, or under **Build** variables instead of runtime **Variables and Secrets**. |
| Names listed but `"loginWired": false` | Names are close but unmatched. Rename to `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET`. |
| `"clientIdShape": "does NOT look like a GitHub client id"` | The Client **ID** box holds the wrong value (GitHub ids start `Ov23`). |
| `"loginWired": true` | Login is ready. Go to `/admin/`. |
| `"looksStorage": "cache"` or `"memory"` | Looks is temporary. Finish the KV steps above. |
| `"looksStorage": "kv"` / `"looksDurable": true` | Looks is durable. Counts survive deploys. |
| `"mailWired": true` | Contact form can send straight to Henrik’s inbox. |
| `"mailWired": false` / `"mailVia": "none"` | Add **`RESEND_API_KEY`** (steps below), then Retry. |

### Contact form (real send, no mail app)

`/contact` posts to **`/api/contact`**. The note goes to **`henrik@thenewsoulsearchers.de`**
by default (Henrik’s laptop / Strato mailbox). Reply-To is the rider’s address.

Override with Worker secret **`CONTACT_INBOX`** if needed (e.g. temporary web.de while Strato is down).

DNS first (Resend → Domains → `thenewsoulsearchers.de`):

1. **Enable Sending** verified (DKIM + the `send` / `rsend` CNAMEs, DNS only)
2. Leave **Enable Receiving** off so Strato / existing MX keeps delivering `henrik@…`
3. DMARC on the root should be soft (`p=none` or `p=quarantine`) so Resend → Strato does not hard-bounce

#### Dashboard path (no Terminal)

Do this on Worker **`thenewsoulsearchersblogc`** only (name ends with **c**).

1. Resend → [API Keys](https://resend.com/api-keys) → delete old keys → **Create API Key** → copy the `re_…` once
2. Cloudflare → Workers & Pages → **`thenewsoulsearchersblogc`** → Settings → Variables and secrets
3. Delete Variables named `thenewsoulsearchers` or `soulsearchers` (wrong names; unused)
4. On **`RESEND_API_KEY`**: Edit → paste the new `re_…` → Save  
   (Secret is nicer than Variable; either works. The *value* must be the fresh key.)
5. Hard-refresh **https://thenewsoulsearchers.de/contact** → one short Send → look for **Sent**

If Send says the mail key was rejected, the `re_…` value is still wrong. Make another key in Resend and edit `RESEND_API_KEY` again.

#### Terminal path (also fine)

```sh
# From the blog repo on the Mac
sh scripts/set-resend-secret.sh
```

Or one shot without the script:

```sh
export CLOUDFLARE_ACCOUNT_ID=a81e1d3b6d945aa2b872e4c8fd32f382
npx --yes wrangler@4 login --device
npx --yes wrangler@4 secret put RESEND_API_KEY --name thenewsoulsearchersblogc
```

Paste the Resend API key when asked (starts with `re_`). Then hard-refresh **https://thenewsoulsearchers.de/cms-status**:

- `"mailWired": true` and `RESEND_API_KEY` inside `textBindingsVisibleToWorker` → hard-refresh `/contact` and send a test
- Still false / key missing from that list → the secret is on a sibling Worker (`thenewsoulsearchersblog` without the **c**, or Build vars). Run the script again.

Until a **working** key is there, Send shows **Not delivered yet** (or “Mail key was rejected”) and never opens a mail app.

Notes land in **`henrik@thenewsoulsearchers.de`** by default (From `hello@thenewsoulsearchers.de`
via Resend). Reply-To is the rider.

### Free member mailing list (Resend Audience)

“Become a member” saves each email in KV **and** adds it to one Resend Audience named
**Soul Searchers members**. From Resend → **Audiences** / **Broadcasts** you can write that
whole group later.

Your private roster (name, email, date joined) lives on **`/members`** in the top nav (also under
**Free members** on `/looks`). Same login cookie as Looks (set when you open the Decap editor).
Strangers who tap Members only see “Nothing to see here.” The public site never shows those
addresses.

Optional pin (recommended once you have created the audience in Resend):

```sh
npx --yes wrangler@4 secret put RESEND_AUDIENCE_ID --name thenewsoulsearchersblogc
```

Paste the audience id from Resend. If this secret is missing, the Worker creates the audience
on first join and remembers the id in KV (`members:audience_id`).

### If Resend shows Bounced to henrik@thenewsoulsearchers.de

Your **key is fine**. Strato (`smtpin.rzone.de`) often rejects mail that is:

- **From** `@thenewsoulsearchers.de` (via Resend / Amazon)
- **To** `@thenewsoulsearchers.de` (your Strato mailbox)

It looks like spoofing to them, even when DMARC is `p=none` and DKIM is valid.

**Try DNS (Cloudflare → DNS → TXT on the root `thenewsoulsearchers.de`):**

Change SPF from:

```txt
v=spf1 include:_spf.strato.com -all
```

to:

```txt
v=spf1 include:_spf.strato.com include:amazonses.com ~all
```

(Keep Strato; soften `-all` to `~all`; allow Resend’s Amazon SES path.)

Wait a few minutes, send one new `/contact` test, check the **newest** Resend row.

**If it still bounces:** set `CONTACT_INBOX` to a Gmail (or other) inbox you open on the laptop, and optionally in Strato set a forward from `henrik@…` → that Gmail so the domain address still feeds the laptop.

Do **not** turn on Resend **Receiving** on the root domain (that steals Strato MX).

To retarget:

```sh
export CLOUDFLARE_ACCOUNT_ID=a81e1d3b6d945aa2b872e4c8fd32f382
npx --yes wrangler@4 secret put CONTACT_INBOX --name thenewsoulsearchersblogc
```

(`/cms-status` shows `mailTo` / `mailFrom` / `mailKeyProbe`.)

Check live status anytime: **GET /api/contact** returns `{ "mailWired": true/false, "to": "…" }` without revealing secrets.

Five Workers (`thenewsoulsearchersblogc`, `bloga`, `blogb`, `bl`, `blo`) are Git-connected to this repo and all serve this code. `thenewsoulsearchersblogc` is the one on the domain, so its secrets are the ones that count.

Do not force-push over `thenewsoulsearchersblog` `main` after using the editor — that would wipe those posts.

---

## Thin tires pulse (auto every 2 days)

Cron on **`thenewsoulsearchersblogc`**: `0 6 */2 * *` (06:00 UTC every 2nd calendar day). Pulls cycling RSS → three sections (road men, road women, cyclo-cross) → KV (`STATS` key `pulse:v1`) → optional GitHub commits under `src/content/pulse/` for Decap.

**Secret (so new items also land in the editor):** a fine-scoped GitHub PAT with `contents:write` on `chewbacca23/thenewsoulsearchersblog`:

```sh
npx --yes wrangler@4 secret put GITHUB_PULSE_TOKEN --name thenewsoulsearchersblogc
```

Without the token, the public `/pulse` page and homepage tease still update from KV; Decap just will not get new markdown files until the token is set.

Manual run (same token as Bearer): `POST /api/pulse/run`  
Public JSON: `GET /api/pulse`

---

## Pages / Worker build (already live)

Use this repo **`chewbacca23/thenewsoulsearchersblog`** (blog only — no subfolder).

## New project (or reconnect existing)

1. [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → your project (or **Create**)
2. **Settings** → **Builds & deployments** → **Connect to Git**
3. Repository: **`chewbacca23/thenewsoulsearchersblog`**
4. Production branch: **`main`**

| Setting | Value |
| --- | --- |
| Root directory | *(leave empty)* |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Environment variable | `NODE_VERSION` = `22` |

5. **Save** → trigger deploy
6. **Custom domains** → `thenewsoulsearchers.de` (+ optional `www`)

---

## Also serve thenewsoulsearchers.com

Same Worker, same site. `.de` stays the canonical home (SEO, RSS, GitHub editor login).
`.com` serves the public pages; `/admin`, `/auth`, `/callback`, `/looks`, and `/members` on `.com` redirect to `.de`.

### One-time Cloudflare steps

1. Put **`thenewsoulsearchers.com`** on Cloudflare (Add site → free plan is fine). Point the registrar nameservers to the ones Cloudflare shows.
2. Wait until the zone is **Active**.
3. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **`thenewsoulsearchersblogc`**
4. **Settings** → **Domains & Routes** → **Add** → **Custom Domain**
5. Add **`thenewsoulsearchers.com`**, then again **`www.thenewsoulsearchers.com`**
6. Cloudflare creates the DNS + certificate. Give it a minute, then open:
   - https://thenewsoulsearchers.com/
   - https://www.thenewsoulsearchers.com/

No need for a second Worker or a second GitHub repo. Mail stays `@thenewsoulsearchers.de`.

## If you already deployed from plasticparticles-shop

Your old project pointed at repo `plasticparticles-shop` with root directory **`soul-searchers`**.

**Switch it:**

1. Pages project → **Settings** → **Build**
2. Change repo to **`thenewsoulsearchersblog`**
3. Clear **root directory** (blank)
4. Build output: **`dist`**
5. Redeploy

Or create a fresh Pages project on this repo and delete the old one — same result.

## Verify

- https://thenewsoulsearchers.de/
- https://thenewsoulsearchers.de/journal

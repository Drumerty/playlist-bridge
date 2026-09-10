# Playlist Bridge

A single-page web app that reads your Spotify playlists and sends them to:
- **YouTube Music** (via the YouTube Data API — the playlist it creates syncs into YouTube Music)
- **Deezer**
- a **.csv** file
- a **.txt** file

Everything runs in the browser. There's no backend server, and no credentials are stored anywhere but your own browser session.

## Editing your API IDs (no more config.js edits)

There's a **Settings** panel at the top of the page now. Paste your Spotify/Google/Deezer IDs in there and hit **Save settings** — they're stored in this browser's local storage and used immediately, overriding whatever's in `config.js`. `config.js` is now just the first-run fallback; you shouldn't need to open it again unless you're changing the Redirect URI itself (which still has to match wherever this is actually hosted, so that one stays in the file).

Note this is per-browser: if you open the app in a different browser or clear site data, you'll need to re-enter the IDs there too.

## Library check: direct comparison vs upload

The Library check section now has an explicit toggle:
- **"Use the playlist loaded above directly"** (default) — compares your local folder straight against whatever playlist you picked from Spotify in this session. No CSV/TXT export or upload needed.
- **"Upload a .csv/.txt export instead"** — useful if you want to check a playlist without re-connecting Spotify, using a file exported earlier.

Either way, the missing/uncertain results are still downloadable as CSV — that export was never about the *source* of the comparison, only its *output*, so it's untouched by this toggle.

## Visual highlighting

- Spotify connection status turns green on success, red on failure.
- After a transfer, the chosen destination is tinted: green (fully added), amber (partially added — some tracks couldn't be matched), or red (failed outright).
- In Library check, **missing** rows have a red left border, **uncertain** rows an amber one, so you can scan the list at a glance.

## Files

```
index.html    the page
style.css     styling
app.js        all the logic (auth, fetching, exporting, transferring)
config.js     <- put your API client IDs here
channel.html  required by the Deezer SDK, don't rename or remove
README.md     this file
```

## 1. Host it somewhere with HTTPS

OAuth redirects need a real URL (not `file://`). Any static host works:
- GitHub Pages, Netlify, Vercel, Cloudflare Pages — free and take 2 minutes
- or run it locally with HTTPS via a tool like `mkcert` + a simple dev server, if a provider allows `localhost` redirects (Spotify does)

Whatever URL you end up with (e.g. `https://yourname.github.io/playlist-bridge/`), that's your **redirect URI** — you'll register the exact same URL with each provider below.

## 2. Register the app with each provider

### Spotify
1. Go to https://developer.spotify.com/dashboard → **Create app**
2. Add your redirect URI exactly (including trailing `/index.html` if present)
3. Copy the **Client ID** into `config.js` as `SPOTIFY_CLIENT_ID`
4. No client secret is needed — this app uses PKCE, which is safe for a pure front-end app

### Google / YouTube
1. Go to https://console.cloud.google.com/apis/credentials
2. Create an **OAuth Client ID** of type "Web application"
3. Add your URL under both "Authorized JavaScript origins" (just the origin, e.g. `https://yourname.github.io`) and "Authorized redirect URIs" (the full URL)
4. In the same project, go to **APIs & Services → Library** and enable **YouTube Data API v3**
5. Copy the **Client ID** into `config.js` as `GOOGLE_CLIENT_ID`
6. While your OAuth consent screen is in "Testing" mode, add your own Google account as a test user, or publish the app if you want anyone to use it

### Deezer
1. Go to https://developers.deezer.com/myapps → **Create a new application**
2. Set the redirect URL to your hosted URL
3. Copy the **Application ID** into `config.js` as `DEEZER_APP_ID`
4. Deezer's SDK also needs the `channel.html` file included in this folder, hosted at the same domain — don't delete it

## 3. Fill in config.js and deploy

Edit the three values in `config.js`, then upload all files to your host. Open the page, connect Spotify, pick a playlist, choose where it should go, and hit **Transfer playlist**.

## How matching works (and its limits)

Spotify tells us exact tracks. Neither YouTube nor Deezer let us transfer track IDs directly — instead the app searches each service for `"artist + title"` and takes the closest result. This works well for popular, officially-released tracks and can miss on live versions, remixes, or very obscure tracks. Anything that doesn't get a confident match is skipped and reported in the log, so you can add it manually.

## Library check (new)

A separate block at the bottom of the page lets you compare a local music folder against a playlist to see what you're missing:

1. Pick your local folder — the browser lists filenames only; nothing is read from inside the files or uploaded anywhere.
2. Either leave the playlist field empty (it'll use whatever playlist you loaded from Spotify above), or upload a `.csv`/`.txt` you exported earlier.
3. Hit **Compare library**. Matching is done by comparing words in each filename against the artist+title (case/spacing/`(Remastered)`-style tags don't matter), so it copes with reasonably messy naming.
4. Download the missing list as `.csv` or `.txt`.

This only tells you what's missing — it doesn't fetch or download anything. What you do with the missing list (buy it, rip a CD you own, use a licensed download service, etc.) is up to you.

Folder selection uses the browser's directory picker, which works in Chrome/Edge/Chromium browsers; Firefox and Safari have inconsistent support for it.

## Run as a standalone app (Steam Deck / macOS) — one redirect URI, forever

Instead of hosting this on the web, you can run it locally with a tiny built-in
server that always listens on the same fixed port: `http://127.0.0.1:17845`.
Register that *exact* URL once with Spotify, Google, and Deezer, and it'll
keep working no matter which machine you launch it from — Steam Deck today,
Mac tomorrow — because the redirect URI never changes.

Requires only Python 3, which is already installed on both macOS and SteamOS.

### One-time setup
1. In each provider's dashboard, set the redirect URI to exactly:
   `http://127.0.0.1:17845/index.html`
   (Spotify requires the literal `127.0.0.1` — not `localhost` — as of their
   2025 security changes; `config.js` already uses the right one.)
2. Fill in your three client IDs in `config.js`, same as before.

### macOS
- Double-click **`run-mac.command`**.
- First time only: macOS blocks unsigned scripts on double-click — right-click
  it and choose **Open** instead, then confirm.
- It opens your browser to the app automatically. Closing the terminal window
  stops the server.

### Steam Deck
- Switch to **Desktop Mode**.
- Open a terminal (Konsole) in this folder and run:
  ```
  chmod +x run-steamdeck.sh
  ./run-steamdeck.sh
  ```
- It'll open in the default browser (Konqueror/Firefox depending on your setup).
- Optional — to get an icon in the application menu: edit `playlist-bridge.desktop`,
  fixing the path in the `Exec=` line to wherever you put this folder, then
  copy it to `~/.local/share/applications/`.
- Optional — to launch it from **Gaming Mode** like any other game: in Desktop
  Mode, add `run-steamdeck.sh` as a **non-Steam game** via Steam's "Add a Game"
  menu. It'll still open a browser window, which is a bit unusual for Gaming
  Mode but works.

### Android
There's no equivalent "one app" packaging for Android here — a full local
server bundled into an Android app is a much bigger undertaking than this
project. The practical option on Android is opening the **hosted web version**
(see the hosting section above) in a mobile browser. That version needs its
own separately-registered redirect URI, since it's a different origin from
your local `127.0.0.1` setup — the two can coexist as separate entries in
each provider's dashboard if you want both.

## Clarifying "why is this file missing" (Library check)

Every track that doesn't confidently match a local file falls into one of two
buckets, both explained in the Library check block itself:
- **Missing** — no local file resembles it at all
- **Uncertain** — a local file is a partial match (e.g. different edit, or a
  messy filename) but not confident enough to call it "found." The closest
  filename and a rough match score are shown so you can verify by ear rather
  than the tool silently guessing wrong.

## Two CSV formats

- **Simple** (`playlistname_simple.csv`) — just Artist and Title, two columns, nothing else, in that order. This is the plain "what Spotify shows while playing" view, same information as the .txt export but in spreadsheet form. Checked by default.
- **Full** (`playlistname.csv`) — adds Album, ISRC, and a direct Spotify link per track, useful mainly for tracking down tracks with garbled source metadata (see below).

Note: only one destination can be selected at a time (it's a single-choice list now, not checkboxes) — run the transfer once per destination if you want more than one.

## Garbled artist/title names (e.g. a label name instead of an artist)

Some tracks — especially stock/production-music catalogs, mood or ambient background-music playlists — genuinely have bad metadata *at the source*. Spotify's own catalog has the business/label name in the artist field and junk text in the title; the app is just displaying exactly what Spotify's API returns, there's no "correct" name being missed.

Two things help:
- Each track preview row has a small **↗** link to open that exact track on Spotify, so you can at least confirm what Spotify itself shows.
- **Click directly on any title or artist in the preview list to edit it.** Your correction updates immediately and flows into every export/transfer for that track — CSV, TXT, YouTube, and Deezer all read from the same corrected data, so you only need to fix a name once.
- The CSV export also includes an **ISRC** column (a track's industry-standard recording code) and the Spotify link, which can help you look the real track up on a site like MusicBrainz if the Spotify data alone isn't enough.

## A Spotify limitation you'll hit



As of Spotify's February 2026 Web API migration, **reading a playlist's tracks only works for playlists you own or collaborate on.** Spotify-curated playlists — Discover Weekly, Daily Mix, genre mixes like "Old School Dubstep", Release Radar, etc. — return a 403 with no metadata about tracks at all. This is a Spotify-side restriction with no API workaround.

If you want to move one of those into another service, the practical fix is: in Spotify, use "Add to playlist" to copy its tracks into a playlist you own, then transfer that one instead.

## Known constraints

- YouTube Data API has a daily quota; a search costs more quota than a playlist insert, so very large playlists (500+ tracks) may hit the limit on a fresh Google Cloud project. You can request a quota increase from Google if needed.
- Deezer's login and API calls happen through their JS SDK (JSONP-based), which is why `channel.html` is required.
- This app requests **read-only** access to Spotify — it never modifies or deletes anything in your Spotify account.

// ---------------------------------------------------------
// Playlist Bridge — app logic
// Everything runs client-side. No backend, no stored secrets.
// ---------------------------------------------------------

// ---------------------------------------------------------
// VERSION / CHANGELOG
// Bump APP_VERSION and prepend an entry to CHANGELOG here with every
// change that ships. This array is the source of truth for the "what's
// new" panel in the header; CHANGELOG.md mirrors it for the repo — keep
// both in sync when you add an entry.
// ---------------------------------------------------------

const APP_VERSION = "1.2.0";

const CHANGELOG = [
  {
    version: "1.2.0",
    date: "2026-09-10",
    notes: [
      'Fixed: exports and the track preview now show only the primary artist (e.g. "Skeler, Devilish Trio" \u2192 "Skeler") instead of every credited artist joined with commas.',
      "Added: version number and a \"what's new\" changelog panel at the top of the page.",
    ],
  },
  {
    version: "1.1.0",
    date: "2026-09-10",
    notes: [
      "Search queries sent to YouTube, Deezer, and the iTunes/MusicBrainz auto-fix lookups now strip periods/hyphens and use only the primary artist, improving match rates.",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-09-10",
    notes: [
      "Initial release: Spotify \u2192 YouTube Music / Deezer / CSV / TXT transfer, in-page Settings panel for API IDs, Library Check against a local folder, auto-fix names via MusicBrainz/iTunes/Deezer, noisy-tag cleanup toggle, garbled-metadata editing, standalone local-server mode for Steam Deck/macOS.",
    ],
  },
];

function renderVersionInfo() {
  const badge = $("versionBadge");
  if (badge) badge.textContent = "v" + APP_VERSION;

  const list = $("changelogList");
  if (!list) return;
  list.innerHTML = "";
  CHANGELOG.forEach((entry) => {
    const li = document.createElement("li");
    li.className = "changelog-entry";
    const notesHtml = entry.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("");
    li.innerHTML =
      `<div class="changelog-version">v${escapeHtml(entry.version)} <span class="changelog-date">${escapeHtml(entry.date)}</span></div>` +
      `<ul class="changelog-notes">${notesHtml}</ul>`;
    list.appendChild(li);
  });
}

// ---------------------------------------------------------
// CONFIG — defaults come from config.js, but any value saved in the
// Settings panel (stored in localStorage) takes priority. This means
// you edit your Client IDs on the page itself, never in a file.
// ---------------------------------------------------------

const SETTINGS_STORAGE_KEY = "pb_settings_overrides";

function loadSettingsOverrides() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveSettingsOverrides(overrides) {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(overrides));
}

// CFG is a live object: settings saved later mutate it in place, so
// every function that reads CFG.SPOTIFY_CLIENT_ID etc. always sees
// the latest value without needing to re-fetch anything.
const CFG = Object.assign({}, window.PB_CONFIG, loadSettingsOverrides());

// -------- tiny state --------
const state = {
  spotifyToken: null,
  playlists: [],
  chosenPlaylist: null,
  tracks: [], // { title, artist, album }
  googleToken: null,
  deezerReady: false,
};

// -------- DOM helpers --------
const $ = (id) => document.getElementById(id);

function show(id) { $(id).classList.remove("hidden"); }

function setStatus(el, text, kind = "info") {
  el.textContent = text;
  el.classList.remove("status-ok", "status-err", "status-info");
  el.classList.add("status-" + kind);
}

function log(msg, kind = "info") {
  show("step-log");
  const li = document.createElement("li");
  li.className = kind;
  li.textContent = msg;
  $("logList").appendChild(li);
  li.scrollIntoView({ block: "nearest" });
}

function checkSetup() {
  const missing = [];
  if (!CFG.SPOTIFY_CLIENT_ID || CFG.SPOTIFY_CLIENT_ID.startsWith("YOUR_")) missing.push("Spotify");
  if (!CFG.GOOGLE_CLIENT_ID || CFG.GOOGLE_CLIENT_ID.startsWith("YOUR_")) missing.push("Google (YouTube)");
  if (!CFG.DEEZER_APP_ID || CFG.DEEZER_APP_ID.startsWith("YOUR_")) missing.push("Deezer");
  if (missing.length) {
    $("setupWarningText").textContent =
      `Missing client ID(s) for: ${missing.join(", ")}. You can still try Spotify + file export ` +
      `if only those are filled in — fill the rest in above, in Settings.`;
    show("setupWarning");
  } else {
    $("setupWarning").classList.add("hidden");
  }
}

function populateSettingsForm() {
  $("cfgSpotifyId").value = CFG.SPOTIFY_CLIENT_ID.startsWith("YOUR_") ? "" : CFG.SPOTIFY_CLIENT_ID;
  $("cfgGoogleId").value = CFG.GOOGLE_CLIENT_ID.startsWith("YOUR_") ? "" : CFG.GOOGLE_CLIENT_ID;
  $("cfgDeezerId").value = CFG.DEEZER_APP_ID.startsWith("YOUR_") ? "" : CFG.DEEZER_APP_ID;
  $("cfgRedirectUri").value = CFG.REDIRECT_URI;
}

function saveSettingsForm() {
  const overrides = {
    SPOTIFY_CLIENT_ID: $("cfgSpotifyId").value.trim() || CFG.SPOTIFY_CLIENT_ID,
    GOOGLE_CLIENT_ID: $("cfgGoogleId").value.trim() || CFG.GOOGLE_CLIENT_ID,
    DEEZER_APP_ID: $("cfgDeezerId").value.trim() || CFG.DEEZER_APP_ID,
  };
  Object.assign(CFG, overrides); // mutate in place — every function sees this immediately
  saveSettingsOverrides(overrides);
  setStatus($("settingsStatus"), "Saved to this browser.", "ok");
  checkSetup();
}

// ===========================================================
// PKCE helpers (Spotify Authorization Code with PKCE)
// ===========================================================

function randomString(len = 64) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  const rnd = crypto.getRandomValues(new Uint8Array(len));
  for (let i = 0; i < len; i++) out += chars[rnd[i] % chars.length];
  return out;
}

async function sha256base64url(input) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ===========================================================
// SPOTIFY
// ===========================================================

async function connectSpotify() {
  const verifier = randomString(64);
  sessionStorage.setItem("pb_spotify_verifier", verifier);
  const challenge = await sha256base64url(verifier);

  const params = new URLSearchParams({
    client_id: CFG.SPOTIFY_CLIENT_ID,
    response_type: "code",
    redirect_uri: CFG.REDIRECT_URI,
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: "playlist-read-private playlist-read-collaborative",
  });
  window.location.href = "https://accounts.spotify.com/authorize?" + params.toString();
}

async function exchangeSpotifyCode(code) {
  const verifier = sessionStorage.getItem("pb_spotify_verifier");
  const body = new URLSearchParams({
    client_id: CFG.SPOTIFY_CLIENT_ID,
    grant_type: "authorization_code",
    code,
    redirect_uri: CFG.REDIRECT_URI,
    code_verifier: verifier,
  });
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error("Spotify token exchange failed: " + (await res.text()));
  const data = await res.json();
  state.spotifyToken = data.access_token;
}

async function spotifyFetch(url) {
  const res = await fetch(url, {
    headers: { Authorization: "Bearer " + state.spotifyToken },
  });
  if (!res.ok) {
    const err = new Error("Spotify API error " + res.status);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function loadSpotifyPlaylists() {
  setStatus($("spotifyStatus"), "Loading playlists…", "info");
  let url = "https://api.spotify.com/v1/me/playlists?limit=50";
  const all = [];
  while (url) {
    const data = await spotifyFetch(url);
    if (data && data.items) {
      all.push(...data.items);
    }
    url = data ? data.next : null;
  }
  state.playlists = all;
  renderPlaylists();
  setStatus($("spotifyStatus"), `Connected — ${all.length} playlists found.`, "ok");
  show("step-playlists");
}

function renderPlaylists() {
  const container = $("playlistList");
  container.innerHTML = "";
  state.playlists.forEach((pl) => {
    // Spotify's Feb 2026 API migration renamed `tracks` -> `items` on playlist
    // objects. Keep the old key as a fallback in case a cached/older token
    // path or a differently-versioned response ever sends it.
    const count = pl.items?.total ?? pl.tracks?.total ?? 0;

    const div = document.createElement("div");
    div.className = "playlist-item";
    div.innerHTML = `<span class="name">${escapeHtml(pl.name)}</span><span class="count">${count} tracks</span>`;
    div.addEventListener("click", () => selectPlaylist(pl));
    container.appendChild(div);
  });
}

async function selectPlaylist(pl) {
  state.chosenPlaylist = pl;
  $("chosenPlaylistName").textContent = pl.name;
  $("trackList").innerHTML = "<li>Loading tracks…</li>";
  show("step-destinations");

  // Spotify's Feb 2026 API migration renamed this endpoint from
  // /tracks to /items, and the entry key from `track` to `item`.
  // It's also now ONLY available for playlists you own or collaborate
  // on — for anything else (e.g. Spotify's own editorial/algorithmic
  // playlists like Discover Weekly or genre mixes) it returns 403
  // with no workaround on the API side.
  let url = `https://api.spotify.com/v1/playlists/${pl.id}/items?fields=items(item(id,name,artists(name),album(name),external_ids(isrc))),next&limit=100`;
  const tracks = [];

  try {
    while (url) {
      let data;
      try {
        data = await spotifyFetch(url);
      } catch (err) {
        if (err.status === 403) {
          log(
            `Can't read tracks for "${pl.name}" — this endpoint only works for playlists you own or collaborate on. If this is a Spotify-curated playlist (Discover Weekly, a genre mix, etc.), the Web API blocks it entirely; there's no workaround. Try a playlist you created or added tracks to yourself.`,
            "err"
          );
          break;
        }
        throw err;
      }
      if (!data || !data.items) break;

      for (const entry of data.items) {
        const t = entry && entry.item;
        if (!t) continue;

        tracks.push({
          title: t.name,
          artist: Array.isArray(t.artists) ? t.artists.map((a) => a.name).join(", ") : "Unknown Artist",
          album: t.album?.name || "",
          isrc: t.external_ids?.isrc || "",
          spotifyUrl: t.id ? `https://open.spotify.com/track/${t.id}` : "",
        });
      }
      url = data.next;
    }
  } catch (err) {
    log(`Error fetching tracks: ${err.message}`, "err");
  }

  state.tracks = tracks;
  renderTrackPreview();
}
function renderTrackPreview() {
  $("trackCount").textContent = state.tracks.length;
  const list = $("trackList");
  list.innerHTML = "";
  state.tracks.forEach((t, idx) => {
    const li = document.createElement("li");
    li.className = "track-row";
    const linkHtml = t.spotifyUrl
      ? `<a href="${t.spotifyUrl}" target="_blank" rel="noopener" class="t-link" title="Open on Spotify to check the real metadata">↗</a>`
      : "";
    li.innerHTML = `
      <span class="t-artist" contenteditable="true" data-idx="${idx}" data-field="artist">${escapeHtml(t.artist)}</span>
      <span class="t-title" contenteditable="true" data-idx="${idx}" data-field="title">${escapeHtml(t.title)}</span>
      ${linkHtml}
    `;
    list.appendChild(li);
  });
  updateLibSourceUI();
}

// Track edits made directly in the preview list flow into state.tracks,
// so a manual fix to garbled metadata (common with stock/production-music
// tracks whose source data is just bad) carries through to every export
// and every transfer destination — not just one of them.
document.addEventListener("blur", (e) => {
  const el = e.target;
  if (!el.matches || !el.matches("[data-field]")) return;
  const idx = Number(el.dataset.idx);
  const field = el.dataset.field;
  if (state.tracks[idx]) {
    state.tracks[idx][field] = el.textContent.trim();
  }
}, true);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ===========================================================
// FILE EXPORTS (.csv / .txt)
// ===========================================================

function downloadBlob(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

function csvFrom(rows) {
  return rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\r\n");
}

// ---------- name cleanup for export/search ----------
// Strips noise commonly found in Spotify's title field that has nothing
// to do with identifying the track — remaster/edition tags, "Official
// Video", live-recording notes, etc. Doesn't touch meaningful content
// like "(feat. Artist)" or a track's actual subtitle.

const NOISE_WORDS =
  "remaster(?:ed)?(?:\\s*\\d{4})?|\\d{4}\\s*remaster(?:ed)?|" +
  "live(?:\\s*(?:at|from|in)\\s*[^)\\]]*)?|" +
  "mono|stereo|single version|album version|deluxe(?:\\s*edition)?|" +
  "bonus track|radio edit|clean(?:\\s*version)?|explicit(?:\\s*version)?|" +
  "official\\s*(?:video|audio|music video|lyric video)|lyric video|" +
  "hd|hq|4k|visualizer|video edit|extended (?:mix|version)|original mix";

// e.g. "Song Title (Remastered 2011)" / "Song Title [Official Video]"
const NOISE_BRACKETED = new RegExp(`\\s*[\\(\\[]\\s*(?:${NOISE_WORDS})\\s*[\\)\\]]`, "gi");
// e.g. "Song Title - Remastered 2011" (no brackets, trailing dash form)
const NOISE_DASH_SUFFIX = new RegExp(`\\s*-\\s*(?:${NOISE_WORDS})\\s*$`, "gi");

function cleanTitleText(title) {
  let t = String(title);
  t = t.replace(NOISE_BRACKETED, "");
  t = t.replace(NOISE_DASH_SUFFIX, "");
  t = t.replace(/\s{2,}/g, " ").trim();
  return t || title; // never return an empty string — fall back to original
}

function cleanArtistText(artist) {
  // Reduce to the primary/lead artist only. Multiple credited artists
  // joined with a comma, "&", "/", "feat.", "x", "vs." etc. (e.g. "Skeler,
  // Devilish Trio") used to just get their separators standardized and
  // all of them kept — that's what was still showing up in exports and
  // the preview list. Now only the first name is kept, same as what's
  // already used for building search queries below.
  return primaryArtist(artist);
}

function isCleanupEnabled() {
  const el = $("cleanNamesToggle");
  return el ? el.checked : false;
}

// ---------- search-query optimization ----------
// primaryArtist() is shared by cleanArtistText() above (what's shown/
// exported) and buildSearchQuery() below (what's sent to search APIs).
// searchFriendly() is search-only — export/preview text keeps its
// original punctuation.

function primaryArtist(artist) {
  // "La Bouche, Justus" / "La Bouche feat. Justus" often searches worse
  // than "La Bouche" alone — secondary/featured credits add noise that
  // some search backends weight too heavily. Take the lead artist only.
  const first = String(artist)
    .split(/\s*[,&/]\s*|\s+feat\.?\s+|\s+ft\.?\s+|\s+featuring\s+|\s+x\s+|\s+vs\.?\s+/i)[0]
    .trim();
  return first || artist;
}

function searchFriendly(s) {
  // "JON A.S. KICK" and "Say it Right - Old School Version" style
  // punctuation (periods used as spacers, stray hyphens) can make a
  // literal search match worse than the plain words alone. Strip it for
  // query-building only — never touches the stored title/artist.
  return String(s)
    .replace(/\./g, "")
    .replace(/-/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// The single function everything below should call when building a query
// for an external search endpoint (YouTube search, Deezer search, iTunes
// search). Applies the noise-strip from cleanTitleText first (Remastered/
// Official Video/etc. tags), then reduces to the primary artist, then
// strips leftover punctuation.
function buildSearchQuery(track) {
  const title = cleanTitleText(track.title);
  const artist = primaryArtist(track.artist);
  return searchFriendly(`${artist} ${title}`);
}

// ===========================================================
// NAME LOOKUP SERVICES — free, no credentials, no login for any of these.
//
// MusicBrainz : public metadata DB, matched by ISRC. Direct fetch()
//               works — MusicBrainz sets normal CORS headers.
// iTunes      : Apple's public search API. Does NOT support CORS for
//               direct fetch(), so we use JSONP (script-tag injection),
//               which iTunes still explicitly supports via ?callback=.
//               Rate limit: ~20 calls/minute per Apple's own docs.
// Deezer      : public search endpoint. Also blocks CORS on fetch()
//               by design — Deezer's own developer FAQ says to use
//               JSONP (?output=jsonp&callback=) instead, so that's
//               what we do here. This does NOT need Deezer login —
//               that's only required for the transfer feature, which
//               writes to your account; a plain search is public data.
// ===========================================================

function jsonpRequest(url) {
  return new Promise((resolve, reject) => {
    const cbName = "pbJsonp_" + Math.random().toString(36).slice(2);
    const timeout = setTimeout(() => { cleanup(); reject(new Error("JSONP request timed out")); }, 8000);
    const script = document.createElement("script");
    function cleanup() {
      clearTimeout(timeout);
      delete window[cbName];
      script.remove();
    }
    window[cbName] = (data) => { cleanup(); resolve(data); };
    script.src = url + (url.includes("?") ? "&" : "?") + "callback=" + cbName;
    script.onerror = () => { cleanup(); reject(new Error("JSONP request failed to load")); };
    document.head.appendChild(script);
  });
}

async function musicbrainzLookupByIsrc(isrc) {
  const res = await fetch(`https://musicbrainz.org/ws/2/isrc/${encodeURIComponent(isrc)}?fmt=json&inc=artist-credits`);
  if (!res.ok) return { rateLimited: res.status === 503, hit: null };
  const data = await res.json();
  const rec = data.recordings && data.recordings[0];
  if (!rec || !rec.title) return { rateLimited: false, hit: null };
  const artist = Array.isArray(rec["artist-credit"]) ? rec["artist-credit"].map((ac) => ac.name).join(", ") : null;
  return { rateLimited: false, hit: { title: rec.title, artist } };
}

async function itunesLookupByText(query) {
  const url = `https://itunes.apple.com/search?media=music&entity=song&limit=1&term=${encodeURIComponent(query)}`;
  const data = await jsonpRequest(url);
  const r = data && data.results && data.results[0];
  return r ? { title: r.trackName, artist: r.artistName } : null;
}

async function deezerLookupByText(query) {
  const url = `https://api.deezer.com/search?limit=1&output=jsonp&q=${encodeURIComponent(query)}`;
  const data = await jsonpRequest(url);
  const r = data && data.data && data.data[0];
  return r ? { title: r.title, artist: r.artist ? r.artist.name : null } : null;
}

function looksLikeConfidentMatch(track, hit) {
  if (!hit || !hit.title) return false;
  const a = normalizeForMatch(`${track.artist} ${track.title}`);
  const b = normalizeForMatch(`${hit.artist || ""} ${hit.title}`);
  return tokenSimilarity(a, b) >= 0.4;
}

function applyHit(track, hit, source) {
  const changed = hit.title !== track.title || (hit.artist && hit.artist !== track.artist);
  track.title = hit.title;
  if (hit.artist) track.artist = hit.artist;
  track._resolvedBy = source;
  return changed;
}

async function fixNamesViaLookupServices() {
  $("btnFixNamesMusicBrainz").disabled = true;
  state.tracks.forEach((t) => { delete t._resolvedBy; });

  let mbFixed = 0, itunesFixed = 0, deezerFixed = 0;

  // Pass 1 — MusicBrainz, ISRC-based (most reliable when it has data)
  const withIsrc = state.tracks.filter((t) => t.isrc);
  if (withIsrc.length) {
    log(`Pass 1/3 — MusicBrainz (by ISRC): checking ${withIsrc.length} tracks…`);
    for (const t of withIsrc) {
      try {
        const { rateLimited, hit } = await musicbrainzLookupByIsrc(t.isrc);
        if (rateLimited) { log("MusicBrainz asked us to slow down — stopping this pass early.", "err"); break; }
        if (hit) { if (applyHit(t, hit, "MusicBrainz")) mbFixed++; }
      } catch { /* skip this track, other passes may still catch it */ }
      await sleep(1100); // MusicBrainz hard limit: 1 request/second
    }
  } else {
    log("No tracks have an ISRC — skipping the MusicBrainz pass.", "info");
  }

  // Pass 2 — iTunes Search, text-based fallback for anything MusicBrainz didn't confirm
  const stillNeedItunes = state.tracks.filter((t) => !t._resolvedBy);
  if (stillNeedItunes.length) {
    log(`Pass 2/3 — iTunes Search: checking ${stillNeedItunes.length} remaining tracks (~20/min limit, slow)…`);
    for (const t of stillNeedItunes) {
      try {
        const hit = await itunesLookupByText(buildSearchQuery(t));
        if (looksLikeConfidentMatch(t, hit)) { if (applyHit(t, hit, "iTunes")) itunesFixed++; }
      } catch { /* leave it for Deezer pass or as-is */ }
      await sleep(3200); // stay safely under Apple's ~20 calls/minute limit
    }
  }

  // Pass 3 — Deezer Search, text-based, last resort
  const stillNeedDeezer = state.tracks.filter((t) => !t._resolvedBy);
  if (stillNeedDeezer.length) {
    log(`Pass 3/3 — Deezer Search: checking ${stillNeedDeezer.length} remaining tracks…`);
    for (const t of stillNeedDeezer) {
      try {
        const hit = await deezerLookupByText(buildSearchQuery(t));
        if (looksLikeConfidentMatch(t, hit)) { if (applyHit(t, hit, "Deezer")) deezerFixed++; }
      } catch { /* nothing more to try */ }
      await sleep(400);
    }
  }

  const untouched = state.tracks.filter((t) => !t._resolvedBy).length;
  renderTrackPreview();
  log(
    `Done — MusicBrainz fixed ${mbFixed}, iTunes fixed ${itunesFixed}, Deezer fixed ${deezerFixed}; ${untouched} left as-is (already fine or no confident match anywhere).`,
    mbFixed + itunesFixed + deezerFixed ? "ok" : "info"
  );
  $("btnFixNamesMusicBrainz").disabled = false;
}

function exportableTracks() {
  if (!isCleanupEnabled()) return state.tracks;
  return state.tracks.map((t) => ({
    ...t,
    title: cleanTitleText(t.title),
    artist: cleanArtistText(t.artist),
  }));
}

function exportCsv() {
  const rows = [["Title", "Artist", "Album", "ISRC", "Spotify Link"]];
  exportableTracks().forEach((t) => rows.push([t.title, t.artist, t.album, t.isrc || "", t.spotifyUrl || ""]));
  const name = safeFileName(state.chosenPlaylist.name) + ".csv";
  downloadBlob(name, csvFrom(rows), "text/csv");
  log(`Saved ${name}`, "ok");
}

function exportCsvSimple() {
  const rows = [["Artist", "Title"]];
  exportableTracks().forEach((t) => rows.push([t.artist, t.title]));
  const name = safeFileName(state.chosenPlaylist.name) + "_simple.csv";
  downloadBlob(name, csvFrom(rows), "text/csv");
  log(`Saved ${name}`, "ok");
}

function exportTxt() {
  const lines = exportableTracks().map((t) => `${t.artist} - ${t.title}`);
  const name = safeFileName(state.chosenPlaylist.name) + ".txt";
  downloadBlob(name, lines.join("\r\n"), "text/plain");
  log(`Saved ${name}`, "ok");
}

function safeFileName(s) {
  return s.replace(/[^a-z0-9\-_ ]/gi, "").trim().replace(/\s+/g, "_") || "playlist";
}

// ===========================================================
// YOUTUBE MUSIC (via YouTube Data API v3 — playlists sync to YT Music)
// ===========================================================

function loadGoogleIdentityScript() {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.accounts) return resolve();
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function getGoogleToken() {
  if (state.googleToken) return state.googleToken;
  await loadGoogleIdentityScript();
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: CFG.GOOGLE_CLIENT_ID,
      scope: "https://www.googleapis.com/auth/youtube",
      callback: (resp) => {
        if (resp.error) return reject(new Error(resp.error));
        state.googleToken = resp.access_token;
        resolve(resp.access_token);
      },
    });
    client.requestAccessToken();
  });
}

async function transferToYoutube() {
  log("Connecting to YouTube…");
  const token = await getGoogleToken();
  const authHeader = { Authorization: "Bearer " + token, "Content-Type": "application/json" };

  const createRes = await fetch(
    "https://www.googleapis.com/youtube/v3/playlists?part=snippet,status",
    {
      method: "POST",
      headers: authHeader,
      body: JSON.stringify({
        snippet: {
          title: state.chosenPlaylist.name,
          description: "Imported from Spotify with Playlist Bridge",
        },
        status: { privacyStatus: "private" },
      }),
    }
  );
  if (!createRes.ok) throw new Error("Could not create YouTube playlist: " + (await createRes.text()));
  const playlist = await createRes.json();
  const playlistId = playlist.id;
  log(`Created YouTube playlist "${state.chosenPlaylist.name}"`, "ok");

  let added = 0, missed = 0;
  for (const t of exportableTracks()) {
    const q = encodeURIComponent(buildSearchQuery(t));
    const searchRes = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1&q=${q}`,
      { headers: authHeader }
    );
    if (!searchRes.ok) { missed++; log(`Search failed for "${t.title}"`, "err"); continue; }
    const searchData = await searchRes.json();
    const videoId = searchData.items && searchData.items[0] && searchData.items[0].id.videoId;
    if (!videoId) { missed++; log(`No YouTube match for "${t.artist} - ${t.title}"`, "err"); continue; }

    const addRes = await fetch(
      "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet",
      {
        method: "POST",
        headers: authHeader,
        body: JSON.stringify({
          snippet: {
            playlistId,
            resourceId: { kind: "youtube#video", videoId },
          },
        }),
      }
    );
    if (addRes.ok) { added++; } else { missed++; log(`Could not add "${t.title}"`, "err"); }
    await sleep(150);
  }
  log(`YouTube: ${added} added, ${missed} missed.`, missed ? "info" : "ok");
  return { added, missed };
}

// ===========================================================
// DEEZER
// ===========================================================

function loadDeezerSdk() {
  return new Promise((resolve, reject) => {
    if (window.DZ) return resolve();
    window.dzAsyncInit = function () {
      DZ.init({ appId: CFG.DEEZER_APP_ID, channelUrl: CFG.REDIRECT_URI.replace(/index\.html$/, "") + "channel.html" });
      resolve();
    };
    const s = document.createElement("script");
    s.src = "https://connect.deezer.com/js/client.js";
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function deezerLogin() {
  return new Promise((resolve, reject) => {
    DZ.login(
      (resp) => (resp.authResponse ? resolve(resp) : reject(new Error("Deezer login was not authorized"))),
             { perms: "basic_access,manage_library" }
    );
  });
}

function deezerApi(path, method, params) {
  return new Promise((resolve, reject) => {
    DZ.api(path, method, params, (resp) => {
      if (resp && resp.error) reject(new Error(resp.error.message || "Deezer API error"));
      else resolve(resp);
    });
  });
}

async function transferToDeezer() {
  log("Connecting to Deezer…");
  await loadDeezerSdk();
  await deezerLogin();

  const me = await deezerApi("/user/me", "GET");
  const created = await deezerApi(`/user/${me.id}/playlists`, "POST", { title: state.chosenPlaylist.name });
  const playlistId = created.id;
  log(`Created Deezer playlist "${state.chosenPlaylist.name}"`, "ok");

  const trackIds = [];
  let missed = 0;
  for (const t of exportableTracks()) {
    // Try a precise field-scoped query first (best when metadata is clean),
    // then fall back to the same loosely-cleaned free-text query the other
    // services use — the quoted exact-field search can miss on punctuation
    // or multi-artist credits that a plain-text search handles fine.
    const preciseQ = `track:"${cleanTitleText(t.title)}" artist:"${primaryArtist(t.artist)}"`;
    let results = await deezerApi("/search", "GET", { q: preciseQ });
    let hit = results && results.data && results.data[0];
    if (!hit) {
      results = await deezerApi("/search", "GET", { q: buildSearchQuery(t) });
      hit = results && results.data && results.data[0];
    }
    if (hit) trackIds.push(hit.id);
    else { missed++; log(`No Deezer match for "${t.artist} - ${t.title}"`, "err"); }
    await sleep(120);
  }

  if (trackIds.length) {
    await deezerApi(`/playlist/${playlistId}/tracks`, "POST", { songs: trackIds.join(",") });
  }
  log(`Deezer: ${trackIds.length} added, ${missed} missed.`, missed ? "info" : "ok");
  return { added: trackIds.length, missed };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ===========================================================
// LIBRARY CHECK — compare a local folder against a playlist
// Everything here is local: filenames are read from the browser's
// file picker, nothing is uploaded anywhere.
// ===========================================================

const libState = {
  localFilenames: [],   // raw filenames from the folder picker
  playlistTracks: [],   // [{ title, artist }] — from session or uploaded file
  missing: [],          // tracks with no plausible local candidate
  uncertain: [],         // tracks with a low-confidence candidate — verify by ear
};

const STOPWORDS = new Set([
  "the", "a", "an", "feat", "feat.", "ft", "ft.", "featuring",
  "official", "audio", "video", "lyrics", "lyric", "hd", "hq",
  "remastered", "remaster", "version", "edit", "radio", "explicit",
  "with", "and", "of",
]);

function normalizeForMatch(s) {
  return String(s)
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")   // strip accents
    .replace(/\.[a-z0-9]{2,4}$/i, "")                     // drop file extension
    .replace(/[\(\[][^)\]]*[\)\]]/g, " ")                 // drop (Remastered), [Official Video], etc.
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

function tokenSimilarity(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) return 0;
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let overlap = 0;
  for (const t of setA) if (setB.has(t)) overlap++;
  return overlap / new Set([...setA, ...setB]).size; // Jaccard similarity
}

const HIGH_CONFIDENCE = 0.55; // at/above this: treat as found, don't bother the user
const LOW_CONFIDENCE = 0.22;  // below this: no plausible candidate, truly missing
// between the two: "uncertain" — a candidate exists but isn't a confident match

function parsePlaylistCsv(text) {
  // Matches the format exportCsv() produces: Title,Artist,Album with
  // double-quoted, "" -escaped fields.
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  const rows = lines.map((line) => {
    const cells = [];
    let cur = "", inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') { inQuotes = false; }
        else cur += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ",") { cells.push(cur); cur = ""; }
        else cur += c;
      }
    }
    cells.push(cur);
    return cells;
  });
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const titleIdx = header.indexOf("title");
  const artistIdx = header.indexOf("artist");
  return rows.slice(1).map((r) => ({
    title: r[titleIdx] || "",
    artist: r[artistIdx] || "",
  }));
}

function parsePlaylistTxt(text) {
  // Matches the format exportTxt() produces: "Artist - Title" per line.
  return text.split(/\r?\n/).filter((l) => l.trim().length).map((line) => {
    const idx = line.indexOf(" - ");
    if (idx === -1) return { title: line.trim(), artist: "" };
    return { artist: line.slice(0, idx).trim(), title: line.slice(idx + 3).trim() };
  });
}

async function handleLibraryFolderInput(e) {
  const files = Array.from(e.target.files || []);
  libState.localFilenames = files
    .map((f) => f.name)
    .filter((name) => /\.(mp3|flac|m4a|wav|aac|ogg)$/i.test(name));
  $("libFolderStatus").textContent = `${libState.localFilenames.length} audio files found in folder.`;
}

async function handleLibraryPlaylistInput(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const text = await file.text();
  const tracks = file.name.toLowerCase().endsWith(".csv")
    ? parsePlaylistCsv(text)
    : parsePlaylistTxt(text);
  libState.playlistTracks = tracks;
  $("libPlaylistStatus").textContent = `Loaded ${tracks.length} tracks from ${file.name}.`;
}

function updateLibSourceUI() {
  const useUpload = $("libSourceUpload").checked;
  $("libPlaylistInput").classList.toggle("hidden", !useUpload);
  if (useUpload) {
    $("libSourceHint").textContent = "";
  } else if (state.tracks.length) {
    const name = state.chosenPlaylist ? state.chosenPlaylist.name : "the loaded playlist";
    setStatus($("libSourceHint"), `Will compare directly against "${name}" (${state.tracks.length} tracks) — no export/upload needed.`, "ok");
  } else {
    setStatus($("libSourceHint"), "No playlist loaded yet — pick one above, or switch to upload a file.", "info");
  }
}

async function compareLibrary() {
  const useUpload = $("libSourceUpload").checked;
  const tracks = useUpload ? libState.playlistTracks : state.tracks;

  if (!libState.localFilenames.length) {
    log("Pick a local folder first.", "err");
    return;
  }
  if (useUpload && !tracks.length) {
    log("Upload a .csv or .txt export first, or switch to using the loaded playlist.", "err");
    return;
  }
  if (!useUpload && !tracks.length) {
    log("No playlist loaded — connect Spotify and pick a playlist above, or switch to upload a file.", "err");
    return;
  }

  $("btnCompareLibrary").disabled = true;
  log(`Comparing ${tracks.length} playlist tracks against ${libState.localFilenames.length} local files…`);

  const localTokenSets = libState.localFilenames.map((name) => ({
    name,
    tokens: normalizeForMatch(name),
  }));

  const missing = [];
  const uncertain = [];

  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    const trackTokens = normalizeForMatch(`${t.artist} ${t.title}`);
    let bestScore = 0;
    let bestFile = null;
    for (const f of localTokenSets) {
      const score = tokenSimilarity(trackTokens, f.tokens);
      if (score > bestScore) { bestScore = score; bestFile = f.name; }
      if (bestScore === 1) break; // can't do better than a perfect match
    }

    if (bestScore >= HIGH_CONFIDENCE) {
      // confidently found locally — nothing to report
    } else if (bestScore >= LOW_CONFIDENCE) {
      uncertain.push({ ...t, candidate: bestFile, score: bestScore });
    } else {
      missing.push({ ...t, candidate: null, score: bestScore });
    }

    if (i % 200 === 0) await sleep(0); // keep the UI responsive on big libraries
  }

  libState.missing = missing;
  libState.uncertain = uncertain;
  renderLibraryResults(tracks.length);
  log(
    `Library check done — ${missing.length} missing, ${uncertain.length} uncertain (close but unconfirmed match), ${tracks.length - missing.length - uncertain.length} confidently found.`,
    "info"
  );
  $("btnCompareLibrary").disabled = false;
}

function renderLibraryResults(totalCount) {
  $("libMissingCount").textContent = libState.missing.length;
  $("libUncertainCount").textContent = libState.uncertain.length;
  $("libTotalCount").textContent = totalCount;

  const missingList = $("libMissingList");
  missingList.innerHTML = "";
  libState.missing.forEach((t) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="t-artist">${escapeHtml(t.artist)}</span><span class="t-title">${escapeHtml(t.title)}</span>`;
    missingList.appendChild(li);
  });

  const uncertainList = $("libUncertainList");
  uncertainList.innerHTML = "";
  libState.uncertain.forEach((t) => {
    const li = document.createElement("li");
    li.className = "lib-uncertain-row";
    li.innerHTML = `
      <div class="t-main"><span class="t-artist">${escapeHtml(t.artist)}</span><span class="t-title">${escapeHtml(t.title)}</span></div>
      <div class="t-candidate">closest local file: <code>${escapeHtml(t.candidate)}</code> (${Math.round(t.score * 100)}% word overlap) — check by ear</div>
    `;
    uncertainList.appendChild(li);
  });

  show("libResults");
}

function downloadMissingCsv() {
  const rows = [["Title", "Artist"]];
  libState.missing.forEach((t) => rows.push([t.title, t.artist]));
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  downloadBlob("missing.csv", csv, "text/csv");
}

function downloadMissingTxt() {
  const lines = libState.missing.map((t) => `${t.artist} - ${t.title}`);
  downloadBlob("missing.txt", lines.join("\r\n"), "text/plain");
}

function downloadUncertainCsv() {
  const rows = [["Title", "Artist", "ClosestLocalFile", "MatchScore"]];
  libState.uncertain.forEach((t) => rows.push([t.title, t.artist, t.candidate, Math.round(t.score * 100) + "%"]));
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  downloadBlob("uncertain_matches.csv", csv, "text/csv");
}

// ===========================================================
// TRANSFER ORCHESTRATION
// ===========================================================

async function runTransfer() {
  const checkedBoxes = Array.from(document.querySelectorAll('input[name="dest"]:checked'));
  if (!checkedBoxes.length) { log("Pick at least one destination.", "err"); return; }
  if (!state.tracks.length) { log("This playlist has no tracks to transfer.", "err"); return; }

  // clear any highlighting left over from a previous run
  document.querySelectorAll(".dest-option").forEach((el) =>
    el.classList.remove("result-ok", "result-partial", "result-fail")
  );

  $("btnTransfer").disabled = true;
  show("step-log");
  $("logList").innerHTML = "";
  log(`Starting transfer of "${state.chosenPlaylist.name}" (${state.tracks.length} tracks)…`);

  for (const checkbox of checkedBoxes) {
    const dest = checkbox.value;
    // Use the checkbox we already have a reference to, rather than
    // re-querying the DOM by value — avoids silent failures if markup
    // and script ever get out of sync (e.g. a stale cached HTML file).
    const label = checkbox.closest(".dest-option");
    try {
      if (dest === "csv") { exportCsv(); label?.classList.add("result-ok"); }
      else if (dest === "csv-simple") { exportCsvSimple(); label?.classList.add("result-ok"); }
      else if (dest === "txt") { exportTxt(); label?.classList.add("result-ok"); }
      else if (dest === "youtube") {
        const { added, missed } = await transferToYoutube();
        label?.classList.add(missed === 0 ? "result-ok" : added > 0 ? "result-partial" : "result-fail");
      } else if (dest === "deezer") {
        const { added, missed } = await transferToDeezer();
        label?.classList.add(missed === 0 ? "result-ok" : added > 0 ? "result-partial" : "result-fail");
      } else {
        log(`Unknown destination "${dest}" — skipped.`, "err");
      }
    } catch (err) {
      log(`${dest}: ${err.message}`, "err");
      label?.classList.add("result-fail");
    }
    await sleep(50); // give each triggered download its own tick, some browsers throttle back-to-back downloads
  }

  log("Done.", "ok");
  $("btnTransfer").disabled = false;
}

// ===========================================================
// BOOT
// ===========================================================

function init() {
  renderVersionInfo();
  checkSetup();
  populateSettingsForm();

  $("btnSaveSettings").addEventListener("click", saveSettingsForm);
  $("btnConnectSpotify").addEventListener("click", connectSpotify);
  $("btnTransfer").addEventListener("click", runTransfer);
  $("btnFixNamesMusicBrainz").addEventListener("click", fixNamesViaLookupServices);

  $("libFolderInput").addEventListener("change", handleLibraryFolderInput);
  $("libPlaylistInput").addEventListener("change", handleLibraryPlaylistInput);
  $("libSourceSession").addEventListener("change", updateLibSourceUI);
  $("libSourceUpload").addEventListener("change", updateLibSourceUI);
  $("btnCompareLibrary").addEventListener("click", compareLibrary);
  $("btnDownloadMissingCsv").addEventListener("click", downloadMissingCsv);
  $("btnDownloadMissingTxt").addEventListener("click", downloadMissingTxt);
  $("btnDownloadUncertainCsv").addEventListener("click", downloadUncertainCsv);
  updateLibSourceUI();

  // Handle Spotify redirect back with ?code=...
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (code) {
    window.history.replaceState({}, "", CFG.REDIRECT_URI);
    exchangeSpotifyCode(code)
      .then(loadSpotifyPlaylists)
      .catch((err) => { setStatus($("spotifyStatus"), "Spotify connection failed: " + err.message, "err"); });
  }
}

init();

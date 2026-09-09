// ---------------------------------------------------------
// Playlist Bridge — app logic
// Everything runs client-side. No backend, no stored secrets.
// ---------------------------------------------------------

const CFG = window.PB_CONFIG;

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
    `if only those are filled in — see config.js and README.md.`;
    show("setupWarning");
  }
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
  $("spotifyStatus").textContent = "Loading playlists…";
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
  $("spotifyStatus").textContent = `Connected — ${all.length} playlists found.`;
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
  let url = `https://api.spotify.com/v1/playlists/${pl.id}/items?fields=items(item(name,artists(name),album(name))),next&limit=100`;
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
  state.tracks.forEach((t) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="t-title">${escapeHtml(t.title)}</span><span class="t-artist">${escapeHtml(t.artist)}</span>`;
    list.appendChild(li);
  });
}

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

function exportCsv() {
  const rows = [["Title", "Artist", "Album"]];
  state.tracks.forEach((t) => rows.push([t.title, t.artist, t.album]));
  const csv = rows
  .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
  .join("\r\n");
  const name = safeFileName(state.chosenPlaylist.name) + ".csv";
  downloadBlob(name, csv, "text/csv");
  log(`Saved ${name}`, "ok");
}

function exportTxt() {
  const lines = state.tracks.map((t) => `${t.artist} - ${t.title}`);
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
  for (const t of state.tracks) {
    const q = encodeURIComponent(`${t.artist} ${t.title}`);
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
  for (const t of state.tracks) {
    const q = `track:"${t.title}" artist:"${t.artist}"`;
    const results = await deezerApi("/search", "GET", { q });
    const hit = results && results.data && results.data[0];
    if (hit) trackIds.push(hit.id);
    else { missed++; log(`No Deezer match for "${t.artist} - ${t.title}"`, "err"); }
    await sleep(120);
  }

  if (trackIds.length) {
    await deezerApi(`/playlist/${playlistId}/tracks`, "POST", { songs: trackIds.join(",") });
  }
  log(`Deezer: ${trackIds.length} added, ${missed} missed.`, missed ? "info" : "ok");
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

async function compareLibrary() {
  // Prefer an uploaded file if one was provided; otherwise fall back
  // to whatever playlist is currently loaded from the Spotify session.
  const tracks = libState.playlistTracks.length ? libState.playlistTracks : state.tracks;

  if (!libState.localFilenames.length) {
    log("Pick a local folder first.", "err");
    return;
  }
  if (!tracks.length) {
    log("No playlist loaded — connect Spotify and pick a playlist, or upload a .csv/.txt export.", "err");
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
    li.innerHTML = `<span class="t-title">${escapeHtml(t.title)}</span><span class="t-artist">${escapeHtml(t.artist)}</span>`;
    missingList.appendChild(li);
  });

  const uncertainList = $("libUncertainList");
  uncertainList.innerHTML = "";
  libState.uncertain.forEach((t) => {
    const li = document.createElement("li");
    li.className = "lib-uncertain-row";
    li.innerHTML = `
      <div class="t-main"><span class="t-title">${escapeHtml(t.title)}</span><span class="t-artist">${escapeHtml(t.artist)}</span></div>
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
  const dests = Array.from(document.querySelectorAll('input[name="dest"]:checked')).map((el) => el.value);
  if (!dests.length) { log("Pick at least one destination.", "err"); return; }
  if (!state.tracks.length) { log("This playlist has no tracks to transfer.", "err"); return; }

  $("btnTransfer").disabled = true;
  show("step-log");
  $("logList").innerHTML = "";
  log(`Starting transfer of "${state.chosenPlaylist.name}" (${state.tracks.length} tracks)…`);

  for (const dest of dests) {
    try {
      if (dest === "csv") exportCsv();
      else if (dest === "txt") exportTxt();
      else if (dest === "youtube") await transferToYoutube();
      else if (dest === "deezer") await transferToDeezer();
    } catch (err) {
      log(`${dest}: ${err.message}`, "err");
    }
  }

  log("Done.", "ok");
  $("btnTransfer").disabled = false;
}

// ===========================================================
// BOOT
// ===========================================================

function init() {
  checkSetup();

  $("btnConnectSpotify").addEventListener("click", connectSpotify);
  $("btnTransfer").addEventListener("click", runTransfer);

  $("libFolderInput").addEventListener("change", handleLibraryFolderInput);
  $("libPlaylistInput").addEventListener("change", handleLibraryPlaylistInput);
  $("btnCompareLibrary").addEventListener("click", compareLibrary);
  $("btnDownloadMissingCsv").addEventListener("click", downloadMissingCsv);
  $("btnDownloadMissingTxt").addEventListener("click", downloadMissingTxt);
  $("btnDownloadUncertainCsv").addEventListener("click", downloadUncertainCsv);
  $("libSourceHint").textContent = "Uses your uploaded file if provided, otherwise the playlist currently loaded above.";

  // Handle Spotify redirect back with ?code=...
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (code) {
    window.history.replaceState({}, "", CFG.REDIRECT_URI);
    exchangeSpotifyCode(code)
    .then(loadSpotifyPlaylists)
    .catch((err) => { $("spotifyStatus").textContent = "Spotify connection failed: " + err.message; });
  }
}

init();

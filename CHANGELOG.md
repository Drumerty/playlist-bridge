# Changelog

This mirrors the `CHANGELOG` array at the top of `app.js`, which also
drives the "what's new" panel in the app header. Update both together
when you make a change.

## 1.4.0 — 2026-09-10
- Added: Liked Songs now shows up as an entry at the top of your playlist
  list (needs re-connecting Spotify once to grant the new
  user-library-read permission) — transfer or export it exactly like any
  other playlist.
- Added: three color themes — Parchment (default), White, and Dark —
  switchable from the swatches next to the title. Your choice is
  remembered.

## 1.3.0 — 2026-09-10
- Fixed for real this time: the previous fix only cleaned the artist name
  at export time — the on-screen preview (and the underlying track data)
  still had every Spotify-credited artist joined together, e.g. "Skeler,
  Devilish Trio". Now only the primary artist is kept the moment tracks
  are loaded from Spotify, so the preview, edits, exports, and search
  queries all agree.
- Added cache-busting version tags to app.js/style.css/config.js so a
  redeploy shows up immediately instead of a browser or host serving a
  stale cached copy (the likely cause of the version badge getting stuck
  on an old value).

## 1.2.0 — 2026-09-10
- Fixed: exports and the track preview now show only the primary artist
  (e.g. "Skeler, Devilish Trio" → "Skeler") instead of every credited
  artist joined with commas.
- Added: version number and a "what's new" changelog panel at the top
  of the page.

## 1.1.0 — 2026-09-10
- Search queries sent to YouTube, Deezer, and the iTunes/MusicBrainz
  auto-fix lookups now strip periods/hyphens and use only the primary
  artist, improving match rates.

## 1.0.0 — 2026-09-10
- Initial release: Spotify → YouTube Music / Deezer / CSV / TXT
  transfer, in-page Settings panel for API IDs, Library Check against a
  local folder, auto-fix names via MusicBrainz/iTunes/Deezer, noisy-tag
  cleanup toggle, garbled-metadata editing, standalone local-server mode
  for Steam Deck/macOS.

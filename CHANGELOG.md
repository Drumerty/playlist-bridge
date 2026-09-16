# Changelog

This mirrors the `CHANGELOG` array at the top of `app.js`, which also
drives the "what's new" panel in the app header. Update both together
when you make a change.

## 1.5.0 — 2026-09-16
- Fixed the biggest source of wrong songs: every search result is now
  verified before it's used. Transfers used to take the first result
  YouTube or Deezer returned, on faith — which is how karaoke tracks,
  covers, tribute-band versions, "sped up"/"slowed + reverb" edits and
  radio cuts ended up in transferred playlists. Results are now checked
  by ISRC, recording variant, primary artist, duration and title before
  anything is added.
- Deezer transfers now look the track up by ISRC first (the exact master
  recording), falling back to verified search only when there's no ISRC
  entry. Note this uses Deezer's `/track/isrc:` resource endpoint —
  `search?q=isrc:` returns unrelated results.
- YouTube transfers now pull several candidates and their real durations
  (one batched `videos?part=contentDetails` call) instead of blindly
  taking the top hit. Duration tolerance is asymmetric there: a video
  running longer than the track is normal (official videos carry
  intro/outro), a shorter one is still treated as a radio edit and
  rejected.
- Fixed: "Clean noisy tags" no longer deletes (Live), (Radio Edit),
  (Acoustic) or (Extended Mix). Those identify a specific recording —
  stripping them meant searching for the studio take and saving it under
  the live track's name. Release tags like (2011 Remaster),
  [Deluxe Edition] and [Official Video] are still stripped as before.
- Fixed: artist names containing a slash (AC/DC) were split at the slash
  and searched as "AC".
- Fixed: the MusicBrainz name-fix pass joined every credited artist back
  together, undoing the primary-artist reduction done at ingestion and
  re-breaking every later search query.
- Auto-fix names is far more cautious — it now requires a confident match
  on artist, duration and variant before renaming anything, and checks
  several lookup results instead of only the first.
- Library check no longer counts a local karaoke or live file as having
  found the studio track; those surface as uncertain instead.
- Added `matcher.js`, which holds all of the above matching logic in one
  place (exposed as `window.PBMatch`).

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

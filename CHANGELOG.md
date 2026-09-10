# Changelog

This mirrors the `CHANGELOG` array at the top of `app.js`, which also
drives the "what's new" panel in the app header. Update both together
when you make a change.

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

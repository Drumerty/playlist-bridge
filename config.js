// ---------------------------------------------------------
// Playlist Bridge — configuration defaults
//
// These are just FIRST-RUN DEFAULTS. Once the page loads, use the
// "Settings" panel at the top of the app to edit your Client IDs —
// they're saved in this browser's local storage and take priority
// over anything here. You should not need to edit this file again
// after the first deploy, except to change REDIRECT_URI itself
// (which must always match wherever this is actually hosted).
//
//   Spotify : https://developer.spotify.com/dashboard
//             -> Create app -> add REDIRECT_URI below as a
//                "Redirect URI" -> copy the Client ID.
//             -> IMPORTANT: Spotify requires the literal "127.0.0.1",
//                not "localhost" — that's already handled below.
//
//   Google  : https://console.cloud.google.com/apis/credentials
//             -> Create OAuth Client ID (type: Web application)
//             -> add REDIRECT_URI as an "Authorized redirect URI"
//                and also as an "Authorized JavaScript origin"
//                (just the origin, no path)
//             -> enable the "YouTube Data API v3" in APIs & Services
//
//   Deezer  : https://developers.deezer.com/myapps
//             -> Create an app -> set the Redirect URI to
//                REDIRECT_URI -> copy the Application ID
//
// If you're running this via server.py / run-mac.command /
// run-steamdeck.sh, REDIRECT_URI below should be a fixed local port —
// register that SAME URL with every provider, on every machine you use.
//
// If hosting this on a real domain (GitHub Pages etc.), REDIRECT_URI
// should be that domain's exact URL to index.html.
// ---------------------------------------------------------

window.PB_CONFIG = {
  REDIRECT_URI: "https://drumerty.github.io/playlist-bridge/index.html",

  SPOTIFY_CLIENT_ID: "0a4ecebc70d646d480d8e4d05540972a",

  GOOGLE_CLIENT_ID: "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com",

  DEEZER_APP_ID: "YOUR_DEEZER_APP_ID",
};

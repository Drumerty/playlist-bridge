// ---------------------------------------------------------
// Playlist Bridge — configuration
//
// Fill these in with credentials from each provider's own
// developer dashboard. Nobody but you can generate these —
// they're tied to your app registration and redirect URI.
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
// run-steamdeck.sh (recommended), REDIRECT_URI below is fixed to a
// specific local port — register that SAME URL with every provider,
// on every machine you use. That's the whole point: it never has to
// change again, no matter which computer you're on.
//
// If instead you're hosting this on a real domain (GitHub Pages etc.),
// swap the line below back to:
//   REDIRECT_URI: window.location.origin + window.location.pathname,
// ---------------------------------------------------------

window.PB_CONFIG = {
  REDIRECT_URI: "http://127.0.0.1:17845/index.html",

  SPOTIFY_CLIENT_ID: "0a4ecebc70d646d480d8e4d05540972a",

  GOOGLE_CLIENT_ID: "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com",

  DEEZER_APP_ID: "YOUR_DEEZER_APP_ID",
};

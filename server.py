#!/usr/bin/env python3
"""
Playlist Bridge — local server
Serves the app on a fixed port so your Spotify/Google/Deezer redirect
URIs can stay registered as http://127.0.0.1:17845/index.html forever,
regardless of which machine (Steam Deck, Mac, whatever) you run this on.

Requires nothing but Python 3, which ships on macOS and SteamOS.
Run it directly: python3 server.py
Or use run-mac.command / run-steamdeck.sh, which just call this.
"""

import http.server
import socketserver
import os
import webbrowser

PORT = 17845  # change this ONLY if you also update it in config.js and
              # in every provider's redirect URI settings
DIR = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIR, **kwargs)

    def log_message(self, fmt, *args):
        pass  # keep the terminal quiet; errors still show via exceptions


def main():
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
        url = f"http://127.0.0.1:{PORT}/index.html"
        print("=" * 60)
        print(" Playlist Bridge")
        print(f" Running at {url}")
        print(" Press Ctrl+C to stop.")
        print("=" * 60)
        try:
            webbrowser.open(url)
        except Exception:
            print(f"Couldn't auto-open a browser — go to {url} manually.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()

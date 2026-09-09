#!/bin/bash
# Run this from Steam Deck's Desktop Mode (Konsole, or double-click after
# marking it executable) to launch Playlist Bridge.
cd "$(dirname "$0")"
python3 server.py

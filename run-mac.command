#!/bin/bash
# Double-click this on macOS to launch Playlist Bridge.
# First run: right-click -> Open (macOS blocks unsigned scripts on a
# plain double-click the very first time). After that, double-click works.
cd "$(dirname "$0")"
python3 server.py

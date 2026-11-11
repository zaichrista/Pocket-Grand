# Tiny Tunes

Play a few notes, add a message, and send them as a QR code. Scanning the code opens a little piano that unfolds and plays the tune back.

Live site: https://zaichrista.github.io/Pocket-Grand/

## How it works
The tune and message are stored in the link itself (the part after `#`), so there is no server or database. The page builds a QR code from that link and animates it into a 3D piano on a canvas.

## Editing
Edit the files in `src/`, then rebuild the single deployable page:

    python3 build.py

`index.html` in the repo root is generated; don't edit it by hand. Commit and push to `main` to publish with GitHub Pages.

The public address lives in `HOME` in `src/grand.js`.

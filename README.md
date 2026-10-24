# Maidan & Masala — branding tools

Two tools, one repo. They do the same job in different places.

```
/                 static web app  -> this is what Vercel serves
  index.html
  brand-overlay.png
  vercel.json
/cli              Node command-line tool -> runs on your own machine
  brand.js
  server.js
  make-overlay.js
```

## Vercel serves the root, and only the root

`.vercelignore` excludes `cli/`, and there is **no package.json at the root** —
that is deliberate. A root `package.json` makes Vercel assume a Node web app,
look for a server, find none, and return `FUNCTION_INVOCATION_FAILED`.

Deploy settings, if Vercel asks:

| Setting | Value |
|---|---|
| Framework Preset | **Other** |
| Build Command | leave empty |
| Output Directory | leave empty (or `.`) |
| Install Command | leave empty |

## The web app (`/`)

Encodes in the browser via ffmpeg compiled to WebAssembly. No upload, no server,
no time limit. Slower than native — roughly 1–3 minutes for a 60-second clip.

This is the only version that can run on Vercel. See below.

## The CLI (`/cli`)

Native ffmpeg on your machine. Roughly 20x faster, handles batches.

```bash
cd cli
node brand.js clip.mp4
node brand.js ./footage --watch     # brand new clips as they land
node server.js                      # same drop-zone UI at localhost:4100
```

Needs Node 18+ and ffmpeg installed. **Do not deploy this folder** — it is a
terminal tool, not a website.

## Why the CLI cannot run on Vercel

Checked against Vercel's documented limits:

- **No ffmpeg binary** in the function runtime. `server.js` spawns `ffmpeg`;
  on Vercel that process does not exist.
- **Request body capped at 4.5 MB.** Any video above that returns
  `413 FUNCTION_PAYLOAD_TOO_LARGE`. Reels are bigger.
- Duration and bundle size are *not* the problem — Hobby allows 300s and 250 MB.

A server-side version is possible: upload direct to Vercel Blob (bypassing the
body cap), then a function with a bundled static ffmpeg pulls, encodes and writes
back. It works. It is also a lot of moving parts and storage cost for something
the CLI does locally in seconds.

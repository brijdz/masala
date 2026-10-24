#!/usr/bin/env node
/**
 * Maidan & Masala video brander.
 *
 *   node brand.js clip.mp4                 one file
 *   node brand.js ./footage                every video in a folder
 *   node brand.js clip.mp4 --keep-audio    keep the original audio
 *   node brand.js clip.mp4 --no-fit        already 9:16, skip padding
 *   node brand.js clip.mp4 --cover         also write a cover frame PNG
 *   node brand.js ./footage --watch        brand new files as they appear
 *
 * Requires ffmpeg on PATH.  macOS: brew install ffmpeg
 *                           Windows: winget install Gyan.FFmpeg
 *                           Linux:  sudo apt install ffmpeg
 */
import { spawn, spawnSync } from "node:child_process";
import { readdir, mkdir, stat, watch } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OVERLAY = path.join(HERE, "brand-overlay.png");
const BG = "0x0E1A17";                 // brand night green
const W = 1080, H = 1920;
const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"]);

const C = { dim: s => `\x1b[2m${s}\x1b[0m`, y: s => `\x1b[33m${s}\x1b[0m`,
            g: s => `\x1b[32m${s}\x1b[0m`, r: s => `\x1b[31m${s}\x1b[0m`,
            b: s => `\x1b[1m${s}\x1b[0m` };

function die(msg) { console.error(C.r("✗ ") + msg); process.exit(1); }

function checkFfmpeg() {
  const r = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  if (r.error) die("ffmpeg not found on PATH.\n  macOS:   brew install ffmpeg\n  Windows: winget install Gyan.FFmpeg\n  Linux:   sudo apt install ffmpeg");
  return r.stdout.split("\n")[0];
}

function probe(file) {
  const r = spawnSync("ffprobe", ["-v","error","-select_streams","v:0",
    "-show_entries","stream=width,height:format=duration","-of","json", file], { encoding: "utf8" });
  if (r.status !== 0) return null;
  try {
    const j = JSON.parse(r.stdout);
    return { w: j.streams?.[0]?.width, h: j.streams?.[0]?.height,
             dur: parseFloat(j.format?.duration || 0) };
  } catch { return null; }
}

function run(args, onProgress) {
  return new Promise((res, rej) => {
    const p = spawn("ffmpeg", args);
    let err = "";
    p.stderr.on("data", d => {
      const s = d.toString(); err += s;
      const m = s.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (m && onProgress) onProgress(+m[1]*3600 + +m[2]*60 + parseFloat(m[3]));
    });
    p.on("close", c => c === 0 ? res() : rej(new Error(err.split("\n").slice(-12).join("\n"))));
    p.on("error", rej);
  });
}

async function brandOne(input, outDir, opts) {
  const base = path.basename(input, path.extname(input));
  const out = path.join(outDir, `${base}-mm.mp4`);
  const info = probe(input);
  const dur = info?.dur || 0;

  const chain = opts.fit
    ? `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
      `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${BG},setsar=1[bg];[bg][1:v]overlay=0:0[v]`
    : `[0:v]setsar=1[bg];[bg][1:v]overlay=0:0[v]`;

  const args = ["-y","-i",input,"-i",OVERLAY,"-filter_complex",chain,"-map","[v]"];
  if (opts.keepAudio) args.push("-map","0:a?","-c:a","aac","-b:a","128k");
  else args.push("-an");
  args.push("-c:v","libx264","-preset","medium","-crf","20",
            "-pix_fmt","yuv420p","-movflags","+faststart", out);

  process.stdout.write(`  ${path.basename(input)} ${C.dim(info ? `${info.w}×${info.h} ${dur.toFixed(1)}s` : "")}`);
  await run(args, t => {
    if (!dur) return;
    const pct = Math.min(100, (t / dur) * 100).toFixed(0);
    process.stdout.write(`\r  ${path.basename(input)} ${C.dim(`${info.w}×${info.h}`)} ${C.y(pct + "%")}   `);
  });
  process.stdout.write(`\r  ${path.basename(input)} ${C.g("✓")} → ${path.basename(out)}${" ".repeat(12)}\n`);

  if (opts.cover) {
    const cover = path.join(outDir, `${base}-cover.png`);
    await run(["-y","-ss", String(Math.min(1.5, dur * 0.05)), "-i", out,
               "-frames:v","1", cover]);
    console.log(`  ${C.dim("cover →")} ${path.basename(cover)}`);
  }
  return out;
}

async function collect(target) {
  const s = await stat(target).catch(() => null);
  if (!s) die(`Not found: ${target}`);
  if (s.isFile()) return [target];
  const names = await readdir(target);
  return names
    .filter(n => VIDEO_EXT.has(path.extname(n).toLowerCase()) && !n.includes("-mm."))
    .map(n => path.join(target, n))
    .sort();
}

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv.includes("-h") || argv.includes("--help")) {
    console.log(`
${C.b("mm-brand")} — brand a video for the Maidan & Masala Reels feed

  node brand.js <file|folder> [options]

  --keep-audio   keep the original audio (default: strip it, so Facebook's
                 music picker applies cleanly)
  --no-fit       source is already 1080×1920; skip scaling and padding
  --cover        also write a cover frame PNG (the Reel thumbnail)
  --out <dir>    output folder (default: ./branded)
  --watch        watch a folder and brand new files as they land
`);
    process.exit(0);
  }

  const version = checkFfmpeg();
  if (!existsSync(OVERLAY)) die(`Missing ${OVERLAY}\n  Run: node make-overlay.js`);

  const target = argv[0];
  const opts = {
    keepAudio: argv.includes("--keep-audio"),
    fit: !argv.includes("--no-fit"),
    cover: argv.includes("--cover"),
  };
  const oi = argv.indexOf("--out");
  const outDir = oi > -1 && argv[oi + 1] ? argv[oi + 1] : "branded";
  await mkdir(outDir, { recursive: true });

  console.log(C.dim(version));
  console.log(C.b("\nBranding") + C.dim(`  audio: ${opts.keepAudio ? "kept" : "stripped"} · fit: ${opts.fit ? "1080×1920" : "as-is"} · out: ${outDir}\n`));

  const files = await collect(target);
  if (!files.length) die("No video files found.");

  let ok = 0;
  for (const f of files) {
    try { await brandOne(f, outDir, opts); ok++; }
    catch (e) { console.log(`\r  ${path.basename(f)} ${C.r("✗")}\n${C.dim(e.message)}`); }
  }
  console.log(C.g(`\n${ok}/${files.length} done`) + C.dim(` → ${path.resolve(outDir)}`));

  if (argv.includes("--watch")) {
    console.log(C.dim(`\nWatching ${target} … Ctrl-C to stop`));
    const seen = new Set(files.map(f => path.basename(f)));
    for await (const ev of watch(target)) {
      const n = ev.filename;
      if (!n || seen.has(n) || n.includes("-mm.") || !VIDEO_EXT.has(path.extname(n).toLowerCase())) continue;
      seen.add(n);
      await new Promise(r => setTimeout(r, 1500));   // let the file finish writing
      try { await brandOne(path.join(target, n), outDir, opts); } catch (e) { console.log(C.r("  ✗ ") + e.message); }
    }
  }
}

main().catch(e => die(e.message));

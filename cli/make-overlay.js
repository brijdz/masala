#!/usr/bin/env node
/**
 * Regenerates brand-overlay.png with ffmpeg's own text renderer.
 * Edit the constants, re-run, and every future video picks up the change.
 *   node make-overlay.js
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "brand-overlay.png");

const W = 1080, H = 1920, M = 110;
const MARIGOLD = "0xE8A21C";
const MUTED    = "0x8C9490";
const WORDMARK = "MAIDAN & MASALA";
// Facebook's Reel UI covers roughly the bottom 250px; stay above it.
const WORDMARK_Y = H - 300;

const filters = [
  `color=c=0x00000000:s=${W}x${H}:d=1,format=rgba`,
  `drawbox=x=${M}:y=96:w=150:h=8:color=${MARIGOLD}@1:t=fill`,
  `drawtext=text='${WORDMARK}':x=${M}:y=${WORDMARK_Y}:fontsize=34:fontcolor=${MUTED}@0.92`,
].join(",");

const r = spawnSync("ffmpeg", ["-y","-f","lavfi","-i",filters,"-frames:v","1",OUT],
  { encoding: "utf8" });

if (r.status !== 0) {
  console.error("Failed. ffmpeg needs the drawtext filter (libfreetype).");
  console.error(r.stderr.split("\n").slice(-8).join("\n"));
  process.exit(1);
}
console.log("✓ brand-overlay.png written —", W + "×" + H);

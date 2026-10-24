#!/usr/bin/env node
/**
 * Local drop-zone UI over the same pipeline as brand.js.
 * Native ffmpeg, so roughly 20x faster than the browser (wasm) version.
 *
 *   node server.js          then open http://localhost:4100
 *
 * Localhost only. Nothing is exposed to the network.
 */
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OVERLAY = path.join(HERE, "brand-overlay.png");
const PORT = process.env.PORT || 4100;
const BG = "0x0E1A17", W = 1080, H = 1920;

if (spawnSync("ffmpeg", ["-version"]).error) {
  console.error("ffmpeg not found on PATH."); process.exit(1);
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>M&M Brander</title><style>
:root{--night:#0E1A17;--chalk:#F2EFE6;--marigold:#E8A21C;--pitch:#4A7C59;--muted:#8C9490;--line:#1D2A26}
*{box-sizing:border-box}body{margin:0;background:var(--night);color:var(--chalk);
font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;display:flex;
justify-content:center;padding:34px 16px}main{width:100%;max-width:640px}
.rule{width:150px;height:8px;border-radius:4px;background:var(--marigold);margin-bottom:18px}
h1{font-size:27px;margin:0 0 6px}p.sub{color:var(--muted);margin:0 0 26px}
#drop{border:2px dashed var(--line);border-radius:14px;padding:44px;text-align:center;cursor:pointer}
#drop:hover,#drop.over{border-color:var(--marigold);background:#121f1b}
#drop strong{display:block;font-size:19px;margin-bottom:6px}#drop span{color:var(--muted);font-size:14px}
input[type=file]{display:none}label.row{display:flex;gap:11px;align-items:flex-start;padding:13px 15px;
border:1px solid var(--line);border-radius:10px;cursor:pointer;margin-top:12px}
label.row input{margin-top:3px;accent-color:var(--marigold);width:17px;height:17px}
label.row small{color:var(--muted);display:block}
button{width:100%;margin-top:22px;padding:15px;border:0;border-radius:10px;background:var(--marigold);
color:#1a1205;font-weight:700;font-size:16px;cursor:pointer}button:disabled{background:#2b3c37;color:var(--muted)}
#log{margin-top:18px;font:12.5px/1.6 ui-monospace,Menlo,monospace;color:var(--muted);
border-left:2px solid var(--line);padding-left:13px;white-space:pre-wrap}
a.dl{display:block;margin-top:16px;padding:15px;text-align:center;border-radius:10px;
background:var(--pitch);color:var(--chalk);text-decoration:none;font-weight:700}
video{width:100%;margin-top:20px;border-radius:12px;background:#000;max-height:55vh}
</style></head><body><main>
<div class="rule"></div><h1>Maidan &amp; Masala — Brander</h1>
<p class="sub">Local. Native ffmpeg. Nothing leaves this machine.</p>
<div id="drop"><strong>Drop a video</strong><span>or click to choose</span>
<input type="file" id="f" accept="video/*"></div>
<label class="row"><input type="checkbox" id="mute" checked><span><b>Strip audio</b>
<small>So Facebook's music picker applies cleanly.</small></span></label>
<label class="row"><input type="checkbox" id="fit" checked><span><b>Fit to 1080&times;1920</b>
<small>Pad to vertical on the brand background.</small></span></label>
<button id="go" disabled>Choose a video</button>
<div id="log"></div><video id="pv" controls playsinline style="display:none"></video>
<a class="dl" id="dl" style="display:none" download>Download</a>
</main><script>
const $=s=>document.querySelector(s);let file=null;
const drop=$("#drop"),inp=$("#f");
drop.onclick=()=>inp.click();
drop.ondragover=e=>{e.preventDefault();drop.classList.add("over")};
drop.ondragleave=()=>drop.classList.remove("over");
drop.ondrop=e=>{e.preventDefault();drop.classList.remove("over");pick(e.dataTransfer.files[0])};
inp.onchange=()=>pick(inp.files[0]);
function pick(f){if(!f)return;file=f;drop.querySelector("strong").textContent=f.name;
drop.querySelector("span").textContent=(f.size/1048576).toFixed(1)+" MB";
$("#go").disabled=false;$("#go").textContent="Apply branding"}
$("#go").onclick=async()=>{
  if(!file)return;const b=$("#go");b.disabled=true;b.textContent="Encoding…";
  $("#log").textContent="Working. Native ffmpeg — usually a few seconds.";
  $("#pv").style.display="none";$("#dl").style.display="none";
  try{
    const r=await fetch("/brand?name="+encodeURIComponent(file.name)
      +"&mute="+$("#mute").checked+"&fit="+$("#fit").checked,
      {method:"POST",body:file});
    if(!r.ok)throw new Error(await r.text());
    const blob=await r.blob();const url=URL.createObjectURL(blob);
    $("#pv").src=url;$("#pv").style.display="block";
    $("#dl").href=url;$("#dl").download=file.name.replace(/\\.[^.]+$/,"")+"-mm.mp4";
    $("#dl").style.display="block";
    $("#log").textContent="Done. "+(blob.size/1048576).toFixed(1)+" MB";
  }catch(e){$("#log").textContent="Failed: "+e.message}
  finally{b.disabled=false;b.textContent="Apply branding"}
};
</script></body></html>`;

createServer(async (req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url.startsWith("/?"))) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(PAGE);
  }
  if (req.method === "POST" && req.url.startsWith("/brand")) {
    const u = new URL(req.url, "http://x");
    const name = u.searchParams.get("name") || "clip.mp4";
    const mute = u.searchParams.get("mute") !== "false";
    const fit  = u.searchParams.get("fit")  !== "false";
    let dir;
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      dir = await mkdtemp(path.join(tmpdir(), "mmbrand-"));
      const inFile = path.join(dir, "in" + (path.extname(name) || ".mp4"));
      const outFile = path.join(dir, "out.mp4");
      await writeFile(inFile, Buffer.concat(chunks));

      const chain = fit
        ? `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
          `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${BG},setsar=1[bg];[bg][1:v]overlay=0:0[v]`
        : `[0:v]setsar=1[bg];[bg][1:v]overlay=0:0[v]`;
      const args = ["-y","-i",inFile,"-i",OVERLAY,"-filter_complex",chain,"-map","[v]"];
      if (mute) args.push("-an"); else args.push("-map","0:a?","-c:a","aac","-b:a","128k");
      args.push("-c:v","libx264","-preset","medium","-crf","20","-pix_fmt","yuv420p",
                "-movflags","+faststart", outFile);

      await new Promise((ok, bad) => {
        const p = spawn("ffmpeg", args); let err = "";
        p.stderr.on("data", d => err += d);
        p.on("close", c => c === 0 ? ok() : bad(new Error(err.split("\n").slice(-8).join("\n"))));
      });

      const buf = await readFile(outFile);
      res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": buf.length });
      res.end(buf);
      console.log(`  ✓ ${name} → ${(buf.length/1048576).toFixed(1)} MB`);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(e.message);
      console.error("  ✗", e.message);
    } finally {
      if (dir) rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    return;
  }
  res.writeHead(404); res.end("not found");
}).listen(PORT, "127.0.0.1", () =>
  console.log(`\n  M&M Brander → http://localhost:${PORT}\n  Ctrl-C to stop\n`));

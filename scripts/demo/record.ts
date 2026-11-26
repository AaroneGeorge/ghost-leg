// Records the hackathon demo: intro slides, a real 30 s round on devnet (host + 3 bots) with captions, outro.
// Headless capture has no sound, so the page logs every music call (level, stop, end song) and
// scripts/demo/soundtrack.py rebuilds the exact soundtrack from public/audio; scripts/demo/cut.sh muxes it.
//
//   bun run dev            # in another terminal
//   bun scripts/demo/record.ts demo/raw
import { chromium, type Page } from "playwright-core";
import { Connection, Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "fs";

const OUT = process.argv[2] ?? "demo/raw";
const APP = process.env.APP ?? "http://localhost:5173/";
const BRAVE = process.env.BROWSER ?? "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const ROUND_SECS = 30;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

// a fresh burner for the demo, funded from the deployer (devnet)
const burner = Keypair.generate();
const deployer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(".keys/devnet-deployer.json", "utf8"))));
const conn = new Connection("https://rpc.magicblock.app/devnet", "confirmed");
await sendAndConfirmTransaction(
  conn,
  new Transaction().add(SystemProgram.transfer({ fromPubkey: deployer.publicKey, toPubkey: burner.publicKey, lamports: 0.15 * LAMPORTS_PER_SOL })),
  [deployer],
);
console.log("demo burner funded", burner.publicKey.toBase58());

const browser = await chromium.launch({ executablePath: BRAVE, headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
});
await ctx.addInitScript((key: string) => {
  if (!localStorage.getItem("gl:burner")) localStorage.setItem("gl:burner", key);
  localStorage.setItem("gl:muted", "0");
}, JSON.stringify(Array.from(burner.secretKey)));
const page = await ctx.newPage();
const t0 = Date.now();
const T = () => (Date.now() - t0) / 1000;
const marks: Record<string, number> = {};
const mark = (k: string) => (marks[k] = T(), console.log(`[${T().toFixed(1)}] ${k}`));

await page.goto(APP);
await page.waitForSelector(".wordmark");
await page.waitForFunction(() => (window as any).__music);
// log every music change (dev build exposes window.__music)
await page.evaluate((t0: number) => {
  const m = (window as any).__music;
  const log: any[] = ((window as any).__musicLog = []);
  let last = "";
  const push = (e: any) => {
    const k = JSON.stringify({ ...e, t: 0 });
    if (k !== last) (last = k), log.push({ ...e, t: (Date.now() - t0) / 1000 });
  };
  for (const name of ["setLevel", "stop", "sting"]) {
    const f = m[name].bind(m);
    m[name] = (...a: any[]) => (push({ k: name, a: a[0] ?? null }), f(...a));
  }
  push({ k: "setLevel", a: 1 });
}, t0);

// ── overlays (styled with the app's own fonts)
await page.addStyleTag({
  content: `
  .demo-slide{position:fixed;inset:0;z-index:40;background:#15130e;display:flex;flex-direction:column;justify-content:center;padding:0 110px;color:#fff;font-family:"VT323",monospace}
  .demo-slide h1{font-family:"Press Start 2P",monospace;font-size:46px;margin:0 0 22px;text-transform:uppercase}
  .demo-slide h2{font-family:"Press Start 2P",monospace;font-size:22px;margin:0 0 30px;text-transform:uppercase;color:#f7e04a}
  .demo-slide p{font-size:34px;margin:0;color:#b8b09c}
  .demo-slide ul{list-style:none;margin:0;padding:0}
  .demo-slide li{font-size:36px;margin:12px 0;opacity:0;animation:demoIn .01s steps(1) forwards}
  .demo-slide li b{font-weight:400;color:#fff;text-transform:uppercase}
  .demo-slide li::before{content:"";display:inline-block;width:18px;height:18px;margin-right:22px;background:var(--c,#e8352b)}
  .demo-slide .ghost-row{display:flex;gap:26px;margin-bottom:34px}
  .demo-slide .ghost-row svg{width:84px;height:auto;image-rendering:pixelated}
  .demo-tag{position:absolute;font-family:"Press Start 2P",monospace;font-size:13px;text-transform:uppercase}
  .wallet{visibility:hidden}
  .demo-cap{position:fixed;right:30px;top:14px;z-index:45;background:#15130e;color:#fff;
    font-family:"Press Start 2P",monospace;font-size:14px;line-height:1.6;text-transform:uppercase;padding:12px 20px;white-space:nowrap;
    box-shadow:0 -4px 0 0 #f7e04a,0 4px 0 0 #f7e04a,-4px 0 0 0 #f7e04a,4px 0 0 0 #f7e04a}
  @keyframes demoIn{to{opacity:1}}`,
});
const ghosts = async (colors: string[]) =>
  page.evaluate((colors: string[]) => {
    const src = document.querySelector(".wordmark svg")!.outerHTML;
    return colors.map((c) => src.replaceAll("#e8352b", c)).join("");
  }, colors);
const GHOSTS = await ghosts(["#e8352b", "#f6ad44", "#6cc6ba", "#f2b6c9"]);
const slide = (html: string) =>
  page.evaluate((html: string) => {
    document.querySelector(".demo-slide")?.remove();
    const d = document.createElement("div");
    d.className = "demo-slide";
    d.innerHTML = html;
    d.querySelectorAll("li").forEach((li, i) => ((li as HTMLElement).style.animationDelay = `${0.5 + i * 0.9}s`));
    document.body.appendChild(d);
  }, html);
const noSlide = () => page.evaluate(() => document.querySelector(".demo-slide")?.remove());
const caption = (text: string | null) =>
  page.evaluate((text: string | null) => {
    document.querySelector(".demo-cap")?.remove();
    if (!text) return;
    const d = document.createElement("div");
    d.className = "demo-cap";
    d.innerHTML = text;
    document.body.appendChild(d);
  }, text);
const li = (c: string, html: string) => `<li style="--c:${c}">${html}</li>`;

// ── 1. intro
mark("intro");
await slide(`<div class="ghost-row">${GHOSTS}</div><h1>Ghost Leg</h1><p>Musical chairs on a ladder · MagicBlock Ephemeral Rollups + VRF · Solana</p>
  <span class="demo-tag" style="top:34px;left:44px">Let's play</span><span class="demo-tag" style="bottom:34px;right:44px">Solana Blitz v10</span>`);
await sleep(4500);
await slide(`<h2>How it works</h2><ul>
  ${li("#e8352b", "Everyone <b>stakes</b> into one pot")}
  ${li("#f6ad44", "<b>VRF</b> hides which slot holds the 👑")}
  ${li("#6cc6ba", "Draw <b>rungs</b>: each one swaps where two lines land")}
  ${li("#f2b6c9", "Every rung is a <b>free ~130 ms</b> MagicBlock ER transaction")}</ul>`);
await sleep(6500);
await slide(`<h2>Rules</h2><ul>
  ${li("#e8352b", "Pull the 👑 onto <b>your line</b>, knock rivals off it")}
  ${li("#f6ad44", "The music climbs to <b>danger levels 4 and 5</b>")}
  ${li("#6cc6ba", "When the <b>music stops</b>, the round is over")}
  ${li("#f2b6c9", "<b>VRF picks one rung</b> of the ladder: that board pays")}
  ${li("#f7e04a", "Hold the crown longest for the best odds · <b>Solana pays</b> everyone")}</ul>`);
await sleep(7500);
await noSlide();

// ── 2. host opens a table
await caption("Host opens a table: stake, rung price, round length");
await sleep(1200);
const inputs = page.locator(".create input");
await inputs.nth(0).fill("0.003");
await inputs.nth(1).fill("0.0001");
await inputs.nth(2).fill("50");
await inputs.nth(3).fill(String(ROUND_SECS));
await sleep(900);
await page.getByRole("button", { name: /Open table/ }).click();
mark("create-click");
await page.waitForURL(/#\/g\//, { timeout: 60_000 });
await page.waitForSelector(".qr");
mark("lobby");
await caption("Share the QR · or seat bots");
await sleep(1500);
await page.getByRole("button", { name: /\+3 bots/ }).click();
mark("bots-click");
await page.waitForFunction(() => document.querySelectorAll(".player").length >= 4, null, { timeout: 90_000 });
await sleep(500);
mark("bots-ready");
await caption("Start: VRF shuffles the hidden prizes");
await sleep(1500);
await page.getByRole("button", { name: /Start round/ }).click();
mark("start-click");
await page.waitForFunction(() => document.querySelector(".status")?.textContent === "Live", null, { timeout: 60_000 });
mark("live");

// ── 3. the round: I play too (space = pull toward the crown)
const live = Date.now();
const timeline: [number, string][] = [
  [0, "Draw rungs: free MagicBlock ER transactions"],
  [7, "Pull the 👑 onto your line · knock rivals off"],
  [14, "Every rung grows the pot"],
  [(ROUND_SECS * 2) / 3, "Danger zone: music level 4"],
  [(ROUND_SECS * 5) / 6, "Danger level 5: the music is about to stop"],
];
let ti = 0;
const player = (async () => {
  while (Date.now() - live < (ROUND_SECS + 2) * 1000) {
    const s = (Date.now() - live) / 1000;
    if (ti < timeline.length && s >= timeline[ti][0]) await caption(timeline[ti++][1]);
    if (await page.locator(".pull").count()) await page.keyboard.press("Space");
    await sleep(500 + Math.random() * 500);
  }
})();
await page.waitForSelector(".stop-flash", { timeout: (ROUND_SECS + 15) * 1000 });
mark("stop");
await caption("The music stopped: the round is over");
await player;
await page.waitForFunction(() => /ladder speaks|Closed/.test(document.querySelector(".status")?.textContent ?? ""), null, { timeout: 60_000 });
mark("settled");
await caption("VRF picked one rung: the ladder above the cut pays");
await page.waitForFunction(() => /Closed/.test(document.querySelector(".status")?.textContent ?? ""), null, { timeout: 90_000 });
mark("paid");
await caption("Settled back to Solana: everyone paid");
await sleep(6000);
await caption(null);

// ── 4. outro
await slide(`<div class="ghost-row">${GHOSTS}</div><h1>Ghost Leg</h1><p>github.com/AaroneGeorge/ghost-leg</p>
  <p style="margin-top:14px">MagicBlock Ephemeral Rollups · VRF · Solana devnet</p><span class="demo-tag" style="bottom:34px;right:44px">Insert coin</span>`);
await sleep(4500);
mark("end");

const music = await page.evaluate(() => (window as any).__musicLog);
await ctx.close();
await browser.close();
const webm = readdirSync(OUT).filter((f) => f.endsWith(".webm")).sort().pop()!;
renameSync(`${OUT}/${webm}`, `${OUT}/raw.webm`);
writeFileSync(`${OUT}/timeline.json`, JSON.stringify({ marks, music }, null, 2));
console.log("wrote", `${OUT}/raw.webm`, `${OUT}/timeline.json`);

// Claude plays one seat in a Ghost Leg table from the terminal.
// usage: bun scripts/claude-player.ts <game address>
// Wallet: .keys/claude-player.json (funded from the deployer if low).
import { Keypair, PublicKey } from "@solana/web3.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  RungSender, baseConnection, erConnection, fetchGame, fetchGameAnywhere, ix, keypairSigner, lamports,
  send, sol, transfer, SNIPE_WINDOW_SECS, type GameState,
} from "../src/lib/ghostleg";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`, ...a);
const load = (p: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));

const game = new PublicKey(process.argv[2]);
const WALLET = ".keys/claude-player.json";
if (!existsSync(WALLET)) writeFileSync(WALLET, JSON.stringify(Array.from(Keypair.generate().secretKey)));
const me = load(WALLET);
const session = Keypair.generate();
const base = baseConnection();
const er = erConnection();

// ── join
const g0 = (await fetchGame(base, game))!;
const deposit = g0.stake + g0.rungPrice * BigInt(g0.rungBudget) + 2_000_000n;
const bal = BigInt(await base.getBalance(me.publicKey));
if (bal < deposit + 1_100_000n) {
  const deployer = load(".keys/devnet-deployer.json");
  await send(base, [transfer(deployer.publicKey, me.publicKey, deposit + 3_000_000n - bal)], keypairSigner(deployer));
  log("topped up my wallet from the deployer");
}
if (!g0.players.some((p) => p.wallet.equals(me.publicKey))) {
  await send(base, [await ix.join(me.publicKey, game, session.publicKey)], keypairSigner(me));
}
log(`joined ${game.toBase58().slice(0, 6)}… as ${me.publicKey.toBase58()} (deposit ${sol(deposit)} SOL)`);

// ── wait for the round
let g: GameState | null = null;
for (;;) {
  const r = await fetchGameAnywhere(game).catch(() => null);
  if (r?.game.status === "Live" && r.where === "er") { g = r.game; break; }
  if (r && (r.game.status === "Paid")) { log("table closed before starting"); process.exit(0); }
  await sleep(400);
}
const idx = g.players.findIndex((p) => p.wallet.equals(me.publicKey));
const crownSlot = g.prizeBps.indexOf(Math.max(...g.prizeBps));
log(`round live: 👑 is in column ${crownSlot + 1}; I'm player ${idx + 1}`);

// ── play: pull toward the crown at a human pace; defend when holding it; a few snipes are a coin flip, so
// I try to be on the crown before the cut zone opens and keep a reserve to answer late steals.
const sender = new RungSender(er, session, game);
let used = 0;
let lastSlot = -1;
while (Date.now() < g.endTs * 1000 - 200) {
  const fresh = await fetchGame(er, game).catch(() => null);
  if (fresh) g = fresh;
  if (g.status !== "Live") break;
  used = g.players[idx].rungsUsed;
  const slot = g.ends.indexOf(idx);
  const left = g.endTs - Date.now() / 1000;
  if (slot !== lastSlot) {
    log(`${left.toFixed(0).padStart(3)}s left · I'm on ${g.prizeBps[slot] / 100}%${slot === crownSlot ? " 👑" : ""} · rungs used ${used}/${g.rungBudget}`);
    lastSlot = slot;
  }
  if (slot !== crownSlot && used < g.rungBudget) {
    const gap = slot < crownSlot ? slot : slot - 1;
    await sender.add(gap).catch(() => null);
    // wait for it to land (or give up after ~1.2 s), then a human-ish reaction delay
    for (let k = 0; k < 8; k++) {
      await sleep(150);
      const f = await fetchGame(er, game).catch(() => null);
      if (f && f.players[idx].rungsUsed > used) { g = f; break; }
    }
    await sleep(left > SNIPE_WINDOW_SECS ? 450 + Math.random() * 500 : 700 + Math.random() * 600);
  } else {
    await sleep(250);
  }
}
log("bell! waiting for the VRF cut and payout…");

// ── result (the host's browser finishes + settles; I just watch, with a backup finish)
for (let i = 0; i < 120; i++) {
  const r = await fetchGameAnywhere(game).catch(() => null);
  if (r && i === 20 && r.game.status === "Live") await send(er, [await ix.finish(session.publicKey, game)], keypairSigner(session)).catch(() => null);
  if (r && r.game.status === "Paid") {
    const x = r.game;
    log(`cut at rung ${x.cutoff}/${x.rungs.length}`);
    x.players.forEach((p, i) => log(`  player ${i + 1}${i === idx ? " (Claude)" : ""}: ${p.rungsUsed} rungs → ${sol(p.payout)} SOL`));
    process.exit(0);
  }
  await sleep(1000);
}
log("timed out waiting for payout");

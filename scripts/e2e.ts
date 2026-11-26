// Go/no-go: one full Ghost Leg game on devnet + the devnet-as ephemeral rollup.
// Host = .keys/devnet-deployer.json; three throwaway bot wallets are funded from it.
import { Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import {
  RungSender, baseConnection, delegationStatus, erConnection, fetchGame, gamePda, ix, keypairSigner,
  lamports, replayEnds, send, short, sol, transfer, STATUS,
} from "../src/lib/ghostleg";

const DURATION = Number(process.env.DURATION ?? 25);
const host = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(".keys/devnet-deployer.json", "utf8"))));
const base = baseConnection();
const er = erConnection();
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`, ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(label: string, fn: () => Promise<T | null | undefined | false>, timeoutMs = 90_000, everyMs = 500): Promise<T> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await fn().catch(() => null);
    if (v) return v as T;
    await sleep(everyMs);
  }
  throw new Error(`timeout waiting for ${label}`);
}

const gameId = BigInt(Date.now());
const game = gamePda(host.publicKey, gameId);
const wallets = [host, Keypair.generate(), Keypair.generate(), Keypair.generate()];
const sessions = wallets.map(() => Keypair.generate());

log("host", host.publicKey.toBase58(), "balance", sol(BigInt(await base.getBalance(host.publicKey))), "SOL");
log("game", game.toBase58());

// fund bots (stake 0.01 + 40 rungs * 0.0002 + session float 0.002 + fees)
await send(base, wallets.slice(1).map((w) => transfer(host.publicKey, w.publicKey, lamports(0.03))), keypairSigner(host));
log("funded 3 bots");

await send(base, [await ix.createGame(host.publicKey, gameId, lamports(0.01), lamports(0.0002), 40, DURATION)], keypairSigner(host));
log("created");

for (let i = 0; i < wallets.length; i++) {
  await send(base, [await ix.join(wallets[i].publicKey, game, sessions[i].publicKey)], keypairSigner(wallets[i]));
}
log("4 players joined");

const sigDelegate = await send(base, [await ix.delegate(host.publicKey, gameId)], keypairSigner(host));
log("delegated", sigDelegate);
const ds = await waitFor("router delegation", async () => {
  const s = await delegationStatus(game);
  return s.isDelegated ? s : null;
});
log("router says delegated, fqdn", ds.fqdn);
await waitFor("ER clone", () => fetchGame(er, game));
log("ER has the game");

const tStart = Date.now();
const sigStart = await send(er, [await ix.start(sessions[0].publicKey, game)], keypairSigner(sessions[0]));
log("start (VRF #1 requested)", sigStart);
let g = await waitFor("VRF start callback", async () => {
  const x = await fetchGame(er, game);
  return x && x.status === "Live" ? x : null;
}, 60_000, 200);
log(`LIVE after ${(Date.now() - tStart)} ms; prize bps by slot`, g.prizeBps, "ends at", new Date(g.endTs * 1000).toISOString());

// frenzy: each bot greedily tries to drag the top prize toward itself
const senders = sessions.map((s) => new RungSender(er, s, game));
const top = g.prizeBps.indexOf(Math.max(...g.prizeBps));
let sent = 0;
const latencies: number[] = [];
const frenzyEnd = g.endTs * 1000 + 500;
async function bot(i: number) {
  while (Date.now() < frenzyEnd) {
    const cur = await fetchGame(er, game);
    if (!cur || cur.status !== "Live" || Date.now() > cur.endTs * 1000 + 300) break;
    if (cur.players[i].rungsUsed >= cur.rungBudget) break;
    const mySlot = cur.ends.indexOf(i);
    let gap: number;
    if (mySlot === top) {
      // holding the top prize: spend a rung somewhere that does not touch it (a decoy)
      const safe = Array.from({ length: cur.nPlayers - 1 }, (_, k) => k).filter((k) => k !== top && k !== top - 1);
      if (!safe.length) { await sleep(300); continue; }
      gap = safe[Math.floor(Math.random() * safe.length)];
    } else gap = mySlot < top ? mySlot : mySlot - 1;
    const ts = Date.now();
    const sig = await senders[i].add(gap).catch((e) => (log("rung err", String(e).slice(0, 120)), null));
    if (sig) {
      sent++;
      if (latencies.length < 10) {
        await er.confirmTransaction(sig, "confirmed").catch(() => null);
        latencies.push(Date.now() - ts);
      }
    }
    await sleep(150 + Math.random() * 400);
  }
}
await Promise.all(wallets.map((_, i) => bot(i)));
g = (await fetchGame(er, game))!;
log(`frenzy over: sent ${sent}, on-chain rungs ${g.rungs.length}; confirm latency ms`, latencies);

// The ER clock can trail wall time by a second or two: retry until the program agrees the bell rang.
const sigFinish = await waitFor("finish accepted", async () => {
  try {
    return await send(er, [await ix.finish(sessions[1].publicKey, game)], keypairSigner(sessions[1]));
  } catch (e) {
    if (!String(e).includes("0x1779")) throw e; // RoundNotOver
    return null;
  }
}, 30_000, 700);
log("finish (VRF #2 requested)", sigFinish);
g = await waitFor("VRF cut callback", async () => {
  const x = await fetchGame(er, game);
  return x && x.status === "Settled" ? x : null;
}, 60_000, 200);
const check = replayEnds(g.nPlayers, g.rungs, g.cutoff);
log(`SETTLED: cut at rung ${g.cutoff}/${g.rungs.length}; ends ${g.ends} (replay ${check}); pot ${sol(g.pot)} SOL`);
g.players.forEach((p, i) => log(`  player ${i} ${short(p.wallet)} used ${p.rungsUsed} rungs, payout ${sol(p.payout)} SOL`));

const sigSettle = await send(er, [await ix.settle(sessions[2].publicKey, game)], keypairSigner(sessions[2]));
log("settle_and_undelegate", sigSettle);
await waitFor("base copy back", async () => {
  const x = await fetchGame(base, game);
  return x && x.status === "Settled" ? x : null;
}, 120_000, 1000);
log("base layer has the settled game");

const before = await Promise.all(wallets.map((w) => base.getBalance(w.publicKey)));
const sigPay = await send(base, [await ix.payout(host.publicKey, game, wallets.map((w) => w.publicKey))], keypairSigner(host));
const after = await Promise.all(wallets.map((w) => base.getBalance(w.publicKey)));
log("payout", sigPay);
after.forEach((a, i) => log(`  player ${i} received ${sol(BigInt(a - before[i]))} SOL`));
const fin = (await fetchGame(base, game))!;
log("final status", fin.status, STATUS.indexOf(fin.status));
log("GO ✅");

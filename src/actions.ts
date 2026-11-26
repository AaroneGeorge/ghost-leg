import { Keypair, PublicKey } from "@solana/web3.js";
import {
  baseConnection, erConnection, fetchGame, gamePda, ix, keypairSigner, lamports, send, transfer,
  type GameState,
} from "./lib/ghostleg";
import { newBot, rememberGame, saveBots, sessionFor, loadBots, type AppWallet } from "./wallet";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const SESSION_FLOAT = 2_000_000n;

export type GameParams = { stake: number; rungPrice: number; rungBudget: number; duration: number };
export const DEFAULT_PARAMS: GameParams = { stake: 0.02, rungPrice: 0.0005, rungBudget: 40, duration: 45 };

export const depositOf = (g: Pick<GameState, "stake" | "rungPrice" | "rungBudget">) =>
  g.stake + g.rungPrice * BigInt(g.rungBudget) + SESSION_FLOAT;

/** Rent for a table account (5,426 bytes) on devnet, rounded up. */
export const TABLE_RENT_SOL = 0.0285;
/** What one bot costs its host: deposit + its fee float (see addBots). */
export const botCostSol = (depositSol: number) => depositSol + 0.00102;

/** Solana's raw errors, in words a player can act on. */
export function friendlyError(e: unknown): string {
  const s = String(e);
  // an unfunded fee payer fails simulation with no logs; a short system transfer fails with 0x1
  if (/Logs: \[\]|prior credit|insufficient (funds|lamports)|custom program error: 0x1\b/i.test(s))
    return "Not enough devnet SOL in your test wallet. Top it up at faucet.solana.com and try again.";
  return s.replace(/^Error: /, "").slice(0, 160);
}

export async function createGame(wallet: AppWallet, p: GameParams): Promise<PublicKey> {
  const gameId = BigInt(Date.now());
  const game = gamePda(wallet.publicKey, gameId);
  const session = sessionFor(game);
  await send(
    baseConnection(),
    [
      await ix.createGame(wallet.publicKey, gameId, lamports(p.stake), lamports(p.rungPrice), p.rungBudget, p.duration),
      await ix.join(wallet.publicKey, game, session.publicKey),
    ],
    wallet,
  );
  rememberGame(game);
  return game;
}

export async function joinGame(wallet: AppWallet, game: PublicKey) {
  const session = sessionFor(game);
  await send(baseConnection(), [await ix.join(wallet.publicKey, game, session.publicKey)], wallet);
  rememberGame(game);
}

/** Devnet convenience: the host funds and seats up to `count` bots that play from this browser. */
export async function addBots(wallet: AppWallet, g: GameState, count: number) {
  const base = baseConnection();
  const existing = loadBots(g.address);
  // bots saved earlier but never seated (e.g. a failed join) are retried first
  const seated = (b: { wallet: Keypair }) => g.players.some((p) => p.wallet.equals(b.wallet.publicKey));
  const pending = existing.filter((b) => !seated(b)).slice(0, count);
  const fresh = Array.from({ length: Math.max(0, count - pending.length) }, (_, i) => newBot(existing.length + i));
  const bots = [...pending, ...fresh];
  // deposit + fees + rent-exempt minimum so the bot wallet survives paying the deposit
  const need = depositOf(g) + 20_000n + 1_000_000n;
  const balances = await Promise.all(bots.map((b) => base.getBalance(b.wallet.publicKey)));
  const topUps = bots
    .map((b, i) => ({ b, amt: need - BigInt(balances[i]) }))
    .filter((x) => x.amt > 0n)
    .map((x) => transfer(wallet.publicKey, x.b.wallet.publicKey, x.amt));
  saveBots(g.address, [...existing, ...fresh]);
  if (topUps.length) await send(base, topUps, wallet);
  for (const b of bots) {
    await send(base, [await ix.join(b.wallet.publicKey, g.address, b.session.publicKey)], keypairSigner(b.wallet));
  }
}

/** Host: hand the game to the ephemeral rollup, then ask VRF for the prize layout. */
export async function startRound(wallet: AppWallet, g: GameState, onStep: (s: string) => void) {
  const er = erConnection();
  onStep("Delegating the game to MagicBlock's ephemeral rollup…");
  await send(baseConnection(), [await ix.delegate(wallet.publicKey, g.gameId)], wallet);
  onStep("Waiting for the rollup to clone the game…");
  for (let i = 0; i < 60; i++) {
    if (await fetchGame(er, g.address).catch(() => null)) break;
    await sleep(500);
  }
  onStep("Drawing the prize layout with VRF…");
  const session = sessionFor(g.address);
  await send(er, [await ix.start(session.publicKey, g.address)], keypairSigner(session));
}

/** Anyone in the game: after the bell, ask VRF where to cut. Retries while the ER clock catches up. */
export async function finishRound(session: Keypair, game: PublicKey): Promise<string | null> {
  const er = erConnection();
  for (let i = 0; i < 40; i++) {
    try {
      return await send(er, [await ix.finish(session.publicKey, game)], keypairSigner(session));
    } catch (e) {
      const s = String(e);
      if (s.includes("0x1779")) { await sleep(700); continue; } // RoundNotOver
      return null; // someone else already finished (WrongStatus) or a transient error
    }
  }
  return null;
}

/** Commit the settled game back to Solana, then pay everyone from the game PDA. */
export async function settleAndPay(session: Keypair, g: GameState, onStep: (s: string) => void): Promise<{ settleSig?: string; paySig?: string }> {
  const er = erConnection();
  const base = baseConnection();
  const out: { settleSig?: string; paySig?: string } = {};
  onStep("Committing the result back to Solana…");
  try {
    out.settleSig = await send(er, [await ix.settle(session.publicKey, g.address)], keypairSigner(session));
  } catch {
    /* another client already settled */
  }
  for (let i = 0; i < 120; i++) {
    const b = await fetchGame(base, g.address).catch(() => null);
    if (b && (b.status === "Settled" || b.status === "Paid")) {
      if (b.status === "Paid") return out;
      break;
    }
    await sleep(1000);
  }
  onStep("Paying out on Solana…");
  try {
    out.paySig = await send(base, [await ix.payout(session.publicKey, g.address, g.players.map((p) => p.wallet))], keypairSigner(session));
  } catch {
    /* already paid */
  }
  return out;
}

/** Bot brain: drag the biggest prize toward yourself; when holding it, spend decoys elsewhere. */
export function botGap(g: GameState, i: number): number | null {
  const n = g.nPlayers;
  const best = Math.max(...g.prizeBps);
  const top = g.prizeBps.indexOf(best);
  const mySlot = g.ends.indexOf(i);
  if (Math.random() < 0.18) return Math.floor(Math.random() * (n - 1)); // chaos
  if (mySlot === top) {
    const safe = Array.from({ length: n - 1 }, (_, k) => k).filter((k) => k !== top && k !== top - 1);
    return safe.length ? safe[Math.floor(Math.random() * safe.length)] : null;
  }
  return mySlot < top ? mySlot : mySlot - 1;
}

/** The single gap that moves `player` one step toward the biggest prize (null if already there). */
export function pullGap(g: GameState, player: number): number | null {
  const top = g.prizeBps.indexOf(Math.max(...g.prizeBps));
  const mySlot = g.ends.indexOf(player);
  if (mySlot === top || mySlot < 0) return null;
  return mySlot < top ? mySlot : mySlot - 1;
}

/** Host closes an unstarted table and refunds every deposit. */
export async function cancelGame(wallet: AppWallet, g: GameState) {
  await send(baseConnection(), [await ix.cancel(wallet.publicKey, g.address, g.players.map((p) => p.wallet))], wallet);
}

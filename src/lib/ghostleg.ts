// Shared Ghost Leg client: used by the React app and by the Bun scripts.
import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import idl from "./ghost_leg.json";
import type { GhostLeg } from "./ghost_leg_types";

export const PROGRAM_ID = new PublicKey(idl.address);
export const BASE_RPC = "https://rpc.magicblock.app/devnet";
export const BASE_WS = "wss://rpc.magicblock.app/devnet";
export const ER_RPC = "https://devnet-as.magicblock.app";
export const ER_WS = "wss://devnet-as.magicblock.app";
export const ROUTER_RPC = "https://devnet-router.magicblock.app/";
/** devnet-as validator identity (getIdentity on 2026-11-25) */
export const ER_VALIDATOR = new PublicKey("MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57");
export const EXPLORER = "https://explorer.solana.com";
export const SNIPE_WINDOW_SECS = 15;
/** The danger zone always plays at least this long before the music may stop (mirrors the program). */
export const MIN_DANGER_SECS = 5;

export const STATUS = ["Lobby", "Drawing", "Live", "Cutting", "Settled", "Paid"] as const;
export type StatusName = (typeof STATUS)[number];

export type PlayerSlot = {
  wallet: PublicKey;
  session: PublicKey;
  rungsUsed: number;
  payout: bigint;
};
export type Rung = { gap: number; player: number; t: number };
export type GameState = {
  address: PublicKey;
  host: PublicKey;
  gameId: bigint;
  status: StatusName;
  stake: bigint;
  rungPrice: bigint;
  rungBudget: number;
  durationSecs: number;
  nPlayers: number;
  players: PlayerSlot[];
  prizeBps: number[];
  ends: number[];
  startTs: number;
  endTs: number;
  cutoff: number;
  startRandomness: number[];
  cutRandomness: number[];
  pot: bigint;
  rungs: Rung[];
};

export const baseConnection = () => new Connection(BASE_RPC, { commitment: "confirmed", wsEndpoint: BASE_WS });
export const erConnection = () => new Connection(ER_RPC, { commitment: "confirmed", wsEndpoint: ER_WS });

// A read-only provider is enough to build instructions and decode accounts.
const dummyWallet = {
  publicKey: PublicKey.default,
  signTransaction: async <T,>(t: T) => t,
  signAllTransactions: async <T,>(t: T[]) => t,
};
export const program = new Program<GhostLeg>(
  idl as GhostLeg,
  new AnchorProvider(new Connection(BASE_RPC), dummyWallet as never, {}),
);

export function gamePda(host: PublicKey, gameId: bigint | number): PublicKey {
  const id = Buffer.alloc(8);
  id.writeBigUInt64LE(BigInt(gameId));
  return PublicKey.findProgramAddressSync([Buffer.from("ghostleg"), host.toBuffer(), id], PROGRAM_ID)[0];
}

const big = (x: BN | number) => BigInt(x.toString());

export function decodeGame(address: PublicKey, data: Buffer): GameState {
  const g = program.coder.accounts.decode("game", data);
  const n = g.nPlayers as number;
  return {
    address,
    host: g.host,
    gameId: big(g.gameId),
    status: STATUS[g.status] ?? "Lobby",
    stake: big(g.stake),
    rungPrice: big(g.rungPrice),
    rungBudget: g.rungBudget,
    durationSecs: g.durationSecs,
    nPlayers: n,
    players: g.players.slice(0, n).map((p: any) => ({
      wallet: p.wallet,
      session: p.session,
      rungsUsed: p.rungsUsed,
      payout: big(p.payout),
    })),
    prizeBps: Array.from(g.prizeBps as number[]).slice(0, n),
    ends: Array.from(g.ends as number[]).slice(0, n),
    startTs: Number(g.startTs),
    endTs: Number(g.endTs),
    cutoff: g.cutoff,
    startRandomness: Array.from(g.startRandomness as number[]),
    cutRandomness: Array.from(g.cutRandomness as number[]),
    pot: big(g.pot),
    rungs: (g.rungs as any[]).map((r) => ({ gap: r.gap, player: r.player, t: r.t })),
  };
}

export async function fetchGame(conn: Connection, address: PublicKey): Promise<GameState | null> {
  const info = await conn.getAccountInfo(address, "confirmed");
  if (!info || !info.owner.equals(PROGRAM_ID)) return null;
  return decodeGame(address, info.data as Buffer);
}

export const DELEGATION_PROGRAM_ID = new PublicKey("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");

/** Reads the authoritative copy: base if our program owns it there, otherwise the ER clone. */
export async function fetchGameAnywhere(address: PublicKey): Promise<{ game: GameState; where: "er" | "base" } | null> {
  const baseInfo = await baseConnection().getAccountInfo(address, "confirmed");
  if (baseInfo && baseInfo.owner.equals(PROGRAM_ID)) return { game: decodeGame(address, baseInfo.data as Buffer), where: "base" };
  const er = await fetchGame(erConnection(), address).catch(() => null);
  return er ? { game: er, where: "er" } : null;
}

export async function delegationStatus(account: PublicKey): Promise<{ isDelegated: boolean; fqdn?: string }> {
  const res = await fetch(ROUTER_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getDelegationStatus", params: [account.toBase58()] }),
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

// ───────────── instruction builders ─────────────

export const ix = {
  createGame: (host: PublicKey, gameId: bigint, stake: bigint, rungPrice: bigint, rungBudget: number, durationSecs: number) =>
    program.methods
      .createGame(new BN(gameId.toString()), new BN(stake.toString()), new BN(rungPrice.toString()), rungBudget, durationSecs)
      .accountsPartial({ host, game: gamePda(host, gameId) })
      .instruction(),
  join: (player: PublicKey, game: PublicKey, session: PublicKey) =>
    program.methods.join(session).accountsPartial({ player, game, sessionKey: session }).instruction(),
  delegate: (host: PublicKey, gameId: bigint) =>
    program.methods
      .delegateGame(new BN(gameId.toString()))
      .accountsPartial({ host, game: gamePda(host, gameId) })
      .remainingAccounts([{ pubkey: ER_VALIDATOR, isSigner: false, isWritable: false }])
      .instruction(),
  start: (payer: PublicKey, game: PublicKey) =>
    program.methods.start(Math.floor(Math.random() * 256)).accountsPartial({ payer, game }).instruction(),
  addRung: (signer: PublicKey, game: PublicKey, gap: number) =>
    program.methods.addRung(gap).accountsPartial({ signer, game }).instruction(),
  finish: (payer: PublicKey, game: PublicKey) =>
    program.methods.finish(Math.floor(Math.random() * 256)).accountsPartial({ payer, game }).instruction(),
  settle: (payer: PublicKey, game: PublicKey) =>
    program.methods.settleAndUndelegate().accountsPartial({ payer, game }).instruction(),
  cancel: (host: PublicKey, game: PublicKey, wallets: PublicKey[]) =>
    program.methods
      .cancel()
      .accountsPartial({ host, game })
      .remainingAccounts(wallets.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })))
      .instruction(),
  payout: (caller: PublicKey, game: PublicKey, wallets: PublicKey[]) =>
    program.methods
      .payout()
      .accountsPartial({ caller, game })
      .remainingAccounts(wallets.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })))
      .instruction(),
};

// ───────────── sending ─────────────

export type WalletSigner = {
  publicKey: PublicKey;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
};
export const keypairSigner = (kp: Keypair): WalletSigner => ({
  publicKey: kp.publicKey,
  signTransaction: async (tx) => {
    tx.partialSign(kp);
    return tx;
  },
});

export async function send(
  conn: Connection,
  ixs: TransactionInstruction[],
  signer: WalletSigner,
  opts: { confirm?: boolean; extraSigners?: Keypair[] } = {},
): Promise<string> {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = signer.publicKey;
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  if (opts.extraSigners?.length) tx.partialSign(...opts.extraSigners);
  const signed = await signer.signTransaction(tx);
  const sig = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: opts.confirm === false });
  if (opts.confirm !== false) {
    const res = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    if (res.value.err) throw new Error(`tx ${sig} failed: ${JSON.stringify(res.value.err)}`);
  }
  return sig;
}

/** Cached ER blockhash so rung spam does not wait on a round-trip per tap. */
export class RungSender {
  private blockhash = "";
  private fetchedAt = 0;
  constructor(private conn: Connection, private session: Keypair, private game: PublicKey) {}
  private async hash() {
    if (Date.now() - this.fetchedAt > 20_000 || !this.blockhash) {
      this.blockhash = (await this.conn.getLatestBlockhash("confirmed")).blockhash;
      this.fetchedAt = Date.now();
    }
    return this.blockhash;
  }
  private counter = 0;
  async add(gap: number): Promise<string> {
    // Identical (signer, gap, blockhash) transactions would share a signature and be dropped as
    // duplicates, so every rung carries a distinct compute-unit limit.
    this.counter = (this.counter + 1) % 50_000;
    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 150_000 + this.counter }),
      await ix.addRung(this.session.publicKey, this.game, gap),
    );
    tx.feePayer = this.session.publicKey;
    tx.recentBlockhash = await this.hash();
    tx.sign(this.session);
    return this.conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  }
}

// ───────────── game maths (mirrors the program) ─────────────

export function replayEnds(n: number, rungs: Rung[], upTo = rungs.length): number[] {
  const ends = Array.from({ length: n }, (_, i) => i);
  for (const r of rungs.slice(0, upTo)) [ends[r.gap], ends[r.gap + 1]] = [ends[r.gap + 1], ends[r.gap]];
  return ends;
}

/** slot (bottom column) whose prize each player currently lands on */
export function slotOfPlayer(ends: number[]): number[] {
  const out: number[] = [];
  ends.forEach((player, slot) => (out[player] = slot));
  return out;
}

export const sol = (lamports: bigint | number) => Number(lamports) / LAMPORTS_PER_SOL;
export const lamports = (s: number) => BigInt(Math.round(s * LAMPORTS_PER_SOL));
export const short = (k: PublicKey | string) => {
  const s = typeof k === "string" ? k : k.toBase58();
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
};
export const transfer = (from: PublicKey, to: PublicKey, amount: bigint) =>
  SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: amount });

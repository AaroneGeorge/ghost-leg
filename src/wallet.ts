import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { keypairSigner, type WalletSigner } from "./lib/ghostleg";

export type AppWallet = WalletSigner & { kind: "burner" | "phantom" };

const loadKp = (key: string): Keypair | null => {
  const raw = localStorage.getItem(key);
  return raw ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw))) : null;
};
const saveKp = (key: string, kp: Keypair) => localStorage.setItem(key, JSON.stringify(Array.from(kp.secretKey)));

/** A devnet-only burner wallet kept in this browser. */
export function burnerWallet(): AppWallet {
  let kp = loadKp("gl:burner");
  if (!kp) {
    kp = Keypair.generate();
    saveKp("gl:burner", kp);
  }
  return { ...keypairSigner(kp), kind: "burner" };
}

type PhantomProvider = {
  publicKey: PublicKey | null;
  connect: () => Promise<{ publicKey: PublicKey }>;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
};
const phantom = (): PhantomProvider | null => (window as any).phantom?.solana ?? (window as any).solana ?? null;
export const hasPhantom = () => !!phantom();

export async function phantomWallet(): Promise<AppWallet> {
  const p = phantom();
  if (!p) throw new Error("Phantom not found");
  const { publicKey } = await p.connect();
  return { publicKey, signTransaction: (tx) => p.signTransaction(tx), kind: "phantom" };
}

/** Per-game session key: signs rungs on the ephemeral rollup without wallet pop-ups. */
export function sessionFor(game: PublicKey): Keypair {
  const k = `gl:session:${game.toBase58()}`;
  let kp = loadKp(k);
  if (!kp) {
    kp = Keypair.generate();
    saveKp(k, kp);
  }
  return kp;
}
export const hasSession = (game: PublicKey) => !!localStorage.getItem(`gl:session:${game.toBase58()}`);

export type Bot = { wallet: Keypair; session: Keypair; name: string };
const BOT_NAMES = ["Kitsune", "Tanuki", "Oni", "Kappa", "Tengu"];
export function loadBots(game: PublicKey): Bot[] {
  const raw = localStorage.getItem(`gl:bots:${game.toBase58()}`);
  if (!raw) return [];
  return (JSON.parse(raw) as { w: number[]; s: number[]; n: string }[]).map((b) => ({
    wallet: Keypair.fromSecretKey(Uint8Array.from(b.w)),
    session: Keypair.fromSecretKey(Uint8Array.from(b.s)),
    name: b.n,
  }));
}
export function saveBots(game: PublicKey, bots: Bot[]) {
  localStorage.setItem(
    `gl:bots:${game.toBase58()}`,
    JSON.stringify(bots.map((b) => ({ w: Array.from(b.wallet.secretKey), s: Array.from(b.session.secretKey), n: b.name }))),
  );
}
export const newBot = (i: number): Bot => ({ wallet: Keypair.generate(), session: Keypair.generate(), name: BOT_NAMES[i % BOT_NAMES.length] });

/** Games this browser created or joined (for the home screen). */
export function rememberGame(game: PublicKey) {
  const list = recentGames().filter((g) => g !== game.toBase58());
  localStorage.setItem("gl:recent", JSON.stringify([game.toBase58(), ...list].slice(0, 8)));
}
export const recentGames = (): string[] => JSON.parse(localStorage.getItem("gl:recent") ?? "[]");

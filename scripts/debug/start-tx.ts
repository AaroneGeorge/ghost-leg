import { PublicKey } from "@solana/web3.js";
import { erConnection, fetchGame } from "../../src/lib/ghostleg";
const er = erConnection();
const game = new PublicKey("H1bPX39KNk6Sfy5Mt2bngTwngNMmJC3ZqbgebgxEGfyE");
const g = await fetchGame(er, game); console.log("status", g?.status);
const tx = await er.getTransaction("JsVYPd47wvNqo6KHhqEkvyJHgZa2keJdLQs4rrsBJkQxbJTeSWTmA3njGbZ7MyZcAmN98gPjWfAM5Zypen3pEbk", { maxSupportedTransactionVersion: 1 });
console.log("start err", JSON.stringify(tx?.meta?.err)); console.log(tx?.meta?.logMessages?.join("\n"));
const sigs = await er.getSignaturesForAddress(game, { limit: 20 });
for (const s of sigs) { console.log(s.signature, JSON.stringify(s.err));
  const t = await er.getTransaction(s.signature, { maxSupportedTransactionVersion: 1 }); console.log((t?.meta?.logMessages ?? []).slice(0,12).join("\n  ")); }

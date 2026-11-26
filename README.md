# 🪜 Ghost Leg: rewrite fate in 45 seconds

Ghost Leg (amidakuji) is the ladder lottery played across Japan and Korea. Each player owns a column, and the prizes sit at the bottom. Follow your line down, and every rung you meet swaps you to the neighbouring column.

**Ghost Leg on MagicBlock turns that lottery into musical chairs on a ladder.** Everyone stakes into a pot. When the round opens, every player spams rungs that swap where the paths land: drag the 👑 toward yourself, knock your rivals off it. The music climbs through five danger levels; in the danger zone it plays 5 seconds of warning, then the game calls VRF live and the answer decides when the music stops (0–10 s later). When it stops, the round is over. A second VRF draw then rewinds to a random rung inside the danger zone, and rungs below that cut are void, so even someone reading the chain can't snipe the stop.

Built for **Solana Blitz v10: Entertainment Finance**.

## Why it needs MagicBlock

| Need | MagicBlock piece | Where |
|---|---|---|
| Dozens of free moves per second from every player, confirmed in ~130 ms | **Ephemeral Rollup**: the game account is delegated to `devnet-as`; every `add_rung` is a gasless ER transaction signed by a per-game session key, with no wallet pop-ups | `add_rung` |
| Nobody knows which slot holds the 👑 until the round opens | **VRF #1** (requested from inside the ER): Fisher–Yates shuffle of the prize slots | `start` → `start_callback` |
| Musical chairs: nobody knows when the music stops | **VRF #2**, drawn live: after 5 s of danger zone any player calls `arm`; the callback sets `end_ts` 0–10 s later (once only: the game moves LIVE → ARMING → STOP_SET) | `arm` → `arm_callback` |
| No sniping: a rung placed at the buzzer may not count | **VRF #3**: picks the cut uniformly between the first rung of the final 15 s and the last rung; only rungs above the cut are replayed | `finish` → `finish_callback` |
| Real money, settled on Solana | **Commit + undelegate** back to the base layer, then one `payout` instruction pays every player from the game PDA | `settle_and_undelegate`, `payout` |

Measured on devnet (25 Nov 2026):
- 160 rungs in 25 s from 4 players.
- `add_rung` confirmation took 125–270 ms.
- The VRF prize layout arrived 616 ms after `start`.
- A full game, from create through payout, took about 37 s.

## How a round works

```
base layer   create_game ─ join ×N (stake + rung budget into the PDA, fund a session key) ─ delegate_game
                                                                                              │
ER (10 ms)   start ──VRF──▶ start_callback (prizes) ─ add_rung × hundreds ─ arm ──VRF──▶ arm_callback (music stop) ─ finish ──VRF──▶ finish_callback (cut + payouts)
                                                                                              │
base layer                                                    settle_and_undelegate (commit) ─ payout (one tx pays everyone)
```

- **The pot** is every stake plus every rung bought, including voided ones: you paid for them.
- **Prize shares** go to the slots: 2 players 100/0; 3 players 70/30/0; 4 players 60/30/10/0; 5–6 players 50/30/20/0…
- **Refunds:** the unspent rung budget is refunded at payout.
- **Lamports stay in one place:** they never leave the game PDA while it is delegated. The ER changes only accounting, and settlement moves lamports once on Solana.
- **Late VRF callbacks are ignored:** each callback checks the expected status, so a duplicate or late callback is a no-op.

## Music

| Phase | Track |
|---|---|
| Site and lobby | Danger level 1 |
| Round, first half / second half | Danger level 2 / 3 |
| Danger zone (last 15 s of the longest round) | Danger level 4 for the guaranteed first 5 s, then 5 while VRF decides and until the stop; the timer is hidden |
| The VRF-chosen stop second | the track grinds to a halt (tape-stop) and the round closes |
| Reveal | end sound |

The tracks are `public/audio/level1..5.wav` and `end.wav`, played as beat-aligned loops with Web Audio (`src/audio.ts`). Without them the app synthesises its own escalating track.

## Play it

1. Open the app. A devnet burner wallet is created in your browser; click **+1 SOL**, or fund the shown address from faucet.solana.com. Phantom also works.
2. **Open table**, then add bots or share the QR code / invite link.
3. **Start round**. Press **space** or tap **PULL 👑** to move toward the crown, or click between two rails to place a rung anywhere.

## Run locally

```bash
bun install
bun run dev             # app on http://localhost:5173
bun scripts/e2e.ts      # full on-chain game with 4 wallets (needs .keys/devnet-deployer.json with devnet SOL)
anchor build            # program (Anchor 1.0.2, ephemeral-rollups-sdk 0.18.0)
```

**Program (devnet):** `DhS45bjZe13UqRbdoJZx5WK8rxmhG5VspmAUZU9F2yG8`. **ER:** `https://devnet-as.magicblock.app`, validator `MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57`.

## Notes for builders

`ephemeral-rollups-sdk` 0.18.0's `#[vrf_callback]` injects an `address = …scoped_vrf_identity_const(&crate::ID)` constraint. Anchor evaluates that at runtime, so the identity PDA is hashed in software inside the callback. In our callback that cost about 270k compute units, and the callback ran out of compute. The fix is to declare `vrf_program_identity` yourself, with the address in a `const`; see `VRF_CALLBACK_IDENTITY` in `programs/ghost-leg/src/lib.rs`.

## Stack

- **On-chain:** Anchor 1.0.2 and `ephemeral-rollups-sdk` 0.18.0 (`anchor`, `vrf`).
- **App:** React 19, Vite and `@solana/web3.js`, with Anchor's TypeScript client for the instructions.
- **Rendering:** hand-written SVG for the ladder.
- **Bots:** they play from the host's browser using the same session-key path as humans.

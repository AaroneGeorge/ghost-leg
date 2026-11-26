import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import QRCode from "qrcode";
import {
  BASE_RPC, DELEGATION_PROGRAM_ID, ER_RPC, MAX_ROUND_SECS, MIN_ROUND_SECS, PROGRAM_ID, RungSender, dangerStartsAt, musicLevelAt,
  baseConnection, chainNow, decodeGame, erConnection, fetchGameAnywhere, short, sol, syncChainClock, type GameState,
} from "./lib/ghostleg";
import { COLORS, Ladder } from "./Ladder";
import { Ghost } from "./Pixel";
import { music, type Level } from "./audio";
import {
  DEFAULT_PARAMS, addBots, botGap, cancelGame, createGame, depositOf, finishRound, joinGame, pullGap, settleAndPay, startRound,
  type GameParams,
} from "./actions";
import { burnerWallet, hasPhantom, hasSession, loadBots, phantomWallet, recentGames, sessionFor, type AppWallet } from "./wallet";

const erTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent(ER_RPC)}`;
const baseTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
const acct = (a: PublicKey | string, er = false) =>
  `https://explorer.solana.com/address/${a.toString()}?${er ? `cluster=custom&customUrl=${encodeURIComponent(ER_RPC)}` : "cluster=devnet"}`;

function useRoute(): string {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const f = () => setHash(location.hash);
    addEventListener("hashchange", f);
    return () => removeEventListener("hashchange", f);
  }, []);
  return hash;
}

function useBalance(pk: PublicKey | null) {
  const [bal, setBal] = useState<number | null>(null);
  const refresh = useCallback(async () => {
    if (!pk) return;
    setBal(await baseConnection().getBalance(pk).catch(() => null));
  }, [pk]);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 6000);
    return () => clearInterval(t);
  }, [refresh]);
  return [bal, refresh] as const;
}

export default function App() {
  const route = useRoute();
  const [wallet, setWallet] = useState<AppWallet>(() => burnerWallet());
  const [balance, refreshBalance] = useBalance(wallet.publicKey);
  const [toast, setToast] = useState<string | null>(null);
  const say = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast((t) => (t === m ? null : t)), 6000);
  }, []);

  const airdrop = async () => {
    try {
      say("Requesting 1 devnet SOL…");
      const c = baseConnection();
      const sig = await c.requestAirdrop(wallet.publicKey, 1e9);
      await c.confirmTransaction(sig, "confirmed");
      say("Airdrop landed ✓");
      refreshBalance();
    } catch {
      say("Faucet is rate-limited — try faucet.solana.com with this address");
    }
  };

  const [muted, setMuted] = useState(music.muted);
  useEffect(() => {
    const unlock = () => music.unlock();
    addEventListener("pointerdown", unlock);
    addEventListener("keydown", unlock);
    return () => {
      removeEventListener("pointerdown", unlock);
      removeEventListener("keydown", unlock);
    };
  }, []);

  const gameMatch = route.match(/^#\/g\/([1-9A-HJ-NP-Za-km-z]{32,44})/);
  return (
    <div className="app">
      <header>
        <a href="#/" className="brand" aria-label="Ghost Leg home">
          <Brand />
        </a>
        <div className="wallet">
          <button className="chip sound" title={muted ? "unmute" : "mute"} onClick={() => (music.unlock(), music.setMuted(!muted), setMuted(!muted))}>
            {muted ? "♪ off" : "♪ on"}
          </button>
          <span className={`net`}>devnet · MagicBlock ER</span>
          <button className="chip" title="copy address" onClick={() => (navigator.clipboard.writeText(wallet.publicKey.toBase58()), say("Address copied"))}>
            {wallet.kind === "phantom" ? "👻" : "🔥"} {short(wallet.publicKey)}
          </button>
          <span className="chip">{balance === null ? "…" : `${sol(balance).toFixed(3)} SOL`}</span>
          {wallet.kind === "burner" && <button className="chip" onClick={airdrop}>+1 SOL</button>}
          {wallet.kind === "burner" && hasPhantom() && (
            <button className="chip" onClick={async () => setWallet(await phantomWallet())}>Use Phantom</button>
          )}
          {wallet.kind === "phantom" && <button className="chip" onClick={() => setWallet(burnerWallet())}>Use burner</button>}
        </div>
      </header>
      {gameMatch ? (
        <GameView key={gameMatch[1]} address={new PublicKey(gameMatch[1])} wallet={wallet} say={say} />
      ) : (
        <Home wallet={wallet} say={say} />
      )}
      {toast && <div className="toast">{toast}</div>}
      <footer>
        Every rung is a free transaction on a MagicBlock Ephemeral Rollup · the prize layout and the rung that counts are
        MagicBlock VRF · settles back to Solana · <a href={acct(PROGRAM_ID)} target="_blank">program</a>
      </footer>
    </div>
  );
}

function Home({ wallet, say }: { wallet: AppWallet; say: (m: string) => void }) {
  const [p, setP] = useState<GameParams>(DEFAULT_PARAMS);
  const [busy, setBusy] = useState(false);
  const recent = recentGames();
  useEffect(() => music.setLevel(1), []); // the site plays danger level 1 (this also ends the end song)
  const deposit = p.stake + p.rungPrice * p.rungBudget + 0.002;
  const create = async () => {
    setBusy(true);
    try {
      const g = await createGame(wallet, { ...p, duration: clampRound(p.duration) });
      location.hash = `#/g/${g.toBase58()}`;
    } catch (e) {
      say(`Create failed: ${String(e).slice(0, 140)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="home">
      <section className="hero">
        <div className="hero-top">
          <div className="poster" aria-hidden>
            <span className="poster-tag">Let's play</span>
            <div className="ghosts">
              <Ghost color={COLORS[0]} look="down" size={92} />
              <Ghost color={COLORS[1]} look="left" size={92} />
              <Ghost color={COLORS[2]} look="up" size={92} />
              <Ghost color={COLORS[3]} look="left" size={92} />
            </div>
            <span className="poster-tag end blink">Insert coin</span>
          </div>
          <h1>
            One ladder.<br />One random rung<br /><em>decides it all.</em>
          </h1>
        </div>
        <p className="lede">
          The ladder lottery of Japan and Korea, rebuilt as musical chairs. Draw rungs to swap where the lines land, pull the 👑 toward you and
          hold it: when the music stops, VRF picks one rung and the board at that rung pays out.
        </p>
        <ol className="rules">
          <li><b>Stake</b> into a pot held by the program. Unused rungs are refunded.</li>
          <li><b>VRF</b> shuffles the prizes the moment the round opens.</li>
          <li><b>Draw rungs</b>: free ~130&nbsp;ms transactions on a MagicBlock Ephemeral Rollup. Each one grows the pot.</li>
          <li><b>Danger zone</b>: the last third of the round plays danger levels 4 and 5. Rounds run {MIN_ROUND_SECS}–{MAX_ROUND_SECS}s.</li>
          <li><b>One rung decides</b>: VRF picks any rung; the board right after it pays out, later rungs are void. Hold the crown longest for the best odds. Solana pays everyone.</li>
        </ol>
      </section>
      <section className="card create">
        <h2>Open a table</h2>
        <label>Stake (SOL)<input type="number" step="0.01" value={p.stake} onChange={(e) => setP({ ...p, stake: +e.target.value })} /></label>
        <label>Rung price (SOL)<input type="number" step="0.0001" value={p.rungPrice} onChange={(e) => setP({ ...p, rungPrice: +e.target.value })} /></label>
        <label>Rung budget<input type="number" value={p.rungBudget} onChange={(e) => setP({ ...p, rungBudget: +e.target.value })} /></label>
        <label>Round length (s)<input type="number" min={MIN_ROUND_SECS} max={MAX_ROUND_SECS} value={p.duration} onChange={(e) => setP({ ...p, duration: +e.target.value })} onBlur={() => setP({ ...p, duration: clampRound(p.duration) })} /></label>
        <p className="muted">Each player deposits {deposit.toFixed(4)} SOL (stake + rung budget + a 0.002 session float).</p>
        <button className="primary" disabled={busy} onClick={create}>{busy ? "Opening…" : "Open table ▶"}</button>
      </section>
      {recent.length > 0 && (
        <section className="card">
          <h2>Your tables</h2>
          {recent.map((g) => (
            <a key={g} className="recent" href={`#/g/${g}`}>{short(g)}</a>
          ))}
        </section>
      )}
    </main>
  );
}

/** Optional address → display-name labels (localStorage "gl:names"). */
const knownNames = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem("gl:names") ?? "{}");
  } catch {
    return {};
  }
};

function GameView({ address, wallet, say }: { address: PublicKey; wallet: AppWallet; say: (m: string) => void }) {
  const [game, setGame] = useState<GameState | null>(null);
  const [where, setWhere] = useState<"er" | "base" | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [qr, setQr] = useState<string>("");
  const [now, setNow] = useState(chainNow()); // rollup clock, the one the program closes the ladder on
  const [sigs, setSigs] = useState<{ finish?: string; settle?: string; pay?: string }>({});
  const gameRef = useRef<GameState | null>(null);
  gameRef.current = game;
  // set once, the instant the music stops: from then on nothing on this table moves or takes input
  const halted = useRef(false);
  const [isHalted, setHalted] = useState(false);

  // ── optimistic rungs: a rung shows (and moves the paths) the moment it is sent, so rapid presses
  // each aim from the latest position instead of from the last chain snapshot.
  const chainRef = useRef<GameState | null>(null);
  const pendingRef = useRef<{ player: number; gap: number; seq: number; at: number }[]>([]);
  const overlay = useCallback((g: GameState): GameState => {
    if (g.status !== "Live") {
      pendingRef.current = [];
      return g;
    }
    const now = Date.now();
    pendingRef.current = pendingRef.current.filter((p) => g.players[p.player] && g.players[p.player].rungsUsed <= p.seq && now - p.at < 4000);
    if (!pendingRef.current.length) return g;
    const rungs = [...g.rungs];
    const ends = [...g.ends];
    const players = g.players.map((p) => ({ ...p }));
    const t = Math.max(0, Math.floor(chainNow() / 1000 - g.startTs));
    for (const p of pendingRef.current) {
      [ends[p.gap], ends[p.gap + 1]] = [ends[p.gap + 1], ends[p.gap]];
      rungs.push({ gap: p.gap, player: p.player, t });
      players[p.player].rungsUsed += 1;
    }
    return { ...g, rungs, ends, players };
  }, []);
  const ingest = useCallback(
    (g: GameState, keepPaid = false) => {
      const cur = chainRef.current;
      if (keepPaid && cur && cur.status === "Paid") return;
      // ignore an older snapshot of the same live round (poll racing the websocket)
      if (cur && cur.status === "Live" && g.status === "Live" && g.rungs.length < cur.rungs.length) return;
      chainRef.current = g;
      const merged = overlay(g);
      gameRef.current = merged;
      setGame(merged);
    },
    [overlay],
  );
  const addLocal = useCallback(
    (player: number, gap: number) => {
      const g = gameRef.current;
      const base = chainRef.current;
      if (!g || !base) return;
      pendingRef.current.push({ player, gap, seq: g.players[player].rungsUsed, at: Date.now() });
      const merged = overlay(base);
      gameRef.current = merged;
      setGame(merged);
    },
    [overlay],
  );
  const bots = useMemo(() => loadBots(address), [address, game?.nPlayers]);
  const session = useMemo(() => (hasSession(address) ? sessionFor(address) : null), [address, game?.nPlayers]);

  // ── state sync: websocket on both layers + a polling fallback
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const r = await fetchGameAnywhere(address).catch(() => null);
      if (alive && r) {
        ingest(r.game);
        setWhere(r.where);
      }
    };
    poll();
    const t = setInterval(poll, 2500);
    const base = baseConnection();
    const er = erConnection();
    const s1 = base.onAccountChange(address, (info) => {
      if (info.owner.equals(PROGRAM_ID)) {
        ingest(decodeGame(address, info.data as Buffer));
        setWhere("base");
      } else if (info.owner.equals(DELEGATION_PROGRAM_ID)) setWhere("er");
    }, { commitment: "confirmed" });
    const s2 = er.onAccountChange(address, (info) => {
      if (info.owner.equals(PROGRAM_ID)) {
        ingest(decodeGame(address, info.data as Buffer), true);
        setWhere("er");
      }
    }, { commitment: "processed" });
    return () => {
      alive = false;
      clearInterval(t);
      base.removeAccountChangeListener(s1);
      er.removeAccountChangeListener(s2);
    };
  }, [address, ingest]);

  useEffect(() => {
    void syncChainClock(erConnection()).catch(() => 0);
    const t = setInterval(() => setNow(chainNow()), 100);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    QRCode.toDataURL(location.href, { margin: 1, width: 220, color: { dark: "#ffffff", light: "#00000000" } }).then(setQr);
  }, []);

  const me = game ? game.players.findIndex((p) => p.wallet.equals(wallet.publicKey) || (session && p.session.equals(session.publicKey))) : -1;
  const isHost = !!game && game.host.equals(wallet.publicKey);
  const names = (game?.players ?? []).map((p, i) => {
    const b = bots.find((x) => x.wallet.publicKey.equals(p.wallet));
    if (b) return `🤖 ${b.name}`;
    if (game && p.wallet.equals(game.host)) return i === me ? "YOU" : "Host";
    if (i === me) return "YOU";
    const label = knownNames()[p.wallet.toBase58()];
    if (label) return label;
    return short(p.wallet);
  });
  const livePot = game ? game.stake * BigInt(game.nPlayers) + game.rungPrice * BigInt(game.players.reduce((a, p) => a + p.rungsUsed, 0)) : 0n;

  // ── my rung sender
  const sender = useMemo(() => (session && game ? new RungSender(erConnection(), session, address) : null), [session, address, game?.status === "Live"]);
  const addRung = useCallback(
    (gap: number) => {
      const g = gameRef.current;
      if (!g || g.status !== "Live" || me < 0 || !sender || halted.current || chainNow() >= g.endTs * 1000) return;
      if (g.players[me].rungsUsed >= g.rungBudget) return say("Out of rungs");
      addLocal(me, gap);
      sender.add(gap).catch((e) => say(String(e).slice(0, 120)));
    },
    [me, sender, say, addLocal],
  );
  const pull = useCallback(() => {
    const g = gameRef.current;
    if (!g || g.status !== "Live" || halted.current || chainNow() >= g.endTs * 1000) return;
    const gap = pullGap(g, me);
    if (gap === null) return say("You're on the 👑 — defend it!");
    addRung(gap);
  }, [addRung, me, say]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.code === "Space") (e.preventDefault(), pull());
      const d = Number(e.key);
      if (d >= 1 && d <= 5) addRung(d - 1);
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [pull, addRung]);

  // ── bots (host's browser drives them)
  useEffect(() => {
    if (!game || game.status !== "Live" || !isHost || bots.length === 0) return;
    let stop = false;
    const loops = bots.map(async (b, k) => {
      const s = new RungSender(erConnection(), b.session, address);
      const temper = 260 + k * 90 + Math.random() * 200;
      let spent = -1; // counted here, not read from the board: the board can lag a few seconds behind
      while (!stop) {
        const g = gameRef.current;
        if (!g || g.status !== "Live" || halted.current || chainNow() >= g.endTs * 1000) break;
        const idx = g.players.findIndex((p) => p.wallet.equals(b.wallet.publicKey));
        if (idx >= 0 && spent < 0) spent = g.players[idx].rungsUsed;
        const rungsLeft = idx >= 0 ? g.rungBudget - Math.max(spent, g.players[idx].rungsUsed) : 0;
        let wait = 250; // sitting on the crown (or out of rungs): just watch closely
        if (rungsLeft > 0) {
          const gap = botGap(g, idx);
          if (gap !== null) {
            addLocal(idx, gap);
            spent++;
            s.add(gap).catch(() => null);
            // Spread what is left over the time that is left, so bots keep fighting until the countdown ends
            // instead of burning the budget early. Never faster than the bot's own temper.
            const pace = (g.endTs * 1000 - chainNow()) / Math.max(1, rungsLeft - 1);
            wait = Math.max(temper + Math.random() * 300, pace * (0.6 + Math.random() * 0.7));
          }
        }
        await new Promise((r) => setTimeout(r, wait));
      }
    });
    return () => {
      stop = true;
      void loops;
    };
  }, [game?.status, isHost, bots, address, addLocal]);

  // ── automation: finish after the bell, then settle + pay (host first, others as backup)
  const finishing = useRef(0);
  const settling = useRef(0);
  useEffect(() => {
    if (!game || !session || me < 0) return;
    if (game.status === "Live" && now > game.endTs * 1000 + 300 && now - finishing.current > 15_000) {
      finishing.current = now;
      setTimeout(async () => {
        const sig = await finishRound(session, address);
        if (sig) setSigs((s) => ({ ...s, finish: sig }));
        else if (!isHost) finishing.current = Date.now() - 10_000; // let a backup client retry sooner
      }, isHost ? 0 : 2500 + Math.random() * 2000);
    }
    if (game.status === "Settled" && now - settling.current > 45_000) {
      settling.current = now;
      setTimeout(async () => {
        const out = await settleAndPay(session, game, setStep);
        setSigs((s) => ({ ...s, settle: out.settleSig ?? s.settle, pay: out.paySig ?? s.pay }));
        setStep(null);
      }, isHost ? 3500 : 9000 + Math.random() * 4000);
    }
  }, [game, now, session, me, isHost, where, address]);

  // ── music: level 1 in the lobby, 2-3 while live, 4-5 in the danger zone, a tape-stop when the round ends
  // (the VRF-chosen second), and a sting on the reveal.
  const sawLive = useRef(false);
  const stung = useRef(false);
  const stopAt = useRef(0);
  const frozen = useRef<GameState | null>(null); // the board as it was the instant the music stopped
  const dangerAt = game ? (game.startTs + dangerStartsAt(game.durationSecs)) * 1000 : 0;
  // The one place the round stops: board snapshot, input lock and music cut happen in the same call,
  // and the render that follows shows the frozen board. Nothing can restart the music afterwards.
  const halt = useCallback(() => {
    if (halted.current) return;
    halted.current = true;
    if (sawLive.current) stopAt.current = chainNow(); // the banner is for a stop you were there for
    frozen.current = gameRef.current;
    if (sawLive.current) music.stop();
    else music.setLevel(0);
    setHalted(true);
    setNow(chainNow());
  }, []);
  const musicOver = !!game && game.status === "Live" && isHalted;
  // fire exactly at the stop second on the rollup clock (re-armed if a timer wakes a hair early)
  const liveEnd = game && game.status === "Live" ? game.endTs * 1000 : 0;
  useEffect(() => {
    if (!liveEnd || halted.current) return;
    let t = 0;
    const check = () => {
      const left = liveEnd - chainNow();
      if (left <= 0) halt();
      else t = window.setTimeout(check, left);
    };
    check();
    return () => clearTimeout(t);
  }, [liveEnd, halt]);
  useEffect(() => {
    if (!game) return;
    const s = game.status;
    if (s === "Lobby" || s === "Drawing") return music.setLevel(1);
    if (s === "Live" && !halted.current) {
      if (now >= game.endTs * 1000) return halt(); // backup for a timer the tab throttled
      sawLive.current = true;
      const lvl: Level = musicLevelAt(Math.max(0, now / 1000 - game.startTs), game.durationSecs);
      return music.setLevel(lvl);
    }
    if (s !== "Live") halt(); // round ended while we were away: freeze without a level change
    if ((s === "Settled" || s === "Paid") && sawLive.current && !stung.current) {
      stung.current = true;
      const top = game.prizeBps.indexOf(Math.max(...game.prizeBps));
      setTimeout(() => mounted.current && music.sting(me >= 0 && game.ends[top] === me), 900);
    }
  }, [game, now, dangerAt, me, halt]);
  // the end song belongs to the result screen only: leaving it (home, another table) goes back to level 1
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
      music.setLevel(1);
    },
    [],
  );

  if (!game) return <main className="loading">Loading table {short(address)}…</main>;

  const doJoin = async () => {
    try {
      setStep("Joining…");
      await joinGame(wallet, address);
    } catch (e) {
      say(`Join failed: ${String(e).slice(0, 140)}`);
    } finally {
      setStep(null);
    }
  };
  const doBots = async (count: number) => {
    try {
      setStep(`Seating ${count} bot${count > 1 ? "s" : ""}…`);
      await addBots(wallet, game, count);
    } catch (e) {
      say(`Bots failed: ${String(e).slice(0, 140)}`);
    } finally {
      setStep(null);
    }
  };
  const doStart = async () => {
    try {
      await startRound(wallet, game, setStep);
    } catch (e) {
      say(`Start failed: ${String(e).slice(0, 160)}`);
    } finally {
      setStep(null);
    }
  };

  // while the music is stopped the table shows (and counts) exactly what it showed at the stop
  const board = (musicOver || game.status === "Cutting") && frozen.current ? frozen.current : game;
  const mySlot = me >= 0 ? game.ends.indexOf(me) : -1;
  const myBps = mySlot >= 0 ? game.prizeBps[mySlot] ?? 0 : 0;
  const settled = game.status === "Settled" || (game.status === "Paid" && game.startTs > 0);

  return (
    <main className="game">
      <section className="stage">
        <div className="hud">
          <div className={`status s-${game.status.toLowerCase()}`}>
            {game.status === "Paid" && game.startTs === 0 ? "Cancelled · deposits refunded" : musicOver ? "Stopped" : statusLine(game.status)}
          </div>
          {game.status === "Live" && !musicOver && now < dangerAt && (
            <div className="timer">
              {Math.ceil((dangerAt - now) / 1000)}s<small>until the danger zone</small>
            </div>
          )}
          {game.status === "Live" && !musicOver && now >= dangerAt && (
            <div className="timer danger">
              {Math.max(0, Math.ceil((game.endTs * 1000 - now) / 1000))}s<small>until the music stops</small>
            </div>
          )}
          {(musicOver || game.status === "Cutting") && <div className="timer stopped">■ STOP</div>}
          <div className="pot">
            pot <b>{sol(settled ? game.pot : livePot).toFixed(4)}</b> SOL
          </div>
          <div className="rungcount">{board.rungs.length} rungs</div>
        </div>
        <Ladder
          game={board}
          me={me}
          names={names}
          interactive={game.status === "Live" && !musicOver && me >= 0}
          paused={musicOver || game.status === "Cutting"}
          onGap={addRung}
        />
        {(musicOver || game.status === "Cutting" || (stopAt.current > 0 && now - stopAt.current < 2500)) && (
          <div className="stop-flash">
            THE MUSIC STOPPED
            {(musicOver || game.status === "Cutting") && <small>VRF is picking the rung that counts…</small>}
          </div>
        )}
        {game.status === "Live" && !musicOver && me >= 0 && (
          <div className="controls">
            <button className="pull" onPointerDown={pull}>
              <span className="pull-dot" />PULL 👑<small>space</small>
            </button>
            <div className="mine">
              you land on <b style={{ color: COLORS[me % COLORS.length] }}>{(myBps / 100).toFixed(0)}%</b> · rungs left{" "}
              <b>{game.rungBudget - game.players[me].rungsUsed}</b>
            </div>
          </div>
        )}
        {settled && (
          <div className="controls">
            <a className="primary as-button again" href="#/">New table ▶</a>
            <div className="mine">{game.status === "Paid" ? "Paid out on Solana ✓" : "Settling on Solana…"}</div>
          </div>
        )}
        {step && <div className="step">{step}</div>}
      </section>

      <aside className="side">
        {game.status === "Lobby" && (
          <div className="card">
            <h2>Table lobby</h2>
            <p className="muted">
              Stake {sol(game.stake)} · rung {sol(game.rungPrice)} × {game.rungBudget} · {game.durationSecs}s round. Deposit{" "}
              {sol(depositOf(game)).toFixed(4)} SOL.
            </p>
            {qr && <img className="qr" src={qr} alt="scan to join" />}
            <button className="chip" onClick={() => (navigator.clipboard.writeText(location.href), say("Link copied"))}>Copy invite link</button>
            {me < 0 && <button className="primary" onClick={doJoin}>Join table</button>}
            {isHost && game.nPlayers < 6 && (
              <div className="row">
                <button onClick={() => doBots(1)}>+1 bot</button>
                {6 - game.nPlayers > 1 && (
                  <button onClick={() => doBots(Math.min(3, 6 - game.nPlayers))}>+{Math.min(3, 6 - game.nPlayers)} bots</button>
                )}
              </div>
            )}
            {isHost && (
              <button className="primary" disabled={game.nPlayers < 2} onClick={doStart}>
                {game.nPlayers < 2 ? "Need 2+ players" : "Start round ▶"}
              </button>
            )}
            {isHost && (
              <button className="ghost" onClick={async () => {
                try { setStep("Refunding everyone…"); await cancelGame(wallet, game); say("Table cancelled, deposits refunded"); }
                catch (e) { say(`Cancel failed: ${String(e).slice(0, 140)}`); } finally { setStep(null); }
              }}>Cancel table (refund all)</button>
            )}
            {!isHost && me >= 0 && <p className="muted">Waiting for the host to start…</p>}
          </div>
        )}

        <div className="card">
          <h2>Players</h2>
          {game.players.map((p, i) => {
            const slot = game.ends.indexOf(i);
            const bps = game.prizeBps[slot] ?? 0;
            return (
              <div className="player" key={i}>
                <Ghost className="dot" color={COLORS[i % COLORS.length]} size={22} walk={false} />
                <span className="pname">
                  <span>{i === me ? "YOU" : names[i].replace(/^🤖 /, "")}</span>
                  {names[i].startsWith("🤖") && !settled && <small className="cpu">cpu</small>}
                </span>
                <span className="muted">{p.rungsUsed} rungs</span>
                {settled ? (
                  <b className={p.payout > 0n ? "win" : ""}>{sol(p.payout).toFixed(4)} SOL</b>
                ) : game.status === "Live" ? (
                  <span>{(bps / 100).toFixed(0)}%</span>
                ) : null}
              </div>
            );
          })}
        </div>

        {settled && (
          <div className="card proof">
            <h2>Provably fair</h2>
            <p>
              Prize layout VRF <code>{hex(game.startRandomness)}</code>
            </p>
            <p>
              The music played {game.endTs - game.startTs}s. Cut VRF <code>{hex(game.cutRandomness)}</code> → picked rung{" "}
              <b>{game.cutoff}</b> of {game.rungs.length} (any rung could be picked). Rungs below the line are void.
            </p>
            <p className="links">
              <a href={acct(address, where === "er")} target="_blank">game account</a>
              {sigs.finish && <a href={erTx(sigs.finish)} target="_blank">finish tx (ER)</a>}
              {sigs.settle && <a href={erTx(sigs.settle)} target="_blank">commit tx (ER)</a>}
              {sigs.pay && <a href={baseTx(sigs.pay)} target="_blank">payout tx (Solana)</a>}
            </p>
          </div>
        )}
        <p className="muted tiny">
          {where === "er" ? "Live on MagicBlock ER (devnet-as)" : "On Solana devnet"} · <a href={acct(address, where === "er")} target="_blank">{short(address)}</a> ·{" "}
          <a href={BASE_RPC.includes("devnet") ? "https://faucet.solana.com" : "#"} target="_blank">faucet</a>
        </p>
      </aside>
    </main>
  );
}

const clampRound = (d: number) => Math.min(MAX_ROUND_SECS, Math.max(MIN_ROUND_SECS, Math.round(d) || 45));
const hex = (b: number[]) => b.slice(0, 8).map((x) => x.toString(16).padStart(2, "0")).join("") + "…";
function statusLine(s: GameState["status"]) {
  switch (s) {
    case "Lobby": return "Lobby · waiting for players";
    case "Drawing": return "VRF is shuffling the prizes…";
    case "Live": return "Live";
    case "Cutting": return "Music stopped · VRF is picking the rung…";
    case "Settled": return "The ladder speaks";
    case "Paid": return "Closed: paid out on Solana";
  }
}

/** Pixel wordmark with the house ghost. */
function Brand() {
  return (
    <span className="wordmark">
      <Ghost color={COLORS[0]} size={30} look="right" />
      <span>Ghost Leg</span>
    </span>
  );
}

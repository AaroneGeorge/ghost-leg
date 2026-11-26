import { useMemo, useState } from "react";
import { type GameState } from "./lib/ghostleg";
import { CrownSprite, GhostSprite, type Look } from "./Pixel";

// arcade palette: red, orange, teal, pink lead; then lemon and blue for tables of five and six
export const COLORS = ["#e8352b", "#f6ad44", "#6cc6ba", "#f2b6c9", "#f7e04a", "#5b8cff"];

type Props = {
  game: GameState;
  me: number;
  names: string[];
  interactive: boolean;
  /** the music stopped: everything holds still (the ghosts stop walking) */
  paused?: boolean;
  onGap?: (gap: number) => void;
};

const W = 680;
const TOP = 86;
const BODY = 400;
const BOTTOM = 74; // prize boxes only
const PAD = 70;
const GRID_DOTS = 9;

/** One or two letters per player, unique within the table (Kitsune → Ki, Kappa → Ka). */
export function initials(names: string[]): string[] {
  const clean = names.map((n, i) => (n ?? String(i + 1)).replace(/^[^\p{L}\p{N}]+/u, "").trim() || String(i + 1));
  const one = clean.map((n) => n.slice(0, 1).toUpperCase());
  return clean.map((n, i) => (one.filter((x) => x === one[i]).length > 1 ? n.slice(0, 1).toUpperCase() + n.slice(1, 2).toLowerCase() : one[i]));
}

export function Ladder({ game, me, names, interactive, paused = false, onGap }: Props) {
  const n = game.nPlayers;
  // a cancelled table is also "Paid" but never started: no reveal for it
  const settled = (game.status === "Settled" || game.status === "Paid") && game.startTs > 0;
  const rungs = game.rungs;
  const rows = Math.max(rungs.length, 24);
  const rowH = BODY / (rows + 1);
  const x = (c: number) => (n === 1 ? W / 2 : PAD + (c * (W - 2 * PAD)) / (n - 1));
  const y = (k: number) => TOP + (k + 1) * rowH;
  const applied = settled ? game.cutoff : rungs.length;
  const [hover, setHover] = useState<number | null>(null);

  const paths = useMemo(() => {
    return Array.from({ length: n }, (_, p) => {
      let col = p;
      const pts: [number, number][] = [[x(col), TOP]];
      const turns: [number, number][] = [];
      rungs.slice(0, applied).forEach((r, k) => {
        if (r.gap === col || r.gap === col - 1) {
          const to = r.gap === col ? col + 1 : col - 1;
          pts.push([x(col), y(k)], [x(to), y(k)]);
          turns.push([x(col), y(k)], [x(to), y(k)]);
          col = to;
        }
      });
      pts.push([x(col), TOP + BODY]);
      return { d: "M" + pts.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(" L"), end: col, turns };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rungs, applied, n]);

  const bestBps = Math.max(...game.prizeBps, 0);
  const winner = settled ? game.ends[game.prizeBps.indexOf(bestBps)] : -1;
  const live = game.status === "Live";
  const walking = live && !paused;
  const landing = useMemo(() => {
    const out: number[] = [];
    game.ends.forEach((p, slot) => (out[p] = slot));
    return out;
  }, [game.ends]);
  const known = game.status !== "Lobby" && game.status !== "Drawing" && game.startTs > 0;
  const topSlot = known ? game.prizeBps.indexOf(bestBps) : -1;

  // Widths follow row height so a crowded ladder stays readable instead of merging into a block.
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const rungW = clamp(rowH * 0.34, 1, 6);
  const pathW = clamp(rowH * 0.46, 1.6, 7);
  const winW = clamp(rowH * 0.55, 2, 7);
  const thinW = clamp(rowH * 0.22, 0.8, 2);
  const nodeR = rowH > 7 ? pathW * 1.25 : 0;
  const rungDot = rowH > 5 ? rungW * 1.1 : 0;

  return (
    <svg className="ladder" viewBox={`0 0 ${W} ${TOP + BODY + BOTTOM}`} role="img" aria-label="Ghost Leg ladder">
      {/* reveal only: everything below the VRF cut is void */}
      {settled && game.cutoff < rungs.length && (
        <rect x={PAD - 44} y={y(game.cutoff) - rowH / 2} width={W - 2 * PAD + 88} height={TOP + BODY - (y(game.cutoff) - rowH / 2)} className="dangerzone" />
      )}

      {/* rails: faint line + a grid of dim dots */}
      {Array.from({ length: n }, (_, c) => (
        <g key={c}>
          <line x1={x(c)} y1={TOP} x2={x(c)} y2={TOP + BODY} className="rail" shapeRendering="crispEdges" />
          {Array.from({ length: GRID_DOTS }, (_, k) => (
            <rect key={k} x={x(c) - 4} y={TOP + ((k + 0.5) * BODY) / GRID_DOTS - 4} width={8} height={8} className="grid-dot" />
          ))}
        </g>
      ))}

      {/* rungs */}
      {rungs.map((r, k) => {
        const void_ = settled && k >= game.cutoff;
        const col = void_ ? "#ffffff" : COLORS[r.player % COLORS.length];
        const cls = void_ ? "rung rung-void" : settled ? "rung rung-dim" : k === rungs.length - 1 && live ? "rung rung-new" : "rung";
        return (
          <g key={k} className={cls}>
            <line x1={x(r.gap)} x2={x(r.gap + 1)} y1={y(k)} y2={y(k)} stroke={col} strokeWidth={rungW} strokeDasharray={void_ ? "4 6" : undefined} shapeRendering="crispEdges" />
            {rungDot > 0 && !void_ && (
              <>
                <rect x={x(r.gap) - rungDot} y={y(k) - rungDot} width={rungDot * 2} height={rungDot * 2} fill={col} />
                <rect x={x(r.gap + 1) - rungDot} y={y(k) - rungDot} width={rungDot * 2} height={rungDot * 2} fill={col} />
              </>
            )}
          </g>
        );
      })}

      {/* the VRF cut */}
      {settled && (
        <g className="cutline">
          <line x1={PAD - 44} x2={W - PAD + 44} y1={y(game.cutoff) - rowH / 2} y2={y(game.cutoff) - rowH / 2} />
          <text x={PAD - 44} y={y(game.cutoff) - rowH / 2 - 8}>
            &gt; VRF cut · rung {game.cutoff}/{rungs.length}
          </text>
        </g>
      )}

      {/* paths: mine while live, everyone's on reveal (winner on top, thick) */}
      {paths
        .map((p, i) => ({ p, i }))
        .filter(({ i }) => i === me || settled)
        .sort((a, b) => (a.i === winner ? 1 : 0) - (b.i === winner ? 1 : 0))
        .map(({ p, i }) => {
          const w = settled ? (i === winner ? winW : thinW) : pathW;
          const col = COLORS[i % COLORS.length];
          return (
            <g key={`${i}-${settled}`} className={settled ? (i === winner ? "pathg winner" : "pathg thin") : "pathg"}>
              <path d={p.d} pathLength={1} className={settled ? "path reveal" : "path"} stroke={col} style={{ strokeWidth: w, animationDelay: settled ? `${i === winner ? 1.4 : i * 0.2}s` : undefined }} />
              {nodeR > 0 && (!settled || i === winner) && p.turns.map(([a, b], k) => <rect key={k} x={a - nodeR} y={b - nodeR} width={nodeR * 2} height={nodeR * 2} fill={col} className={settled ? "node reveal-node" : "node"} />)}
            </g>
          );
        })}

      {/* hit zones between rails */}
      {interactive &&
        Array.from({ length: n - 1 }, (_, gap) => (
          <g key={gap} onPointerEnter={() => setHover(gap)} onPointerLeave={() => setHover(null)} onPointerDown={() => onGap?.(gap)}>
            <rect x={x(gap) + 10} y={TOP} width={x(gap + 1) - x(gap) - 20} height={BODY} className={hover === gap ? "hit hit-on" : "hit"} />
          </g>
        ))}

      {/* players on top: a ghost each, eyes on the crown */}
      {Array.from({ length: n }, (_, i) => {
        const col = COLORS[i % COLORS.length];
        const at = landing[i];
        const look: Look = !known || settled || topSlot < 0 || at === topSlot ? "down" : topSlot < at ? "left" : "right";
        return (
          <g key={i} transform={`translate(${x(i)},${TOP - 30})`} className={walking ? "walking" : undefined} style={{ animationDelay: `${i * -0.13}s` }}>
            {i === me && <rect x={-29} y={-29} width={58} height={58} fill="none" stroke={col} strokeWidth={3} className="me-box" shapeRendering="crispEdges" />}
            <GhostSprite px={3} color={col} look={look} walk={walking} />
            <text y={-38} textAnchor="middle" className="name">
              {i === me ? "YOU" : names[i]?.replace(/^🤖 /, "")}
            </text>
          </g>
        );
      })}

      {/* prizes at the bottom (slot order) */}
      {Array.from({ length: n }, (_, slot) => {
        const bps = game.prizeBps[slot] ?? 0;
        const top = known && bps === bestBps && bps > 0;
        return (
          <g key={slot} transform={`translate(${x(slot)},${TOP + BODY + 40})`}>
            {top && <rect x={-31} y={-27} width={62} height={54} className="prize-ring" shapeRendering="crispEdges" />}
            <rect x={-25} y={-21} width={50} height={42} className={top ? "prize prize-top" : "prize"} shapeRendering="crispEdges" />
            <text y={top ? 13 : 5} textAnchor="middle" className={top ? "prize-text prize-text-top" : "prize-text"}>
              {known ? `${(bps / 100).toFixed(0)}%` : "?"}
            </text>
            {top && <CrownSprite cx={0} cy={-7} px={2.4} color="#15130e" />}
          </g>
        );
      })}
    </svg>
  );
}

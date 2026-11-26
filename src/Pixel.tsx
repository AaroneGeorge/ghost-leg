// Original pixel sprites for Ghost Leg: a ghost that actually has legs (it walks), and a crown.
// Drawn as merged runs of <rect>s so they stay crisp at any size.

const BODY = [
  ".....####.....",
  "...########...",
  "..##########..",
  ".############.",
  ".############.",
  "##############",
  "##############",
  "##############",
  "##############",
  "##############",
  "##############",
  ".############.",
];
const LEGS_A = ["..###....###..", "..###....###..", ".####....####."];
const LEGS_B = ["...###..###...", "...###..###...", "..####..####.."];
export const GHOST_W = 14;
export const GHOST_H = BODY.length + LEGS_A.length;

function runs(rows: string[], y0 = 0) {
  const out: { x: number; y: number; w: number }[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (row[x] !== "#") {
        x++;
        continue;
      }
      const s = x;
      while (row[x] === "#") x++;
      out.push({ x: s, y: y + y0, w: x - s });
    }
  });
  return out;
}
const BODY_RUNS = runs(BODY);
const LEGS_A_RUNS = runs(LEGS_A, BODY.length);
const LEGS_B_RUNS = runs(LEGS_B, BODY.length);

export type Look = "left" | "right" | "up" | "down" | "center";

/** Ghost sprite inside an existing <svg>: centred on (cx, cy), `px` user units per pixel. */
export function GhostSprite({ cx = 0, cy = 0, px = 3, color, look = "center", walk = true, eyes = true }: {
  cx?: number; cy?: number; px?: number; color: string; look?: Look; walk?: boolean; eyes?: boolean;
}) {
  const ox = cx - (GHOST_W * px) / 2;
  const oy = cy - (GHOST_H * px) / 2;
  const r = (x: number, y: number, w: number, h: number, fill: string, k: string | number) => (
    <rect key={k} x={ox + x * px} y={oy + y * px} width={w * px} height={h * px} fill={fill} />
  );
  const dx = look === "left" ? 0 : look === "right" ? 2 : 1;
  const dy = look === "up" ? 0 : look === "down" ? 2 : 1;
  return (
    <g className="ghost-sprite" shapeRendering="crispEdges">
      {BODY_RUNS.map((s, k) => r(s.x, s.y, s.w, 1, color, `b${k}`))}
      <g className={walk ? "legs-a" : undefined}>{LEGS_A_RUNS.map((s, k) => r(s.x, s.y, s.w, 1, color, `a${k}`))}</g>
      {walk && <g className="legs-b">{LEGS_B_RUNS.map((s, k) => r(s.x, s.y, s.w, 1, color, `l${k}`))}</g>}
      {eyes &&
        [2, 8].map((ex) => (
          <g key={ex}>
            {r(ex + 1, 4, 2, 4, "#fff", "w1")}
            {r(ex, 5, 4, 2, "#fff", "w2")}
            {r(ex + dx, 4 + dy, 2, 2, "#15130e", "p")}
          </g>
        ))}
    </g>
  );
}

/** Standalone ghost (its own <svg>), for HTML layouts. */
export function Ghost({ color, size = 64, look = "center", walk = true, className }: {
  color: string; size?: number; look?: Look; walk?: boolean; className?: string;
}) {
  return (
    <svg className={className} width={size} height={(size * GHOST_H) / GHOST_W} viewBox={`0 0 ${GHOST_W} ${GHOST_H}`} aria-hidden>
      <GhostSprite cx={GHOST_W / 2} cy={GHOST_H / 2} px={1} color={color} look={look} walk={walk} />
    </svg>
  );
}

const CROWN = ["#...#...#", "##.###.##", "#########", "#########"];
const CROWN_RUNS = runs(CROWN);
export function CrownSprite({ cx, cy, px = 2.4, color = "#f7e04a" }: { cx: number; cy: number; px?: number; color?: string }) {
  const ox = cx - (9 * px) / 2;
  const oy = cy - (4 * px) / 2;
  return (
    <g className="crown-sprite" shapeRendering="crispEdges">
      {CROWN_RUNS.map((s, k) => (
        <rect key={k} x={ox + s.x * px} y={oy + s.y * px} width={s.w * px} height={px} fill={color} />
      ))}
    </g>
  );
}

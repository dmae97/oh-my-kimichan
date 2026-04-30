/**
 * OMK Brand Theme — oh-my-kimichan CLI color system
 * Extracted from kimichan.png brand palette
 * HUD-ready: gradients, gauges, panels, sparkles ✨
 */

import { totalmem, freemem, loadavg, cpus } from "os";
import { KIMICHAN_SIMPLE_ASCII_ART } from "./kimichan-simple-art.js";

// ── True-color ANSI helpers ──────────────────────────────────
const colorEnabled = process.env.FORCE_COLOR === "1"
  || process.env.FORCE_COLOR === "true"
  || (
    process.env.NO_COLOR === undefined
    && process.env.TERM !== "dumb"
    && Boolean(process.stdout.isTTY)
  );
const esc = (codes: string) => colorEnabled ? `\x1b[${codes}m` : "";
const rgb = (r: number, g: number, b: number) => `38;2;${r};${g};${b}`;
const bgRgb = (r: number, g: number, b: number) => `48;2;${r};${g};${b}`;

// ── Brand palette (from kimichan.png) ────────────────────────
// "Onii-chan~ hai, naniga suki? Chocomint yori mo anata~ 💜"
const P = {
  purple: { r: 123, g: 91, b: 245 },   // #7B5BF5  Kimichan's eyes & logo
  lightPurple: { r: 167, g: 139, b: 250 }, // #A78BFA  soft highlights
  darkPurple: { r: 91, g: 33, b: 182 },    // #5B21B6  deep shadows
  pink: { r: 236, g: 72, b: 153 },         // #EC4899  hearts & cheeks
  hotPink: { r: 236, g: 72, b: 153 },      // #EC4899  accent
  mint: { r: 20, g: 184, b: 166 },         // #14B8A6  chocomint!
  darkMint: { r: 13, g: 148, b: 136 },     // #0D9488  mint shadow
  orange: { r: 251, g: 146, b: 60 },       // #FB923C  warning
  red: { r: 248, g: 113, b: 113 },         // #F87171  error
  blue: { r: 96, g: 165, b: 250 },         // #60A5FA  info
  cream: { r: 243, g: 232, b: 255 },       // #F3E8FF  bright text
  dark: { r: 36, g: 28, b: 50 },           // #241C32  hoodie black
  gray: { r: 148, g: 163, b: 184 },        // #94A3B8  muted
  skin: { r: 249, g: 211, b: 197 },        // #F9D3C5  warm skin tone
};

// ── Style builders ───────────────────────────────────────────
export const style = {
  reset: esc("0"),
  bold: esc("1"),
  dim: esc("2"),
  italic: esc("3"),
  underline: esc("4"),

  // Brand colors
  purple: (s: string) => esc(rgb(P.purple.r, P.purple.g, P.purple.b)) + s + esc("0"),
  lightPurple: (s: string) => esc(rgb(P.lightPurple.r, P.lightPurple.g, P.lightPurple.b)) + s + esc("0"),
  darkPurple: (s: string) => esc(rgb(P.darkPurple.r, P.darkPurple.g, P.darkPurple.b)) + s + esc("0"),
  pink: (s: string) => esc(rgb(P.pink.r, P.pink.g, P.pink.b)) + s + esc("0"),
  hotPink: (s: string) => esc(rgb(P.hotPink.r, P.hotPink.g, P.hotPink.b)) + s + esc("0"),
  mint: (s: string) => esc(rgb(P.mint.r, P.mint.g, P.mint.b)) + s + esc("0"),
  darkMint: (s: string) => esc(rgb(P.darkMint.r, P.darkMint.g, P.darkMint.b)) + s + esc("0"),
  orange: (s: string) => esc(rgb(P.orange.r, P.orange.g, P.orange.b)) + s + esc("0"),
  red: (s: string) => esc(rgb(P.red.r, P.red.g, P.red.b)) + s + esc("0"),
  blue: (s: string) => esc(rgb(P.blue.r, P.blue.g, P.blue.b)) + s + esc("0"),
  cream: (s: string) => esc(rgb(P.cream.r, P.cream.g, P.cream.b)) + s + esc("0"),
  gray: (s: string) => esc(rgb(P.gray.r, P.gray.g, P.gray.b)) + s + esc("0"),
  skin: (s: string) => esc(rgb(P.skin.r, P.skin.g, P.skin.b)) + s + esc("0"),

  // Combos
  purpleBold: (s: string) => esc("1;" + rgb(P.purple.r, P.purple.g, P.purple.b)) + s + esc("0"),
  pinkBold: (s: string) => esc("1;" + rgb(P.pink.r, P.pink.g, P.pink.b)) + s + esc("0"),
  mintBold: (s: string) => esc("1;" + rgb(P.mint.r, P.mint.g, P.mint.b)) + s + esc("0"),
  blueBold: (s: string) => esc("1;" + rgb(P.blue.r, P.blue.g, P.blue.b)) + s + esc("0"),
  creamBold: (s: string) => esc("1;" + rgb(P.cream.r, P.cream.g, P.cream.b)) + s + esc("0"),

  // Backgrounds
  bgPurple: (s: string) => esc(bgRgb(P.purple.r, P.purple.g, P.purple.b) + ";" + rgb(255, 255, 255)) + s + esc("0"),
  bgPink: (s: string) => esc(bgRgb(P.pink.r, P.pink.g, P.pink.b) + ";" + rgb(255, 255, 255)) + s + esc("0"),
  bgDark: (s: string) => esc(bgRgb(P.dark.r, P.dark.g, P.dark.b) + ";" + rgb(P.cream.r, P.cream.g, P.cream.b)) + s + esc("0"),
};

// ── Semantic helpers ─────────────────────────────────────────
export const status = {
  ok: (s: string) => style.mintBold("✔ " + s),
  warn: (s: string) => style.orange("⚠ " + s),
  fail: (s: string) => style.red("✖ " + s),
  info: (s: string) => style.purple("ℹ " + s),
  success: (s: string) => style.mint("✅ " + s),
  error: (s: string) => style.red("❌ " + s),
};

// ── Layout primitives ────────────────────────────────────────
export function header(text: string): string {
  const line = "═".repeat(Math.min(text.length + 6, 60));
  return [
    "",
    style.purple("╔" + "═".repeat(2) + "✦" + "═".repeat(text.length + 2) + "✦" + "═".repeat(2) + "╗"),
    style.purple("║") + "  " + style.pinkBold(text) + "  " + style.purple("║"),
    style.purple("╚" + "═".repeat(2) + "✦" + "═".repeat(text.length + 2) + "✦" + "═".repeat(2) + "╝"),
    "",
  ].join("\n");
}

export function subheader(text: string): string {
  return style.purpleBold("▸ " + text);
}

export function separator(width = 50): string {
  return style.gray("─".repeat(width));
}

export function bullet(text: string, color: "purple" | "pink" | "mint" | "blue" | "skin" = "purple"): string {
  const colors = { purple: style.purple, pink: style.pink, mint: style.mint, blue: style.blue, skin: style.skin };
  return "  " + colors[color]("◆") + " " + text;
}

export function label(key: string, value: string): string {
  return "  " + style.gray(sanitizeTerminalText(key) + ":") + " " + style.cream(sanitizeTerminalText(value));
}

export function box(lines: string[], title?: string): string {
  const termWidth = process.stdout.columns || 80;
  const rawInner = Math.max(
    ...lines.map((l) => stripAnsi(l).length),
    title ? stripAnsi(title).length + 4 : 0
  );
  const innerWidth = Math.min(rawInner, Math.max(termWidth - 4, 20));
  const width = innerWidth + 4;
  const top = title
    ? style.purple("╔" + "═".repeat(2) + " " + title + " " + "═".repeat(Math.max(0, width - stripAnsi(title).length - 6)) + "╗")
    : style.purple("╔" + "═".repeat(width) + "╗");
  const bottom = style.purple("╚" + "═".repeat(width) + "╝");
  const body = lines.map((l) => style.purple("║ ") + padEndAnsi(l, innerWidth) + style.purple(" ║"));
  return [top, ...body, bottom].join("\n");
}

// ── HUD primitives ───────────────────────────────────────────

/** Generate a gradient text from purple to pink */
export function gradient(text: string): string {
  const chars = [...text];
  const result: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    const t = chars.length === 1 ? 0.5 : i / (chars.length - 1);
    const r = Math.round(P.purple.r + (P.pink.r - P.purple.r) * t);
    const g = Math.round(P.purple.g + (P.pink.g - P.purple.g) * t);
    const b = Math.round(P.purple.b + (P.pink.b - P.purple.b) * t);
    result.push(esc(rgb(r, g, b)) + chars[i] + esc("0"));
  }
  return result.join("");
}

/** Render a horizontal gauge bar */
export function gauge(
  label: string,
  value: number,
  max: number,
  width = 24
): string {
  const ratio = Math.min(Math.max(value / max, 0), 1);
  const filled = Math.round(ratio * width);
  const empty = width - filled;

  let barColor = rgb(P.mint.r, P.mint.g, P.mint.b);
  if (ratio > 0.7) barColor = rgb(P.orange.r, P.orange.g, P.orange.b);
  if (ratio > 0.9) barColor = rgb(P.red.r, P.red.g, P.red.b);

  const bar = esc(barColor) + "█".repeat(filled) + esc("0") + style.gray("░".repeat(empty));
  const pct = style.creamBold(`${Math.round(ratio * 100)}%`.padStart(4));
  return `  ${style.gray(label.padStart(10))} ${bar} ${pct}`;
}

/** Render a multi-line panel with a title */
export function panel(lines: string[], title?: string): string {
  const innerWidth = Math.max(...lines.map((l) => stripAnsi(l).length), title ? stripAnsi(title).length + 4 : 0);
  const width = innerWidth + 4;
  const top = title
    ? style.darkPurple("┏" + "━".repeat(2) + " " + style.pinkBold(title) + " " + "━".repeat(Math.max(0, width - stripAnsi(title).length - 6)) + "┓")
    : style.darkPurple("┏" + "━".repeat(width) + "┓");
  const bottom = style.darkPurple("┗" + "━".repeat(width) + "┛");
  const body = lines.map((l) =>
    style.darkPurple("┃ ") + padEndAnsi(l, innerWidth) + style.darkPurple(" ┃")
  );
  return [top, ...body, bottom].join("\n");
}

/** Sparkle header with stars */
export function sparkleHeader(text: string): string {
  const deco = "✨ 💜 ✨";
  const total = text.length + deco.length + 4;
  const line = "~".repeat(Math.min(total, 60));
  return [
    "",
    style.lightPurple(line),
    "  " + style.pinkBold(text) + "  " + style.purple(deco),
    style.lightPurple(line),
    "",
  ].join("\n");
}

/** Single stat line: label + value + optional unit */
export function stat(label: string, value: string, unit = ""): string {
  return "  " + style.gray(label + ":") + " " + style.mintBold(value) + style.gray(unit);
}

/** Get system usage snapshot */
export function getSystemUsage(): {
  cpuPercent: number;
  memUsedGB: number;
  memTotalGB: number;
  memPercent: number;
  loadAvg: number[];
} {
  const memTotal = totalmem();
  const memFree = freemem();
  const memUsed = memTotal - memFree;

  // Very rough CPU estimate using loadavg vs core count
  const cores = cpus().length;
  const load1 = loadavg()[0];
  const cpuPercent = Math.min(Math.round((load1 / cores) * 100), 100);

  return {
    cpuPercent,
    memUsedGB: Math.round((memUsed / 1024 / 1024 / 1024) * 10) / 10,
    memTotalGB: Math.round((memTotal / 1024 / 1024 / 1024) * 10) / 10,
    memPercent: Math.round((memUsed / memTotal) * 100),
    loadAvg: loadavg(),
  };
}

// ── Utility ──────────────────────────────────────────────────
function stripAnsi(str: string): string {
  return sanitizeTerminalText(str);
}

export function padEndAnsi(str: string, len: number): string {
  return str + " ".repeat(Math.max(0, len - stripAnsi(str).length));
}

export function sanitizeTerminalText(value: string): string {
  return value
    .replace(/\x1B\][\s\S]*?(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B[P^_][\s\S]*?\x1B\\/g, "")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "");
}

// ── Kimichan Emoji Kit ───────────────────────────────────────
export const emoji = {
  shell: "🐚",
  code: "💜",
  search: "🔍",
  download: "📥",
  package: "📦",
  sparkles: "✨",
  heart: "🩷",
  star: "🌟",
  magic: "🪄",
  cat: "🐱",
  cookie: "🍪",
  leaf: "🌿",
  candy: "🍬",
  flower: "🌸",
  moon: "🌙",
  cloud: "☁️",
  fire: "🔥",
  zap: "⚡",
  checklist: "☑️",
  wand: "✨",
};

export function kimichanStatusChips(): string {
  const chips = [
    style.purpleBold("[AI-native]"),
    style.blue("[agent-first]"),
    style.mintBold("[plan-first]"),
    style.orange("[safe]"),
    style.lightPurple("[open]"),
  ];
  return chips.join(" ");
}

export function kimichanCliHero(): string {
  const heroLines = [
    gradient("✦ oh-my-kimichan ✦"),
    style.creamBold("Kimi CLI, but better."),
    style.gray("The orchestration layer that turns Kimi CLI into a powerful coding team."),
    "",
    ...KIMICHAN_SIMPLE_ASCII_ART.split("\n").map((line) => style.lightPurple(line)),
    "",
    kimichanStatusChips(),
  ];

  return box(heroLines, "Kimichan Mascot Theme");
}

// ── Kimichan Custom Banner ───────────────────────────────────
export function kimichanMetaBox(meta?: { directory?: string; session?: string; model?: string }): string {
  const metaLines: string[] = [];
  if (meta?.directory) metaLines.push(label("Directory", meta.directory));
  if (meta?.session) metaLines.push(label("Session", meta.session));
  if (meta?.model) metaLines.push(label("Model", meta.model));

  if (metaLines.length === 0) return "";
  return box(metaLines, "Session Info") + "\n";
}

export function kimichanBanner(meta?: { directory?: string; session?: string; model?: string }): string {
  const parts: string[] = [
    kimichanCliHero(),
  ];

  const metaBox = kimichanMetaBox(meta);
  if (metaBox) parts.push(metaBox);

  return parts.join("\n");
}

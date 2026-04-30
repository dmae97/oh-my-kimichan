/**
 * OMK Brand Theme — oh-my-kimichan CLI color system
 * Extracted from kimichan.png brand palette
 */

// ── True-color ANSI helpers ──────────────────────────────────
const esc = (codes: string) => `\x1b[${codes}m`;
const rgb = (r: number, g: number, b: number) => `38;2;${r};${g};${b}`;
const bgRgb = (r: number, g: number, b: number) => `48;2;${r};${g};${b}`;

// ── Brand palette (from kimichan.png) ────────────────────────
// "Onii-chan~ hai, naniga suki? Chocomint yori mo anata~ 💜"
const P = {
  purple: { r: 123, g: 91, b: 245 },   // #7B5BF5  Kimichan's eyes
  pink: { r: 236, g: 72, b: 153 },      // #EC4899  hearts & cheeks
  mint: { r: 20, g: 184, b: 166 },      // #14B8A6  chocomint!
  orange: { r: 245, g: 158, b: 11 },    // #F59E0B  warning
  red: { r: 239, g: 68, b: 68 },        // #EF4444  error
  blue: { r: 96, g: 165, b: 250 },      // #60A5FA  info
  cream: { r: 243, g: 232, b: 255 },    // #F3E8FF  bright text
  dark: { r: 36, g: 28, b: 50 },        // #241C32  hoodie black
  gray: { r: 156, g: 163, b: 175 },     // #9CA3AF  muted
  skin: { r: 249, g: 211, b: 197 },     // #F9D3C5  warm skin tone
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
  pink: (s: string) => esc(rgb(P.pink.r, P.pink.g, P.pink.b)) + s + esc("0"),
  mint: (s: string) => esc(rgb(P.mint.r, P.mint.g, P.mint.b)) + s + esc("0"),
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
  info: (s: string) => style.blue("ℹ " + s),
  success: (s: string) => style.mint("✅ " + s),
  error: (s: string) => style.red("❌ " + s),
};

// ── Layout primitives ────────────────────────────────────────
export function header(text: string): string {
  const line = "═".repeat(Math.min(text.length + 4, 60));
  return [
    "",
    style.purple(line),
    style.purpleBold("  " + text + "  "),
    style.purple(line),
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
  return "  " + style.gray(key + ":") + " " + style.cream(value);
}

export function box(lines: string[], title?: string): string {
  const width = Math.max(...lines.map((l) => stripAnsi(l).length), title ? stripAnsi(title).length + 4 : 0) + 4;
  const top = title
    ? style.purple("╔" + "═".repeat(2) + " " + title + " " + "═".repeat(width - stripAnsi(title).length - 6) + "╗")
    : style.purple("╔" + "═".repeat(width) + "╗");
  const bottom = style.purple("╚" + "═".repeat(width) + "╝");
  const body = lines.map((l) => style.purple("║ ") + l + " ".repeat(width - stripAnsi(l).length - 2) + style.purple(" ║"));
  return [top, ...body, bottom].join("\n");
}

// ── Utility ──────────────────────────────────────────────────
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

export function padEndAnsi(str: string, len: number): string {
  return str + " ".repeat(Math.max(0, len - stripAnsi(str).length));
}

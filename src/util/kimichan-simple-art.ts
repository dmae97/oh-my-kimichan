/**
 * Small Kimichan mascot banner.
 *
 * Keep this intentionally compact: it is printed in normal `omk` help output
 * and as the fallback Kimi banner replacement, so it must render well on
 * narrow terminals and in logs that do not handle image-style ANSI art.
 */
export const KIMICHAN_SIMPLE_ASCII_ART = [
  "      /\\_/\\",
  "     ( •ᴗ• )   Plan first. Ship small. Stay safe!",
  "     / >☕      kimi❯ [AI-native] [agent-first] [safe]",
  "  ── hoodie black · violet terminal · mint checks ──",
].join("\n");

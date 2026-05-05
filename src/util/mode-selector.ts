/**
 * TTY raw-mode mode selector.
 * Shows a live-updating mode badge and cycles presets with Tab key.
 */

import { getCurrentMode, setCurrentMode, getModePresets, type OmkMode } from "./mode-preset.js";
import { style } from "./theme.js";

const MODES: OmkMode[] = ["agent", "plan", "chat", "debugging", "review"];

export async function promptModeCycle(): Promise<OmkMode> {
  const current = await getCurrentMode();
  let idx = MODES.indexOf(current);
  if (idx === -1) idx = 0;

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return current;
  }

  const preset = () => getModePresets().find((p) => p.name === MODES[idx]);

  const renderBadge = () => {
    const p = preset();
    const badge = p ? `${p.icon} ${style.mintBold(p.label)}` : MODES[idx];
    const hint = style.gray("[Tab] next  [Shift+Tab] prev  [Enter] start  [Ctrl+C] exit");
    // Clear current line and rewrite
    process.stdout.write(`\r\x1B[K  Mode: ${badge}  ${hint}  `);
  };

  process.stdout.write("\n");
  renderBadge();

  return new Promise((resolve, reject) => {
    const stdin = process.stdin;

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const cleanup = () => {
      stdin.removeAllListeners("data");
      stdin.setRawMode(false);
      stdin.pause();
    };

    const onData = (data: string) => {
      const key = data;
      if (key === "\t") {
        idx = (idx + 1) % MODES.length;
        renderBadge();
        return;
      }
      // Shift+Tab (ESC [ Z) — reverse cycle
      if (key === "\x1b[Z") {
        idx = (idx - 1 + MODES.length) % MODES.length;
        renderBadge();
        return;
      }
      if (key === "\r" || key === "\n") {
        cleanup();
        process.stdout.write("\n");
        const selected = MODES[idx];
        if (selected !== current) {
          setCurrentMode(selected)
            .then(() => resolve(selected))
            .catch(reject);
        } else {
          resolve(selected);
        }
        return;
      }
      if (key === "\u0003" || key === "q" || key === "Q") {
        cleanup();
        process.stdout.write("\n");
        process.exit(0);
      }
    };

    stdin.on("data", onData);
  });
}

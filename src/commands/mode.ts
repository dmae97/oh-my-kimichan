import { style, status, label, header, separator } from "../util/theme.js";
import {
  getCurrentMode,
  setCurrentMode,
  getModePresets,
  isValidMode,
  type OmkMode,
} from "../util/mode-preset.js";
import { t } from "../util/i18n.js";

export async function modeCommand(
  presetArg: string | undefined,
  options: { list?: boolean }
): Promise<void> {
  // omk mode list
  if (options.list) {
    await printModeList();
    return;
  }

  // omk mode (no args) → show current
  if (!presetArg) {
    const current = await getCurrentMode();
    const preset = getModePresets().find((p) => p.name === current);
    console.log(header(t("mode.currentHeader")));
    if (preset) {
      console.log(label(t("mode.name"), `${preset.icon} ${preset.label}`));
      console.log(label(t("mode.description"), preset.description));
    } else {
      console.log(label(t("mode.name"), current));
    }
    console.log(separator(40));
    console.log(style.gray(t("mode.switchHint")));
    return;
  }

  let mode = presetArg.toLowerCase().trim();
  if (mode === "default") mode = "agent"; // backward compatibility
  if (!isValidMode(mode)) {
    console.error(status.error(t("mode.invalid", mode)));
    console.log(style.gray(t("mode.validValues")));
    for (const p of getModePresets()) {
      console.log(`  ${p.icon} ${style.cream(p.name)} — ${p.description}`);
    }
    process.exit(1);
  }

  const from = await getCurrentMode();
  if (from === mode) {
    console.log(status.ok(t("mode.alreadySet", mode)));
    return;
  }

  await setCurrentMode(mode as OmkMode);
  const preset = getModePresets().find((p) => p.name === mode);
  console.log(status.ok(t("mode.switched", from, mode)));
  if (preset) {
    console.log(label(t("mode.description"), preset.description));
  }
}

async function printModeList(): Promise<void> {
  const current = await getCurrentMode();
  console.log(header(t("mode.listHeader")));
  for (const p of getModePresets()) {
    const isCurrent = p.name === current;
    const marker = isCurrent ? style.mint("▸") : " ";
    const name = isCurrent ? style.mintBold(p.name) : style.cream(p.name);
    console.log(` ${marker} ${p.icon} ${name} — ${p.description}`);
  }
  console.log(separator(40));
  console.log(style.gray(t("mode.switchHint")));
}

import { getProjectRoot } from "../util/fs.js";
import {
  pasteScreenshot,
  getScreenshotDir,
  listScreenshots,
  cleanScreenshots,
} from "../util/screenshot-store.js";
import { style, status, header, label } from "../util/theme.js";

interface ScreenshotOptions {
  json?: boolean;
  days?: string;
  dryRun?: boolean;
}

function output(data: unknown, json: boolean | undefined, human: string): void {
  if (json) {
    console.log(JSON.stringify(data));
  } else {
    console.log(human);
  }
}

export async function screenshotPasteCommand(options: ScreenshotOptions): Promise<void> {
  const root = getProjectRoot();
  const result = pasteScreenshot(root);
  if (!result.ok) {
    if (options.json) {
      console.log(JSON.stringify({ ok: false, error: result.error }));
    } else {
      console.error(status.error(result.error ?? "Failed to paste screenshot"));
    }
    process.exit(1);
  }
  output(
    { ok: true, path: result.path, relativePath: result.relativePath },
    options.json,
    status.ok(`Screenshot saved: ${result.relativePath}`)
  );
}

export async function screenshotDirCommand(options: ScreenshotOptions): Promise<void> {
  const dir = getScreenshotDir();
  output({ dir }, options.json, label("Screenshot directory", dir));
}

export async function screenshotListCommand(options: ScreenshotOptions): Promise<void> {
  const entries = listScreenshots();
  if (options.json) {
    console.log(JSON.stringify({ entries }));
    return;
  }
  if (entries.length === 0) {
    console.log(style.gray("No screenshots found."));
    return;
  }
  console.log(header("Screenshots"));
  for (const e of entries) {
    const sizeKb = (e.size / 1024).toFixed(1);
    const date = new Date(e.mtimeMs).toISOString().slice(0, 19).replace("T", " ");
    console.log(`  ${date}  ${sizeKb.padStart(6)} KB  ${e.relativePath}`);
  }
}

export async function screenshotCleanCommand(options: ScreenshotOptions): Promise<void> {
  const days = Math.max(0, parseInt(options.days ?? "7", 10));
  const dryRun = Boolean(options.dryRun);
  const result = cleanScreenshots(days, dryRun);

  if (options.json) {
    console.log(JSON.stringify({ days, dryRun, ...result }));
    return;
  }

  if (dryRun) {
    console.log(header(`Dry run — would delete screenshots older than ${days} days`));
  } else {
    console.log(header(`Deleted screenshots older than ${days} days`));
  }

  if (result.deleted.length === 0) {
    console.log(style.gray("No screenshots to delete."));
  } else {
    for (const p of result.deleted) {
      console.log(`  ${dryRun ? "[would delete]" : "[deleted]"} ${p}`);
    }
  }

  if (result.skipped.length > 0) {
    console.log(style.gray(`\n  Kept ${result.skipped.length} newer screenshot(s).`));
  }
}

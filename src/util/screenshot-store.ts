/**
 * Screenshot store — cross-platform clipboard image reader with safe project-relative paths.
 *
 * All images are saved under .omk/screenshots/YYYY-MM-DD/ so they stay
 * gitignored and organized by date.
 */
import { execFileSync } from "child_process";
import { writeFileSync, mkdirSync, readFileSync, readdirSync, statSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, relative } from "path";
import { createHash } from "crypto";
import { getProjectRoot } from "./fs.js";

export const SCREENSHOT_DIR = ".omk/screenshots";
export const MAX_SIZE_BYTES = 20 * 1024 * 1024;

export interface ScreenshotResult {
  ok: boolean;
  path?: string;
  relativePath?: string;
  error?: string;
}

const IMAGE_MAGIC = new Map<string, number[]>([
  ["png", [0x89, 0x50, 0x4e, 0x47]],
  ["jpg", [0xff, 0xd8, 0xff]],
  ["webp", [0x52, 0x49, 0x46, 0x46]], // RIFF
  ["gif", [0x47, 0x49, 0x46, 0x38]], // GIF8
]);

export function validateMagicBytes(buf: Buffer): { ok: boolean; ext: string } {
  for (const [ext, magic] of IMAGE_MAGIC) {
    if (buf.length >= magic.length && magic.every((b, i) => buf[i] === b)) {
      return { ok: true, ext };
    }
  }
  return { ok: false, ext: "" };
}

function generateScreenshotPath(projectRoot: string, ext: string): { fullPath: string; relativePath: string } {
  const now = new Date();
  const dateDir = now.toISOString().slice(0, 10);
  const timestamp = now.toISOString().replace(/[:.]/g, "").slice(0, 15);
  const hash = createHash("sha256").update(`${Date.now()}-${Math.random()}`).digest("hex").slice(0, 8);
  const fileName = `screenshot-${timestamp}-${hash}.${ext}`;
  const dir = join(projectRoot, SCREENSHOT_DIR, dateDir);
  mkdirSync(dir, { recursive: true });
  const fullPath = join(dir, fileName);
  const relativePath = relative(projectRoot, fullPath).replace(/\\/g, "/");
  return { fullPath, relativePath };
}

function saveScreenshot(data: Buffer, ext: string, projectRoot: string): ScreenshotResult {
  if (data.length > MAX_SIZE_BYTES) {
    return { ok: false, error: `Image exceeds ${MAX_SIZE_BYTES / (1024 * 1024)} MB limit` };
  }
  const magic = validateMagicBytes(data);
  if (!magic.ok) {
    return { ok: false, error: "Clipboard does not contain a valid image (PNG/JPG/WebP/GIF)" };
  }
  const { fullPath, relativePath } = generateScreenshotPath(projectRoot, magic.ext);
  writeFileSync(fullPath, data);
  return { ok: true, path: fullPath, relativePath: `./${relativePath}` };
}

// ---------------------------------------------------------------------------
// Windows provider
// ---------------------------------------------------------------------------

function readWindowsClipboard(projectRoot: string): ScreenshotResult {
  try {
    const ps = `
      Add-Type -Assembly System.Windows.Forms;
      $img = [Windows.Forms.Clipboard]::GetImage();
      if ($img -eq $null) { exit 1 };
      $ms = New-Object IO.MemoryStream;
      $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png);
      [Convert]::ToBase64String($ms.ToArray());
    `;
    const encoded = Buffer.from(ps, "utf16le").toString("base64");
    const b64 = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-STA", "-EncodedCommand", encoded],
      { encoding: "utf-8", timeout: 5000, windowsHide: true }
    ).trim();
    const buf = Buffer.from(b64, "base64");
    if (buf.length === 0) {
      return { ok: false, error: "No image in clipboard" };
    }
    return saveScreenshot(buf, "png", projectRoot);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// macOS provider
// ---------------------------------------------------------------------------

function readMacOSClipboard(projectRoot: string): ScreenshotResult {
  // Try pngpaste first (more reliable)
  try {
    const tmpPath = join(tmpdir(), `omk-screenshot-${Date.now()}.png`);
    execFileSync("pngpaste", [tmpPath], { timeout: 5000 });
    const buf = readFileSync(tmpPath);
    if (buf.length === 0) {
      return { ok: false, error: "No image in clipboard" };
    }
    return saveScreenshot(buf, "png", projectRoot);
  } catch {
    // Fallback to osascript
    try {
      const tmpPath = join(tmpdir(), `omk-screenshot-${Date.now()}.png`);
      const script = `
        set pngData to the clipboard as «class PNGf»
        set f to open for access POSIX file "${tmpPath}" with write permission
        write pngData to f
        close access f
      `;
      execFileSync("osascript", ["-e", script], { encoding: "utf-8", timeout: 5000 });
      const buf = readFileSync(tmpPath);
      if (buf.length === 0) {
        return { ok: false, error: "No image in clipboard" };
      }
      return saveScreenshot(buf, "png", projectRoot);
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}

// ---------------------------------------------------------------------------
// Linux / WSL provider
// ---------------------------------------------------------------------------

function readLinuxClipboard(projectRoot: string): ScreenshotResult {
  // WSL2: try Windows clipboard via powershell.exe first
  if (process.env.WSL_DISTRO_NAME || process.env.WSLENV) {
    try {
      const ps = `
        Add-Type -Assembly System.Windows.Forms;
        $img = [Windows.Forms.Clipboard]::GetImage();
        if ($img -eq $null) { exit 1 };
        $ms = New-Object IO.MemoryStream;
        $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png);
        [Convert]::ToBase64String($ms.ToArray());
      `;
      const encoded = Buffer.from(ps, "utf16le").toString("base64");
      const b64 = execFileSync(
        "powershell.exe",
        ["-NoProfile", "-STA", "-EncodedCommand", encoded],
        { encoding: "utf-8", timeout: 5000, windowsHide: true }
      ).trim();
      const buf = Buffer.from(b64, "base64");
      if (buf.length === 0) {
        return { ok: false, error: "No image in clipboard" };
      }
      return saveScreenshot(buf, "png", projectRoot);
    } catch {
      // fall through to native Linux tools
    }
  }

  try {
    let buf: Buffer;
    try {
      buf = execFileSync("wl-paste", ["--type", "image/png"], { timeout: 5000, encoding: "buffer" });
    } catch {
      buf = execFileSync("xclip", ["-selection", "clipboard", "-t", "image/png", "-o"], { timeout: 5000, encoding: "buffer" });
    }
    if (buf.length === 0) {
      return { ok: false, error: "No image in clipboard" };
    }
    return saveScreenshot(buf, "png", projectRoot);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function pasteScreenshot(projectRoot?: string): ScreenshotResult {
  const root = projectRoot ?? getProjectRoot();
  if (process.platform === "win32") {
    return readWindowsClipboard(root);
  }
  if (process.platform === "darwin") {
    return readMacOSClipboard(root);
  }
  return readLinuxClipboard(root);
}

export function getScreenshotDir(projectRoot?: string): string {
  const root = projectRoot ?? getProjectRoot();
  return join(root, SCREENSHOT_DIR);
}

export interface ScreenshotEntry {
  relativePath: string;
  fullPath: string;
  size: number;
  mtimeMs: number;
}

export function listScreenshots(projectRoot?: string): ScreenshotEntry[] {
  const root = projectRoot ?? getProjectRoot();
  const base = join(root, SCREENSHOT_DIR);
  if (!existsSync(base)) return [];

  const entries: ScreenshotEntry[] = [];
  for (const dateDir of readdirSync(base)) {
    const datePath = join(base, dateDir);
    const stat = statSync(datePath, { throwIfNoEntry: false });
    if (!stat || !stat.isDirectory()) continue;
    for (const file of readdirSync(datePath)) {
      const fullPath = join(datePath, file);
      const s = statSync(fullPath, { throwIfNoEntry: false });
      if (!s || !s.isFile()) continue;
      entries.push({
        relativePath: relative(root, fullPath).replace(/\\/g, "/"),
        fullPath,
        size: s.size,
        mtimeMs: s.mtimeMs,
      });
    }
  }
  return entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export interface CleanResult {
  deleted: string[];
  skipped: string[];
}

export function cleanScreenshots(days: number, dryRun: boolean, projectRoot?: string): CleanResult {
  const root = projectRoot ?? getProjectRoot();
  const base = join(root, SCREENSHOT_DIR);
  if (!existsSync(base)) return { deleted: [], skipped: [] };

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const result: CleanResult = { deleted: [], skipped: [] };

  for (const dateDir of readdirSync(base)) {
    const datePath = join(base, dateDir);
    const stat = statSync(datePath, { throwIfNoEntry: false });
    if (!stat || !stat.isDirectory()) continue;

    for (const file of readdirSync(datePath)) {
      const fullPath = join(datePath, file);
      const s = statSync(fullPath, { throwIfNoEntry: false });
      if (!s || !s.isFile()) continue;

      if (s.mtimeMs < cutoff) {
        if (!dryRun) {
          rmSync(fullPath);
        }
        result.deleted.push(relative(root, fullPath).replace(/\\/g, "/"));
      } else {
        result.skipped.push(relative(root, fullPath).replace(/\\/g, "/"));
      }
    }

    // Remove empty date directories
    if (!dryRun && readdirSync(datePath).length === 0) {
      rmSync(datePath, { recursive: true });
    }
  }

  return result;
}

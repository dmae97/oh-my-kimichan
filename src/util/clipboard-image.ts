/**
 * Cross-platform clipboard image reader.
 * Saves images under .omk/attachments/ relative to the project root
 * so users see abbreviated paths instead of raw temp directories.
 */

import { execSync } from "child_process";
import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join, relative } from "path";

export interface ClipboardImageResult {
  path: string | null;
  relativePath: string | null;
  error?: string;
}

function getAttachmentPath(projectRoot: string, ext: string): { path: string; relativePath: string } {
  const dir = join(projectRoot, ".omk", "attachments");
  mkdirSync(dir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `image-${timestamp}.${ext}`;
  const path = join(dir, fileName);
  return { path, relativePath: relative(projectRoot, path) };
}

function saveProjectImage(data: Buffer, ext: string, projectRoot: string): { path: string; relativePath: string } {
  const { path, relativePath } = getAttachmentPath(projectRoot, ext);
  writeFileSync(path, data);
  return { path, relativePath };
}

function readWindows(projectRoot: string): ClipboardImageResult {
  try {
    const ps = `
      Add-Type -Assembly System.Windows.Forms;
      $img = [Windows.Forms.Clipboard]::GetImage();
      if ($img -eq $null) { exit 1 };
      $ms = New-Object IO.MemoryStream;
      $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png);
      [Convert]::ToBase64String($ms.ToArray());
    `;
    const b64 = execSync(`powershell.exe -NoProfile -Command "${ps.replace(/\n/g, " ")}"`, {
      encoding: "utf-8",
      timeout: 5000,
      windowsHide: true,
    }).trim();
    const buf = Buffer.from(b64, "base64");
    if (buf.length === 0) return { path: null, relativePath: null, error: "No image in clipboard" };
    const saved = saveProjectImage(buf, "png", projectRoot);
    return { path: saved.path, relativePath: saved.relativePath };
  } catch (e) {
    return { path: null, relativePath: null, error: (e as Error).message };
  }
}

function readMacOS(projectRoot: string): ClipboardImageResult {
  // Try pngpaste first (more reliable, writes directly to disk)
  try {
    const { path, relativePath } = getAttachmentPath(projectRoot, "png");
    execSync(`pngpaste "${path}"`, { timeout: 5000 });
    const buf = readFileSync(path);
    if (buf.length === 0) return { path: null, relativePath: null, error: "No image in clipboard" };
    return { path, relativePath };
  } catch {
    // Fallback to osascript: write to a temp file then copy into project
    try {
      const tmpPath = join(tmpdir(), `omk-clipboard-${Date.now()}.png`);
      const script = `
        set pngData to the clipboard as «class PNGf»
        set tmpPath to "${tmpPath}"
        set f to open for access tmpPath with write permission
        write pngData to f
        close access f
        return tmpPath
      `;
      execSync("osascript -e '" + script.replace(/'/g, "'\"'\"'") + "'", {
        encoding: "utf-8",
        timeout: 5000,
      });
      const buf = readFileSync(tmpPath);
      if (buf.length === 0) return { path: null, relativePath: null, error: "No image in clipboard" };
      const saved = saveProjectImage(buf, "png", projectRoot);
      return { path: saved.path, relativePath: saved.relativePath };
    } catch (e) {
      return { path: null, relativePath: null, error: (e as Error).message };
    }
  }
}

function readLinux(projectRoot: string): ClipboardImageResult {
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
      const b64 = execSync(`powershell.exe -NoProfile -Command "${ps.replace(/\n/g, " ")}"`, {
        encoding: "utf-8",
        timeout: 5000,
        windowsHide: true,
      }).trim();
      const buf = Buffer.from(b64, "base64");
      if (buf.length === 0) return { path: null, relativePath: null, error: "No image in clipboard" };
      const saved = saveProjectImage(buf, "png", projectRoot);
      return { path: saved.path, relativePath: saved.relativePath };
    } catch {
      // fall through to native Linux tools
    }
  }

  try {
    let buf: Buffer;
    try {
      buf = execSync("wl-paste --type image/png", { timeout: 5000, encoding: "buffer" });
    } catch {
      buf = execSync("xclip -selection clipboard -t image/png -o", { timeout: 5000, encoding: "buffer" });
    }
    if (buf.length === 0) return { path: null, relativePath: null, error: "No image in clipboard" };
    const saved = saveProjectImage(buf, "png", projectRoot);
    return { path: saved.path, relativePath: saved.relativePath };
  } catch (e) {
    return { path: null, relativePath: null, error: (e as Error).message };
  }
}

export function readClipboardImage(projectRoot: string): ClipboardImageResult {
  if (process.platform === "win32") return readWindows(projectRoot);
  if (process.platform === "darwin") return readMacOS(projectRoot);
  return readLinux(projectRoot);
}

import { runShell } from "../util/shell.js";

export async function stitchInstallCommand(): Promise<void> {
  console.log("📦 Installing Google Stitch skills...\n");
  const skills = [
    "design-md",
    "stitch-design",
    "react:components",
    "shadcn-ui",
  ];
  for (const skill of skills) {
    const result = await runShell(
      "npx",
      ["-y", "skills", "add", "google-labs-code/stitch-skills", "--skill", skill, "--global"],
      { timeout: 120000 }
    );
    if (result.failed) {
      console.error(`❌ Failed to install ${skill}:`, result.stderr);
    } else {
      console.log(`✅ ${skill} installed`);
    }
  }
}

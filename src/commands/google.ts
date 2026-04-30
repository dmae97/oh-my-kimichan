import { runShell } from "../util/shell.js";
import { style, header, status } from "../util/theme.js";

export async function stitchInstallCommand(): Promise<void> {
  console.log(header("Installing Google Stitch skills"));
  const skills = [
    "design-md",
    "stitch-design",
    "react:components",
    "shadcn-ui",
  ];
  let failCount = 0;
  for (const skill of skills) {
    const result = await runShell(
      "npx",
      ["-y", "skills", "add", "google-labs-code/stitch-skills", "--skill", skill, "--global"],
      { timeout: 120000 }
    );
    if (result.failed) {
      console.error(status.error(`Failed to install ${skill}:`), result.stderr);
      failCount++;
    } else {
      console.log(status.ok(`${skill} installed`));
    }
  }
  if (failCount === skills.length) {
    console.error("\n" + status.error("모든 스킬 설치에 실패했습니다."));
    process.exit(1);
  }
}

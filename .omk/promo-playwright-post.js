/**
 * Playwright script to auto-post oh-my-kimichan promo to GitHub Discussions
 *
 * Usage:
 *   1. Ensure you are logged into GitHub in your default browser
 *   2. npx playwright install chromium (if not already installed)
 *   3. node .omk/promo-playwright-post.js
 *
 * The script navigates to the Show and Tell discussion creation page,
 * fills the title and body, and submits.
 */

import { chromium } from "playwright";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bodyPath = join(__dirname, "promo-github-discussion.md");
const body = readFileSync(bodyPath, "utf-8");
const title =
  "Show and Tell: oh-my-kimichan — Turn Kimi Code CLI into a Worktree-Based Coding Team";

const DISCUSSION_URL =
  "https://github.com/dmae97/oh-my-kimichan/discussions/new?category=show-and-tell";

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  console.log("Navigating to GitHub Discussions...");
  await page.goto(DISCUSSION_URL, { waitUntil: "networkidle" });

  // Wait for the form to be ready
  await page.waitForSelector('input[name="discussion[title]"]', { timeout: 15000 });

  console.log("Filling title...");
  await page.fill('input[name="discussion[title]"]', title);

  console.log("Filling body...");
  // GitHub uses a textarea with name="discussion[body]"
  await page.fill('textarea[name="discussion[body]"]', body);

  console.log("Ready to submit. Review the form in the browser.");
  console.log("The script will auto-submit in 5 seconds...");

  await page.waitForTimeout(5000);

  // Click the Submit button
  const submitBtn = page.locator('button:has-text("Start discussion")');
  await submitBtn.click();

  console.log("Submitted! Waiting for navigation...");
  await page.waitForNavigation({ timeout: 30000 });

  console.log("Done. URL:", page.url());

  await browser.close();
})();

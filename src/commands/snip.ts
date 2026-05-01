import { readFileSync } from "fs";
import { style } from "../util/theme.js";
import { saveSnippet, getSnippet, deleteSnippet, searchSnippets, listSnippets } from "../util/snippet.js";

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    process.stdin.on("error", reject);
  });
}

export async function snipSaveCommand(name: string, options: { file?: string; tags?: string }): Promise<void> {
  let content: string;
  if (options.file) {
    content = readFileSync(options.file, "utf-8");
  } else {
    if (process.stdin.isTTY) {
      console.error(style.red("✖ Provide --file <path> or pipe content via stdin."));
      process.exit(1);
    }
    content = await readStdin();
  }

  const tags = options.tags?.split(",").map((t) => t.trim()).filter(Boolean);
  const result = await saveSnippet(name, content, tags);
  if (result.success) {
    console.log(style.mint(`✔ Saved snippet "${name}" to ${result.path}`));
  } else {
    console.error(style.red(`✖ Failed to save snippet "${name}"`));
    process.exit(1);
  }
}

export async function snipGetCommand(name: string): Promise<void> {
  const snippet = await getSnippet(name);
  if (!snippet) {
    console.error(style.red(`✖ Snippet "${name}" not found.`));
    process.exit(1);
  }
  console.log(snippet.content);
}

export async function snipListCommand(): Promise<void> {
  const snippets = await listSnippets();
  if (snippets.length === 0) {
    console.log(style.gray("No snippets found. Use 'omk snip save <name>' to create one."));
    return;
  }
  console.log(style.purpleBold(`Snippets (${snippets.length}):\n`));
  for (const s of snippets) {
    const tags = s.tags.length > 0 ? style.gray(` [${s.tags.join(", ")}]`) : "";
    console.log(`  ${style.mintBold(s.name)}${tags}`);
  }
}

export async function snipSearchCommand(query: string): Promise<void> {
  const snippets = await searchSnippets(query);
  if (snippets.length === 0) {
    console.log(style.gray(`No snippets matching "${query}".`));
    return;
  }
  console.log(style.purpleBold(`Results for "${query}" (${snippets.length}):\n`));
  for (const s of snippets) {
    const tags = s.tags.length > 0 ? style.gray(` [${s.tags.join(", ")}]`) : "";
    const preview = s.content.replace(/\s+/g, " ").trim().slice(0, 80);
    console.log(`  ${style.mintBold(s.name)}${tags}`);
    console.log(`    ${style.gray(preview + (s.content.length > 80 ? "…" : ""))}`);
  }
}

export async function snipDeleteCommand(name: string): Promise<void> {
  const result = await deleteSnippet(name);
  if (result.success) {
    console.log(style.mint(`✔ Deleted snippet "${name}"`));
  } else {
    console.error(style.red(`✖ Snippet "${name}" not found.`));
    process.exit(1);
  }
}

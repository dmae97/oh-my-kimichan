import test from "node:test";
import assert from "node:assert/strict";

import { BannerReplacer } from "../dist/kimi/banner.js";

test("Kimi banner replacement waits through terminal setup-only chunks", async () => {
  const originalWrite = process.stdout.write;
  let replacedMeta = null;
  const replacer = new BannerReplacer((meta) => {
    replacedMeta = meta;
  });

  process.stdout.write = function (_chunk, encoding, callback) {
    if (typeof encoding === "function") encoding();
    if (typeof callback === "function") callback();
    return true;
  };

  try {
    assert.equal(replacer.process("\x1b[2J\x1b[H"), null);
    await new Promise((resolve) => setTimeout(resolve, 350));

    const output = replacer.process("╭─\nWelcome to Kimi Code CLI!\nDirectory: /tmp/project\nSession: abc\nModel: kimi-k2.6\n╰─\n");

    assert.equal(output, null);
    assert.deepEqual(replacedMeta, {
      directory: "/tmp/project",
      session: "abc",
      model: "kimi-k2.6",
    });
  } finally {
    process.stdout.write = originalWrite;
  }
});

test("Kimi banner replacement tolerates upstream welcome wording drift", () => {
  let replaced = false;
  const replacer = new BannerReplacer(() => {
    replaced = true;
  });

  const output = replacer.process("╭─\nWelcome to Kimi CLI!\nDirectory: /tmp/project\nSession: abc\nModel: kimi-k2.6\n╰─\n");

  assert.equal(output, null);
  assert.equal(replaced, true);
});

test("Kimi banner replacement passes through prompt output immediately", () => {
  let replaced = false;
  const replacer = new BannerReplacer(() => {
    replaced = true;
  });

  const prompt = "kimi❯ ";
  const output = replacer.process(prompt);

  assert.equal(output, prompt);
  assert.equal(replaced, false);
});

test("Kimi banner replacement passes through boxed input forms immediately", () => {
  let replaced = false;
  const replacer = new BannerReplacer(() => {
    replaced = true;
  });

  const boxedPrompt = [
    "╭────────────────────────╮",
    "│ What should Kimi do?   │",
    "╰────────────────────────╯",
    "kimi❯ ",
  ].join("\n");
  const output = replacer.process(boxedPrompt);

  assert.equal(output, boxedPrompt);
  assert.equal(replaced, false);
});

import test from "node:test";
import assert from "node:assert/strict";

import { kimichanCliHero, sanitizeTerminalText } from "../dist/util/theme.js";
import { KIMICHAN_SIMPLE_ASCII_ART } from "../dist/util/kimichan-simple-art.js";

test("Kimichan CLI hero uses the compact mascot theme", () => {
  const hero = kimichanCliHero();

  assert.match(hero, /oh-my-kimichan/);
  assert.match(hero, /Kimi CLI, but better/);
  assert.match(hero, /Plan first\. Ship small\. Stay safe!/);
  assert.match(hero, /\[AI-native]/);
  assert.equal(KIMICHAN_SIMPLE_ASCII_ART.split("\n").length <= 5, true);
});

test("terminal text sanitizer strips control sequences from display values", () => {
  const unsafe = "safe\x1b]52;c;copied\x07\x1b[31mred\x00";

  assert.equal(sanitizeTerminalText(unsafe), "safered");
});

import test from "node:test";
import assert from "node:assert/strict";

import { KimiBugFilter } from "../dist/kimi/bug-filter.js";

test("Kimi bug filter passes normal prompt output without buffering forever", () => {
  const filter = new KimiBugFilter();

  assert.deepEqual(filter.process("kimi❯ "), {
    output: "kimi❯ ",
    sendEnter: false,
  });
});

test("Kimi bug filter keeps split exception marker prefix only", () => {
  const filter = new KimiBugFilter();

  assert.deepEqual(filter.process("hello Unhandled exception in event"), {
    output: "hello ",
    sendEnter: false,
  });
  assert.deepEqual(filter.forceFlush(), "Unhandled exception in event");
});

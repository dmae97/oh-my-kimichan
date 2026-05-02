import { test } from "node:test";
import assert from "node:assert";
import { buildProfileArgs } from "../dist/util/runtime-profile.js";

test("buildProfileArgs injects supported flags only", () => {
  const profile = {
    model: "kimi-k2-6",
    thinking: true,
    temperature: 0.15,
    topP: 0.85,
    variant: "coding",
  };
  const caps = { model: true, thinking: true, temperature: true, topP: true, variant: true };
  const args = buildProfileArgs(profile, caps);
  assert.deepStrictEqual(args, [
    "--model", "kimi-k2-6",
    "--thinking",
    "--temperature", "0.15",
    "--top-p", "0.85",
    "--variant", "coding",
  ]);
});

test("buildProfileArgs omits unsupported flags (soft fallback)", () => {
  const profile = {
    model: "kimi-k2-6",
    thinking: true,
    temperature: 0.15,
    topP: 0.85,
    variant: "coding",
  };
  const caps = { model: true, thinking: true, temperature: false, topP: false, variant: false };
  const args = buildProfileArgs(profile, caps);
  assert.deepStrictEqual(args, ["--model", "kimi-k2-6", "--thinking"]);
});

test("buildProfileArgs handles no-thinking", () => {
  const profile = { thinking: false };
  const caps = { model: true, thinking: true, temperature: false, topP: false, variant: false };
  const args = buildProfileArgs(profile, caps);
  assert.deepStrictEqual(args, ["--no-thinking"]);
});

test("buildProfileArgs returns empty when nothing is supported", () => {
  const profile = { temperature: 0.5, topP: 0.9 };
  const caps = { model: false, thinking: false, temperature: false, topP: false, variant: false };
  const args = buildProfileArgs(profile, caps);
  assert.deepStrictEqual(args, []);
});

test("buildProfileArgs skips undefined fields", () => {
  const profile = { model: undefined, thinking: undefined };
  const caps = { model: true, thinking: true, temperature: true, topP: true, variant: true };
  const args = buildProfileArgs(profile, caps);
  assert.deepStrictEqual(args, []);
});

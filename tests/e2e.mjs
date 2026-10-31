// End-to-end smoke test. Start the app first, e.g.:
//   npm run build && UNSAFE_MEMORY_STORE=1 npm start
// then: BASE_URL=http://localhost:3000 npm run test:e2e
import { createRequire } from "node:module";
// Playwright is not a project dependency; install it globally or locally to run this.
const { chromium } = createRequire(import.meta.url)("playwright");
import assert from "node:assert/strict";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const browser = await chromium.launch();
const page = await browser.newPage();
const problems = [];
page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
page.on("pageerror", (e) => problems.push(String(e)));

const step = (s) => console.log("•", s);
const user = `e2e_${Date.now().toString(36)}`;

step("protected pages redirect to sign-in");
await page.goto(`${BASE}/play/rubiks`);
assert.equal(new URL(page.url()).pathname, "/");

step("security headers present");
const res = await page.goto(BASE);
const h = res.headers();
assert.match(h["content-security-policy"], /script-src 'self' 'nonce-/);
assert.equal(h["x-frame-options"], "DENY");
assert.equal(h["x-content-type-options"], "nosniff");
assert.ok(!h["x-powered-by"]);

step("register");
await page.getByRole("tab", { name: "Create account" }).click();
await page.getByLabel("Username").fill(user);
await page.getByLabel("Password", { exact: true }).fill("a-good-password");
await page.getByLabel("Confirm password").fill("a-good-password");
await page.getByRole("button", { name: "Create account" }).last().click();
await page.waitForURL(`${BASE}/play`);
await page.getByText(`Signed in as`).waitFor();

step("open rubik's cube and capture scramble");
const newGame = page.waitForResponse((r) => r.url().endsWith("/api/rubiks/new") && r.status() === 201);
await page.getByRole("link", { name: /Rubik/ }).click();
let game = await (await newGame).json();
await page.locator("canvas").waitFor();
await page.getByRole("button", { name: /Hint \(5 left\)/ }).waitFor();

step("turn faces with buttons and keyboard");
await page.getByRole("button", { name: "R clockwise" }).click();
await page.keyboard.press("Shift+R"); // undo it
await page.waitForTimeout(700);
await page.getByText("Moves: 2").waitFor();

step("use all 5 hints");
for (let left = 4; left >= 0; left--) {
  await page.getByRole("button", { name: /Hint \(\d left\)/ }).click();
  await page.getByRole("button", { name: "Do it" }).waitFor();
  await page.getByRole("button", { name: "Do it" }).click();
  await page.waitForTimeout(500);
  if (left > 0) await page.getByRole("button", { name: `💡 Hint (${left} left)` }).waitFor();
}
step("6th hint warns, then forces a restart");
await page.getByRole("button", { name: "No hints left" }).click();
await page.getByText("If you ask for another one, this game ends").waitFor();
await page.getByRole("button", { name: "Keep playing" }).click();
await page.getByRole("button", { name: "No hints left" }).click();
await page.getByRole("button", { name: "Ask anyway (restart)" }).click();
await page.getByRole("heading", { name: "Out of hints" }).waitFor();
assert.equal(await page.getByRole("button", { name: "R clockwise" }).isDisabled(), true);

step("start over gives a fresh game with 5 hints");
const again = page.waitForResponse((r) => r.url().endsWith("/api/rubiks/new") && r.status() === 201);
await page.getByRole("button", { name: "Start over" }).click();
game = await (await again).json();
await page.getByRole("button", { name: /Hint \(5 left\)/ }).waitFor();

step("solve the cube by reversing the scramble");
const solution = [...game.scramble].reverse().map((m) => (m.endsWith("2") ? m : m.endsWith("'") ? m[0] : `${m}'`));
for (const m of solution) {
  const key = m[0].toLowerCase();
  if (m.endsWith("2")) { await page.keyboard.press(key); await page.waitForTimeout(260); await page.keyboard.press(key); }
  else if (m.endsWith("'")) await page.keyboard.press(`Shift+${key}`);
  else await page.keyboard.press(key);
  await page.waitForTimeout(260);
}
await page.getByRole("heading", { name: "🎉 Solved!" }).waitFor({ timeout: 15000 });
await page.screenshot({ path: process.env.SCREENSHOT ?? "test-results/solved.png" });

step("stats show on the hub");
await page.getByRole("link", { name: "← Games" }).click();
await page.waitForURL(`${BASE}/play`);
await page.locator(".stats dd").first().filter({ hasText: "1" }).waitFor();

step("sign out ends the session");
await page.getByRole("button", { name: "Sign out" }).click();
await page.waitForURL(`${BASE}/`);
await page.goto(`${BASE}/play`);
assert.equal(new URL(page.url()).pathname, "/");

step("wrong password is rejected");
await page.getByLabel("Username").fill(user);
await page.getByLabel("Password", { exact: true }).fill("wrong-password");
await page.getByRole("button", { name: "Sign in" }).last().click();
await page.getByRole("alert").filter({ hasText: "Wrong username or password" }).waitFor();

await browser.close();
assert.deepEqual(problems.filter((p) => !/status of 401/.test(p)), [], "browser console errors / CSP violations");
console.log("E2E PASSED");

import { chromium } from 'file:///C:/Users/Castbox/WorkBuddy/2026-08-31-11-14-42/neon-turf/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ headless: true, executablePath: 'C:/Users/Castbox/.workbuddy/browsers/neon-turf/chromium-1234/chrome-win64/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

await page.goto('http://localhost:4174', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('[data-action="spectate"]');
await page.click('[data-action="spectate"]');
await page.waitForSelector('#game-canvas');
await page.waitForTimeout(900);

const failures = [];

const before = await page.evaluate(() => window.__neonDebug?.fighterAnimation());
if (!Array.isArray(before) || before.length < 4) failures.push(`expected an AI roster, got ${before?.length}`);

// Force a splat and watch the collapse instead of an instant disappear.
const hit = await page.evaluate(() => window.__neonDebug?.eliminateNearestAi());
if (!hit) failures.push('debugEliminateNearestAi returned nothing');
if (hit && hit.elimination <= 0) failures.push(`elimination timer was not started: ${hit?.elimination}`);
if (hit && hit.visible !== true) failures.push('fighter was hidden immediately instead of playing the collapse');

await page.waitForTimeout(260);
const mid = (await page.evaluate(() => window.__neonDebug?.fighterAnimation())) ?? [];
const collapsing = mid.find(item => item.id === hit?.id);
if (!collapsing) failures.push('collapsing fighter missing from animation snapshot');
else {
  if (!collapsing.visible) failures.push('collapsing fighter was hidden before the animation finished');
  if (collapsing.elimination >= 1) failures.push('elimination timer did not advance');
  if (collapsing.visualScaleY > 0.9) failures.push(`collapse did not flatten the body, scaleY=${collapsing.visualScaleY}`);
  if (collapsing.visualY > -0.05) failures.push(`collapse did not sink the body, visualY=${collapsing.visualY}`);
}

await page.waitForTimeout(1100);
const after = (await page.evaluate(() => window.__neonDebug?.fighterAnimation())) ?? [];
const finished = after.find(item => item.id === hit?.id);
if (finished && finished.visible) failures.push('collapsed fighter never left the field');
if (finished && finished.elimination > 0) failures.push(`elimination timer did not finish: ${finished.elimination}`);

// The rest of the match must keep running.
const state = await page.evaluate(() => window.__neonDebug?.state());
if (!state?.spectatorMode) failures.push('spectate mode was lost after a splat');
if (state?.ending) failures.push('match ended unexpectedly during animation check');

// Live fighters should still breathe and animate rather than freeze.
const breathing = after.filter(item => item.alive);
if (breathing.length === 0) failures.push('no living fighters left to animate');

// In a real AI battle, hits and jumps must actually drive the new reaction states.
let sawFlinch = 0;
let sawJumpCharge = 0;
// AI priority is painting, so first contact happens naturally mid-match (~20s in).
// Poll generously and break as soon as both reactions have been observed.
for (let i = 0; i < 220; i++) {
  const snapshot = (await page.evaluate(() => window.__neonDebug?.fighterAnimation())) ?? [];
  sawFlinch += snapshot.filter(item => item.flinch > 0).length;
  sawJumpCharge += snapshot.filter(item => item.jumpCharge > 0).length;
  if (sawFlinch > 0 && sawJumpCharge > 0) break;
  await page.waitForTimeout(200);
}
if (sawFlinch === 0) failures.push('no fighter ever played the hit flinch during live combat');
if (sawJumpCharge === 0) failures.push('no fighter ever played the takeoff pose during live combat');

if (errors.length) failures.push(`runtime errors: ${errors.join(' | ')}`);

console.log(JSON.stringify({ hit, collapsing, finished, aliveAfter: breathing.length, sawFlinch, sawJumpCharge, errors, failures }, null, 2));
await browser.close();
if (failures.length) process.exit(1);

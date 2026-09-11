import { chromium } from 'file:///C:/Users/Castbox/WorkBuddy/2026-08-31-11-14-42/neon-turf/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ headless: true, executablePath: 'C:/Users/Castbox/.workbuddy/browsers/neon-turf/chromium-1234/chrome-win64/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

// Blank expanse keeps the aim line clear of walls for the piercing probe.
await page.goto('http://localhost:4174', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.evaluate(() => localStorage.setItem('neon-turf-save', JSON.stringify({ arena: 'blank-expanse' })));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('[data-action="start"]');
await page.click('[data-action="start"]');
await page.waitForSelector('#game-canvas');
await page.waitForTimeout(600);

const failures = [];

// 1) Umbrella guard: frontal shots are reduced, rear shots are not.
const shield = await page.evaluate(() => window.__neonDebug?.shieldProbe(17));
if (!shield) failures.push('shield probe unavailable');
else {
  if (shield.front >= shield.baseDamage) failures.push(`umbrella did not absorb frontal damage: ${JSON.stringify(shield)}`);
  if (shield.rear !== shield.baseDamage) failures.push(`rear hits should take full damage: ${JSON.stringify(shield)}`);
  if (shield.front !== Math.round(17 * 0.65)) failures.push(`frontal shield value unexpected: ${shield.front}`);
}

// 2) Charger piercing: one shot damages both enemies on the aim line.
// Sample fast (~0.4s): first target is hit at ~0.1s, the pierced second at ~0.3s,
// before ambient AI combat noise starts landing on the placed targets.
const probe = await page.evaluate(() => window.__neonDebug?.setupPiercingProbe());
if (!probe || probe.placed.length !== 2) failures.push(`piercing probe unavailable: ${JSON.stringify(probe)}`);
await page.waitForTimeout(400);
const snapshot = (await page.evaluate(() => window.__neonDebug?.fighterAnimation())) ?? [];
const byId = new Map(snapshot.map(item => [item.id, item]));
const [firstId, secondId] = probe?.placed ?? [];
const first = byId.get(firstId);
const second = byId.get(secondId);
if (!first || !second) failures.push('pierced fighters missing from snapshot');
else {
  if (first.health > 40) failures.push(`first target was not hit: health=${first.health}`);
  if (second.health > 40) failures.push(`piercing stopped at the first target: second health=${second.health}`);
  if (!first.alive || !second.alive) failures.push('targets died before the piercing sample');
}

if (errors.length) failures.push(`runtime errors: ${errors.join(' | ')}`);

console.log(JSON.stringify({ shield, probe, first: first && { id: first.id, health: first.health }, second: second && { id: second.id, health: second.health }, errors, failures }, null, 2));
await browser.close();
if (failures.length) process.exit(1);

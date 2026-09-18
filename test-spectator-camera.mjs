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
await page.waitForTimeout(1200);

const failures = [];
const box = await page.locator('#game-canvas').boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

// 1) Spectating starts in the automatic whole-battle framing.
const auto = await page.evaluate(() => window.__neonDebug?.spectatorCamera());
if (!auto?.spectator) failures.push('spectate mode did not start');
if (auto?.free) failures.push('spectator camera should start locked to the auto framing');

// 2) Dragging orbits the camera without unlocking it.
const beforeOrbit = await page.evaluate(() => window.__neonDebug?.spectatorCamera());
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down({ button: 'right' });
await page.mouse.move(box.x + box.width / 2 + 180, box.y + box.height / 2, { steps: 8 });
await page.mouse.up({ button: 'right' });
await page.waitForTimeout(200);
const afterOrbit = await page.evaluate(() => window.__neonDebug?.spectatorCamera());
if (afterOrbit?.yaw === beforeOrbit?.yaw) failures.push('dragging did not orbit the spectator camera');

// 3) WASD pans the focus point and unlocks the camera.
await page.keyboard.down('KeyW');
await page.waitForTimeout(700);
await page.keyboard.up('KeyW');
await page.waitForTimeout(200);
const panned = await page.evaluate(() => window.__neonDebug?.spectatorCamera());
if (!panned?.free) failures.push('panning did not switch the camera to free control');
const moved = Math.hypot((panned?.pan.x ?? 0) - (afterOrbit?.pan.x ?? 0), (panned?.pan.z ?? 0) - (afterOrbit?.pan.z ?? 0));
if (moved < 2) failures.push(`panning barely moved the focus: ${moved.toFixed(2)}`);

// 4) The wheel zooms in and out.
await page.mouse.wheel(0, 600);
await page.waitForTimeout(250);
const zoomedOut = await page.evaluate(() => window.__neonDebug?.spectatorCamera());
if (!((zoomedOut?.distance ?? 0) > (panned?.distance ?? 0))) failures.push(`wheel did not zoom out: ${panned?.distance} -> ${zoomedOut?.distance}`);
await page.mouse.wheel(0, -900);
await page.waitForTimeout(250);
const zoomedIn = await page.evaluate(() => window.__neonDebug?.spectatorCamera());
if (!((zoomedIn?.distance ?? 0) < (zoomedOut?.distance ?? 0))) failures.push(`wheel did not zoom in: ${zoomedOut?.distance} -> ${zoomedIn?.distance}`);
if ((zoomedIn?.distance ?? 0) < 8) failures.push(`zoom went past the close limit: ${zoomedIn?.distance}`);

// 5) Space and F return to the automatic overview.
await page.keyboard.press('Space');
await page.waitForTimeout(250);
const recentered = await page.evaluate(() => window.__neonDebug?.spectatorCamera());
if (recentered?.free) failures.push('space did not return to the automatic framing');
await page.keyboard.down('KeyD');
await page.waitForTimeout(400);
await page.keyboard.up('KeyD');
await page.waitForTimeout(150);
const freeAgain = await page.evaluate(() => window.__neonDebug?.spectatorCamera());
if (!freeAgain?.free) failures.push('panning after recentering did not unlock again');
await page.keyboard.press('KeyF');
await page.waitForTimeout(250);
const viaKey = await page.evaluate(() => window.__neonDebug?.spectatorCamera());
if (viaKey?.free) failures.push('F did not return to the automatic framing');

// 6) Free camera must not upset the rest of the match.
const state = await page.evaluate(() => window.__neonDebug?.state());
if (!state?.spectatorMode) failures.push('spectate mode was lost');
if (errors.length) failures.push(`runtime errors: ${errors.join(' | ')}`);

console.log(JSON.stringify({ auto: auto && { free: auto.free, distance: auto.distance }, panned: panned && { free: panned.free, pan: panned.pan }, zoom: { before: panned?.distance, out: zoomedOut?.distance, in: zoomedIn?.distance }, recentered: recentered && { free: recentered.free, distance: recentered.distance }, moved: Number(moved.toFixed(2)), errors, failures }, null, 2));
await browser.close();
if (failures.length) process.exit(1);

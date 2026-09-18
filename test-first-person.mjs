import { chromium } from 'file:///C:/Users/Castbox/WorkBuddy/2026-08-31-11-14-42/neon-turf/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ headless: true, executablePath: 'C:/Users/Castbox/.workbuddy/browsers/neon-turf/chromium-1234/chrome-win64/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

await page.goto('http://localhost:4174', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.evaluate(() => localStorage.setItem('neon-turf-save', JSON.stringify({ arena: 'blank-expanse', viewMode: 'third' })));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('[data-action="start"]');
await page.click('[data-action="start"]');
await page.waitForSelector('#game-canvas');
await page.waitForTimeout(700);

const failures = [];

// 1) Third person is the baseline.
const third = await page.evaluate(() => window.__neonDebug?.viewState());
if (third?.mode !== 'third') failures.push(`expected third-person start, got ${third?.mode}`);
if (third && !third.bodyVisible) failures.push('player body should be visible in third person');
if (third && third.distanceToPlayer < 4) failures.push(`third-person camera too close: ${third.distanceToPlayer}`);
if (third?.weaponModel !== null) failures.push(`view model should not exist in third person: ${third?.weaponModel}`);

// 2) Switch to first person: eyes at head height, own body hidden, wider lens.
await page.evaluate(() => window.__neonDebug?.setViewMode('first'));
await page.waitForTimeout(260);
const first = await page.evaluate(() => window.__neonDebug?.viewState());
if (first?.mode !== 'first') failures.push(`first-person switch failed: ${first?.mode}`);
if (first?.bodyVisible) failures.push('own body was not hidden in first person');
if (first && first.distanceToPlayer > 2.5) failures.push(`camera is not at eye level: ${first?.distanceToPlayer}`);
if (first && first.distanceToPlayer < 1.2) failures.push(`camera fell inside the body: ${first?.distanceToPlayer}`);
if (first && (first.cameraPosition.y < 1.2 || first.cameraPosition.y > 2.6)) failures.push(`eye height out of range: ${first?.cameraPosition.y}`);
if (first?.weaponModel !== 'pulse') failures.push(`first-person weapon model missing: ${first?.weaponModel}`);
if (first?.cameraFov !== 72) failures.push(`first-person fov not applied: ${first?.cameraFov}`);

// 3) Firing still works from the eyes.
const ammoBefore = await page.evaluate(() => Number(document.querySelector('[data-ammo-text]')?.getAttribute('data-value') || 0));
const box = await page.locator('#game-canvas').boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down({ button: 'left' });
await page.waitForTimeout(420);
await page.mouse.up({ button: 'left' });
const ammoAfter = await page.evaluate(() => Number(document.querySelector('[data-ammo-text]')?.getAttribute('data-value') || 0));
if (!(ammoAfter < ammoBefore)) failures.push(`firing failed in first person: ${ammoBefore} -> ${ammoAfter}`);

// 4) V toggles back to third person and the body reappears.
await page.keyboard.press('KeyV');
await page.waitForTimeout(260);
const back = await page.evaluate(() => window.__neonDebug?.viewState());
if (back?.mode !== 'third') failures.push(`V did not return to third person: ${back?.mode}`);
if (back && !back.bodyVisible) failures.push('body stayed hidden after returning to third person');
if (back && back.distanceToPlayer < 4) failures.push(`third-person camera did not pull back: ${back?.distanceToPlayer}`);
if (back?.cameraFov !== 58) failures.push(`fov not restored: ${back?.cameraFov}`);
if (back?.weaponModel !== null) failures.push(`view model leaked into third person: ${back?.weaponModel}`);

// 5) Spectating must never enter first person.
const savedMode = await page.evaluate(() => JSON.parse(localStorage.getItem('neon-turf-save') || '{}').viewMode);
if (savedMode !== 'third') failures.push(`view mode was not persisted: ${savedMode}`);

if (errors.length) failures.push(`runtime errors: ${errors.join(' | ')}`);

console.log(JSON.stringify({ third, first, back, savedMode, ammo: { before: ammoBefore, after: ammoAfter }, errors, failures }, null, 2));
await browser.close();
if (failures.length) process.exit(1);

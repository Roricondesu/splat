import { chromium } from 'file:///C:/Users/Castbox/WorkBuddy/2026-08-31-11-14-42/neon-turf/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ headless: true, executablePath: 'C:/Users/Castbox/.workbuddy/browsers/neon-turf/chromium-1234/chrome-win64/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

await page.goto('http://localhost:4174', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });

const failures = [];

// 1) The home screen exposes a battle royale entry that opens the briefing.
await page.waitForSelector('[data-action="battle-royale"]');
await page.click('[data-action="battle-royale"]');
await page.waitForSelector('[data-br="players"]');
await page.selectOption('[data-br="players"]', '30');
await page.selectOption('[data-br="teams"]', '4');
await page.click('[data-br-start]');
await page.waitForSelector('#game-canvas');
await page.waitForTimeout(900);

// 2) Roster and arena scale.
const opened = await page.evaluate(() => window.__neonDebug?.battleRoyale());
if (!opened?.mode) failures.push('battle royale mode did not start');
if (opened?.fighterCount !== 30) failures.push(`expected 30 fighters, got ${opened?.fighterCount}`);
if (opened?.teams !== 4) failures.push(`expected 4 squads, got ${opened?.teams}`);
if (opened?.worldSize !== 180) failures.push(`expected the super map (180), got ${opened?.worldSize}`);
if (opened?.aliveCount !== 30) failures.push(`expected 30 alive at drop, got ${opened?.aliveCount}`);
if (opened?.sandbox?.length !== 4) failures.push(`expected 4 team colours, got ${opened?.sandbox?.length}`);

// 3) HUD shows the survivor count.
const hud = await page.locator('.br-hud').count();
if (hud !== 1) failures.push(`battle royale HUD missing (${hud})`);
const aliveDigits = await page.locator('[data-br-alive]').getAttribute('data-value');
if (aliveDigits !== '30') failures.push(`survivor counter wrong: ${aliveDigits}`);

// 4) The zone collapses and burns whoever is outside it.
await page.evaluate(() => window.__neonDebug?.collapseZone());
await page.waitForTimeout(120);
const collapsed = await page.evaluate(() => window.__neonDebug?.battleRoyale());
if (collapsed?.radius !== 14) failures.push(`zone did not collapse: ${collapsed?.radius}`);
await page.evaluate(() => window.__neonDebug?.setPlayerHealth(100));
await page.evaluate(() => window.__neonDebug?.placePlayerOutsideZone());
await page.waitForTimeout(1200);
const burnedSnapshot = (await page.evaluate(() => window.__neonDebug?.fighterAnimation())) ?? [];
const burnedPlayer = burnedSnapshot.find(item => item.id === 0);
const outsideNow = await page.evaluate(() => window.__neonDebug?.battleRoyale());
if (!outsideNow?.outsideZone) failures.push('player was not registered as outside the zone');
if (!burnedPlayer) failures.push('player missing from the fighter snapshot');
else if (!(burnedPlayer.health < 92)) failures.push(`zone did not burn the player: health=${burnedPlayer.health}`);
const warning = await page.locator('.br-zone-warning.show').count();
if (warning !== 1) failures.push(`outside-zone warning not shown (${warning})`);

// 5) No respawns: a downed fighter stays down.
await page.evaluate(() => window.__neonDebug?.eliminateNearestAi());
await page.waitForTimeout(3600);
const afterWait = (await page.evaluate(() => window.__neonDebug?.fighterAnimation())) ?? [];
const deadStayDead = afterWait.filter(item => !item.alive).length;
if (deadStayDead < 1) failures.push('eliminated fighters respawned in battle royale');

// 6) Last squad standing ends the match.
const wipe = await page.evaluate(() => window.__neonDebug?.eliminateAllButOneTeam());
await page.waitForTimeout(900);
const ended = await page.evaluate(() => window.__neonDebug?.state());
if ((wipe?.aliveTeams ?? 9) > 1) failures.push(`squads were not reduced: ${JSON.stringify(wipe)}`);
if (!ended?.ending) failures.push('match did not end when one squad remained');

if (errors.length) failures.push(`runtime errors: ${errors.join(' | ')}`);

console.log(JSON.stringify({ opened, collapsed, burnedHealth: burnedPlayer?.health, deadStayDead, wipe, ending: ended?.ending, errors, failures }, null, 2));
await browser.close();
if (failures.length) process.exit(1);

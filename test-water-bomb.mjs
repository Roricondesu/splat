import { chromium } from 'playwright';

const origin = 'http://localhost:4174';
const browserPath = 'C:/Users/Castbox/.workbuddy/browsers/neon-turf/chromium-1234/chrome-win64/chrome.exe';
const browser = await chromium.launch({ headless: true, executablePath: browserPath });
const errors = [];
const failures = [];

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}?testMatchSeconds=30`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-action="start"]');
  await page.click('[data-action="start"]');
  await page.waitForSelector('#game-canvas');
  await page.waitForTimeout(300);

  await page.evaluate(() => window.__neonDebug?.setPlayerAmmo(100));
  const before = await page.evaluate(() => window.__neonDebug?.state());
  const thrown = await page.evaluate(() => window.__neonDebug?.throwWaterBomb());
  const launched = await page.evaluate(() => window.__neonDebug?.state());
  await page.waitForFunction(() => (window.__neonDebug?.state()?.waterBombs || 0) === 0, { timeout: 4500 });
  const exploded = await page.evaluate(() => window.__neonDebug?.state());

  await page.evaluate(() => window.__neonDebug?.setPlayerAmmo(49));
  const blocked = await page.evaluate(() => window.__neonDebug?.throwWaterBomb());
  const afterBlocked = await page.evaluate(() => window.__neonDebug?.state());

  const buttonCount = await page.locator('[data-water-bomb]').count();
  if (!thrown) failures.push('water bomb did not launch at full ammo');
  if (Math.abs((before?.playerAmmo || 0) - (launched?.playerAmmo || 0) - 50) > 0.1) failures.push(`wrong ammo cost: ${before?.playerAmmo} -> ${launched?.playerAmmo}`);
  if ((launched?.waterBombs || 0) !== 1) failures.push(`water bomb projectile missing: ${launched?.waterBombs}`);
  if ((exploded?.waterBombs || 0) !== 0) failures.push(`water bomb did not explode: ${exploded?.waterBombs}`);
  if (blocked !== false || Math.abs((afterBlocked?.playerAmmo || 0) - 49) > 0.1) failures.push(`low-ammo throw was not blocked: ${blocked}, ${afterBlocked?.playerAmmo}`);
  if (buttonCount !== 1) failures.push(`mobile water-bomb button count=${buttonCount}`);
  if (errors.length) failures.push(...errors);

  console.log(JSON.stringify({
    thrown,
    beforeAmmo: before?.playerAmmo,
    launchedAmmo: launched?.playerAmmo,
    launchedBombs: launched?.waterBombs,
    explodedBombs: exploded?.waterBombs,
    coverageBefore: before?.coverage?.paintedPercent,
    coverageAfter: exploded?.coverage?.paintedPercent,
    blocked,
    afterBlockedAmmo: afterBlocked?.playerAmmo,
    buttonCount,
    errors,
    failures
  }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  await browser.close();
}

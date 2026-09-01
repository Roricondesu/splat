import { chromium } from 'playwright';

const origin = 'http://localhost:4174';
const browserPath = 'C:/Users/Castbox/.workbuddy/browsers/neon-turf/chromium-1234/chrome-win64/chrome.exe';
const browser = await chromium.launch({ headless: true, executablePath: browserPath });
const failures = [];
const errors = [];

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}?testMatchSeconds=30`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-action="settings"]');
  await page.click('[data-action="settings"]');
  await page.selectOption('[data-setting="infiniteInk"]', 'true');
  await page.selectOption('[data-setting="infiniteHealth"]', 'true');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('neon-turf-save') || '{}'));
  await page.click('.modal-close');
  await page.click('[data-action="start"]');
  await page.waitForSelector('#game-canvas');
  await page.waitForTimeout(250);

  const before = await page.evaluate(() => window.__neonDebug?.state());
  for (let i = 0; i < 4; i++) await page.evaluate(() => window.__neonDebug?.firePlayer());
  await page.evaluate(() => window.__neonDebug?.throwWaterBomb());
  await page.evaluate(() => {
    window.__neonDebug?.setPlayerHealth(15);
    window.__neonDebug?.paintUnderPlayer('orange');
  });
  await page.waitForTimeout(450);
  const after = await page.evaluate(() => window.__neonDebug?.state());

  if (saved.infiniteInk !== true || saved.infiniteHealth !== true) failures.push(`settings not persisted: ${JSON.stringify(saved)}`);
  if ((after?.playerAmmo || 0) !== 100) failures.push(`infinite ink failed: ${before?.playerAmmo} -> ${after?.playerAmmo}`);
  if ((after?.playerHealth || 0) !== 100) failures.push(`infinite health failed: ${after?.playerHealth}`);
  if ((after?.waterBombs || 0) < 1) failures.push('infinite ink water bomb did not launch');
  if (errors.length) failures.push(...errors);
  console.log(JSON.stringify({ saved: { infiniteInk: saved.infiniteInk, infiniteHealth: saved.infiniteHealth }, beforeAmmo: before?.playerAmmo, afterAmmo: after?.playerAmmo, afterHealth: after?.playerHealth, waterBombs: after?.waterBombs, errors, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  await browser.close();
}

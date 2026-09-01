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
  await page.goto(`${origin}?testMatchSeconds=40`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-action="start"]');
  await page.click('[data-action="start"]');
  await page.waitForSelector('#game-canvas');
  await page.waitForTimeout(350);

  await page.evaluate(() => {
    window.__neonDebug?.paintUnderPlayer('cyan');
    window.__neonDebug?.setPlayerHealth(40);
    window.__neonDebug?.setPlayerLastDamaged(0);
  });
  await page.keyboard.down('ShiftLeft');
  const combatStart = await page.evaluate(() => window.__neonDebug?.state());
  await page.waitForTimeout(500);
  const combatEnd = await page.evaluate(() => window.__neonDebug?.state());
  await page.keyboard.up('ShiftLeft');

  await page.evaluate(() => {
    window.__neonDebug?.setPlayerHealth(40);
    window.__neonDebug?.setPlayerLastDamaged(4);
  });
  await page.keyboard.down('ShiftLeft');
  const outStart = await page.evaluate(() => window.__neonDebug?.state());
  await page.waitForTimeout(500);
  const outEnd = await page.evaluate(() => window.__neonDebug?.state());
  await page.keyboard.up('ShiftLeft');

  const combatHeal = (combatEnd?.playerHealth || 0) - (combatStart?.playerHealth || 0);
  const outHeal = (outEnd?.playerHealth || 0) - (outStart?.playerHealth || 0);
  if (combatHeal < 1.2 || combatHeal > 3.2) failures.push(`combat heal unexpected=${combatHeal}`);
  if (outHeal < combatHeal * 4.3) failures.push(`out-of-combat heal not 5x: combat=${combatHeal}, out=${outHeal}`);
  if (errors.length) failures.push(...errors);
  console.log(JSON.stringify({ combatHeal, outHeal, ratio: outHeal / Math.max(0.01, combatHeal), errors, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  await browser.close();
}

import { chromium } from 'playwright';

const browserPath = 'C:/Users/Castbox/.workbuddy/browsers/neon-turf/chromium-1234/chrome-win64/chrome.exe';
const browser = await chromium.launch({ headless: true, executablePath: browserPath });
const failures = [];
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://localhost:4174?testMatchSeconds=2', { waitUntil: 'networkidle' });
  await page.click('[data-action="start"]');
  await page.waitForSelector('#game-canvas');
  await page.waitForTimeout(2500);
  const early = await page.evaluate(() => window.__neonDebug?.state());
  const earlyCanvas = await page.locator('#game-canvas').count();
  const alarmIcon = await page.locator('.timer-glyph').count();
  await page.waitForTimeout(1500);
  const middle = await page.evaluate(() => window.__neonDebug?.state());
  const middleCanvas = await page.locator('#game-canvas').count();
  await page.waitForTimeout(3500);
  const final = await page.evaluate(() => window.__neonDebug?.state());
  const result = await page.locator('.result-screen').count();
  if (!early?.ending || !early?.spectatorMode || earlyCanvas !== 1) failures.push(`ending did not switch to spectator: ${JSON.stringify(early)}`);
  if (alarmIcon !== 0) failures.push(`timer alarm icon count=${alarmIcon}`);
  if (middleCanvas !== 1 || !middle?.ending) failures.push(`scene ended too early: ${JSON.stringify(middle)}`);
  if ((middle?.endingElapsed || 0) <= (early?.endingElapsed || 0)) failures.push('ending timer did not advance');
  if (result !== 1) failures.push(`ranking screen not announced: ${JSON.stringify(final)}`);
  if (errors.length) failures.push(...errors);
  console.log(JSON.stringify({ early: { ending: early?.ending, spectatorMode: early?.spectatorMode, endingElapsed: early?.endingElapsed, coverage: early?.teams }, middle: { ending: middle?.ending, endingElapsed: middle?.endingElapsed, coverage: middle?.teams }, final: { gameDisposed: !final, resultVisible: result === 1 }, earlyCanvas, middleCanvas, result, alarmIcon, errors, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  await browser.close();
}

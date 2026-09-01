import { chromium } from 'playwright';
import fs from 'node:fs';

const origin = 'http://localhost:4174';
const out = 'C:/Users/Castbox/WorkBuddy/2026-08-31-11-14-42/neon-turf/test-output';
const browserPath = 'C:/Users/Castbox/.workbuddy/browsers/neon-turf/chromium-1234/chrome-win64/chrome.exe';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: browserPath });
const errors = [];

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  await page.addInitScript(() => {
    const save = JSON.parse(localStorage.getItem('neon-turf-save') || '{}');
    localStorage.setItem('neon-turf-save', JSON.stringify({
      ...save,
      arena: 'blank-expanse',
      difficulty: 'expert',
      quality: 'low'
    }));
  });
  await page.goto(`${origin}?testMatchSeconds=35`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-arena="blank-expanse"].selected');
  const cards = await page.locator('[data-arena]').count();
  await page.click('[data-action="spectate"]');
  await page.waitForSelector('#game-canvas');
  await page.waitForTimeout(3000);
  const first = await page.evaluate(() => window.__neonDebug?.state());
  await page.waitForTimeout(9000);
  const final = await page.evaluate(() => window.__neonDebug?.state());
  const controls = await page.locator('.mobile-controls,[data-stick],[data-fire],[data-submerge],[data-dash],[data-jump]').count();
  await page.screenshot({ path: `${out}/blank-expanse-10v10.png`, fullPage: true });

  const result = {
    cards,
    controls,
    first: {
      arena: first?.arena,
      fighterCount: first?.fighterCount,
      activeAI: first?.activeAI,
      teamSize: first?.teamSize,
      worldSize: first?.worldSize,
      cameraY: first?.cameraY
    },
    final: {
      collisions: final?.aiCollisionViolations,
      paintShots: final?.aiPaintShots,
      fightShots: final?.aiFightShots,
      productiveCells: final?.aiProductivePaintCells,
      paintedPercent: final?.coverage?.paintedPercent,
      rendererCalls: final?.renderer?.calls,
      activeAI: final?.activeAI
    },
    errors
  };
  const failures = [];
  if (cards < 3) failures.push(`arena cards=${cards}`);
  if (controls !== 0) failures.push(`spectator controls=${controls}`);
  if (first?.arena !== 'blank-expanse') failures.push(`arena=${first?.arena}`);
  if (first?.fighterCount !== 20 || first?.activeAI !== 20 || first?.teamSize !== 10) failures.push(`roster=${JSON.stringify(result.first)}`);
  if (first?.worldSize !== 72) failures.push(`worldSize=${first?.worldSize}`);
  if (final?.aiCollisionViolations !== 0) failures.push(`collisions=${final?.aiCollisionViolations}`);
  if ((final?.aiPaintShots || 0) < 70) failures.push(`paintShots=${final?.aiPaintShots}`);
  if ((final?.aiProductivePaintCells || 0) < 600) failures.push(`productiveCells=${final?.aiProductivePaintCells}`);
  if ((final?.activeAI || 0) !== 20) failures.push(`activeAI=${final?.activeAI}`);
  if ((final?.renderer?.calls || 0) > 2050) failures.push(`rendererCalls=${final?.renderer?.calls}`);
  if (errors.length > 0) failures.push(errors.join('; '));
  console.log(JSON.stringify({ result, failures }, null, 2));
  if (failures.length > 0) process.exitCode = 1;
} finally {
  await browser.close();
}

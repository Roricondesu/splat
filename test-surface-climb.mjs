import { chromium } from 'playwright';

const origin = 'http://localhost:4174';
const browserPath = 'C:/Users/Castbox/.workbuddy/browsers/neon-turf/chromium-1234/chrome-win64/chrome.exe';
const browser = await chromium.launch({ headless: true, executablePath: browserPath });
const results = [];
const failures = [];

try {
  for (const arena of ['skyline-market', 'canal-foundry']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(selectedArena => {
      const save = JSON.parse(localStorage.getItem('neon-turf-save') || '{}');
      localStorage.setItem('neon-turf-save', JSON.stringify({
        ...save,
        arena: selectedArena,
        quality: 'medium',
        infiniteInk: false,
        infiniteHealth: false
      }));
    }, arena);
    await page.goto(`${origin}?testMatchSeconds=30`, { waitUntil: 'networkidle' });
    await page.click('[data-action="start"]');
    await page.waitForSelector('#game-canvas');
    await page.waitForTimeout(300);

    const prepared = await page.evaluate(() => window.__neonDebug?.prepareWallClimb());
    const before = await page.evaluate(() => window.__neonDebug?.state());
    await page.keyboard.down('ShiftLeft');
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(260);
    const climbing = await page.evaluate(() => window.__neonDebug?.state());
    await page.keyboard.up('KeyW');
    await page.keyboard.up('ShiftLeft');
    await page.waitForTimeout(120);
    const released = await page.evaluate(() => window.__neonDebug?.state());

    const result = { arena, prepared, before, climbing, released, errors };
    results.push(result);
    if (!prepared) failures.push(`${arena}: wall setup failed`);
    if (before?.worldSize !== 72) failures.push(`${arena}: worldSize=${before?.worldSize}`);
    if ((before?.surfaceInk || 0) < 1 || (before?.surfaceDecals || 0) < 1) failures.push(`${arena}: surface splat missing`);
    if (!climbing?.playerSurfaceClimbing || !climbing?.playerSubmerged) failures.push(`${arena}: player did not enter wall swim`);
    if ((climbing?.positionY || 0) - (before?.positionY || 0) < 0.5) failures.push(`${arena}: vertical climb too small`);
    if (released?.playerSurfaceClimbing) failures.push(`${arena}: wall swim did not release`);
    if (errors.length) failures.push(`${arena}: ${errors.join('; ')}`);
    await page.close();
  }

  console.log(JSON.stringify({ results, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  await browser.close();
}

import { chromium } from 'playwright';

const origin = 'http://localhost:4174';
const browserPath = 'C:/Users/Castbox/.workbuddy/browsers/neon-turf/chromium-1234/chrome-win64/chrome.exe';
const weaponIds = ['pulse', 'roller', 'bucket', 'burst', 'charger', 'scatter', 'brush', 'umbrella'];
const browser = await chromium.launch({ headless: true, executablePath: browserPath });
const results = [];
const failures = [];

try {
  for (const weaponId of weaponIds) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('console', message => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
    await page.addInitScript(selectedWeapon => {
      const save = JSON.parse(localStorage.getItem('neon-turf-save') || '{}');
      localStorage.setItem('neon-turf-save', JSON.stringify({
        ...save,
        weapon: selectedWeapon,
        arena: 'skyline-market',
        quality: 'low'
      }));
    }, weaponId);
    await page.goto(`${origin}?testMatchSeconds=30`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-action="start"]');
    await page.click('[data-action="start"]');
    await page.waitForSelector('#game-canvas');
    await page.waitForFunction(() => Boolean(window.__neonDebug?.weaponSpecs));
    const spec = await page.evaluate(id => window.__neonDebug?.weaponSpecs().find(item => item.id === id), weaponId);
    await page.waitForTimeout(300);
    const box = await page.locator('#game-canvas').boundingBox();
    if (!box || !spec) throw new Error(`Unable to initialize ${weaponId}`);
    const before = await page.evaluate(() => window.__neonDebug?.state());
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.52);
    await page.mouse.down({ button: 'left' });
    await page.waitForTimeout(850);
    let during = await page.evaluate(() => window.__neonDebug?.state());
    let shotDelta = (during?.playerShotCount || 0) - (before?.playerShotCount || 0);
    if (shotDelta === 0) {
      await page.evaluate(() => window.__neonDebug?.firePlayer());
      await page.waitForTimeout(120);
      during = await page.evaluate(() => window.__neonDebug?.state());
      shotDelta = (during?.playerShotCount || 0) - (before?.playerShotCount || 0);
    }
    await page.mouse.up({ button: 'left' });
    await page.waitForTimeout(120);
    const after = await page.evaluate(() => window.__neonDebug?.state());
    const ammoSpent = during?.playerAmmoSpent || 0;
    const expectedPellets = spec.pellets || 1;
    const result = {
      weaponId,
      automatic: spec.automatic,
      arcing: Boolean(spec.arcing),
      expectedPellets,
      actualPellets: during?.playerLastShotPellets,
      shotDelta,
      ammoSpent,
      beforeAmmo: before?.playerAmmo,
      duringAmmo: during?.playerAmmo,
      afterAmmo: after?.playerAmmo,
      projectileSnapshot: during?.projectileSnapshot,
      errors
    };
    results.push(result);

    const assertions = [
      [before?.playerWeapon === weaponId, `wrong equipped weapon: ${before?.playerWeapon}`],
      [shotDelta >= 1, 'did not fire'],
      [spec.automatic ? shotDelta >= 2 : shotDelta === 1, `automatic cadence mismatch, shotDelta=${shotDelta}`],
      [ammoSpent > 0, `ammo did not decrease: ${before?.playerAmmo} -> ${during?.playerAmmo}`],
      [during?.playerLastShotPellets === expectedPellets, `pellet mismatch: ${during?.playerLastShotPellets} != ${expectedPellets}`],
      [errors.length === 0, `runtime errors: ${errors.join('; ')}`]
    ];
    for (const [passed, message] of assertions) {
      if (!passed) failures.push(`${weaponId}: ${message}`);
    }
    await page.close();
  }

  console.log(JSON.stringify({ results, failures }, null, 2));
  if (failures.length > 0) process.exitCode = 1;
} finally {
  await browser.close();
}

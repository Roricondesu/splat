import { chromium } from 'playwright';

const origin = 'http://localhost:4174';
const browserPath = 'C:/Users/Castbox/.workbuddy/browsers/neon-turf/chromium-1234/chrome-win64/chrome.exe';
const arenas = ['skyline-market', 'canal-foundry'];
const failures = [];
const results = [];
const browser = await chromium.launch({ headless: true, executablePath: browserPath });

try {
  for (const arena of arenas) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('console', message => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));

    await page.addInitScript(selectedArena => {
      const save = JSON.parse(localStorage.getItem('neon-turf-save') || '{}');
      localStorage.setItem('neon-turf-save', JSON.stringify({
        ...save,
        arena: selectedArena,
        difficulty: 'expert',
        quality: 'medium'
      }));
    }, arena);
    await page.goto(`${origin}?testMatchSeconds=40`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-action="spectate"]');
    await page.click('[data-action="spectate"]');
    await page.waitForSelector('#game-canvas');

    const controls = await page.locator('.mobile-controls,[data-stick],[data-fire],[data-submerge],[data-dash],[data-jump]').count();
    const initial = await page.evaluate(() => window.__neonDebug?.state());
    const initialById = new Map((initial?.aiPositions || []).map(item => [item.id, item]));
    const samples = [];
    for (let second = 5; second <= 25; second += 5) {
      await page.waitForTimeout(5000);
      const state = await page.evaluate(() => window.__neonDebug?.state());
      samples.push({
        second,
        collisions: state?.aiCollisionViolations,
        jumps: state?.aiJumpCount,
        paintShots: state?.aiPaintShots,
        fightShots: state?.aiFightShots,
        productiveCells: state?.aiProductivePaintCells,
        paintedPercent: state?.coverage?.paintedPercent,
        modes: state?.aiModes,
        rendererCalls: state?.renderer?.calls,
        elevatedCount: (state?.aiPositions || []).filter(item => item.y > 0.45).length
      });
    }
    const final = await page.evaluate(() => window.__neonDebug?.state());
    const displacements = (final?.aiPositions || []).map(item => {
      const start = initialById.get(item.id) || item;
      return Math.hypot(item.x - start.x, item.z - start.z);
    });
    const maxDisplacement = Math.max(0, ...displacements);
    const maxElevatedCount = Math.max(0, ...samples.map(sample => sample.elevatedCount || 0), (final?.aiPositions || []).filter(item => item.y > 0.45).length);
    const maxCollisions = Math.max(0, ...samples.map(sample => sample.collisions || 0));
    const result = {
      arena,
      controls,
      maxCollisions,
      maxDisplacement,
      elevatedCount: maxElevatedCount,
      final: {
        jumps: final?.aiJumpCount,
        paintShots: final?.aiPaintShots,
        fightShots: final?.aiFightShots,
        productiveCells: final?.aiProductivePaintCells,
        paintedPercent: final?.coverage?.paintedPercent,
        rendererCalls: final?.renderer?.calls
      },
      errors,
      samples
    };
    results.push(result);

    const assertions = [
      [controls === 0, `spectator controls rendered: ${controls}`],
      [maxCollisions === 0, `AI collider intersections observed: ${maxCollisions}`],
      [maxDisplacement > 5, `AI path displacement too low: ${maxDisplacement.toFixed(2)}`],
      [(final?.aiJumpCount || 0) > 0, 'AI never jumped'],
      [maxElevatedCount > 0, 'No AI reached elevated geometry during the sampled run'],
      [(final?.aiPaintShots || 0) >= 30, `AI paint shots too low: ${final?.aiPaintShots}`],
      [(final?.aiFightShots || 0) > 0, `AI never entered combat: ${final?.aiFightShots}`],
      [(final?.aiProductivePaintCells || 0) >= 300, `Productive paint too low: ${final?.aiProductivePaintCells}`],
      [(final?.coverage?.paintedPercent || 0) >= 10, `Coverage too low: ${final?.coverage?.paintedPercent}`],
      [(final?.renderer?.calls || 0) <= 1500, `Render calls too high: ${final?.renderer?.calls}`],
      [errors.length === 0, `Runtime errors: ${errors.join('; ')}`]
    ];
    for (const [passed, message] of assertions) {
      if (!passed) failures.push(`${arena}: ${message}`);
    }
    await page.close();
  }

  console.log(JSON.stringify({ results, failures }, null, 2));
  if (failures.length > 0) process.exitCode = 1;
} finally {
  await browser.close();
}

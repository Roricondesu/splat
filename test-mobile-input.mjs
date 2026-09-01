import { chromium } from 'playwright';

const origin = 'http://localhost:4174';
const browserPath = 'C:/Users/Castbox/.workbuddy/browsers/neon-turf/chromium-1234/chrome-win64/chrome.exe';
const browser = await chromium.launch({ headless: true, executablePath: browserPath });
const results = [];
const failures = [];

async function createGame(joystickMode) {
  const page = await browser.newPage({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(mode => {
    const save = JSON.parse(localStorage.getItem('neon-turf-save') || '{}');
    localStorage.setItem('neon-turf-save', JSON.stringify({ ...save, joystickMode: mode, quality: 'low', sensitivity: 1 }));
  }, joystickMode);
  await page.goto(`${origin}?testMatchSeconds=30`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-action="start"]');
  await page.click('[data-action="start"]');
  await page.waitForSelector('.mobile-controls');
  await page.waitForTimeout(300);
  return { page, errors };
}

async function dragControl(page, selector, pointerId, dx, dy) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`${selector} missing`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const before = await page.evaluate(() => window.__neonDebug?.state());
  await page.locator(selector).dispatchEvent('pointerdown', { pointerType: 'touch', pointerId, clientX: x, clientY: y });
  await page.locator(selector).dispatchEvent('pointermove', { pointerType: 'touch', pointerId, clientX: x + dx, clientY: y + dy });
  await page.waitForTimeout(100);
  const during = await page.evaluate(() => window.__neonDebug?.state());
  await page.locator(selector).dispatchEvent('pointerup', { pointerType: 'touch', pointerId, clientX: x + dx, clientY: y + dy });
  return { before, during };
}

try {
  const fixed = await createGame('fixed');
  for (const [selector, pointerId] of [['[data-fire]', 61], ['[data-submerge]', 62], ['[data-jump]', 63], ['[data-water-bomb]', 64]]) {
    const sample = await dragControl(fixed.page, selector, pointerId, 70, -32);
    const yawDelta = Math.abs((sample.during?.cameraYaw || 0) - (sample.before?.cameraYaw || 0));
    const pitchDelta = Math.abs((sample.during?.cameraPitch || 0) - (sample.before?.cameraPitch || 0));
    results.push({ mode: 'fixed', selector, yawDelta, pitchDelta, firing: sample.during?.firing, submerged: sample.during?.playerSubmerged });
    if (yawDelta < 0.03 || pitchDelta < 0.02) failures.push(`${selector} drag did not rotate camera: ${JSON.stringify(sample)}`);
    if (selector === '[data-fire]' && !sample.during?.firing) failures.push('fire did not remain held during drag');
    if (selector === '[data-submerge]' && !sample.during?.submergeHeld) failures.push('submerge did not remain held during drag');
  }
  const fixedStickVisible = await fixed.page.locator('[data-stick]').isVisible();
  if (!fixedStickVisible) failures.push('fixed joystick is hidden');
  failures.push(...fixed.errors);
  await fixed.page.close();

  const floating = await createGame('floating');
  const hiddenBefore = !(await floating.page.locator('[data-stick]').isVisible());
  const beforeMove = await floating.page.evaluate(() => window.__neonDebug?.state());
  await floating.page.locator('.game-screen').dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 71, clientX: 150, clientY: 215 });
  await floating.page.locator('.game-screen').dispatchEvent('pointermove', { pointerType: 'touch', pointerId: 71, clientX: 195, clientY: 180 });
  await floating.page.waitForTimeout(260);
  const duringMove = await floating.page.evaluate(() => window.__neonDebug?.state());
  const visibleDuring = await floating.page.locator('[data-stick]').isVisible();
  await floating.page.locator('.game-screen').dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 71, clientX: 195, clientY: 180 });
  await floating.page.waitForTimeout(80);
  const hiddenAfter = !(await floating.page.locator('[data-stick]').isVisible());
  const travel = Math.hypot((duringMove?.positionX || 0) - (beforeMove?.positionX || 0), (duringMove?.positionZ || 0) - (beforeMove?.positionZ || 0));
  results.push({ mode: 'floating', hiddenBefore, visibleDuring, hiddenAfter, travel });
  if (!hiddenBefore || !visibleDuring || !hiddenAfter || travel < 0.1) failures.push(`floating joystick failed: ${JSON.stringify(results.at(-1))}`);
  failures.push(...floating.errors);
  await floating.page.close();

  console.log(JSON.stringify({ results, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  await browser.close();
}

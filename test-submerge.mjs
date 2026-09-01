import { chromium } from 'playwright';

const origin = 'http://localhost:4174';
const browserPath = 'C:/Users/Castbox/.workbuddy/browsers/neon-turf/chromium-1234/chrome-win64/chrome.exe';
const browser = await chromium.launch({ headless: true, executablePath: browserPath });
const errors = [];

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  await page.addInitScript(() => {
    const save = JSON.parse(localStorage.getItem('neon-turf-save') || '{}');
    localStorage.setItem('neon-turf-save', JSON.stringify({
      ...save,
      weapon: 'pulse',
      arena: 'blank-expanse',
      difficulty: 'expert',
      sensitivity: 1,
      sfx: 0,
      quality: 'low'
    }));
  });
  await page.goto(`${origin}?testMatchSeconds=30`, { waitUntil: 'networkidle' });
  await page.click('[data-action="start"]');
  await page.waitForSelector('#game-canvas');
  await page.waitForTimeout(400);

  await page.evaluate(() => window.__neonDebug?.setPlayerAmmo(25));
  const idleStart = await page.evaluate(() => window.__neonDebug?.state());
  await page.waitForTimeout(700);
  const idleEnd = await page.evaluate(() => window.__neonDebug?.state());

  await page.keyboard.down('ShiftLeft');
  await page.waitForTimeout(700);
  const ownInkSubmerge = await page.evaluate(() => window.__neonDebug?.state());
  await page.keyboard.up('ShiftLeft');

  await page.evaluate(() => window.__neonDebug?.setPlayerAmmo(25));
  await page.evaluate(() => window.__neonDebug?.paintUnderPlayer('orange'));
  await page.keyboard.down('ShiftLeft');
  await page.waitForTimeout(500);
  const enemyInkAttempt = await page.evaluate(() => window.__neonDebug?.state());
  await page.keyboard.up('ShiftLeft');

  const submergeButton = await page.locator('[data-submerge]').count();
  const legacyDashButton = await page.locator('[data-dash]').count();
  const failures = [];
  if ((idleEnd?.playerAmmo || 0) > (idleStart?.playerAmmo || 0) + 0.2) failures.push(`ammo refilled while not submerged: ${idleStart?.playerAmmo} -> ${idleEnd?.playerAmmo}`);
  if (!ownInkSubmerge?.playerSubmerged || (ownInkSubmerge?.playerAmmo || 0) <= (idleEnd?.playerAmmo || 0) + 10) failures.push(`own-ink submerge failed: ${JSON.stringify(ownInkSubmerge)}`);
  if (enemyInkAttempt?.playerSubmerged) failures.push('player submerged in enemy ink');
  if ((enemyInkAttempt?.playerAmmo || 0) > 25.5) failures.push(`ammo refilled in enemy ink: ${enemyInkAttempt?.playerAmmo}`);
  if (submergeButton !== 1 || legacyDashButton !== 0) failures.push(`mobile control mismatch: submerge=${submergeButton}, dash=${legacyDashButton}`);
  if (errors.length) failures.push(errors.join('; '));

  console.log(JSON.stringify({
    idleStart: { ammo: idleStart?.playerAmmo, submerged: idleStart?.playerSubmerged },
    idleEnd: { ammo: idleEnd?.playerAmmo, submerged: idleEnd?.playerSubmerged },
    ownInkSubmerge: { ammo: ownInkSubmerge?.playerAmmo, submerged: ownInkSubmerge?.playerSubmerged, held: ownInkSubmerge?.submergeHeld },
    enemyInkAttempt: { ammo: enemyInkAttempt?.playerAmmo, submerged: enemyInkAttempt?.playerSubmerged, held: enemyInkAttempt?.submergeHeld },
    submergeButton,
    legacyDashButton,
    aiSubmergedCount: ownInkSubmerge?.aiSubmergedCount,
    aiAverageAmmo: ownInkSubmerge?.aiAverageAmmo,
    errors,
    failures
  }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  await browser.close();
}

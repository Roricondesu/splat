import { chromium } from 'playwright';
import fs from 'node:fs';

const out = 'C:/Users/Castbox/WorkBuddy/2026-08-31-11-14-42/neon-turf/test-output';
fs.mkdirSync(out, { recursive: true });
const browserPath = 'C:/Users/Castbox/.workbuddy/browsers/neon-turf/chromium-1234/chrome-win64/chrome.exe';
const errors = [];
const browser = await chromium.launch({ headless: true, executablePath: browserPath });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto('http://localhost:4174?testMatchSeconds=4', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-action="start"]');
  const arenaCards = await page.locator('[data-arena]').count();
  if (arenaCards < 3) throw new Error(`Expected at least 3 arenas, found ${arenaCards}`);
  await page.screenshot({ path: `${out}/home-desktop.png`, fullPage: true });

  await page.click('[data-action="settings"]');
  await page.waitForSelector('.settings-modal');
  await page.selectOption('[data-setting="difficulty"]', 'expert');
  await page.click('.modal-close');
  const savedDifficulty = await page.evaluate(() => JSON.parse(localStorage.getItem('neon-turf-save') || '{}').difficulty);

  await page.click('[data-action="loadout"]');
  await page.waitForSelector('.weapon-card');
  const weapons = await page.locator('.weapon-card').count();
  if (weapons < 8) throw new Error(`Expected at least 8 weapons, found ${weapons}`);
  const outfits = await page.locator('.outfit-card').count();
  if (outfits < 8) throw new Error(`Expected at least 8 outfits and hairstyles, found ${outfits}`);
  await page.locator('[data-weapon="burst"]').click();
  await page.locator('[data-outfit="acid-pop"]').click();
  const savedLoadout = await page.evaluate(() => {
    const save = JSON.parse(localStorage.getItem('neon-turf-save') || '{}');
    return { weapon: save.weapon, outfit: save.outfit };
  });
  await page.screenshot({ path: `${out}/loadout-desktop.png`, fullPage: true });
  await page.click('[data-action="back"]');
  await page.click('[data-action="start"]');
  await page.waitForSelector('#game-canvas');
  await page.waitForTimeout(1200);
  const spectatorBadges = await page.locator('.spectator-badge,.score-chip.spectator-only').count();
  if (spectatorBadges !== 0) throw new Error(`Spectator hint is still rendered: ${spectatorBadges}`);
  const canvasVisible = await page.locator('#game-canvas').isVisible();
  const gameTextNodes = await page.locator('.game-screen text').count();
  const gameVisibleText = await page.locator('.game-screen').evaluate(root => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const values = [];
    while (walker.nextNode()) {
      const value = walker.currentNode.nodeValue?.trim();
      if (value) values.push(value);
    }
    return values;
  });
  if (gameTextNodes !== 0 || gameVisibleText.length !== 0) {
    throw new Error(`Game HUD still contains text: ${JSON.stringify({ gameTextNodes, gameVisibleText })}`);
  }
  const ammoRing = await page.locator('[data-ammo-ring]').count();
  const legacyAmmoBar = await page.locator('[data-ammo]').count();
  if (ammoRing !== 1 || legacyAmmoBar !== 0) throw new Error(`Ammo HUD is not circular: ring=${ammoRing}, bar=${legacyAmmoBar}`);
  const timer = await page.locator('[data-time]').getAttribute('data-value');
  const beforeShot = await page.evaluate(() => Number(document.querySelector('[data-ammo-text]')?.getAttribute('data-value') || 0));
  const canvasBox = await page.locator('#game-canvas').boundingBox();
  if (!canvasBox) throw new Error('Game canvas has no bounding box');
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await page.mouse.down({ button: 'left' });
  await page.waitForTimeout(500);
  await page.mouse.up({ button: 'left' });
  const afterShot = await page.evaluate(() => Number(document.querySelector('[data-ammo-text]')?.getAttribute('data-value') || 0));
  const leftClickFires = afterShot < beforeShot;
  if (!leftClickFires) throw new Error(`Left click did not fire: ammo ${beforeShot} -> ${afterShot}`);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(220);
  await page.keyboard.press('Space');
  await page.waitForTimeout(120);
  const jumpSnapshot = await page.evaluate(() => {
    const game = document.querySelector('#game-canvas');
    return { canvasPresent: Boolean(game), jumpButtonDesktopHidden: getComputedStyle(document.querySelector('[data-jump]')).display === 'none' };
  });
  await page.waitForTimeout(380);
  await page.keyboard.up('KeyW');
  const beforePitch = await page.evaluate(() => window.__neonDebug?.state()?.cameraPitch);
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2 - 70, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(100);
  const afterUpwardDragPitch = await page.evaluate(() => window.__neonDebug?.state()?.cameraPitch);
  if (typeof beforePitch !== 'number' || typeof afterUpwardDragPitch !== 'number' || afterUpwardDragPitch >= beforePitch) {
    throw new Error(`Vertical look direction is inverted: ${beforePitch} -> ${afterUpwardDragPitch}`);
  }
  const beforeTurn = await page.evaluate(() => window.__neonDebug?.state());
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(canvasBox.x + canvasBox.width / 2 + 120, canvasBox.y + canvasBox.height / 2 - 35, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(180);
  const afterMouseTurn = await page.evaluate(() => window.__neonDebug?.state());
  if (!beforeTurn || !afterMouseTurn || Math.abs(afterMouseTurn.playerYaw - beforeTurn.playerYaw) < 0.05) {
    throw new Error(`Mouse did not rotate player: ${JSON.stringify({ beforeTurn, afterMouseTurn })}`);
  }
  await page.keyboard.down('KeyA');
  await page.waitForTimeout(260);
  await page.keyboard.up('KeyA');
  const afterStrafe = await page.evaluate(() => window.__neonDebug?.state());
  if (!afterStrafe || Math.abs(afterStrafe.playerYaw - afterMouseTurn.playerYaw) > 0.02) {
    throw new Error(`WASD changed player facing: ${JSON.stringify({ afterMouseTurn, afterStrafe })}`);
  }
  await page.evaluate(() => window.__neonDebug?.respawnPlayer());
  await page.waitForTimeout(100);
  const afterRespawn = await page.evaluate(() => window.__neonDebug?.state());
  if (!afterRespawn || Math.abs(afterRespawn.playerTilt) > 0.001) {
    throw new Error(`Player remained tilted after respawn: ${JSON.stringify(afterRespawn)}`);
  }
  await page.screenshot({ path: `${out}/game-desktop.png`, fullPage: true });
  await page.evaluate(() => document.exitPointerLock?.());
  await page.waitForFunction(() => document.pointerLockElement === null);

  await page.click('[data-pause]');
  await page.waitForSelector('.pause-modal');
  const pauseVisible = await page.locator('.pause-modal').isVisible();
  await page.click('[data-resume]');
  await page.waitForSelector('.pause-modal', { state: 'detached' });
  await page.waitForSelector('.result-screen', { timeout: 10000 });
  const resultVisible = await page.locator('.result-screen').isVisible();
  await page.screenshot({ path: `${out}/result-desktop.png`, fullPage: true });
  await page.click('[data-action="home"]');
  await page.waitForSelector('[data-action="start"]');
  const spectateEntryVisible = await page.locator('[data-action="spectate"]').isVisible();
  const mapOptions = await page.locator('[data-arena]').count();
  await page.click('[data-arena="canal-foundry"]');
  const selectedArena = await page.evaluate(() => JSON.parse(localStorage.getItem('neon-turf-save') || '{}').arena);
  await page.click('[data-action="spectate"]');
  await page.waitForSelector('#game-canvas');
  await page.waitForTimeout(3500);
  const spectatorState = await page.evaluate(() => window.__neonDebug?.state());
  const spectatorBadgeVisible = await page.locator('.spectator-badge,.score-chip.spectator-only').count() === 0;
  const spectatorControls = await page.locator('.mobile-controls,[data-stick],[data-fire],[data-submerge],[data-dash],[data-jump]').count();
  if (spectatorControls !== 0) throw new Error(`Spectator controls are still rendered: ${spectatorControls}`);
  const compactHud = await page.evaluate(() => ({
    percentageDigits: document.querySelectorAll('[data-cyan],[data-orange]').length,
    eventFeed: document.querySelectorAll('.event-feed').length,
    meterWidth: document.querySelector('.turf-meter')?.getBoundingClientRect().width || 0
  }));
  if (compactHud.percentageDigits !== 0 || compactHud.eventFeed !== 0 || compactHud.meterWidth > 230) {
    throw new Error(`Battle HUD was not compacted: ${JSON.stringify(compactHud)}`);
  }
  if (!spectatorState?.spectatorMode || spectatorState.activeAI !== 8 || spectatorState.cameraY < 15 || spectatorState.arena !== 'canal-foundry') {
    throw new Error(`God view did not initialize correctly: ${JSON.stringify(spectatorState)}`);
  }
  if (spectatorState.aiCollisionViolations !== 0) {
    throw new Error(`AI intersected scene colliders: ${JSON.stringify(spectatorState.aiPositions)}`);
  }
  if (spectatorState.aiJumpCount < 1) {
    throw new Error(`AI never jumped in the 3D arena: ${JSON.stringify(spectatorState)}`);
  }
  if (spectatorState.aiPaintShots < 8 || spectatorState.aiProductivePaintCells < 80 || spectatorState.coverage?.paintedPercent < 4) {
    throw new Error(`AI did not proactively paint enough turf: ${JSON.stringify(spectatorState)}`);
  }
  if (spectatorState.renderer?.calls > 1500) {
    throw new Error(`Render calls regressed: ${JSON.stringify(spectatorState.renderer)}`);
  }
  await page.screenshot({ path: `${out}/spectator-desktop.png`, fullPage: true });
  await page.evaluate(() => document.exitPointerLock?.());
  await page.click('[data-pause]');
  await page.waitForSelector('.pause-modal');
  await page.click('[data-quit]');
  await page.waitForSelector('[data-action="start"]');

  const mobile = await browser.newPage({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
  mobile.on('console', m => { if (m.type() === 'error') errors.push('mobile console: ' + m.text()); });
  mobile.on('pageerror', e => errors.push('mobile pageerror: ' + e.message));
  await mobile.goto('http://localhost:4174', { waitUntil: 'networkidle' });
  await mobile.waitForSelector('[data-action="start"]');
  await mobile.screenshot({ path: `${out}/home-mobile.png`, fullPage: true });
  await mobile.click('[data-action="start"]');
  await mobile.waitForSelector('.mobile-controls');
  await mobile.waitForTimeout(1500);
  const mobileControls = await mobile.locator('.mobile-controls').isVisible();
  const mobileJumpVisible = await mobile.locator('[data-jump]').isVisible();
  const beforeJoystick = await mobile.evaluate(() => window.__neonDebug?.state());
  const stickBox = await mobile.locator('[data-stick]').boundingBox();
  if (!stickBox) throw new Error('Mobile joystick has no bounding box');
  const stickX = stickBox.x + stickBox.width / 2;
  const stickY = stickBox.y + stickBox.height / 2;
  await mobile.locator('[data-stick]').dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 41, clientX: stickX, clientY: stickY });
  await mobile.locator('[data-stick]').dispatchEvent('pointermove', { pointerType: 'touch', pointerId: 41, clientX: stickX + stickBox.width * 0.3, clientY: stickY });
  await mobile.waitForTimeout(320);
  const duringJoystick = await mobile.evaluate(() => window.__neonDebug?.state());
  await mobile.locator('[data-stick]').dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 41, clientX: stickX + stickBox.width * 0.3, clientY: stickY });
  if (!beforeJoystick || !duringJoystick || Math.hypot(duringJoystick.positionX - beforeJoystick.positionX, duringJoystick.positionZ - beforeJoystick.positionZ) < 0.1) {
    throw new Error(`Joystick did not move player: ${JSON.stringify({ beforeJoystick, duringJoystick })}`);
  }
  const beforeSwipeLook = await mobile.evaluate(() => window.__neonDebug?.state());
  await mobile.locator('.game-screen').dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 31, clientX: 610, clientY: 180 });
  await mobile.locator('.game-screen').dispatchEvent('pointermove', { pointerType: 'touch', pointerId: 31, clientX: 700, clientY: 140 });
  await mobile.locator('.game-screen').dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 31, clientX: 700, clientY: 140 });
  await mobile.waitForTimeout(180);
  const afterSwipeLook = await mobile.evaluate(() => window.__neonDebug?.state());
  if (!beforeSwipeLook || !afterSwipeLook || Math.abs(afterSwipeLook.playerYaw - beforeSwipeLook.playerYaw) < 0.05) {
    throw new Error(`Screen swipe did not rotate view: ${JSON.stringify({ beforeSwipeLook, afterSwipeLook })}`);
  }
  await mobile.locator('[data-jump]').dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 23 });
  await mobile.waitForTimeout(160);
  await mobile.screenshot({ path: `${out}/game-mobile.png`, fullPage: true });

  console.log(JSON.stringify({
    weapons,
    arenaCards,
    outfits,
    savedDifficulty,
    savedLoadout,
    canvasVisible,
    gameTextNodes,
    gameVisibleText,
    timer,
    beforeShot,
    afterShot,
    leftClickFires,
    jumpSnapshot,
    mouseFacing: {
      beforeTurn,
      afterMouseTurn,
      afterStrafe,
      afterRespawn
    },
    pauseVisible,
    resultVisible,
    spectateEntryVisible,
    mapOptions,
    selectedArena,
    compactHud,
    spectatorBadgeVisible,
    spectatorControls,
    spectatorState,
    mobileControls,
    mobileJumpVisible,
    mobileJoystick: { beforeJoystick, duringJoystick },
    mobileSwipeLook: { beforeSwipeLook, afterSwipeLook },
    errors
  }, null, 2));
} finally {
  await browser.close();
}

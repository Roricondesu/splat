import { chromium } from 'playwright';
import fs from 'node:fs';

const origin = 'http://localhost:4174';
const out = 'C:/Users/Castbox/WorkBuddy/2026-08-31-11-14-42/neon-turf/test-output/ui';
const browserPath = 'C:/Users/Castbox/.workbuddy/browsers/neon-turf/chromium-1234/chrome-win64/chrome.exe';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: browserPath });
const results = [];
const failures = [];

async function inspect(viewport, name, action) {
  const page = await browser.newPage({ viewport, isMobile: viewport.width < 900, hasTouch: viewport.width < 900 });
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-action="start"]');
  if (action) await action(page);
  await page.waitForTimeout(250);
  const metrics = await page.evaluate(() => {
    const viewport = { width: innerWidth, height: innerHeight };
    const elements = [...document.querySelectorAll('button,[data-arena],.loadout-strip,.result-board,.performance-grid,.settings-modal,.pause-modal,.mobile-controls,.hud-top,.hud-bottom-left,.health-ring')];
    const overflow = elements.map(element => {
      const rect = element.getBoundingClientRect();
      return { className: element.className, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    }).filter(rect => rect.left < -2 || rect.right > viewport.width + 2 || rect.top < -2 || rect.bottom > viewport.height + 2);
    return {
      viewport,
      pageOverflowX: document.documentElement.scrollWidth > innerWidth + 2,
      pageOverflowY: document.documentElement.scrollHeight > innerHeight + 2,
      overflow
    };
  });
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  const contentOverflow = metrics.overflow.filter(rect => rect.left < -2 || rect.right > metrics.viewport.width + 2);
  results.push({ name, metrics, errors });
  if (metrics.pageOverflowX || contentOverflow.length || errors.length) failures.push(`${name}: ${JSON.stringify({ metrics, errors })}`);
  await page.close();
}

try {
  await inspect({ width: 1440, height: 900 }, 'home-1440');
  await inspect({ width: 1024, height: 768 }, 'home-1024');
  await inspect({ width: 844, height: 390 }, 'home-mobile');
  await inspect({ width: 667, height: 375 }, 'home-mobile-small');
  await inspect({ width: 390, height: 844 }, 'home-portrait');
  await inspect({ width: 1440, height: 900 }, 'loadout-1440', async page => { await page.click('[data-action="loadout"]'); await page.waitForSelector('.loadout-layout'); });
  await inspect({ width: 844, height: 390 }, 'loadout-mobile', async page => { await page.click('[data-action="loadout"]'); await page.waitForSelector('.loadout-layout'); });
  await inspect({ width: 1440, height: 900 }, 'settings-1440', async page => { await page.click('[data-action="settings"]'); await page.waitForSelector('.settings-modal'); });
  await inspect({ width: 667, height: 375 }, 'settings-mobile', async page => { await page.click('[data-action="settings"]'); await page.waitForSelector('.settings-modal'); });
  console.log(JSON.stringify({ results, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  await browser.close();
}

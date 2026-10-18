import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { manifest, cssColor } from './hig-tokens.mjs';
const server = spawn(process.execPath, ['apps/docs/scripts/preview.mjs'], { env: { ...process.env, PORT: process.env.HIG_PREVIEW_PORT ?? '0' }, stdio: 'pipe' });
const origin = await new Promise((resolve, reject) => { server.stdout.once('data', chunk => resolve(`http://127.0.0.1:${chunk.toString().match(/localhost:(\d+)/)[1]}`)); server.once('error', reject); server.once('exit', code => reject(new Error(`Preview exited: ${code}`))); });
let browser;
const evidence = process.env.HIG_EVIDENCE_DIR;
const checks = [];
/** Resolve two CSS colors in the page (or frame) so oklch(0.205 0 0) and oklch(20.5% 0 0) compare equal. */
const sameColor = (target, actual, expected) => target.evaluate(([a, b]) => {
  const probe = (value) => { const el = document.createElement('i'); el.style.color = value; document.body.append(el); const out = getComputedStyle(el).color; el.remove(); return out; };
  return probe(a) === probe(b) && probe(a) !== '';
}, [actual, expected]);
function record(check) { checks.push(check); console.log(check); }
try {
  browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(60000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Verify offline recovery without relying on an external exchange or emitting audio/haptics.
  let demoAllowed = false;
  await context.route('**/*', route => route.request().url().startsWith(origin) && (demoAllowed || !route.request().url().includes('/chart-demo/demo/')) ? route.continue() : route.abort());
  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
  assert.match(page.url(), /\/chart\/$/);
  await page.getByRole('tab', { name: 'bun', exact: true }).waitFor();
  await page.getByRole('tab', { name: 'bun', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  const npmTab = page.getByRole('tab', { name: 'npm', exact: true });
  assert.equal(await npmTab.getAttribute('aria-selected'), 'true');
  assert.equal(await npmTab.evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('End');
  assert.equal(await page.getByRole('tab', { name: 'yarn', exact: true }).getAttribute('aria-selected'), 'true');
  await page.keyboard.press('Home');
  assert.equal(await page.getByRole('tab', { name: 'bun', exact: true }).getAttribute('aria-selected'), 'true');
  // HIG Tabs + InstallCommand recipe (hig#69): the command's focusable <pre> is the panel's single tab stop.
  // Tabs drops the panel's own tabindex in an effect after the switch, so wait for that commit first.
  await page.waitForFunction(() => !document.querySelector('[role="tabpanel"]:not([hidden])').hasAttribute('tabindex'));
  await page.keyboard.press('Tab');
  const afterTabs = await page.evaluate(() => { const el = document.activeElement; return { tag: el.tagName, role: el.getAttribute('role'), inPanel: !!el.closest('[role="tabpanel"]') }; });
  assert.deepEqual(afterTabs, { tag: 'PRE', role: null, inPanel: true });
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Copy install command');
  record('Install tabs: arrows/Home/End, selected state and focus; one tab stop per install command');
  await page.evaluate(() => {
    window.copyStatusLog = [];
    const observe = () => {
      for (const el of document.querySelectorAll('[role="status"]')) {
        if (el.textContent) window.copyStatusLog.push({ text: el.textContent, visibleError: /Could not copy|Copy failed/.test(el.textContent) && el.getBoundingClientRect().height > 1 });
      }
    };
    new MutationObserver(observe).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    window.copyCalls = 0;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText(text) {
      window.copyCalls++; window.copiedText = text;
      return new Promise(resolve => { window.finishCopy = resolve; });
    } } });
  });
  // HIG InstallCommand composition: a repeat activation joins the pending clipboard write.
  const copy = page.getByRole('button', { name: 'Copy install command', exact: true });
  await copy.click();
  await copy.click();
  assert.equal(await page.evaluate(() => window.copyCalls), 1);
  await page.evaluate(() => window.finishCopy());
  await page.waitForFunction(() => window.copyStatusLog.some(entry => entry.text === 'Copied'));
  assert.equal(await page.evaluate(() => window.copiedText), 'bun add @bloxwap/chart');
  // HIG IconButton copy for the code window: disabled and busy while pending, then announced.
  const copyCode = page.getByRole('button', { name: 'Copy code', exact: true });
  await copyCode.click();
  assert.equal(await copyCode.isDisabled(), true);
  assert.equal(await copyCode.getAttribute('aria-busy'), 'true');
  await copyCode.evaluate(el => el.click());
  assert.equal(await page.evaluate(() => window.copyCalls), 2);
  await page.evaluate(() => window.finishCopy());
  await page.waitForFunction(() => window.copyStatusLog.some(entry => entry.text.includes('Code copied to clipboard.')));
  assert.match(await page.evaluate(() => window.copiedText), /from '@bloxwap\/chart\/react'/);
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied'); } } }));
  await copy.click();
  await page.waitForFunction(() => window.copyStatusLog.some(entry => entry.text.includes('Copy failed. Select the command') && entry.visibleError));
  await copyCode.click();
  await page.waitForFunction(() => window.copyStatusLog.some(entry => entry.text.includes('Could not copy.') && entry.visibleError));
  assert.equal(await copyCode.isDisabled(), false);
  record('Copy: pending suppresses repeat activation, success status, visible denial and recovery');
  const presentation = await page.evaluate(async () => {
    const css = getComputedStyle(document.documentElement);
    const button = document.querySelector('.hig-button');
    await document.fonts.ready;
    // hig#65: HIG CSS reads --hig-font-sans, so the button's first family is the Next-loaded Bloxwap face.
    const first = (el) => getComputedStyle(el).fontFamily.split(',')[0].trim().replace(/["']/g, '');
    const loaded = (el) => [...document.fonts].some(face => face.family.replace(/["']/g, '') === first(el) && face.status === 'loaded');
    return { buttonFaceLoaded: loaded(button), surface: css.getPropertyValue('--hig-surface').trim(), font: getComputedStyle(document.body).fontFamily, buttonFont: getComputedStyle(button).fontFamily, motion: css.getPropertyValue('--hig-motion-duration-fast').trim(), transform: getComputedStyle(button).transform, legacy: ['--card', '--bloxwap-green', '--space-md'].filter(name => css.getPropertyValue(name).trim()) };
  });
  assert.ok(await sameColor(page, presentation.surface, cssColor('surface')), `--hig-surface ${presentation.surface}`);
  assert.match(presentation.font, /BloxwapSans|Bloxwap Sans|bloxwap/i);
  assert.match(presentation.buttonFont, /BloxwapSans|Bloxwap Sans|bloxwap/i);
  assert.equal(presentation.buttonFaceLoaded, true, 'HIG button renders in a loaded Bloxwap face, not a fallback');
  assert.deepEqual(presentation.legacy, []);
  assert.match(presentation.motion, /^0(m?s)$/);
  assert.equal(presentation.transform, 'none');
  record('@bloxwap/hig-tokens palette, HIG controls in Bloxwap typography, no legacy aliases, reduced motion');
  await page.getByRole('tab', { name: 'npm', exact: true }).click();
  await page.getByRole('tab', { name: 'bun', exact: true }).click();
  if (evidence) { await mkdir(evidence, { recursive: true }); await page.screenshot({ path: `${evidence}/after-home.png`, fullPage: true }); }
  demoAllowed = true;
  await page.goto(`${origin}/chart/docs/playground/`, { waitUntil: 'domcontentloaded' });
  const frame = page.frameLocator('iframe[title="Interactive Bloxwap chart playground"]');
  await frame.locator('button[title="Settings"]').waitFor();
  await page.waitForFunction(() => document.querySelector('iframe').contentWindow.__chartStats?.().bars > 0);
  const demo = await page.locator('iframe').evaluate(el => {
    const doc = el.contentDocument;
    return { stats: el.contentWindow.__chartStats(), light: doc.body.classList.contains('light'), font: getComputedStyle(doc.querySelector('.cts-theme')).getPropertyValue('--cts-font'), panel: getComputedStyle(doc.querySelector('.cts-theme')).getPropertyValue('--cts-panel').trim(), themeButtons: doc.querySelectorAll('button[title^="Theme:"]').length };
  });
  assert.equal(demo.stats.symbol, 'Random walk');
  assert.ok(demo.stats.bars > 0);
  assert.equal(demo.stats.duplicates, 0);
  assert.equal(demo.light, false);
  assert.equal(demo.themeButtons, 0);
  assert.match(demo.font, /Bloxwap Sans/);
  assert.ok(await sameColor(page.frames().find(f => f !== page.mainFrame()), demo.panel, cssColor('surface')), `demo panel ${demo.panel}`);
  await frame.locator('button[title="Settings"]').click();
  await frame.getByRole('dialog', { name: 'Chart settings' }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await frame.getByRole('dialog', { name: 'Chart settings' }).isVisible(), false);
  await frame.locator('#chart').hover({ position: { x: 180, y: 160 } });
  await page.mouse.wheel(0, -120);
  record('Distinctive demo: canvas/worker assets, offline synthetic bars, HIG chrome, locked dark theme, settings/Escape, pointer/wheel');
  if (evidence) await page.screenshot({ path: `${evidence}/after-playground.png`, fullPage: true });
  await page.getByRole('button', { name: /search/i }).first().click();
  const search = page.getByRole('combobox', { name: 'Search' });
  await search.fill('datafeed');
  await page.getByRole('dialog').getByRole('option').first().waitFor();
  await page.keyboard.press('Escape');
  record('Static search index, results and keyboard dismissal');
  await page.goto(`${origin}/chart/docs/getting-started/`, { waitUntil: 'domcontentloaded' });
  const callout = page.locator('.docs-callout [data-severity="warning"]');
  assert.match(await callout.innerText(), /Developer preview/);
  assert.equal(await callout.getAttribute('role'), null);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => { const el = document.activeElement; return { tag: el.tagName, outline: getComputedStyle(el).outlineStyle }; });
  assert.ok(['A', 'BUTTON'].includes(focused.tag));
  assert.notEqual(focused.outline, 'none');
  // Fumadocs binds the shortcut after hydration; retry until the dialog opens.
  for (let attempt = 0; attempt < 20 && !await page.getByRole('combobox', { name: 'Search' }).isVisible(); attempt++) {
    await page.keyboard.press('ControlOrMeta+k');
    await page.waitForTimeout(250);
  }
  await page.getByRole('combobox', { name: 'Search' }).fill('qxzqxzqxz');
  await page.getByRole('dialog').getByRole('status').filter({ hasText: 'No results' }).waitFor();
  await page.keyboard.press('Escape');
  record('HIG callout (not announced), keyboard focus ring, search shortcut and empty results');
  await context.route('**/search.json', route => route.abort());
  await page.goto(`${origin}/chart/docs/guides/data/`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /search/i }).first().click();
  await page.getByRole('combobox', { name: 'Search' }).fill('datafeed');
  await page.getByRole('dialog').getByRole('alert').filter({ hasText: 'Search is unavailable' }).waitFor();
  await page.keyboard.press('Escape');
  await context.unroute('**/search.json');
  record('Search index failure shows the HIG error alert with recovery text');
  await page.evaluate(() => { document.documentElement.dir = 'rtl'; document.documentElement.style.fontSize = '200%'; });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  record('Representative docs: RTL and 200% root text without page overflow');
  await context.close();
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  await mobile.route('**/*', route => route.request().url().startsWith(origin) && !route.request().url().includes('/chart-demo/demo/') ? route.continue() : route.abort());
  const phone = await mobile.newPage();
  phone.setDefaultTimeout(30000);
  phone.setDefaultNavigationTimeout(60000);
  await phone.goto(`${origin}/chart/`, { waitUntil: 'domcontentloaded' });
  const target = await phone.getByRole('button', { name: 'Copy install command' }).boundingBox();
  assert.ok(target.height >= manifest.density.comfortable.target && target.width >= manifest.density.comfortable.target);
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await phone.goto(`${origin}/chart/docs/getting-started/`, { waitUntil: 'domcontentloaded' });
  const menu = phone.getByRole('button', { name: 'Open Sidebar', exact: true });
  await menu.click();
  await phone.getByRole('link', { name: 'Interactive playground', exact: true }).waitFor({ state: 'visible' });
  await phone.getByRole('link', { name: 'Interactive playground', exact: true }).click();
  await phone.waitForURL(/\/chart\/docs\/playground\/?$/);
  record('Touch emulation: 48px copy target, narrow layout and mobile navigation');
  if (evidence) await phone.screenshot({ path: `${evidence}/after-mobile.png`, fullPage: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ browser: await browser.version(), checks, demo, limitations: ['Automated Chrome for Testing (Playwright) with touch emulation only; no physical touch/haptics, iOS, Android, VoiceOver or TalkBack certification'] }, null, 2));
  if (evidence) await writeFile(`${evidence}/browser.json`, JSON.stringify({ browser: await browser.version(), checks, demo }, null, 2) + '\n');
} finally { await browser?.close(); server.kill(); }

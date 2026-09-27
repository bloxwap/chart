/** Real DOM checks for locked themes and frame-coalesced pointer/wheel input. */
export async function verifyPlayground(page, origin) {
  // Use the deterministic local feed; this check needs no external market API.
  await page.route('**/*', route => route.request().url().startsWith(`${origin}/`) ? route.continue() : route.abort());
  await page.addInitScript(() => localStorage.setItem('chart-ts:theme', 'light'));
  for (const lock of ['dark', 'light', '']) {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(`${origin}/demo/${lock ? `?lockedTheme=${lock}` : ''}`);
    await page.waitForSelector('button[title="Settings"]');
    await page.waitForFunction(() => document.querySelector('#chart').width > 400);
    const theme = await page.evaluate(() => ({
      light: document.body.classList.contains('light'),
      buttons: document.querySelectorAll('button[title^="Theme:"]').length,
      choices: [...document.querySelectorAll('[role="menuitemradio"]')]
        .filter(el => ['Light', 'Dark', 'System'].includes(el.querySelector('.cts-item-label')?.textContent)).length,
    }));
    if (theme.light !== (lock !== 'dark') || theme.buttons !== (lock ? 0 : 1) || theme.choices !== (lock ? 0 : 3)) {
      throw new Error(JSON.stringify({ lock, theme }));
    }
    await page.emulateMedia({ colorScheme: 'light' });
    if (await page.evaluate(() => document.body.classList.contains('light')) !== (lock !== 'dark')) {
      throw new Error('System overrode locked theme');
    }
    console.log({ lock: lock || 'unlocked', ...theme });
  }
  const scheduling = await page.evaluate(async () => {
    const canvas = document.querySelector('#chart'), ctx = canvas.getContext('2d'), scale = ctx.scale;
    let paints = 0;
    ctx.scale = function (...args) { paints++; return scale.apply(this, args); };
    try {
      const rect = canvas.getBoundingClientRect();
      for (let i = 0; i < 20; i++) canvas.dispatchEvent(new PointerEvent('pointermove', {
        clientX: rect.left + 100 + i, clientY: rect.top + 150, pointerType: 'mouse', bubbles: true,
      }));
      const synchronous = paints;
      await new Promise(requestAnimationFrame);
      const pointerPaints = paints;
      const perFrame = [];
      for (let i = 0; i < 20; i++) canvas.dispatchEvent(new WheelEvent('wheel', {
        clientX: rect.left + 200, clientY: rect.top + 150, deltaY: -2, bubbles: true, cancelable: true,
      }));
      for (let i = 0; i < 45; i++) {
        paints = 0;
        await new Promise(requestAnimationFrame);
        perFrame.push(paints);
      }
      return { synchronous, pointerPaints, wheelMaxPaints: Math.max(...perFrame), wheelPaints: perFrame.reduce((a, b) => a + b, 0) };
    } finally { ctx.scale = scale; }
  });
  if (scheduling.synchronous !== 0 || scheduling.pointerPaints !== 1 || scheduling.wheelMaxPaints > 1 || scheduling.wheelPaints < 1) {
    throw new Error(JSON.stringify(scheduling));
  }
  console.log(scheduling);
}

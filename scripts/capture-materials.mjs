/**
 * Repeatable OpenPBR visual receipt generator, for GPU-capable local browsers.
 * Requires: npm install --no-save playwright && npx playwright install chromium
 * Run: OPENPBR_URL=http://localhost:8080 node scripts/capture-materials.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { MATERIAL_PRESETS } from '../material-presets.mjs';
const { chromium } = await import('playwright');
const baseUrl = process.env.OPENPBR_URL || 'https://openpbr-viewer-demo-melodicbloom.vercel.app/';
const out = resolve(process.env.OPENPBR_CAPTURE_DIR || 'artifacts/material-captures');
const selected = (process.env.OPENPBR_PRESETS || 'iridescent,metal,glass').split(',');
const maxWaitMs = Number(process.env.OPENPBR_RENDER_TIMEOUT_MS || 90000);
const settleMs = Number(process.env.OPENPBR_SETTLE_MS || 12000);
const viewport = { width: 1280, height: 720 };
await mkdir(out, { recursive: true });
const errors = [];
const browser = await chromium.launch({ headless: process.env.HEADED !== '1' });
const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on('pageerror', e => errors.push({ type: 'pageerror', message: e.message }));
page.on('console', m => {
  if (['error', 'warning'].includes(m.type())) errors.push({ type: m.type(), message: m.text().slice(0, 300) });
});
page.on('response', r => {
  if (r.status() >= 400) errors.push({ type: 'HTTP', status: r.status(), url: r.url() });
});
const report = { sourceUrl: baseUrl, recordedAt: new Date().toISOString(), viewport, runs: [], warnings: errors };
try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  for (const id of selected) {
    if (!MATERIAL_PRESETS.some(p => p.id === id)) throw new Error('Unknown preset: ' + id);
    const startedAt = Date.now();
    const btn = page.locator('[data-preset="' + id + '"]');
    await btn.click({ timeout: 20000 });
    let ready = false;
    try {
      await page.waitForFunction(() => {
        const progress = document.querySelector('#progress_overlay');
        const status = document.querySelector('#material-preset-status')?.textContent || '';
        return progress?.style.display === 'none' && !status.includes('queued while scene loads');
      }, null, { timeout: maxWaitMs, polling: 500 });
      // GPU output can lag after the DOM spinner dismisses.
      await page.waitForTimeout(settleMs);
      ready = true;
    } catch {}
    const record = { id, selected: await btn.getAttribute('aria-pressed') === 'true',
      elapsedMs: Date.now() - startedAt, ready, url: page.url(), screenshot: null };
    record.consoleErrorCount = errors.length;
    record.visualReview = 'pending';
    if (ready && !errors.some(e => /CONTEXT_LOST_WEBGL|textures can not be used with multiple targets/.test(e.message))) {
      const path = resolve(out, id + '.png');
      const mask = await page.addStyleTag({ content: '#material-preset-dock,.lil-gui,#info,#samples { visibility:hidden !important; }' });
      try {
        const png = await page.screenshot({ path, timeout: 20000 });
        record.screenshot = id + '.png';
        record.sha256 = createHash('sha256').update(png).digest('hex');
      } catch (e) { record.screenshotError = e.message; }
      await mask.evaluate(el => el.remove());
    }
    if (ready && !record.screenshot && !record.screenshotError) record.blocked = 'WebGL errors or capture unavailable';
    report.runs.push(record);
    console.log(JSON.stringify(record));
  }
} finally {
  await writeFile(resolve(out, 'acceptance.json'), JSON.stringify(report, null, 2));
  await context.close();
  await browser.close();
}

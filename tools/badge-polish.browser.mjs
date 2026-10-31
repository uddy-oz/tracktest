// Presentation-only QA: local pages, no database writes or account creation.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = 'http://127.0.0.1:4183';
const output = process.env.LOCALAPPDATA + '/StanZer/ui-qa/badge-polish';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const checks = [], errors = [];
try {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', r => new URL(r.request().url()).origin === origin ? r.continue() : r.abort());
  for (const theme of ['dark', 'light']) {
    await page.goto(`${origin}/tools/badge-vault-preview.html?theme=${theme}`);
    await page.locator('.badge-card').first().waitFor();
    await page.evaluate(() => localStorage.removeItem('stanzer.badge-vault.tracked.v1:design-preview-only'));
    await page.reload();
    const next = page.locator('.vault-next');
    await next.waitFor();
    const title = await next.locator('.vault-focus-copy strong').innerText();
    const progress = await next.locator('progress').getAttribute('value');
    assert.ok(Number(progress) > 0 && Number(progress) < 100);
    await next.getByRole('button').click();
    await page.getByRole('dialog').waitFor();
    assert.equal(await page.locator('#vault-detail-title').innerText(), title);
    await page.getByRole('button', { name: 'Track Achievement', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.locator('.vault-tracked').waitFor();
    assert.equal(await page.locator('.badge-highlight-tracked').count(), 1);
    await page.getByRole('button', { name: 'Stop tracking achievement', exact: true }).click();
    await next.waitFor();
    for (const [width, height] of [[390, 844], [768, 1024], [1440, 1000]]) {
      await page.setViewportSize({ width, height });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const styles = await page.locator('.badge-topline strong').evaluateAll(nodes => [...new Set(nodes.map(n => getComputedStyle(n).color))]);
      assert.equal(styles.length, 5, 'All tiers have a distinct text treatment');
      const clipped = await page.locator('.vault-gallery .badge-card').evaluateAll(cards => cards.some(c => [...c.querySelectorAll('.badge-copy,.badge-topline,.badge-state,.badge-progress')].some(e => e.getBoundingClientRect().right > c.getBoundingClientRect().right + 1 || e.getBoundingClientRect().bottom > c.getBoundingClientRect().bottom + 1)));
      assert.equal(clipped, false, `${theme} ${width}: clipped card content`);
      checks.push({ theme, width, height, distinctTiers: 5, overflow: false, clipped: false });
    }
    await page.goto(`${origin}/profile/vault_rc_809e013e`);
    await page.getByRole('button', { name: 'View All Badges', exact: true }).click();
    // Exercise the real theme control, not a CSS-only theme simulation.
    if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) {
      await page.getByRole('button', { name: `Switch to ${theme} theme`, exact: true }).click();
    }
    for (const [width, height] of [[1440, 1000], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.getByLabel('Tier', { exact: true }).selectOption('');
      await page.getByLabel('Sort', { exact: true }).selectOption('tier');
      assert.equal(await page.locator('.vault-gallery .badge-card').count(), 58);
      assert.ok(await page.locator('.vault-gallery .badge-tier-legendary.badge-unlocked').count() > 0);
      await page.screenshot({ path: `${output}/full-${theme}-${width}.png`, fullPage: true });
      await page.locator('.badge-vault').scrollIntoViewIfNeeded();
      await page.evaluate(() => scrollTo(0, document.querySelector('.badge-vault').getBoundingClientRect().top + scrollY - 90));
      await page.screenshot({ path: `${output}/vault-${theme}-${width}.png` });
      await page.locator('.vault-gallery .badge-card').filter({ hasText: 'Arena Legend' }).click();
      await page.screenshot({ path: `${output}/detail-${theme}-${width}.png` });
      await page.keyboard.press('Escape');
    }
  }
  await page.goto(`${origin}/tools/badge-vault-preview.html?guest=1`);
  assert.equal(await page.locator('.vault-focus').count(), 0, 'No invented progress for an empty account');
  for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, recordVideo: { dir: output + '/video' } });
    const motion = await context.newPage();
    await motion.goto(`${origin}/tools/badge-vault-preview.html?theme=${theme}`);
    await motion.getByRole('button', { name: 'Preview unlock reveal' }).click();
    await motion.locator('.badge-earned-popup').waitFor();
    await motion.waitForTimeout(700);
    await motion.screenshot({ path: `${output}/reveal-${theme}.png` });
    await motion.locator('.badge-earned-popup').waitFor({ state: 'detached', timeout: 12000 });
    const video = motion.video();
    await context.close();
    await video.saveAs(`${output}/reveal-${theme}.webm`);
  }
  assert.deepEqual(errors, []);
  writeFileSync(output + '/polish-verification.json', JSON.stringify({ checks, nextTargetDetails: true, trackingHighlight: true, emptyAccountHonest: true, consoleErrors: errors }, null, 2));
  console.log('PASS: actual profile screenshots; next-target/tracking interactions; distinct tiers; responsive card bounds; reveal videos.');
} finally { await browser.close(); }

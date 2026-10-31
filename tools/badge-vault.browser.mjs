import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.BADGE_PREVIEW_URL || 'http://127.0.0.1:4182';
const output = process.env.BADGE_SCREENSHOTS;
if (!output) throw Error('Set BADGE_SCREENSHOTS to a local output directory outside Git.');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // No remote services: this design fixture has no auth or cloud dependencies.
  await page.route('**/*', r => new URL(r.request().url()).origin === origin ? r.continue() : r.abort());
  for (const [width, height] of [[360,800],[390,844],[430,932],[768,1024],[1440,1000]]) for (const theme of ['dark','light']) {
    await page.setViewportSize({width,height});
    await page.goto(`${origin}/tools/badge-vault-preview.html?theme=${theme}`);
    await page.locator('.badge-card').first().waitFor();
    assert.equal(await page.locator('.badge-card').count(),58);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth),false,`${theme} ${width}: overflow`);
    const contrast = await page.evaluate(() => {
      const rgb = s => s.match(/[\d.]+/g).slice(0,3).map(Number);
      const luminance = a => a.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
      const probe=document.createElement('span');probe.style.background='var(--surface)';document.body.append(probe);
      const surface=luminance(rgb(getComputedStyle(probe).backgroundColor));probe.remove();
      return [...document.querySelectorAll('.badge-copy h3,.badge-copy p,.badge-progress small,.badge-state,.badge-topline strong')].map(el=>{const ink=luminance(rgb(getComputedStyle(el).color));return (Math.max(ink,surface)+.05)/(Math.min(ink,surface)+.05);});
    });
    assert.ok(Math.min(...contrast)>=4.5,`${theme}: normal badge text contrast`);
    await page.screenshot({path:`${output}/after-${theme}-${width}.png`, fullPage:true});
    await page.screenshot({path:`${output}/overview-${theme}-${width}.png`});
    await page.getByLabel('Category',{exact:true}).selectOption('Championship');
    assert.equal(await page.locator('.badge-card').count(),3);
    await page.locator('.badge-card').first().click();
    await page.getByRole('dialog').waitFor();
    assert.equal(await page.getByRole('button',{name:'Track Achievement',exact:true}).count(),0);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>document.querySelector('[role="dialog"]').contains(document.activeElement)),true);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(()=>document.querySelector('[role="dialog"]').contains(document.activeElement)),true);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(),0);
    await page.getByLabel('Category',{exact:true}).selectOption('');
    await page.getByLabel('Search achievements').fill('nonesuch');
    await page.getByRole('heading',{name:'No matching achievements'}).waitFor();
    await page.getByRole('button',{name:'Reset filters'}).click();
    results.push({width,height,theme,overflow:false,cards:58,dialogKeyboard:true,minimumBaseSurfaceTextContrast:Math.min(...contrast)});
  }
  await page.getByLabel('Search achievements').fill('Rival');
  await page.locator('.badge-card').click();
  await page.getByRole('button',{name:'Track Achievement',exact:true}).click();
  await page.keyboard.press('Escape');
  await page.reload();
  await page.locator('.vault-tracked').waitFor();
  assert.match(await page.locator('.vault-tracked').innerText(),/Rival/);
  await page.getByRole('button',{name:'Preview unlock reveal'}).click();
  await page.locator('.badge-earned-popup').waitFor();
  await page.screenshot({path:`${output}/unlock-reveal.png`});
  await page.locator('.badge-earned-popup').waitFor({state:'detached',timeout:12000});
  await page.getByRole('button',{name:'Preview unlock reveal'}).click();
  await page.locator('.badge-earned-popup').waitFor({state:'detached',timeout:2000});
  await page.goto(`${origin}/tools/badge-vault-preview.html?guest=1`);
  assert.equal(await page.locator('.badge-unlocked').count(),0);
  await page.locator('.badge-card').first().click();
  assert.equal(await page.getByRole('button',{name:'Track Achievement',exact:true}).count(),0);
  assert.deepEqual(errors,[]);
  writeFileSync(`${output}/verification.json`,JSON.stringify({results,trackingPersistence:true,consoleErrors:errors},null,2));
  console.log(`PASS: ${results.length} viewport/theme combinations, filters, keyboard dialogs, tracking persistence, no console errors.`);
} finally { await browser.close(); }

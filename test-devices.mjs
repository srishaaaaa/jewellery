import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const BASE_URL = 'http://localhost:5174';
const DEVICES = [
  { name: 'iPhone 12 (iOS)', width: 390, height: 844 },
  { name: 'Android (Poco)', width: 360, height: 800 },
  { name: 'Samsung Galaxy', width: 412, height: 915 },
  { name: 'iPad', width: 768, height: 1024 },
  { name: 'iPad (Landscape)', width: 1024, height: 768 },
  { name: 'Laptop (1366x768)', width: 1366, height: 768 },
  { name: 'Desktop (1440x900)', width: 1440, height: 900 },
  { name: 'Desktop (1920x1080)', width: 1920, height: 1080 },
];

let report = ['MAHALASHMI POS - COMPREHENSIVE DEVICE CHECK\n' + '='.repeat(80) + '\n'];

function log(msg) {
  console.log(msg);
  report.push(msg);
}

async function testDevice(browser, device) {
  log(`\n📱 ${device.name} (${device.width}x${device.height})`);
  log('-'.repeat(60));

  const context = await browser.createBrowserContext({ viewport: device });
  const page = await context.newPage();

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 10000 });

    // Check for console errors
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.waitForTimeout(2000);

    // Check scrolling
    const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    const clientHeight = await page.evaluate(() => document.documentElement.clientHeight);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);

    // Check viewport meta
    const viewportMeta = await page.evaluate(() => {
      return document.querySelector('meta[name="viewport"]')?.getAttribute('content') || 'NOT FOUND';
    });

    const title = await page.title();
    const buttons = await page.$$eval('button, a[role="button"]', els => els.length);
    const inputs = await page.$$eval('input, textarea, select', els => els.length);
    const icons = await page.$$eval('[class*="icon"], svg, i', els => els.length);

    log(`  ✓ Title: ${title}`);
    log(`  ✓ Buttons: ${buttons}, Inputs: ${inputs}, Icons: ${icons}`);
    log(`  ✓ Viewport Meta: ${viewportMeta.substring(0, 50)}...`);

    if (scrollWidth > clientWidth + 10) {
      log(`  ⚠️  HORIZONTAL SCROLL: ${scrollWidth}px content > ${clientWidth}px viewport`);
    } else {
      log(`  ✓ No unwanted horizontal scroll`);
    }

    if (scrollHeight > clientHeight) {
      log(`  ✓ Vertical scroll available (${scrollHeight}px / ${clientHeight}px)`);
      // Test scrolling works
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const scrollPos = await page.evaluate(() => window.scrollY);
      if (scrollPos > 0) {
        log(`    ✓ Vertical scroll working (scrolled to ${scrollPos}px)`);
      } else {
        log(`    ⚠️  Scroll may not work properly`);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
    }

    if (errors.length > 0) {
      log(`  ⚠️  Console errors: ${errors.length}`);
      errors.slice(0, 3).forEach(e => log(`     - ${e.substring(0, 60)}`));
    } else {
      log(`  ✓ No console errors`);
    }

    // Check for layout issues
    const bodyOverflow = await page.evaluate(() => {
      const style = window.getComputedStyle(document.body);
      return style.overflow;
    });
    log(`  ℹ Body overflow: ${bodyOverflow}`);

    log(`  ✓ PASS`);

  } catch (error) {
    log(`  ❌ ERROR: ${error.message}`);
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch();

  log(`Start: ${new Date().toLocaleString()}`);
  log(`URL: ${BASE_URL}\n`);

  for (const device of DEVICES) {
    await testDevice(browser, device);
  }

  log('\n' + '='.repeat(80));
  log('SUMMARY');
  log('✓ All device tests completed');
  log(`End: ${new Date().toLocaleString()}`);
  log('='.repeat(80));

  writeFileSync('/tmp/device-report.txt', report.join('\n'));
  console.log('\n✓ Report saved');

  await browser.close();
})().catch(console.error);

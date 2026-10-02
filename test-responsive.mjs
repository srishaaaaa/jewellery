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
let passCount = 0;
let failCount = 0;

function log(msg) {
  console.log(msg);
  report.push(msg);
}

async function testDevice(browser, device) {
  log(`\n📱 ${device.name} (${device.width}x${device.height})`);
  log('-'.repeat(60));

  const page = await browser.newPage({ viewport: device });

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });

    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.waitForTimeout(2000);

    // Get page metrics
    const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    const clientHeight = await page.evaluate(() => document.documentElement.clientHeight);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);

    const viewportMeta = await page.evaluate(() => {
      return document.querySelector('meta[name="viewport"]')?.getAttribute('content') || 'NOT FOUND';
    });

    const title = await page.title();
    const buttons = await page.$$eval('button, a[role="button"]', els => els.length).catch(() => 0);
    const inputs = await page.$$eval('input, textarea, select', els => els.length).catch(() => 0);
    const icons = await page.$$eval('[class*="icon"], svg:not([style*="display:none"])', els => els.length).catch(() => 0);
    const images = await page.$$eval('img', els => els.length).catch(() => 0);

    log(`  ✓ Page Loaded: "${title}"`);
    log(`  ✓ Interactive: ${buttons} buttons, ${inputs} inputs`);
    log(`  ✓ Visual: ${icons} icons, ${images} images`);

    // Check for unwanted horizontal scroll
    let horizontalScrollIssue = false;
    if (scrollWidth > clientWidth + 10) {
      log(`  ⚠️  HORIZONTAL SCROLL ISSUE: ${scrollWidth}px > ${clientWidth}px viewport`);
      horizontalScrollIssue = true;
    } else {
      log(`  ✓ No unwanted horizontal scroll (${scrollWidth}px = ${clientWidth}px)`);
    }

    // Check vertical scroll works
    if (scrollHeight > clientHeight) {
      log(`  ℹ Vertical scroll available: ${scrollHeight}px / ${clientHeight}px`);
      try {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        const scrollPos = await page.evaluate(() => window.scrollY);
        if (scrollPos > 0) {
          log(`    ✓ Vertical scrolling works (scrolled to ${scrollPos}px)`);
        } else {
          log(`    ⚠️  Scroll may not be working`);
        }
        await page.evaluate(() => window.scrollTo(0, 0));
      } catch (e) {
        log(`    ⚠️  Scroll test error: ${e.message}`);
      }
    }

    // Check viewport meta
    if (viewportMeta.includes('width=device-width')) {
      log(`  ✓ Viewport meta configured correctly`);
    } else {
      log(`  ⚠️  Viewport meta may need review: ${viewportMeta.substring(0, 50)}`);
    }

    // Check for console errors
    if (consoleErrors.length === 0) {
      log(`  ✓ No console errors`);
    } else {
      log(`  ⚠️  ${consoleErrors.length} console error(s)`);
      consoleErrors.slice(0, 2).forEach(e => {
        const msg = e.length > 60 ? e.substring(0, 60) + '...' : e;
        log(`     - ${msg}`);
      });
    }

    // Overall status
    const issues = (horizontalScrollIssue ? 1 : 0) + (consoleErrors.length > 0 ? 1 : 0);
    if (issues === 0) {
      log(`  ✅ PASS - No issues detected`);
      passCount++;
    } else {
      log(`  ⚠️  REVIEW - ${issues} issue(s) detected`);
      failCount++;
    }

  } catch (error) {
    log(`  ❌ ERROR: ${error.message}`);
    failCount++;
  } finally {
    await page.close();
  }
}

(async () => {
  const browser = await chromium.launch();

  log(`Test Start: ${new Date().toLocaleString()}`);
  log(`Target URL: ${BASE_URL}`);
  log(`Devices Testing: ${DEVICES.length}\n`);

  for (const device of DEVICES) {
    await testDevice(browser, device);
  }

  await browser.close();

  log('\n' + '='.repeat(80));
  log('TEST SUMMARY');
  log('='.repeat(80));
  log(`Total Tests: ${DEVICES.length}`);
  log(`✅ Passed: ${passCount}`);
  log(`⚠️  Needs Review: ${failCount}`);
  const passRate = ((passCount / DEVICES.length) * 100).toFixed(1);
  log(`Success Rate: ${passRate}%`);
  log(`Test End: ${new Date().toLocaleString()}`);
  log('='.repeat(80));
  log('\nNOTE: This checks viewport responsiveness, scrolling, and basic DOM.');
  log('For full QA: test manually on physical devices, check touch interactions,');
  log('verify camera/barcode scanner integration, and test all page transitions.');

  writeFileSync('/tmp/device-report.txt', report.join('\n'));
  console.log('\n✓ Full report saved to /tmp/device-report.txt');
})().catch(console.error);

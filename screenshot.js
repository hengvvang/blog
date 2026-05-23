const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  
  // Set viewport to a nice laptop resolution
  await page.setViewport({ width: 1440, height: 900 });
  
  console.log('Navigating to http://localhost:6506/ ...');
  await page.goto('http://localhost:6506/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 500));
  
  const destDir = 'C:\\Users\\hengvvang\\.gemini\\antigravity\\brain\\9def2e5f-9d33-4241-bd18-f4dd4a799159';
  
  // Take screenshot of default home page
  console.log('Taking default home screenshot...');
  await page.screenshot({ path: path.join(destDir, 'screenshot_default.png') });
  
  // Click first category (RUST) to show detail view
  console.log('Navigating to RUST category...');
  const rows = await page.$$('.home-collection');
  if (rows.length > 0) {
    await rows[0].click();
    await new Promise(r => setTimeout(r, 400));
    
    // Open first article details
    const cardBtn = await page.$('.card-btn');
    if (cardBtn) {
      await cardBtn.click();
      await new Promise(r => setTimeout(r, 500));
      console.log('Taking article detail page screenshot...');
      await page.screenshot({ path: path.join(destDir, 'screenshot_detail.png') });
    }
  }
  
  // Navigate to HOME, then to TOOLCHAIN partition
  console.log('Navigating back to HOME...');
  await page.goto('http://localhost:6506/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 500));
  
  console.log('Navigating to TOOLCHAIN category...');
  const rowsToolchain = await page.$$('.home-collection');
  if (rowsToolchain.length > 0) {
    // Click the last row which is toolchain
    await rowsToolchain[rowsToolchain.length - 1].click();
    await new Promise(r => setTimeout(r, 600));
    
    console.log('Taking Toolchain partition screenshot...');
    await page.screenshot({ path: path.join(destDir, 'screenshot_toolchain.png') });
  }
  
  await browser.close();
  console.log('Done capturing screenshots!');
})();

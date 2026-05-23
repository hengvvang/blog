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
  
  // Wait for rendering
  await new Promise(r => setTimeout(r, 500));
  
  const destDir = 'C:\\Users\\hengvvang\\.gemini\\antigravity\\brain\\9def2e5f-9d33-4241-bd18-f4dd4a799159';
  
  // Take screenshot of default home page
  console.log('Taking default home screenshot...');
  await page.screenshot({ path: path.join(destDir, 'screenshot_default.png') });
  
  // Click first category (RUST)
  console.log('Navigating to RUST category...');
  const rows = await page.$$('.home-collection');
  if (rows.length > 0) {
    await rows[0].click();
    await new Promise(r => setTimeout(r, 400));
    
    // Open first article details
    console.log('Opening first article...');
    const cardBtn = await page.$('.card-btn');
    if (cardBtn) {
      await cardBtn.click();
      await new Promise(r => setTimeout(r, 500));
      
      console.log('Taking article detail page screenshot...');
      await page.screenshot({ path: path.join(destDir, 'screenshot_detail.png') });
    } else {
      console.warn('Card button not found.');
    }
  } else {
    console.warn('Category row not found.');
  }
  
  await browser.close();
  console.log('Done capturing screenshots!');
})();

import puppeteer from 'puppeteer';

async function capture() {
  console.log("Launching browser...");
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 1000 });
  
  console.log("Navigating to article detail page...");
  await page.goto('http://localhost:9191/#/article/955500365');
  
  // Wait for 2 seconds for content to fetch and render
  await new Promise(r => setTimeout(r, 2000));

  console.log("Capturing INFO tab screenshot...");
  await page.screenshot({ path: 'C:/Users/hengvvang/.gemini/antigravity/brain/1fbf44a8-bfd5-4283-b010-800d5bcef5bd/screenshot.png' });

  console.log("Clicking OUTLINE tab...");
  await page.click('button[data-tab="outline"]');
  await new Promise(r => setTimeout(r, 500));

  console.log("Capturing OUTLINE tab screenshot...");
  await page.screenshot({ path: 'C:/Users/hengvvang/.gemini/antigravity/brain/1fbf44a8-bfd5-4283-b010-800d5bcef5bd/screenshot_outline.png' });
  console.log("Screenshots saved to artifacts/screenshot.png and screenshot_outline.png");
  
  await browser.close();
}

capture().catch(console.error);

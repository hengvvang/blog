const puppeteer = require('puppeteer'); 
(async () => {
    try {
        const browser = await puppeteer.launch();
        const page = await browser.newPage();
        await page.goto('https://genshin.hoyoverse.com/ja/gift', {waitUntil: 'networkidle2'});

        // On genshin gift page, the right side list is usually .news-list or similar.
        const items = await page.$$('.news__item, a.news, .news__list li, .latest-news li, ul.news-list > li');
        
        console.log('Found items:', items.length);
        if(items.length >= 2){
            const news1 = items[0];
            const news2 = items[1];
            console.log('Before 1:', await news1.boundingBox());
            console.log('Before 2:', await news2.boundingBox());
            await news1.hover();
            await new Promise(r=>setTimeout(r, 600));
            console.log('After hover 1 -> 1:', await news1.boundingBox());
            console.log('After hover 1 -> 2:', await news2.boundingBox());
        }
        await browser.close();
    } catch(e) {
        console.error(e);
        process.exit(1);
    }
})();
const puppeteer = require('puppeteer'); 
(async () => {
    try {
        const browser = await puppeteer.launch();
        const page = await browser.newPage();
        await page.goto('https://genshin.hoyoverse.com/ja/gift', {waitUntil: 'networkidle2'});

        // search elements
        const items = await page.$$('a, li, div');
        let news = null;
        for (let el of items) {
            let txt = await page.evaluate(x => x.innerText, el);
            if (txt && txt.indexOf('神と共に戦おう') !== -1) {
                news = await page.evaluateHandle(x => x.closest('li') || x.closest('.news-item') || x, el);
                break;
            }
        }
        
        if (news) {
            const boxBefore = await news.boundingBox();
            console.log('Before Hover Box:', boxBefore);
            // let's grab next element before hover
            const next = await page.evaluateHandle(el => el.nextElementSibling, news);
            const nboxBefore = next ? await next.boundingBox() : null;
            console.log('Next element BEFORE:', nboxBefore);

            await news.hover();
            await new Promise(r => setTimeout(r, 1000));
            const boxAfter = await news.boundingBox();
            console.log('After Hover Box:', boxAfter);
            
            if (next) {
                const nbox = await next.boundingBox();
                console.log('Next element AFTER:', nbox);
            }
        } else {
            console.log('News item not found');
        }
        await browser.close();
    } catch(e) {
        console.error(e);
        process.exit(1);
    }
})();
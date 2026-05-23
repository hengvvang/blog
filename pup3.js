const puppeteer = require('puppeteer'); 
(async () => {
    try {
        const browser = await puppeteer.launch();
        const page = await browser.newPage();
        await page.goto('https://genshin.hoyoverse.com/ja/gift', {waitUntil: 'networkidle2'});

        const info = await page.evaluate(() => {
            const el = Array.from(document.querySelectorAll('a, li, div')).find(x => x.innerText && x.innerText.includes('神と共に戦おう'));
            if (!el) return 'Not found';
            
            // find the news card wrapper by going up to an a or li
            const wrapper = el.closest('li') || el.closest('a') || el.parentElement;
            const next = wrapper.nextElementSibling;
            
            const before1 = wrapper.getBoundingClientRect();
            const before2 = next ? next.getBoundingClientRect() : null;
            
            return {
                html: wrapper.outerHTML,
                before1: {y: before1.y, height: before1.height},
                before2: before2 ? {y: before2.y, height: before2.height} : null
            };
        });
        
        console.log(info);
        
        // Let's do the hover test entirely in browser
        const hoverRes = await page.evaluate(async () => {
            const el = Array.from(document.querySelectorAll('a, li, div')).find(x => x.innerText && x.innerText.includes('神と共に戦おう'));
            const wrapper = el.closest('li') || el.closest('a') || el.parentElement;
            const next = wrapper.nextElementSibling;
            
            // trigger hover styles
            wrapper.dispatchEvent(new MouseEvent('mouseover', {bubbles: true}));
            wrapper.dispatchEvent(new MouseEvent('mouseenter', {bubbles: true}));
            wrapper.classList.add('hover'); // sometimes they use class
            
            await new Promise(r => setTimeout(r, 600));
            
            const after1 = wrapper.getBoundingClientRect();
            const after2 = next ? next.getBoundingClientRect() : null;
            
            return {
                after1: {y: after1.y, height: after1.height},
                after2: after2 ? {y: after2.y, height: after2.height} : null
            };
        });
        console.log(hoverRes);
        
        await browser.close();
    } catch(e) {
        console.error(e);
        process.exit(1);
    }
})();
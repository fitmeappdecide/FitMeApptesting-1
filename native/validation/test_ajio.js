const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
    const url = 'https://www.ajio.com/buda-jeans-co-checked-regular-fit-shirt-/p/703532079_blue';
    const browser = await puppeteer.launch({ headless: 'new' });
    
    console.log("=== Testing iOS User Agent ===");
    const pageIOS = await browser.newPage();
    await pageIOS.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1');
    await pageIOS.goto(url, { waitUntil: 'networkidle2' });
    const htmlIOS = await pageIOS.content();
    fs.writeFileSync('ajio_ios.html', htmlIOS);
    const jsonLDIOS = await pageIOS.evaluate(() => {
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        return Array.from(scripts).map(s => s.innerText);
    });
    console.log("iOS JSON-LD count:", jsonLDIOS.length);
    console.log("iOS JSON-LD snippet:", jsonLDIOS.length > 0 ? jsonLDIOS[0].substring(0, 100) : "None");
    const brandIOS = await pageIOS.evaluate(() => {
        var el = document.querySelector('.brand-name') || document.querySelector('[class*="brand-name"]') || document.querySelector('[class*="brandName"]') || document.querySelector('.brand');
        return el ? el.innerText : null;
    });
    console.log("iOS Brand Extracted:", brandIOS);

    console.log("\n=== Testing Android User Agent ===");
    const pageAndroid = await browser.newPage();
    await pageAndroid.setUserAgent('Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36');
    await pageAndroid.goto(url, { waitUntil: 'networkidle2' });
    const htmlAndroid = await pageAndroid.content();
    fs.writeFileSync('ajio_android.html', htmlAndroid);
    const jsonLDAndroid = await pageAndroid.evaluate(() => {
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        return Array.from(scripts).map(s => s.innerText);
    });
    console.log("Android JSON-LD count:", jsonLDAndroid.length);
    console.log("Android JSON-LD snippet:", jsonLDAndroid.length > 0 ? jsonLDAndroid[0].substring(0, 100) : "None");
    const brandAndroid = await pageAndroid.evaluate(() => {
        var el = document.querySelector('.brand-name') || document.querySelector('[class*="brand-name"]') || document.querySelector('[class*="brandName"]') || document.querySelector('.brand');
        return el ? el.innerText : null;
    });
    console.log("Android Brand Extracted:", brandAndroid);

    await browser.close();
})();

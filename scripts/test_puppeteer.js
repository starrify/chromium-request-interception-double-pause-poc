const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    // Needed only when inside a Docker container
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  const shallDisableCache = process.env.TEST_DISABLE_CACHE == 'true';
  await page._client.send('Network.setCacheDisabled', { cacheDisabled: shallDisableCache });
  page.on('request', (request) => {
    request.continue();
  });
  const url = process.env.TEST_URL || 'https://github.com/';
  try {
    await page.goto(url);
  } catch (err) {
    console.error(err);
  }
  await browser.close();
})();

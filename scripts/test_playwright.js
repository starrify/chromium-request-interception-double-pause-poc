const assert = require('assert');
const { chromium } = require('playwright');
const CRPageModule = require('playwright/lib/server/chromium/crPage.js');

(async () => {
  // for getting access to the *exact* CDP session for that server page
  let _client;
  const origPrototype = CRPageModule.CRPage.prototype;
  CRPageModule.CRPage = function fooCRPage() {
    assert(_client === undefined);
    _client = arguments[0];
    return new origPrototype.constructor(...arguments);
  }

  const browser = await chromium.launch({
    // Needed only when inside a Docker container
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.route('*', (route, request) => {
    route.continue();
  });
  const shallDisableCache = process.env.TEST_DISABLE_CACHE == 'true';
  await _client.send('Network.setCacheDisabled', { cacheDisabled: shallDisableCache });
  const url = process.env.TEST_URL || 'https://github.com/';
  try {
    await page.goto(url);
  } catch (err) {
    console.error(err);
  }
  await browser.close();
})();

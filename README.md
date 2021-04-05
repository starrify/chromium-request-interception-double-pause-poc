# [DevTools] Request interception and caching may trigger double pause on stylesheet-initiated font requests in some conditions

## 1. Overview

This report describes the very behavior of Chromium, which is assumed to be an issue, that enabling request interception via the DevTools Protocol and enabling caching may cause stylesheet-initiated font requests to be paused twice in specific conditions.

I have created a repository on GitHub at https://github.com/starrify/chromium-request-interception-double-pause-poc to lodge this issue description text for better formatting, together with further supplementary materials. The same content has been attached to this issue report in the `full_contents.zip` file, thus you do not have to visit the repository.

## 2. Conditions to trigger the issue

For stably triggering the issue, these mandatory conditions must be all satisfied:
2.1. There is request interception enabled (via [the `Fetch.enable` CDP method][cdp-fetch-enable]).
2.2. There is caching enabled (not disabled via [the `Network.setCacheDisabled` CDP method][cdp-network-setcachedisabled]).
2.3. The page tries to load custom fonts via stylesheets. I'm unsure whether the issue may be triggered by other types of requests, but this is the only one type that I could confirm for now.

In addition to the above conditions, any of the below ones is also needed:
2.4.a. The font itself delays for long enough (a few hundred milliseconds would do).
2.4.b. There are other resources that would [delay the load event][html-spec-delay-load-event] and delay for long enough (a few hundred milliseconds would do). For example, that may be an `<img>`, a `<script>`, or a `<video>` that comes with the `poster` attribute.

## 3. Expected and observed behaviors

Normally when there is request interception configured via [the `Fetch.enable` CDP method][cdp-fetch-enable], we may expect a request to paused once (receiving one [`Fetch.requestPaused` CDP event][cdp-fetch-requestpaused]) if that matches the request interception rules, or not paused at all if no rule is matched.

However, when the described issue is triggered, one may observe the stylesheet-initiated font requests paused twice, if the first pause is then continued (via [the `Fetch.continueRequest` CDP method][cdp-fetch-continuerequest]).

When such double pause issue happens, both pause events would have the same `networkId` value indicating the request, while different `requestId` values indicating the interception.

When such double pause issue happens, continuing the second pause would have Chrome keep processing the request as normal. There is no third pause observed.

## 4. Affected versions

As per the tests that I have got so far, the issue may be reproduced in a wide range of Chromium / Chrome:
- Dev build at a recent revision of `fc608366`: 91.0.4467.0 (Developer Build) (64-bit)
- Current dev channel release: Google Chrome 91.0.4464.5 (Official Build) dev (64-bit)
- Current stable channel release: Google Chrome 89.0.4389.114 (Official Build) (64-bit)
- An earlier stable channel release: Chromium 89.0.4389.82  (Official Build)  Arch Linux  (64-bit)
- r856583 as bundled in `Puppeteer@8.0.0`: 90.0.4427.0  (Developer Build)  (64-bit)
- r737027 as bundled in `Puppeteer@3.0.0`: 81.0.4044.0 (Developer Build) (64-bit)
- r686378 as bundled in `Puppeteer@1.20.0`: 78.0.3882.0 (Developer Build) (64-bit)
- r641577 as bundled in `Puppeteer@1.14.0`: 75.0.3738.0 (Developer Build) (64-bit)

(all from the x86_64 GNU/Linux platform)

## 5. Test environments

All my tests were carried out from two system environments:
- My personal laptop using Arch Linux x86_64, with kernel version 5.10.16 and Node.js v15.11.0
- [The `node:14.16.0-buster` Docker image][dockerhub-node-14-16-0-buster], with Debian buster and Node.js v14.16.0

There are `Puppeteer` and `Playwright` involved in my reproducing the issue. It is assume that they are not the cause, yet I'm also sharing the version info that I tested with:
- Puppeteer: The current release v8.0.0. Also tested with many previous releases, dating back to v1.14.0.
- Playwright: The current release v1.10.0.

There is a `Dockerfile` attached for recreating the exact same test environment for reproducing the issue:
```Dockerfile
FROM node:14.16.0-buster
# Just for the dependencies.
RUN apt-get update && apt-get install -y chromium
WORKDIR /app
RUN npm install puppeteer@8.0.0 playwright@1.10.0
ADD . /app
# Hmm not good practice but shall be enough for this mere test
ENTRYPOINT ["/bin/bash", "-c", "nohup bash -c 'python3 -m http.server 8000 &' && sleep 0.5 && bash -c \"$*\"", "footest"]
```

Unless otherwise specified, sample commands given below would all be based on this docker build.

## 6. Test scripts

There are sample scripts provided in the attachment and the GitHub repository for triggering this issue:
- `scripts/test_puppeteer.js` using Puppeteer.
- `scripts/test_playwright.js` using Playwright.

For your convenience, I'm sharing the `scripts/test_puppeteer.js` content below, while the other one is omitted for being highly similar.
```javascript
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
```

It is suggested to launch the scripts with the `DEBUG=*` to retrieve all debug messages, or `DEBUG=puppeteer:protocol*` for Puppeteer / `DEBUG=*protocol` for Playwright to retrieve only the debug output for the DevTools Protocol details.

Due to the implement limitations in both Puppeteer and Playwright, which would be discussed in a later section, both script would fail at the `page.goto` line (e.g. `Navigation Timeout Exceeded`) when successfully triggering the issue. Despite the failure, it shall be enough to confirm this issue via the DevTools Protocol debug output.

There is a third script provides in `scripts/test_puppeteer_mitigation.js` which mitigates the Puppeteer failure and makes the render successful. When using this script, the Chromium issue may be also confirmed from the debug output.

## 7. Test targets

There are several HTML source files provided in the `static_server/` path that could be used to stably reproduce this issue. There are two types:
- The `static_server/font-long-delay.html` file is for the `2.4.a.` variant described above, where the issue is triggered by loading only the font resource itself that delays for too long.
- The `static_server/font-and-{video,image,script}.html` files are for the `2.4.b.` variant described above, where the issue is triggered by the combination of a font resource and some other long delaying resources.

A static HTTP server is expected to be launched for serving these files.

Apart from the minimal examples created from scratch, there are also many real-world web pages that are observed to trigger this issue stably. One example is https://github.com/, which has a `<video>` tag with the `poster` attribute to [delay the load event][html-spec-delay-load-event], and tries to load several `Alliance*.woff` fonts that may be paused twice.

## 8. Test invocation and results

Using the materials you may find from the attached `full_contents.zip` file or [the mirroring GitHub repository][full-contents-on-github], you may be able to reproduce the issue via the sample commands shared below.

An example of preparing the environment, launching the test with the local "font-and-video" case using the Puppeteer script, and examining the debug logs:

```
# Preparing the testing environment
$ docker build -t tmptest-cr -f ./Dockerfile .

# Launch the test for the "font-and-video" case using the Puppeteer script, saving all debug output
$ docker run --rm tmptest-cr:latest DEBUG=* TEST_URL=http://localhost:8000/static_server/font-and-video.html node scripts/test_puppeteer.js &> sample_results/puppeteer_font-and-video_full.log

# Query the relavant request ID / interception ID for the .woff font resource
$ cat sample_results/puppeteer_font-and-video_full.log | grep Ahem.woff | grep -Po "(?<=protocol:RECV ◀ ).*" | jq '.params|(.requestId//.networkId)' -r
interception-job-3.0
56.4
interception-job-4.0

# Query the log with the above IDs, confirming two Fetch.requestPaused events for the resource
$ cat sample_results/puppeteer_font-and-video_full.log | grep -P '\b(interception-job-[34]\.0|56\.4)\b'
2021-04-05T18:51:52.010Z puppeteer:protocol:RECV ◀ {"method":"Fetch.requestPaused","params":{"requestId":"interception-job-3.0","request":{"url":"http://localhost:8000/static_server/Ahem.woff","method":"GET","headers":{"sec-ch-ua":"","Origin":"http://localhost:8000","sec-ch-ua-mobile":"?0","User-Agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/90.0.4427.0 Safari/537.36","Accept":"*/*","Referer":"http://localhost:8000/static_server/font-and-video.html"},"initialPriority":"VeryHigh","referrerPolicy":"strict-origin-when-cross-origin"},"frameId":"0B4C96E3D545633603BE6348D8972C7C","resourceType":"Font","networkId":"56.4"},"sessionId":"7CF8364501D3B416DAC66386CECECDD8"}
2021-04-05T18:51:52.016Z puppeteer:protocol:RECV ◀ {"method":"Network.requestWillBeSent","params":{"requestId":"56.4","loaderId":"70DF679602B1E0B36BC14D6BD66A1339","documentURL":"http://localhost:8000/static_server/font-and-video.html","request":{"url":"http://localhost:8000/static_server/Ahem.woff","method":"GET","headers":{"sec-ch-ua":"","Referer":"http://localhost:8000/static_server/font-and-video.html","Origin":"http://localhost:8000","sec-ch-ua-mobile":"?0","User-Agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/90.0.4427.0 Safari/537.36"},"mixedContentType":"none","initialPriority":"VeryHigh","referrerPolicy":"strict-origin-when-cross-origin"},"timestamp":1260854.645356,"wallTime":1617648712.008897,"initiator":{"type":"parser","url":"http://localhost:8000/static_server/font-and-video.html"},"type":"Font","frameId":"0B4C96E3D545633603BE6348D8972C7C","hasUserGesture":false},"sessionId":"7CF8364501D3B416DAC66386CECECDD8"}
2021-04-05T18:51:52.017Z puppeteer:protocol:SEND ► {"sessionId":"7CF8364501D3B416DAC66386CECECDD8","method":"Fetch.continueRequest","params":{"requestId":"interception-job-3.0"},"id":22}
2021-04-05T18:51:52.019Z puppeteer:protocol:RECV ◀ {"method":"Fetch.requestPaused","params":{"requestId":"interception-job-4.0","request":{"url":"http://localhost:8000/static_server/Ahem.woff","method":"GET","headers":{"sec-ch-ua":"","Origin":"http://localhost:8000","sec-ch-ua-mobile":"?0","User-Agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/90.0.4427.0 Safari/537.36","Accept":"*/*","Referer":"http://localhost:8000/static_server/font-and-video.html"},"initialPriority":"VeryHigh","referrerPolicy":"strict-origin-when-cross-origin"},"frameId":"0B4C96E3D545633603BE6348D8972C7C","resourceType":"Font","networkId":"56.4"},"sessionId":"7CF8364501D3B416DAC66386CECECDD8"}
```

Another example of launching the test with the https://github.com/ case using the Puppeteer-mitigation script, and examining the debug logs:
(Notice that the request, after continued for the second time, was fulfilled properly.)
```
# Launch the test for https://github.com/ using the Puppeteer-mitigation script, saving all debug output
$ docker run --rm tmptest-cr:latest DEBUG=* TEST_URL=https://github.com/ node scripts/test_puppeteer_mitigation.js &> sample_results/puppeteer_mitigation_github_full.log

# Query the relavant request ID / interception ID for the Alliance-No-1-Regular.woff font resource
$ cat sample_results/puppeteer_mitigation_github_full.log | grep Alliance-No-1-Regular.woff | grep -Po "(?<=protocol:RECV ◀ ).*" | jq '.params|(.requestId//.networkId)' -r
interception-job-26.0
54.162
interception-job-36.0
54.162
54.162

# Query the log with the above IDs, confirming two Fetch.requestPaused events for the resource
$ cat sample_results/puppeteer_mitigation_github_full.log | grep -P '\b(interception-job-[23]6\.0|54\.162)\b'
2021-04-05T18:57:03.602Z puppeteer:protocol:RECV ◀ {"method":"Fetch.requestPaused","params":{"requestId":"interception-job-26.0","request":{"url":"https://github.githubassets.com/static/fonts/alliance/Alliance-No-1-Regular.woff","method":"GET","headers":{"sec-ch-ua":"","Origin":"https://github.com","sec-ch-ua-mobile":"?0","User-Agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/90.0.4427.0 Safari/537.36","Accept":"*/*","Referer":"https://github.githubassets.com/assets/site-804529ba58bde31612842d0001b01542.css"},"initialPriority":"VeryHigh","referrerPolicy":"strict-origin-when-cross-origin"},"frameId":"30701C3DBDDE96E3C565E704CDF57E13","resourceType":"Font","networkId":"54.162"},"sessionId":"687AB783EF752020DB74727D3589F7AE"}
2021-04-05T18:57:03.602Z puppeteer:protocol:SEND ► {"sessionId":"687AB783EF752020DB74727D3589F7AE","method":"Fetch.continueRequest","params":{"requestId":"interception-job-26.0"},"id":44}
2021-04-05T18:57:03.771Z puppeteer:protocol:RECV ◀ {"method":"Network.requestWillBeSent","params":{"requestId":"54.162","loaderId":"D9E5C11689B80539A4587A5BBCBB37AB","documentURL":"https://github.com/","request":{"url":"https://github.githubassets.com/static/fonts/alliance/Alliance-No-1-Regular.woff","method":"GET","headers":{"sec-ch-ua":"","Referer":"https://github.githubassets.com/assets/site-804529ba58bde31612842d0001b01542.css","Origin":"https://github.com","sec-ch-ua-mobile":"?0","User-Agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/90.0.4427.0 Safari/537.36"},"mixedContentType":"none","initialPriority":"VeryHigh","referrerPolicy":"strict-origin-when-cross-origin"},"timestamp":1261166.237788,"wallTime":1617649023.601329,"initiator":{"type":"parser","url":"https://github.githubassets.com/assets/site-804529ba58bde31612842d0001b01542.css"},"type":"Font","frameId":"30701C3DBDDE96E3C565E704CDF57E13","hasUserGesture":false},"sessionId":"687AB783EF752020DB74727D3589F7AE"}
2021-04-05T18:57:03.790Z puppeteer:protocol:RECV ◀ {"method":"Fetch.requestPaused","params":{"requestId":"interception-job-36.0","request":{"url":"https://github.githubassets.com/static/fonts/alliance/Alliance-No-1-Regular.woff","method":"GET","headers":{"sec-ch-ua":"","Origin":"https://github.com","sec-ch-ua-mobile":"?0","User-Agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/90.0.4427.0 Safari/537.36","Accept":"*/*","Referer":"https://github.githubassets.com/assets/site-804529ba58bde31612842d0001b01542.css"},"initialPriority":"VeryHigh","referrerPolicy":"strict-origin-when-cross-origin"},"frameId":"30701C3DBDDE96E3C565E704CDF57E13","resourceType":"Font","networkId":"54.162"},"sessionId":"687AB783EF752020DB74727D3589F7AE"}
2021-04-05T18:57:03.791Z puppeteer:protocol:SEND ► {"sessionId":"687AB783EF752020DB74727D3589F7AE","method":"Fetch.continueRequest","params":{"requestId":"interception-job-36.0"},"id":54}
2021-04-05T18:57:03.793Z puppeteer:protocol:RECV ◀ {"method":"Network.requestWillBeSentExtraInfo","params":{"requestId":"54.162","associatedCookies":[],"headers":{":method":"GET",":authority":"github.githubassets.com",":scheme":"https",":path":"/static/fonts/alliance/Alliance-No-1-Regular.woff","sec-ch-ua":"","origin":"https://github.com","sec-ch-ua-mobile":"?0","user-agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/90.0.4427.0 Safari/537.36","accept":"*/*","sec-fetch-site":"cross-site","sec-fetch-mode":"cors","sec-fetch-dest":"font","referer":"https://github.githubassets.com/assets/site-804529ba58bde31612842d0001b01542.css","accept-encoding":"gzip, deflate, br","accept-language":"en-US"},"clientSecurityState":{"initiatorIsSecureContext":true,"initiatorIPAddressSpace":"Public","privateNetworkRequestPolicy":"WarnFromInsecureToMorePrivate"}},"sessionId":"687AB783EF752020DB74727D3589F7AE"}
2021-04-05T18:57:03.912Z puppeteer:protocol:RECV ◀ {"method":"Network.responseReceivedExtraInfo","params":{"requestId":"54.162","blockedCookies":[],"headers":{"last-modified":"Fri, 04 Dec 2020 01:16:51 GMT","etag":"\"fdddae97036f301bbf0ccadd6fa6155f\"","content-type":"application/font-woff","server":"AmazonS3","via":"1.1 varnish, 1.1 varnish","accept-ranges":"bytes","date":"Mon, 05 Apr 2021 18:57:03 GMT","age":"4666","x-served-by":"cache-dca17781-DCA, cache-ams21077-AMS","x-cache":"HIT, HIT","x-cache-hits":"1, 19","access-control-allow-origin":"*","strict-transport-security":"max-age=31536000","x-fastly-request-id":"a7d90a5c13ea95150621ca49c42501c0845d4d51","content-length":"26960"},"resourceIPAddressSpace":"Public"},"sessionId":"687AB783EF752020DB74727D3589F7AE"}
2021-04-05T18:57:04.019Z puppeteer:protocol:RECV ◀ {"method":"Network.responseReceived","params":{"requestId":"54.162","loaderId":"D9E5C11689B80539A4587A5BBCBB37AB","timestamp":1261166.654681,"type":"Font","response":{"url":"https://github.githubassets.com/static/fonts/alliance/Alliance-No-1-Regular.woff","status":200,"statusText":"","headers":{"x-fastly-request-id":"a7d90a5c13ea95150621ca49c42501c0845d4d51","date":"Mon, 05 Apr 2021 18:57:03 GMT","via":"1.1 varnish, 1.1 varnish","last-modified":"Fri, 04 Dec 2020 01:16:51 GMT","server":"AmazonS3","age":"4666","etag":"\"fdddae97036f301bbf0ccadd6fa6155f\"","x-served-by":"cache-dca17781-DCA, cache-ams21077-AMS","strict-transport-security":"max-age=31536000","x-cache":"HIT, HIT","content-type":"application/font-woff","access-control-allow-origin":"*","accept-ranges":"bytes","content-length":"26960","x-cache-hits":"1, 19"},"mimeType":"application/font-woff","connectionReused":true,"connectionId":40,"remoteIPAddress":"185.199.111.154","remotePort":443,"fromDiskCache":false,"fromServiceWorker":false,"fromPrefetchCache":false,"encodedDataLength":221,"timing":{"requestTime":1261166.428213,"proxyStart":-1,"proxyEnd":-1,"dnsStart":-1,"dnsEnd":-1,"connectStart":-1,"connectEnd":-1,"sslStart":-1,"sslEnd":-1,"workerStart":-1,"workerReady":-1,"workerFetchStart":-1,"workerRespondWithSettled":-1,"sendStart":0.46,"sendEnd":0.976,"pushStart":0,"pushEnd":0,"receiveHeadersEnd":120.58},"responseTime":1.617649023912272e+12,"protocol":"h2","securityState":"secure","securityDetails":{"protocol":"TLS 1.3","keyExchange":"","keyExchangeGroup":"X25519","cipher":"AES_128_GCM","certificateId":0,"subjectName":"*.githubassets.com","sanList":["*.githubassets.com","githubassets.com"],"issuer":"DigiCert SHA2 High Assurance Server CA","validFrom":1604275200,"validTo":1636502399,"signedCertificateTimestampList":[],"certificateTransparencyCompliance":"unknown"}},"frameId":"30701C3DBDDE96E3C565E704CDF57E13"},"sessionId":"687AB783EF752020DB74727D3589F7AE"}
2021-04-05T18:57:04.019Z puppeteer:protocol:RECV ◀ {"method":"Network.dataReceived","params":{"requestId":"54.162","timestamp":1261166.654774,"dataLength":26960,"encodedDataLength":0},"sessionId":"687AB783EF752020DB74727D3589F7AE"}
2021-04-05T18:57:04.020Z puppeteer:protocol:RECV ◀ {"method":"Network.dataReceived","params":{"requestId":"54.162","timestamp":1261166.65583,"dataLength":0,"encodedDataLength":26978},"sessionId":"687AB783EF752020DB74727D3589F7AE"}
2021-04-05T18:57:04.020Z puppeteer:protocol:RECV ◀ {"method":"Network.loadingFinished","params":{"requestId":"54.162","timestamp":1261166.550455,"encodedDataLength":27199,"shouldReportCorbBlocking":false},"sessionId":"687AB783EF752020DB74727D3589F7AE"}
```

Kindly notice that I'm using Docker here only to make sure the exact environment may be reproduced by others. You do not have to build the exact Docker image, and I indeed expect it to be relatively easy to launch the testing scripts from other environments (like your personal machine) and to reproduce the issue.

In the `sample_results/` directory I have included a few other debug logs, whose configuration may be inferred from the respective filenames.

## 9. Impact and severity

In several major projects that communicates with Chromium via the DevTools Protocol, I see the network management code implemented in a way that enabling request interception shall force disable caching:
- In `devtools-frontend`, here's the relevant code at a recent revision: [link][devtools-frontend-sample-code]. This is believed to have been introduced in November 2017 in [revision `76e8a50d`][devtools-frontend-76e8a50d] ([review ID: 764516][gerrit-764516]).
- In `Puppeteer`, here's the relevant code at a recent revision: [link][puppeteer-sample-code]. This is believed to have been introduced in October 2017 in [pull request #1154][puppeteer-pr-1154].
- In `Playwright`, here's the relevant code at a recent revision: [link][playwright-sample-code]. This is believed to have been there [since the initial commit][playwright-sample-code-initial-commit] of the project in November 2019, possibly copied directly from `Puppeteer`.

Therefore one immediate assumption is that the above tools are not impacted by the described issue, as they all explicitly disable caching upon configuring request interception. Therefore the described issue may not be regarded as a high-priority one.

The current implement of those major tools, however, also prevents users from making use of caching and request interception at the same time. Thus resolving this issue may in some scenarios certainly bring some help to specific users.

It's also worth noticing that, due to my limited knowledge of Chromium, I am rather unsure whether there may be any other issue to occur if caching and request interception are both enabled, although I have not yet observed any during my personal tests.

[cdp-fetch-enable]: https://chromedevtools.github.io/devtools-protocol/tot/Fetch/#method-enable
[cdp-fetch-requestpaused]: https://chromedevtools.github.io/devtools-protocol/tot/Fetch/#event-requestPaused
[cdp-fetch-continuerequest]: https://chromedevtools.github.io/devtools-protocol/tot/Fetch/#method-continueRequest
[cdp-network-setcachedisabled]: https://chromedevtools.github.io/devtools-protocol/tot/Network/#method-setCacheDisabled
[html-spec-delay-load-event]: https://html.spec.whatwg.org/multipage/parsing.html#delay-the-load-event
[dockerhub-node-14-16-0-buster]: https://hub.docker.com/_/node?tab=tags&page=1&ordering=last_updated&name=14.16.0-buster
[full-contents-on-github]: https://github.com/starrify/chromium-request-interception-double-pause-poc
[devtools-frontend-sample-code]: https://chromium.googlesource.com/devtools/devtools-frontend/+/c2a35e02f8d6cf1fc622e2e2d03ba667361196c7/front_end/core/sdk/NetworkManager.js#1466
[devtools-frontend-76e8a50d]: https://chromium.googlesource.com/chromium/src/+/76e8a50d855d02323a509da2545e47400d78b3e9
[gerrit-764516]: https://chromium-review.googlesource.com/c/chromium/src/+/764516/
[puppeteer-sample-code]: https://github.com/puppeteer/puppeteer/blob/bf60a300e7e8182bb7149f528f200ab1448b2cdb/src/common/NetworkManager.ts#L203
[puppeteer-pr-1154]: https://github.com/puppeteer/puppeteer/pull/1154
[playwright-sample-code]: https://github.com/microsoft/playwright/blob/e3cf675/src/server/chromium/crNetworkManager.ts#L103
[playwright-sample-code-initial-commit]: https://github.com/microsoft/playwright/blob/9ba375c06344835d783fe60bf33f857f9bc208a4/src/chromium/NetworkManager.ts#L121

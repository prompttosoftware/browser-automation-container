/**
 * Sleeps until the page has no pending requests for at least `idleTime`.
 * @param {Page} page
 * @param {number} idleTime  milliseconds of “quiet” before resolving
 * @param {number} [timeout] how long to wait in total before giving up
 */
async function waitForNetworkIdle(page, idleTime = 500, timeout = 30000) {
    let inflight = 0;
    let resolveIdle;
    let rejectIdle;
  
    const idlePromise = new Promise((res, rej) => {
      resolveIdle = res;
      rejectIdle = rej;
    });
  
    const timer = { id: null };
    const start = Date.now();
  
    function onRequest() {
      inflight++;
      clearTimeout(timer.id);
    }
    function onRequestDone() {
      if (inflight > 0) inflight--;
      if (inflight === 0) {
        // schedule idle resolution
        timer.id = setTimeout(() => resolveIdle(), idleTime);
      }
    }
  
    page.on('request', onRequest);
    page.on('requestfinished', onRequestDone);
    page.on('requestfailed', onRequestDone);
  
    // in case nothing ever happens
    const timeoutId = setTimeout(() => {
      rejectIdle(new Error('waitForNetworkIdle: timeout exceeded'));
    }, timeout);

    try {
      return await idlePromise;
    } finally {
      clearTimeout(timer.id);
      clearTimeout(timeoutId);
      page.off('request', onRequest);
      page.off('requestfinished', onRequestDone);
      page.off('requestfailed', onRequestDone);
    }
}

module.exports = {
    waitForNetworkIdle,
};

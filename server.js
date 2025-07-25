const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const bodyParser = require('body-parser');
const cors = require('cors');
const { extractDOM } = require('./extractDOM.js');
const { isLocalUrl } = require('./isLocalHostUrl.js');
const { waitForNetworkIdle } = require('./waitForNetworkIdle.js');
const { Readability } = require('@mozilla/readability');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;
const ContainerTimer = require('./ContainerTimer.js');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3010;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));

// Store browser instance and active pages
let browser;
const activePages = new Map(); // Map to store active page sessions

const timer = new ContainerTimer({
  startTimeFile: '/data/.container_start.txt',
  thresholdMinutes: 30,
  killDelayMs: 60_000,   // wait 1m after threshold
});

puppeteer.use(StealthPlugin());

// Initialize Puppeteer browser on startup
async function initBrowser() {
  browser = await puppeteer.launch({
    headless: true,
    executablePath: '/usr/bin/chromium',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',

      // Enable developer tools features
      '--remote-debugging-port=9222', // Enable DevTools protocol
      '--enable-logging',
      '--log-level=0',
      '--disable-web-security', // For cross-origin requests if needed
      '--allow-running-insecure-content',
      
      // Performance and memory monitoring
      '--enable-precise-memory-info', // Enable memory API
      '--enable-memory-info',
      '--js-flags=--expose-gc', // Enable garbage collection API
      
      // Network monitoring
      '--enable-features=NetworkService',
      '--enable-network-service-logging',
      
      // Better debugging
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      
      // Existing performance args
      '--disable-features=VizDisplayCompositor',
      '--disable-ipc-flooding-protection'
    ],
    // Enable additional permissions
    ignoreDefaultArgs: ['--disable-extensions'],
  });
  console.log('Browser initialized');
}

// Enhanced page creation with developer tools setup
async function createPage() {
  const page = await browser.newPage();
  
  // Set viewport (your existing code)
  await page.setViewport({ width: 1280, height: 800 });
  
  // Enable developer tools features
  await page.setCacheEnabled(false); // Disable cache for fresh network requests
  
  // Enable JavaScript execution context
  await page.evaluateOnNewDocument(() => {
    // Expose useful debugging functions
    window.puppeteerDebug = {
      getElementInfo: (selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        
        const computedStyle = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        
        return {
          tagName: element.tagName,
          id: element.id,
          className: element.className,
          textContent: element.textContent?.substring(0, 500),
          computedStyle: {
            display: computedStyle.display,
            position: computedStyle.position,
            width: computedStyle.width,
            height: computedStyle.height
          },
          boundingRect: rect,
          isVisible: element.offsetWidth > 0 && element.offsetHeight > 0
        };
      }
    };
  });
  
  // Set up console monitoring
  const consoleLogs = [];
  page.on('console', msg => {
    consoleLogs.push({
      type: msg.type(),
      text: msg.text(),
      timestamp: new Date().toISOString(),
      location: msg.location()
    });
  });
  
  // Set up network monitoring
  const networkRequests = [];
  
  page.on('request', request => {
    networkRequests.push({
      id: request.url() + '-' + Date.now(),
      url: request.url(),
      method: request.method(),
      headers: request.headers(),
      postData: request.postData(),
      timestamp: new Date().toISOString(),
      resourceType: request.resourceType()
    });
  });
  
  page.on('response', response => {
    const request = networkRequests.find(req => 
      req.url === response.url() && !req.status
    );
    if (request) {
      request.status = response.status();
      request.statusText = response.statusText();
      request.responseHeaders = response.headers();
      request.fromCache = response.fromCache();
      request.fromServiceWorker = response.fromServiceWorker();
    }
  });
  
  page.on('requestfailed', request => {
    const reqData = networkRequests.find(req => 
      req.url === request.url() && !req.status
    );
    if (reqData) {
      reqData.failed = true;
      reqData.errorText = request.failure().errorText;
    }
  });
  
  // Store monitoring data on page object for easy access
  page.puppeteerData = {
    consoleLogs,
    networkRequests,
    createdAt: new Date().toISOString()
  };
  
  // Set up error handling
  page.on('error', err => {
    console.error('Page error:', err);
  });
  
  page.on('pageerror', err => {
    console.error('Page JavaScript error:', err);
  });
  
  return page;
}

// Initialize browser when server starts
initBrowser().catch(err => {
  console.error('Failed to initialize browser:', err);
  process.exit(1);
});

// Unified endpoint to perform a sequence of actions
app.post('/actions', async (req, res) => {
  let { sessionId, actions, elementOptions, localHostnames = [] } = req.body;
  
  if (!actions || !Array.isArray(actions)) {
    return res.status(400).json({ error: 'Array of actions is required' });
  }

  try {
    // Get or create a page session
    let page;
    console.log('sessionId: ', sessionId);
    console.log('activePages count: ', activePages.size);
    if (sessionId && activePages.has(sessionId)) {
        console.log("Using existing session...");
        page = activePages.get(sessionId);
    } else if (!sessionId && activePages.size > 0) {
        // If no sessionId provided but pages exist, use the last created page
        console.log("Using last session...");
        const pages = Array.from(activePages.values());
        page = pages[pages.length - 1];
        sessionId = [...activePages.keys()][pages.length - 1];
    } else {
        console.log("Creating new session...");
        page = await createPage(); // Use enhanced page creation
        sessionId = sessionId || Date.now().toString();
        activePages.set(sessionId, page);
    }
    
    // Execute each action in sequence
    const results = [];
    let screenshot = null;
    
    for (const action of actions) {
      const { type } = action;
      
      try {
        switch (type.toLowerCase()) {
            case 'click-coordinates':
              const { x, y } = action;
              if (typeof x !== 'number' || typeof y !== 'number') {
                results.push({
                  success: false,
                  type,
                  error: 'Both x and y coordinates are required for click-coordinates action'
                });
                continue;
              }
              await page.mouse.click(x, y);
              // now wait for “settle”
              try {
                await waitForNetworkIdle(page, /* idleTime */ 500, /* timeout */ 10000);
              } catch (err) {
                // either timed out or something went wrong—optionally log it
                console.warn('Network-idle wait failed:', err.message);
              }
              results.push({
                success: true,
                type,
                x,
                y
              });
            break;

          case 'navigate':
            const { url } = action;
            if (!url) {
              results.push({ 
                success: false, 
                type, 
                error: 'URL is required for navigate action' 
              });
              continue;
            }
            await page.goto(url, { waitUntil: 'domcontentloaded' });
            results.push({ success: true, type, url });
            break;
            
          case 'click':
            const { selector: clickSelector } = action;
            console.log('clickSelector', clickSelector);
            let cleanClickSelector = clickSelector;
            try {
                // Attempt to parse the selector string, which may be double-escaped
                cleanClickSelector = JSON.parse(cleanClickSelector);
            } catch (err) {
                // If parsing fails, log the error and fallback to the original string
                // console.error('Selector parsing failed:', err);
            }
            console.log('cleanSelector', cleanClickSelector);
            await page.waitForSelector(cleanClickSelector, { timeout: 5000 });
            console.log('selector found...');
            await page.click(cleanClickSelector);
            console.log('clicked...');
            // now wait for “settle”
            try {
              await waitForNetworkIdle(page, /* idleTime */ 500, /* timeout */ 10000);
            } catch (err) {
              // either timed out or something went wrong—optionally log it
              console.warn('Network-idle wait failed:', err.message);
            }
            results.push({ success: true, type, selector: cleanClickSelector });
            break;
            
          case 'type':
            const { selector: typeSelector, value } = action;
            let cleanTypeSelector = typeSelector;
            try {
                // Attempt to parse the selector string, which may be double-escaped
                cleanTypeSelector = JSON.parse(cleanTypeSelector);
            } catch (err) {
                // If parsing fails, log the error and fallback to the original string
                // console.error('Selector parsing failed:', err);
            }
            await page.waitForSelector(cleanTypeSelector, { timeout: 5000 });
            await page.type(cleanTypeSelector, value);
            results.push({ success: true, type, selector: cleanTypeSelector });
            break;
            
          case 'keys':
            const { keys } = action;
            await page.keyboard.type(keys);
            results.push({ success: true, type, keys });
            break;
            
          case 'press':
            const { key } = action;
            await page.keyboard.press(key);
            // now wait for “settle”
            try {
              await waitForNetworkIdle(page, /* idleTime */ 500, /* timeout */ 10000);
            } catch (err) {
              // either timed out or something went wrong—optionally log it
              console.warn('Network-idle wait failed:', err.message);
            }
            results.push({ success: true, type, key });
            break;
            
          case 'select':
            const { selector: selectSelector, value: selectValue } = action;
            let cleanSelectSelector = selectSelector;
            try {
                // Attempt to parse the selector string, which may be double-escaped
                cleanSelectSelector = JSON.parse(cleanSelectSelector);
            } catch (err) {
                // If parsing fails, log the error and fallback to the original string
                // console.error('Selector parsing failed:', err);
            }
            await page.waitForSelector(cleanSelectSelector, { timeout: 5000 });
            await page.select(cleanSelectSelector, selectValue);
            results.push({ success: true, type, selector: cleanSelectSelector });
            break;
            
          case 'wait':
            const { milliseconds } = action;
            await page.waitForTimeout(parseInt(milliseconds) || 1000);
            results.push({ success: true, type, milliseconds });
            break;
            
          case 'screenshot':
            const { selector: screenshotSelector } = action;
            if (screenshotSelector) {
                let cleanScreenshotSelector = screenshotSelector;
                try {
                    // Attempt to parse the selector string, which may be double-escaped
                    cleanScreenshotSelector = JSON.parse(cleanScreenshotSelector);
                } catch (err) {
                    // If parsing fails, log the error and fallback to the original string
                    // console.error('Selector parsing failed:', err);
                }
              await page.waitForSelector(cleanScreenshotSelector, { timeout: 5000 });
              const element = await page.$(cleanScreenshotSelector);
              screenshot = await element.screenshot({ encoding: 'base64' });
            } else {
              screenshot = await page.screenshot({ encoding: 'base64' });
            }
            results.push({ success: true, type });
            break;
            
          case 'close':
            // Only close the page, not the browser
            await page.close();
            activePages.delete(sessionId);
            results.push({ success: true, type });
            break;

          case 'execute-js':
            const { code } = action;
            const jsResult = await page.evaluate(code);
            results.push({ 
              success: true, 
              type, 
              result: jsResult 
            });
            break;

          case 'get-console-logs':
            // Enable console monitoring (add this to page creation)
            const consoleLogs = [];
            page.on('console', msg => {
              consoleLogs.push({
                type: msg.type(),
                text: msg.text(),
                timestamp: new Date().toISOString()
              });
            });
            results.push({ 
              success: true, 
              type, 
              logs: consoleLogs 
            });
            break;

          case 'get-network-requests':
            const networkRequests = [];
            page.on('request', request => {
              networkRequests.push({
                url: request.url(),
                method: request.method(),
                headers: request.headers(),
                timestamp: new Date().toISOString()
              });
            });
            page.on('response', response => {
              const request = networkRequests.find(req => req.url === response.url());
              if (request) {
                request.status = response.status();
                request.responseHeaders = response.headers();
                request.size = response.headers()['content-length'];
              }
            });
            results.push({ 
              success: true, 
              type, 
              requests: networkRequests 
            });
            break;

          case 'get-performance-metrics':
            const performanceMetrics = await page.evaluate(() => {
              const navigation = performance.getEntriesByType('navigation')[0];
              const paint = performance.getEntriesByType('paint');
              
              return {
                domContentLoaded: navigation.domContentLoadedEventEnd - navigation.domContentLoadedEventStart,
                loadComplete: navigation.loadEventEnd - navigation.loadEventStart,
                firstPaint: paint.find(p => p.name === 'first-paint')?.startTime,
                firstContentfulPaint: paint.find(p => p.name === 'first-contentful-paint')?.startTime,
                memoryUsage: performance.memory ? {
                  usedJSHeapSize: performance.memory.usedJSHeapSize,
                  totalJSHeapSize: performance.memory.totalJSHeapSize,
                  jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
                } : null
              };
            });
            results.push({ 
              success: true, 
              type, 
              metrics: performanceMetrics 
            });
            break;

          case 'get-element-info':
            const { selector: infoSelector } = action;
            let cleanInfoSelector = infoSelector;
            try {
              cleanInfoSelector = JSON.parse(cleanInfoSelector);
            } catch (err) {
              // console.error('Selector parsing failed:', err);
            }
            
            const elementInfo = await page.evaluate((sel) => {
              const element = document.querySelector(sel);
              if (!element) return null;
              
              const computedStyle = window.getComputedStyle(element);
              const rect = element.getBoundingClientRect();
              
              return {
                tagName: element.tagName,
                id: element.id,
                className: element.className,
                textContent: element.textContent?.substring(0, 500),
                attributes: Object.fromEntries(
                  Array.from(element.attributes).map(attr => [attr.name, attr.value])
                ),
                computedStyle: {
                  display: computedStyle.display,
                  position: computedStyle.position,
                  width: computedStyle.width,
                  height: computedStyle.height,
                  color: computedStyle.color,
                  backgroundColor: computedStyle.backgroundColor,
                  fontSize: computedStyle.fontSize,
                  fontFamily: computedStyle.fontFamily
                },
                boundingRect: {
                  x: rect.x,
                  y: rect.y,
                  width: rect.width,
                  height: rect.height
                },
                isVisible: element.offsetWidth > 0 && element.offsetHeight > 0
              };
            }, cleanInfoSelector);
            
            results.push({ 
              success: true, 
              type, 
              elementInfo 
            });
            break;

          case 'get-local-storage':
            const localStorage = await page.evaluate(() => {
              const storage = {};
              for (let i = 0; i < window.localStorage.length; i++) {
                const key = window.localStorage.key(i);
                storage[key] = window.localStorage.getItem(key);
              }
              return storage;
            });
            results.push({ 
              success: true, 
              type, 
              localStorage 
            });
            break;

          case 'set-local-storage':
            const { key: storageKey, value: storageValue } = action;
            await page.evaluate((key, value) => {
              window.localStorage.setItem(key, value);
            }, storageKey, storageValue);
            results.push({ 
              success: true, 
              type, 
              key: storageKey 
            });
            break;

          case 'get-cookies':
            const cookies = await page.cookies();
            results.push({ 
              success: true, 
              type, 
              cookies 
            });
            break;

          case 'lighthouse-audit':
            // Requires lighthouse package: npm install lighthouse
            const lighthouse = require('lighthouse');
            const chromeLauncher = require('chrome-launcher');
            
            const chrome = await chromeLauncher.launch({chromeFlags: ['--headless']});
            const options = {logLevel: 'info', output: 'json', port: chrome.port};
            const runnerResult = await lighthouse(page.url(), options);
            await chrome.kill();
            
            results.push({ 
              success: true, 
              type, 
              audit: {
                performance: runnerResult.lhr.categories.performance.score * 100,
                accessibility: runnerResult.lhr.categories.accessibility.score * 100,
                bestPractices: runnerResult.lhr.categories['best-practices'].score * 100,
                seo: runnerResult.lhr.categories.seo.score * 100
              }
            });
            break;

          case 'get-page-source':
            const pageSource = await page.content();
            results.push({ 
              success: true, 
              type, 
              source: pageSource 
            });
            break;

          case 'get-all-links':
            const links = await page.evaluate(() => {
              return Array.from(document.querySelectorAll('a[href]')).map(link => ({
                href: link.href,
                text: link.textContent.trim(),
                title: link.title,
                target: link.target
              }));
            });
            results.push({ 
              success: true, 
              type, 
              links 
            });
            break;

          case 'get-all-images':
            const images = await page.evaluate(() => {
              return Array.from(document.querySelectorAll('img')).map(img => ({
                src: img.src,
                alt: img.alt,
                width: img.width,
                height: img.height,
                naturalWidth: img.naturalWidth,
                naturalHeight: img.naturalHeight
              }));
            });
            results.push({ 
              success: true, 
              type, 
              images 
            });
            break;

          case 'check-accessibility':
            // Basic accessibility checks
            const a11yIssues = await page.evaluate(() => {
              const issues = [];
              
              // Check for missing alt text
              const imagesWithoutAlt = document.querySelectorAll('img:not([alt])');
              if (imagesWithoutAlt.length > 0) {
                issues.push(`${imagesWithoutAlt.length} images missing alt text`);
              }
              
              // Check for missing form labels
              const inputsWithoutLabels = document.querySelectorAll('input:not([aria-label]):not([aria-labelledby])');
              const unlabeledInputs = Array.from(inputsWithoutLabels).filter(input => {
                const label = document.querySelector(`label[for="${input.id}"]`);
                return !label && input.type !== 'submit' && input.type !== 'button';
              });
              if (unlabeledInputs.length > 0) {
                issues.push(`${unlabeledInputs.length} form inputs missing labels`);
              }
              
              // Check for missing heading structure
              const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
              if (headings.length === 0) {
                issues.push('No heading elements found');
              }
              
              return issues;
            });
            
            results.push({ 
              success: true, 
              type, 
              issues: a11yIssues 
            });
            break;
            
          default:
            results.push({ 
              success: false, 
              type, 
              error: 'Unsupported action type' 
            });
        }
      } catch (actionError) {
        results.push({ 
          success: false, 
          type, 
          error: actionError.message,
        });
      }
    }
    
    // Create response object
    const response = { 
      success: true,
      sessionId: sessionId || Date.now().toString(),
      actions: results
    };
    
    // If page wasn't closed, extract DOM and add to response
    if (activePages.has(sessionId)) {
      const page = activePages.get(sessionId);
      const url = page.url();
      response.url = url;
      // only call title() if page is still open
      if (!page.isClosed()) {
        try {
          response.title = await page.title();
        } catch (err) {
          // context was destroyed or navigation in-flight
          response.title = null;
        }
      }
      if (url.endsWith('.pdf') || url.startsWith('data:')) {
        response.elements = [];
      } else {
        // safe to scrape
        await page.waitForSelector('body', { timeout: 5000 });
        const pageUrl = page.url();
        const isLocal = isLocalUrl(pageUrl, localHostnames);

        const options = isLocal
          ? {
              maxDepth: 20,
              includeText: true,
              textMinLength: 1,
              maxElements: 300
            }
          : (elementOptions || {
              maxDepth: 3,
              includeText: true,
              textMinLength: 10,
              maxElements: 100
            });

        response.elements = await extractDOM(page, options);
      }
    }
    
    // Add screenshot to response if taken
    if (screenshot) {
        response.screenshot = `data:image/png;base64,${screenshot}`;
    }
    else {
        // if (results.some(r => r.success === false)) {
        //     // take a screenshot
        //     let screenshot = await page.screenshot({ encoding: 'base64' });
        //     response.screenshot = `data:image/png;base64,${screenshot}`;
        // }
    }
    
    // Return the response
    res.json(response);
    
  } catch (error) {
    console.error('Execution error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    timer.restartTimer();
  }
});

// Specialized endpoint for Google search operations
app.post('/google-search', async (req, res) => {
    let { sessionId, action, query, pageNum, resultUrl } = req.body;
    let page;
    
    if (!action) {
      return res.status(400).json({ error: 'Action is required' });
    }
  
    try {
      // Get or create a page session
      if (sessionId && activePages.has(sessionId)) {
        page = activePages.get(sessionId);
      } else {
        page = await browser.newPage();
        sessionId = Date.now().toString();
        activePages.set(sessionId, page);
        
        // Set viewport
        await page.setViewport({ width: 1280, height: 800 });
      }
      
      let result = {
        success: true,
        sessionId,
        action
      };
  
      switch (action) {
        case 'search':
            if (!query) {
                return res.status(400).json({ error: 'Query is required for search action' });
            }
            
            console.log(`Starting DuckDuckGo search for: "${query}"`);
            
            try {
                // Navigate to Google with proper error handling
                console.log('Navigating to DuckDuckGo...');
                await page.goto('https://www.duckduckgo.com', { 
                waitUntil: 'domcontentloaded',
                timeout: 30000 
                });
                console.log(`Page loaded: ${await page.title()}`);
                
                // Handle cookie consent dialog with better selector detection
                try {
                  console.log('Checking for cookie consent dialog...');
                  const cookieSelectors = [
                      'button[id="L2AGLb"]',          // Standard consent button
                      'button[aria-label="Accept all"]', // Alternative text-based selector
                      'form button:nth-child(1)'      // Generic form button as fallback
                  ];
                  
                  for (const selector of cookieSelectors) {
                      const cookieButton = await page.$(selector);
                      if (cookieButton) {
                        console.log(`Cookie dialog found, clicking "${selector}"...`);
                        await cookieButton.click();
                        break;
                      }
                  }
                } catch (e) {
                  console.log('No cookie dialog detected or error handling it:', e.message);
                }
                
                // Locate and interact with the search box with better error handling
                console.log('Locating search input...');
                const searchSelectors = [
                'input[placeholder*="Search"]',
                'textarea[title="Search"]',
                'input[title="Search"]',
                'input[name="q"]',
                'textarea[name="q"]',
                'input[id="searchbox_input"',
                'input[class*="Search"]',
                'input[aria-label*="Search"]',
                ];
                
                let searchInputFound = false;
                for (const selector of searchSelectors) {
                  try {
                      const searchInput = await page.waitForSelector(selector, { visible: true, timeout: 5000 });
                      if (searchInput) {
                        console.log(`Search input found with selector: ${selector}`);
                        await page.waitForSelector(selector, { visible: true, timeout: 5000 });
                        console.log(`Selector ready`);
                        await page.click(selector);
                        console.log(`Clicked search input`);
                        await page.type(selector, query, { delay: 50 }); // Slightly slower typing to mimic human
                        console.log(`Typed query into search input`);
                        searchInputFound = true;
                        break;
                      }
                  } catch (err) {
                      console.log(`Selector ${selector} not found, trying next...`);
                  }
                }
                
                if (!searchInputFound) {
                throw new Error('Could not locate search input element');
                }
                
                // Press Enter to search
                console.log('Submitting search query...');
                await page.keyboard.press('Enter');
                
                // Wait for results with improved detection
                console.log('Waiting for search results to load...');
                const resultSelectors = [
                    '[class*="results"]', // Class contains "results"
                    '[id*="results"]', // ID contains "results"
                ];
                let resultsFound = false;
                
                for (const selector of resultSelectors) {
                try {
                    await page.waitForSelector(selector, { timeout: 20000 });
                    console.log(`Search results found with selector: ${selector}`);
                    resultsFound = true;
                    break;
                } catch (err) {
                    console.log(`Selector ${selector} not found, trying next...`);
                }
                }
                
                if (!resultsFound) {
                    throw new Error('Could not detect search result elements. A CAPTCHA may be triggered.');
                }
                
                // Wait for results to load
                await page.waitForSelector('li:has(> article)', { timeout: 10000 });

                console.log(`Results page loaded: ${await page.title()}`);
                
                // Extract search results with improved selector targeting
                console.log('Extracting search results...');
                const searchResults = await page.evaluate(() => {
                    const results = [];
                    
                    // Try multiple possible result container selectors
                    const containers = Array.from(document.querySelectorAll('li:has(> article)'));
                    
                    if (containers.length === 0) {
                        console.error('No result containers found on page');
                        return [];
                    }
                    
                    containers.forEach(el => {
                        
                        const titleEl = el.querySelector('h2 a span');

                        const linkEl = el.querySelector('h2 a');
                        
                        const snippetEl = el.querySelector('div[data-result="snippet"');
                        
                        if (titleEl && linkEl) {
                        results.push({
                            title: titleEl.textContent.trim(),
                            url: linkEl.href,
                            snippet: snippetEl ? snippetEl.textContent.trim() : ''
                        });
                        }
                    });
                    
                    return results.filter(r => r.title && r.url); // Filter out any empty results
                });
                
                // Log results statistics
                console.log(`Extracted ${searchResults.length} search results`);
                
                // Check pagination
                const hasNextPage = await page.$('button[id="more-results]') !== null;
                const hasPreviousPage = await page.$('a#pnprev, [aria-label="Previous page"]') !== null;
                
                console.log(`Pagination: Next page: ${hasNextPage}, Previous page: ${hasPreviousPage}`);
                
                // Prepare result object
                result.results = searchResults;
                result.currentPage = 1;
                result.hasNextPage = hasNextPage;
                result.hasPreviousPage = hasPreviousPage;
                result.query = query;
                result.totalResults = searchResults.length;
                
            } catch (error) {
                console.error(`Duckduckgo search error: ${error.message}`);
                // Take screenshot on error for debugging
                // await page.screenshot({ path: `error-${Date.now()}.png` });
                result.error = `Search failed: ${error.message}`;
                result.results = [];
            }
            break;

        case 'moreResults':
            try {
                // get the current page number
                const lastDivider = await page.$x('//li/div[@aria-label]');
                const currentPageNumber = parseInt(lastDivider[lastDivider.length - 1].getAttribute('aria-label').match(/\d+/)[0]);
    
                // click the more results button
                const moreResults = await page.$('button[id="more-results"]');
                await moreResults.click();
    
                // wait for the divider
                await page.waitForXPath(`//li/div[@aria-label="Page ${currentPageNumber + 1}"]`);
    
                // get all the elements after the divider
                const newResults = await page.$$(`li:nth-child(n+${await page.$x('//li/div[@aria-label]').length + 1})`);
    
                result.results = newResults;
                result.currentPage = currentPageNumber + 1;
                result.hasNextPage = await page.$('button[id="more-results"]') !== null;
                result.hasPreviousPage = currentPageNumber > 1;
                result.totalResults = newResults.length;
            } catch (error) {
                console.error(`More results error: ${error.message}`);
                // Take screenshot on error for debugging
                // await page.screenshot({ path: `more-results-error-${Date.now()}.png` });
                result.error = `More results failed: ${error.message}`;
                result.results = [];
            }
        break;
          
        case 'nextPage':
        try {
          // Check if next page link exists
          const nextLink = await page.$('button[id="more-results]');
          if (!nextLink) {
            return res.status(400).json({ error: 'No next page available' });
          }
          
          // Click next page
          await nextLink.click();
          await page.waitForSelector('div#search', { timeout: 10000 });
          
          // Get the current page number from the table cell
          const currentPage = await page.evaluate(() => {
            const table = document.querySelector('table.AaVjTc');
            if (!table) return null;
            
            const activeTd = table.querySelector('td.YyVfkd');
            return activeTd ? parseInt(activeTd.textContent) : 1;
          }) || (pageNum ? pageNum + 1 : 2);
          
          // Extract search results
          const nextPageResults = await page.evaluate(() => {
            const results = [];
            const resultElements = document.querySelectorAll('div.g');
            
            resultElements.forEach(el => {
              const titleEl = el.querySelector('h3');
              const linkEl = el.querySelector('a');
              const snippetEl = el.querySelector('div[data-sncf="1"]');
              
              if (titleEl && linkEl) {
                results.push({
                  title: titleEl.textContent,
                  url: linkEl.href,
                  snippet: snippetEl ? snippetEl.textContent : ''
                });
              }
            });
            
            return results;
          });
          
          result.results = nextPageResults;
          result.currentPage = currentPage;
          result.hasNextPage = await page.$('a#pnnext') !== null;
          result.hasPreviousPage = await page.$('a#pnprev') !== null;

        } catch (error) {
            console.error(`Next page error: ${error.message}`);
            // Take screenshot on error for debugging
            // await page.screenshot({ path: `next-page-error-${Date.now()}.png` });
            result.error = `Next page failed: ${error.message}`;
            result.results = [];
        }
          break;
          
        case 'previousPage':
        try {
          // Check if previous page link exists
          const prevLink = await page.$('a#pnprev');
          if (!prevLink) {
            return res.status(400).json({ error: 'No previous page available' });
          }
          
          // Click previous page
          await prevLink.click();
          await page.waitForSelector('div#search', { timeout: 10000 });
          
          // Get the current page number
          const prevPageNum = await page.evaluate(() => {
            const table = document.querySelector('table.AaVjTc');
            if (!table) return null;
            
            const activeTd = table.querySelector('td.YyVfkd');
            return activeTd ? parseInt(activeTd.textContent) : 1;
          }) || (pageNum ? pageNum - 1 : 1);
          
          // Extract search results
          const prevPageResults = await page.evaluate(() => {
            const results = [];
            const resultElements = document.querySelectorAll('div.g');
            
            resultElements.forEach(el => {
              const titleEl = el.querySelector('h3');
              const linkEl = el.querySelector('a');
              const snippetEl = el.querySelector('div[data-sncf="1"]');
              
              if (titleEl && linkEl) {
                results.push({
                  title: titleEl.textContent,
                  url: linkEl.href,
                  snippet: snippetEl ? snippetEl.textContent : ''
                });
              }
            });
            
            return results;
          });
          
          result.results = prevPageResults;
          result.currentPage = prevPageNum;
          result.hasNextPage = await page.$('a#pnnext') !== null;
          result.hasPreviousPage = await page.$('a#pnprev') !== null;
        } catch (error) {
            console.error(`Previous page error: ${error.message}`);
            // Take screenshot on error for debugging
            // await page.screenshot({ path: `previous-page-error-${Date.now()}.png` });
            result.error = `Previous page failed: ${error.message}`;
            result.results = [];
        }
        break;
          
        case 'getPageContents':
            try {
            if (!resultUrl) {
                return res.status(400).json({ error: 'URL is required for getPageContents action' });
            }
            
            // Navigate to the result URL
            await page.goto(resultUrl, { waitUntil: 'domcontentloaded' });
            
            // Extract page title, URL and content
            result.title = await page.title();
            result.url = page.url();
            
            // Extract page text content
            // Get the HTML content from the page
            const html = await page.content();
            // Create a JSDOM instance using the current page URL for relative paths
            const dom = new JSDOM(html, { url: page.url() });

            // Parse the document with Readability
            const article = new Readability(dom.window.document).parse();
            // Get full content and truncate if needed
            const maxLength = 25000; // Maximum characters to return
            const fullContent = article ? article.textContent : '';
            result.content = fullContent.length > maxLength ? 
              fullContent.substring(0, maxLength) + '...' : 
              fullContent;
            
            // Add DOM elements
            result.elements = await extractDOM(page, {
                maxDepth: 3,
                includeText: true,
                textMinLength: 10,
                maxElements: 100
            });
            } catch (error) {
                console.error(`Get page error: ${error.message}`);
                // Take screenshot on error for debugging
                // await page.screenshot({ path: `get-page-error-${Date.now()}.png` });
                result.error = `Get page failed: ${error.message}`;
                result.results = [];
            }
        break;
        
        default:
          return res.status(400).json({ 
            error: 'Unsupported action. Use search, nextPage, previousPage, or getPageContents' 
          });
      }

      // if (result.error) {
      //   // take a screenshot
      //   let screenshot = await page.screenshot({ encoding: 'base64' });
      //   result.screenshot = `data:image/png;base64,${screenshot}`;
      // }
      
      res.status(200).json(result);
      
    } catch (error) {
        console.error('Google search error:', error);
        let screenshot;
        if (page) {
            // failed so add a screenshot
            screenshot = await page.screenshot({ encoding: 'base64' });
        }
        res.status(500).json({ error: error.message, screenshot: screenshot });
    } finally {
      timer.restartTimer();
    }
});

// Endpoint to get a screenshot of the current page
app.post('/screenshot', async (req, res) => {
  const { sessionId, selector } = req.body;
  
  if (!sessionId || !activePages.has(sessionId)) {
    return res.status(400).json({ error: 'Valid sessionId is required' });
  }

  try {
    const page = activePages.get(sessionId);
    
    // Take screenshot
    let screenshot;
    if (selector) {
      // Wait for selector and take screenshot of specific element
      await page.waitForSelector(selector, { timeout: 5000 });
      const element = await page.$(selector);
      screenshot = await element.screenshot({ encoding: 'base64' });
    } else {
      // Take screenshot of entire page
      screenshot = await page.screenshot({ encoding: 'base64' });
    }
    
    // Return the screenshot as base64
    res.json({ 
      success: true, 
      sessionId,
      screenshot: `data:image/png;base64,${screenshot}`
    });
    
  } catch (error) {
    console.error('Screenshot error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint to get active sessions
app.get('/sessions', (req, res) => {
  const sessions = Array.from(activePages.keys()).map(async (sessionId) => {
    const page = activePages.get(sessionId);
    return {
      sessionId,
      url: page.url(),
      title: await page.title()
    };
  });
  
  Promise.all(sessions).then(sessionData => {
    res.json({ success: true, sessions: sessionData });
  });
});

// Endpoint to close a specific session
app.delete('/sessions/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  
  if (activePages.has(sessionId)) {
    try {
      const page = activePages.get(sessionId);
      await page.close();
      activePages.delete(sessionId);
      res.json({ success: true, message: `Session ${sessionId} closed` });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  } else {
    res.status(404).json({ error: 'Session not found' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    browser: browser ? 'running' : 'not running',
    activeSessions: activePages.size
  });
});

// Clean up resources periodically
setInterval(async () => {
  if (activePages.size > 10) { // Clean up if too many pages
    console.log('Cleaning up old page sessions...');
    const sortedPages = Array.from(activePages.entries())
      .sort((a, b) => new Date(b[1].puppeteerData.createdAt) - new Date(a[1].puppeteerData.createdAt));
    
    // Keep only the 5 most recent pages
    const pagesToClose = sortedPages.slice(5);
    for (const [sessionId, page] of pagesToClose) {
      try {
        await page.close();
        activePages.delete(sessionId);
        console.log(`Closed session: ${sessionId}`);
      } catch (err) {
        console.error('Error closing page:', err);
      }
    }
  }
}, 5 * 60 * 1000); // Every 5 minutes

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down...');
  
  // Close all active pages
  for (const page of activePages.values()) {
    await page.close();
  }
  activePages.clear();
  
  // Close browser
  if (browser) {
    await browser.close();
  }
  process.exit(0);
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  timer.setStartTimeToNow();
});

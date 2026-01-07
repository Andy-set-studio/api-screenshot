import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

async function screenshot(url, options = {}) {
  let { 
    format = "jpeg", 
    viewport = [375, 375], 
    dpr = 1, 
    withJs = true, 
    wait, 
    timeout = 10000 
  } = options;

  // Must be between 500 and 13000
  timeout = Math.min(Math.max(timeout, 500), 13000);

  let puppeteerOptions = {
    defaultViewport: {
      width: viewport[0],
      height: viewport[1],
      deviceScaleFactor: parseFloat(dpr),
    },
    ignoreHTTPSErrors: true,
  };

  let puppeteerWrapper;

  if (process?.env?.LOCAL_DEV) {
    // Local development uses standard puppeteer
    puppeteerWrapper = await import("puppeteer");
  } else {
    // Vercel / Production environment
    puppeteerWrapper = puppeteer;

    // These settings are critical for Node 20 / AL2023 compatibility
    puppeteerOptions.executablePath = await chromium.executablePath();
    puppeteerOptions.args = [
      ...chromium.args,
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-zygote",
      "--single-process", // This is vital for serverless shared libraries
    ];
    puppeteerOptions.headless = chromium.headless;
  }

  let browser = null;

  try {
    // Fix for ETXTBSY: Retry once if the binary is 'busy'
    try {
      browser = await puppeteerWrapper.launch(puppeteerOptions);
    } catch (launchError) {
      if (launchError.message.includes("ETXTBSY")) {
        console.warn("Chromium binary busy, retrying launch...");
        await new Promise((resolve) => setTimeout(resolve, 200));
        browser = await puppeteerWrapper.launch(puppeteerOptions);
      } else {
        throw launchError;
      }
    }

    const page = await browser.newPage();

    if (!withJs) {
      await page.setJavaScriptEnabled(false);
    }

    // Race the page load against our own timeout
    const pagePromise = page.goto(url, {
      waitUntil: wait || ["load"],
      timeout,
    });

    const timeoutPromise = new Promise((resolve) =>
      setTimeout(() => resolve("timeout"), timeout)
    );

    const result = await Promise.race([pagePromise, timeoutPromise]);

    if (result === "timeout") {
      await page.evaluate(() => window.stop());
    }

    let screenshotOptions = {
      type: format,
      encoding: "binary",
      fullPage: false,
      captureBeyondViewport: false,
      clip: {
        x: 0,
        y: 0,
        width: viewport[0],
        height: viewport[1],
      },
    };

    if (format === "jpeg") {
      screenshotOptions.quality = 80;
    }

    const output = await page.screenshot(screenshotOptions);
    return output;

  } catch (error) {
    // Log the actual error to Vercel console
    console.error("Screenshot Engine Error:", error.message);
    throw error; // Re-throw so the handler can catch it
  } finally {
    if (browser !== null) {
      await browser.close();
    }
  }
}

export default screenshot;

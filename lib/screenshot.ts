import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export async function screenshotToDataUri(url: string, {
  width = 1200,
  height = 900,
  timeoutMs = 20000,
} = {}): Promise<string | undefined> {
  const executablePath = await chromium.executablePath();
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width, height },
    executablePath,
    headless: chromium.headless,
  });

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(timeoutMs);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const buf = await page.screenshot({ type: 'jpeg', quality: 80 }) as Buffer;
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } finally {
    await browser.close();
  }
}

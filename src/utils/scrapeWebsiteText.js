import { chromium } from "playwright";
import { cleanText } from "./cleanText.js";

export const scrapeWebsiteText = async (url) => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(url, {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    const text = await page.evaluate(() => {
      return document.body.innerText;
    });

    return cleanText(text);
  } finally {
    await browser.close();
  }
};

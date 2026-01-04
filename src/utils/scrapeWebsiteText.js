import { chromium } from "playwright";
import { cleanText } from "./cleanText.js";

export const scrapeWebsiteText = async (url) => {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--single-process",
    ],
  });

  const page = await browser.newPage();

  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded", // safer than networkidle
      timeout: 60000,
    });

    const text = await page.evaluate(() => {
      return document.body.innerText;
    });

    return cleanText(text);
  } finally {
    await browser.close();
  }
};

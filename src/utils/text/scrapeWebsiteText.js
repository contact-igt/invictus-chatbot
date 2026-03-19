import axios from "axios";
import * as cheerio from "cheerio";

/**
 * Scrapes website text by fetching raw content and preparing it for AI extraction.
 * Removed Jina Reader as requested.
 */
export const scrapeWebsiteText = async (url) => {
  if (!url || !url.startsWith("http")) {
    throw new Error("Invalid URL");
  }

  const trimmedUrl = url.trim();
  let rawHtml = "";
  let title = "";
  let description = "";

  // STAGE 1: Stealth Fetching of Raw HTML
  try {
    const response = await axios.get(trimmedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Referer": "https://www.google.com/",
        "DNT": "1",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1"
      },
      timeout: 15000,
      validateStatus: () => true
    });

    if (response.status === 200 && response.data) {
      rawHtml = response.data;
    } else {
      throw new Error(`Website returned status ${response.status}`);
    }
  } catch (error) {
    console.error("Scraping fetch error:", error.message);
    throw new Error(`Failed to fetch website: ${error.message}`);
  }

  const $ = cheerio.load(rawHtml);
  
  // Extract Metadata
  title = $('meta[property="og:title"]').attr("content") || $("title").text() || "";
  description = $('meta[property="og:description"]').attr("content") || $('meta[name="description"]').attr("content") || "";

  // Remove totally useless tags to save tokens
  $("style, iframe, link, noscript, svg").remove();

  // STAGE 2: "AI-Ready" Content Preparation
  // We try to get readable text first
  let content = "";
  const targetSelectors = ["article", "main", "section", "#content", ".content", ".post-body", ".entry-content"];
  
  for (const selector of targetSelectors) {
    const text = $(selector).first().text().replace(/\s+/g, " ").trim();
    if (text.length > 300) {
      content = text;
      break;
    }
  }

  // If standard extraction is empty (likely an SPA), return the RAW BODY for AI processing
  // Limit to ~25k characters to keep token count reasonable
  if (!content || content.length < 300) {
    // Keep script tags if they look like they contain JSON data (__NEXT_DATA__ etc)
    const bodyHtml = $("body").html();
    content = bodyHtml ? bodyHtml.substring(0, 25000) : "No body content found.";
  }

  if (!content || content.length < 50) {
    throw new Error("No readable content or raw code found on this website.");
  }

  return { 
    title: title || "Website Content", 
    description, 
    content 
  };
};

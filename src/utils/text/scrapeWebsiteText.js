import axios from "axios";
import * as cheerio from "cheerio";

export const scrapeWebsiteText = async (url) => {
  if (!url || !url.startsWith("http")) {
    throw new Error("Invalid URL");
  }

  const response = await axios.get(url.trim(), {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0",
      Accept: "text/html"
    },
    timeout: 30000,
    validateStatus: () => true
  });

  if (response.status !== 200 || !response.data) {
    throw new Error("Website not accessible");
  }

  const $ = cheerio.load(response.data);

  $("script, style, noscript, iframe").remove();

  const title =
    $('meta[property="og:title"]').attr("content") ||
    $("title").text() ||
    "";

  const description =
    $('meta[property="og:description"]').attr("content") ||
    $('meta[name="description"]').attr("content") ||
    "";

  let content = "";

  if ($("article").length) {
    content = $("article").text();
  } else if ($("main").length) {
    content = $("main").text();
  } else if ($("section").length) {
    content = $("section").text();
  } else {
    content = $("body").text();
  }

  content = content.replace(/\s+/g, " ").trim();

  return { title, description, content };
};

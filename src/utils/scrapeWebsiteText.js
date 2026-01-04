import axios from "axios";
import * as cheerio from "cheerio";

export const scrapeWebsiteText = async (url) => {
  const { data } = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
    },
    timeout: 30000,
  });

  const $ = cheerio.load(data);

  // 1️⃣ OpenGraph data (best for image + summary)
  const og = {
    title: $('meta[property="og:title"]').attr("content") || $("title").text(),
    description:
      $('meta[property="og:description"]').attr("content") ||
      $('meta[name="description"]').attr("content") ||
      "",
    image: $('meta[property="og:image"]').attr("content") || "",
  };

  // 2️⃣ Full page text
  const text = $("body").text().replace(/\s+/g, " ").trim();

  // 3️⃣ Images
  const images = [];
  $("img").each((_, img) => {
    const src = $(img).attr("src");
    if (src && !src.startsWith("data:")) {
      images.push(src.startsWith("http") ? src : new URL(src, url).href);
    }
  });

  return {
    title: og.title,
    description: og.description,
    mainImage: og.image,
    text,
    images,
  };
};

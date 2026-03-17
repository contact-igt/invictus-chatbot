import fs from "fs";
import path from "path";
import handlebars from "handlebars";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Optional: Simple in-memory cache for compiled templates
const cache = new Map();

/**
 * Loads and compiles a Handlebars template from the public/html directory.
 * 
 * @param {string} folderName - The folder name within public/html/
 * @param {boolean} useCache - Whether to use the in-memory cache (default: true)
 * @returns {Function} Compiled Handlebars template
 */
export const getTemplate = (folderName, useCache = true) => {
  if (useCache && cache.has(folderName)) {
    return cache.get(folderName);
  }

  try {
    const templatePath = path.join(
      __dirname,
      `../../../public/html/${folderName}/index.html`
    );

    if (!fs.existsSync(templatePath)) {
      throw new Error(`Template not found at ${templatePath}`);
    }

    const source = fs.readFileSync(templatePath, "utf8");
    const template = handlebars.compile(source);

    if (useCache) {
      cache.set(folderName, template);
    }

    return template;
  } catch (err) {
    console.error(`[TEMPLATE-LOADER] Error loading template "${folderName}":`, err.message);
    throw err;
  }
};

/**
 * Renders a template with provided data.
 * 
 * @param {string} folderName - The folder name within public/html/
 * @param {Object} data - The data to inject into the template
 * @returns {string} Rendered HTML
 */
export const renderTemplate = (folderName, data) => {
  const template = getTemplate(folderName);
  return template(data);
};

/**
 * In-process cache for WhatsApp template components.
 *
 * Prevents repeated DB round-trips for the same template across campaign
 * batches. For a 10 k-recipient campaign split into 200 dispatch pages, this
 * eliminates ~200 identical SQL queries per template.
 *
 * Cache is invalidated per entry after 1 hour (templates rarely change once
 * approved by Meta). Bounded to MAX_ENTRIES to prevent unbounded growth.
 */
import db from "../database/index.js";
import { tableNames } from "../database/tableName.js";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_ENTRIES = 500;

// Map<template_id, { data: { components, carouselData }, fetchedAt: number }>
const cache = new Map();

/**
 * Returns template components from cache, or fetches from DB and caches them.
 *
 * @param {string} template_id
 * @returns {{ components: object[], carouselData: object[] }}
 */
export const getTemplateComponents = async (template_id) => {
  const entry = cache.get(template_id);
  if (entry && Date.now() - entry.fetchedAt < CACHE_TTL_MS) {
    return entry.data;
  }

  const [[components], [carouselData]] = await Promise.all([
    db.sequelize.query(
      `SELECT component_type, text_content, header_format
       FROM ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS}
       WHERE template_id = ?
         AND component_type IN ('body', 'header', 'footer', 'buttons')`,
      { replacements: [template_id] },
    ),
    db.sequelize.query(
      `SELECT * FROM ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS}
       WHERE template_id = ? AND component_type = 'carousel'`,
      { replacements: [template_id] },
    ),
  ]);

  const data = { components, carouselData };

  // Evict oldest entry when the cache is full (simple FIFO)
  if (cache.size >= MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }

  cache.set(template_id, { data, fetchedAt: Date.now() });
  return data;
};

/**
 * Invalidates one template's cache entry, or clears the entire cache when
 * called without arguments (e.g., after a template is updated).
 *
 * @param {string} [template_id]
 */
export const invalidateTemplateCache = (template_id) => {
  if (template_id) {
    cache.delete(template_id);
  } else {
    cache.clear();
  }
};

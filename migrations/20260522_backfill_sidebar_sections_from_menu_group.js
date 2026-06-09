/**
 * Migration: backfill sidebar sections from navigation_items.menu_group
 *
 * Run manually (from Backend/):
 *   node migrations/20260522_backfill_sidebar_sections_from_menu_group.js
 *   node migrations/20260522_backfill_sidebar_sections_from_menu_group.js down
 */

import db from "../src/database/index.js";
import { tableNames } from "../src/database/tableName.js";

const MIGRATION_NAME = "20260522_backfill_sidebar_sections_from_menu_group";
const BACKFILL_SOURCE = "backfilled_from_menu_group";

const normalizeSectionKey = (value) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");

  const fallback = normalized || "section";
  return fallback.slice(0, 120);
};

const buildUniqueSectionIdentity = ({
  baseKey,
  existingSectionKeys,
  existingSectionIds,
}) => {
  let candidateKey = baseKey;
  let suffix = 2;

  while (existingSectionKeys.has(candidateKey)) {
    candidateKey = `${baseKey}_${suffix++}`;
  }

  let candidateSectionId = `sec_${candidateKey}`.slice(0, 255);
  suffix = 2;

  while (existingSectionIds.has(candidateSectionId)) {
    candidateSectionId = `sec_${candidateKey}_${suffix++}`.slice(0, 255);
  }

  return { sectionKey: candidateKey, sidebarSectionId: candidateSectionId };
};

const getExistingSections = async (transaction) => {
  return db.sequelize.query(
    `
      SELECT
        sidebar_section_id,
        section_key,
        title,
        sort_order,
        metadata
      FROM ${tableNames.SIDEBAR_SECTIONS}
    `,
    {
      type: db.Sequelize.QueryTypes.SELECT,
      transaction,
    },
  );
};

const up = async () => {
  await db.sequelize.transaction(async (transaction) => {
    const groupedMenuRows = await db.sequelize.query(
      `
        SELECT
          TRIM(menu_group) AS menu_group,
          MIN(sort_order) AS min_sort_order,
          MIN(id) AS min_nav_id
        FROM ${tableNames.NAVIGATION_ITEMS}
        WHERE menu_group IS NOT NULL
          AND TRIM(menu_group) <> ''
        GROUP BY TRIM(menu_group)
        ORDER BY MIN(sort_order) ASC, MIN(id) ASC
      `,
      {
        type: db.Sequelize.QueryTypes.SELECT,
        transaction,
      },
    );

    const existingSections = await getExistingSections(transaction);
    const sectionByTitle = new Map();
    const existingSectionKeys = new Set();
    const existingSectionIds = new Set();

    for (const section of existingSections) {
      const titleKey = String(section.title || "").trim();
      if (titleKey && !sectionByTitle.has(titleKey)) {
        sectionByTitle.set(titleKey, section);
      }
      existingSectionKeys.add(section.section_key);
      existingSectionIds.add(section.sidebar_section_id);
    }

    for (const row of groupedMenuRows) {
      const menuGroupTitle = String(row.menu_group || "").trim();
      if (!menuGroupTitle) continue;

      let section = sectionByTitle.get(menuGroupTitle);

      if (!section) {
        const baseKey = normalizeSectionKey(menuGroupTitle);
        const { sectionKey, sidebarSectionId } = buildUniqueSectionIdentity({
          baseKey,
          existingSectionKeys,
          existingSectionIds,
        });

        const desiredSortOrder = Number(row.min_sort_order ?? 0);

        await db.sequelize.query(
          `
            INSERT INTO ${tableNames.SIDEBAR_SECTIONS}
              (
                sidebar_section_id,
                section_key,
                title,
                description,
                assignment_mode,
                is_visible,
                is_active,
                is_system_core,
                sort_order,
                metadata
              )
            VALUES
              (
                :sidebarSectionId,
                :sectionKey,
                :title,
                NULL,
                'global',
                1,
                1,
                0,
                :sortOrder,
                JSON_OBJECT(
                  'source', :source,
                  'migration', :migration,
                  'menu_group', :title
                )
              )
          `,
          {
            replacements: {
              sidebarSectionId,
              sectionKey,
              title: menuGroupTitle,
              sortOrder: Number.isNaN(desiredSortOrder) ? 0 : desiredSortOrder,
              source: BACKFILL_SOURCE,
              migration: MIGRATION_NAME,
            },
            transaction,
          },
        );

        section = {
          sidebar_section_id: sidebarSectionId,
          section_key: sectionKey,
          title: menuGroupTitle,
          sort_order: Number.isNaN(desiredSortOrder) ? 0 : desiredSortOrder,
        };
        sectionByTitle.set(menuGroupTitle, section);
        existingSectionKeys.add(sectionKey);
        existingSectionIds.add(sidebarSectionId);
      }

      await db.sequelize.query(
        `
          UPDATE ${tableNames.NAVIGATION_ITEMS}
          SET sidebar_section_id = :sidebarSectionId
          WHERE sidebar_section_id IS NULL
            AND TRIM(menu_group) = :menuGroupTitle
        `,
        {
          replacements: {
            sidebarSectionId: section.sidebar_section_id,
            menuGroupTitle,
          },
          transaction,
        },
      );
    }

    const orphanVisibleRows = await db.sequelize.query(
      `
        SELECT COUNT(1) AS total
        FROM ${tableNames.NAVIGATION_ITEMS}
        WHERE is_visible = 1
          AND is_active = 1
          AND sidebar_section_id IS NULL
          AND (menu_group IS NULL OR TRIM(menu_group) = '')
      `,
      {
        type: db.Sequelize.QueryTypes.SELECT,
        transaction,
      },
    );

    const orphanCount = Number(orphanVisibleRows?.[0]?.total || 0);
    if (orphanCount > 0) {
      let othersSection = sectionByTitle.get("Others");

      if (!othersSection) {
        const existingByKeyOrId = await db.sequelize.query(
          `
            SELECT sidebar_section_id, section_key, title
            FROM ${tableNames.SIDEBAR_SECTIONS}
            WHERE section_key = 'others'
               OR sidebar_section_id = 'sec_others'
            ORDER BY id ASC
            LIMIT 1
          `,
          {
            type: db.Sequelize.QueryTypes.SELECT,
            transaction,
          },
        );

        if (existingByKeyOrId.length > 0) {
          othersSection = existingByKeyOrId[0];
        }
      }

      if (!othersSection) {
        const maxSortOrderRows = await db.sequelize.query(
          `
            SELECT COALESCE(MAX(sort_order), -1) AS max_sort_order
            FROM ${tableNames.SIDEBAR_SECTIONS}
          `,
          {
            type: db.Sequelize.QueryTypes.SELECT,
            transaction,
          },
        );

        const maxSortOrder = Number(maxSortOrderRows?.[0]?.max_sort_order ?? -1);
        const desiredSortOrder = Number.isNaN(maxSortOrder) ? 0 : maxSortOrder + 1;

        let sectionKey = "others";
        let sidebarSectionId = "sec_others";
        if (existingSectionKeys.has(sectionKey) || existingSectionIds.has(sidebarSectionId)) {
          const uniqueIdentity = buildUniqueSectionIdentity({
            baseKey: sectionKey,
            existingSectionKeys,
            existingSectionIds,
          });
          sectionKey = uniqueIdentity.sectionKey;
          sidebarSectionId = uniqueIdentity.sidebarSectionId;
        }

        await db.sequelize.query(
          `
            INSERT INTO ${tableNames.SIDEBAR_SECTIONS}
              (
                sidebar_section_id,
                section_key,
                title,
                description,
                assignment_mode,
                is_visible,
                is_active,
                is_system_core,
                sort_order,
                metadata
              )
            VALUES
              (
                :sidebarSectionId,
                :sectionKey,
                'Others',
                NULL,
                'global',
                1,
                1,
                0,
                :sortOrder,
                JSON_OBJECT(
                  'source', :source,
                  'migration', :migration,
                  'fallback', 'others'
                )
              )
          `,
          {
            replacements: {
              sidebarSectionId,
              sectionKey,
              sortOrder: desiredSortOrder,
              source: BACKFILL_SOURCE,
              migration: MIGRATION_NAME,
            },
            transaction,
          },
        );

        othersSection = {
          sidebar_section_id: sidebarSectionId,
          section_key: sectionKey,
          title: "Others",
        };
        sectionByTitle.set("Others", othersSection);
        existingSectionKeys.add(sectionKey);
        existingSectionIds.add(sidebarSectionId);
      }

      await db.sequelize.query(
        `
          UPDATE ${tableNames.NAVIGATION_ITEMS}
          SET sidebar_section_id = :sidebarSectionId
          WHERE sidebar_section_id IS NULL
            AND is_visible = 1
            AND is_active = 1
            AND (menu_group IS NULL OR TRIM(menu_group) = '')
        `,
        {
          replacements: {
            sidebarSectionId: othersSection.sidebar_section_id,
          },
          transaction,
        },
      );
    }
  });
};

const down = async () => {
  await db.sequelize.transaction(async (transaction) => {
    const sections = await db.sequelize.query(
      `
        SELECT sidebar_section_id
        FROM ${tableNames.SIDEBAR_SECTIONS}
        WHERE JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.source')) = :source
          AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.migration')) = :migration
      `,
      {
        replacements: {
          source: BACKFILL_SOURCE,
          migration: MIGRATION_NAME,
        },
        type: db.Sequelize.QueryTypes.SELECT,
        transaction,
      },
    );

    if (sections.length === 0) return;

    const sectionIds = sections.map((row) => row.sidebar_section_id).filter(Boolean);
    if (sectionIds.length === 0) return;

    await db.sequelize.query(
      `
        UPDATE ${tableNames.NAVIGATION_ITEMS}
        SET sidebar_section_id = NULL
        WHERE sidebar_section_id IN (:sectionIds)
      `,
      {
        replacements: { sectionIds },
        transaction,
      },
    );

    await db.sequelize.query(
      `
        DELETE FROM ${tableNames.SIDEBAR_SECTIONS}
        WHERE sidebar_section_id IN (:sectionIds)
      `,
      {
        replacements: { sectionIds },
        transaction,
      },
    );
  });
};

const run = async () => {
  const direction = process.argv[2] === "down" ? "down" : "up";
  
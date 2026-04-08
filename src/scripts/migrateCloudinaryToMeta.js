/**
 * Cloudinary to Meta Migration Script
 * Migrates existing Cloudinary media to Meta's Resumable Upload API
 * 
 * Run: node src/scripts/migrateCloudinaryToMeta.js [--dry-run]
 */

import db from "../database/index.js";
import axios from "axios";
import { uploadMediaToMeta } from "../services/mediaUploadService.js";
import { getFileTypeFromMimeType } from "../utils/mediaValidation.js";

const DRY_RUN = process.argv.includes("--dry-run");

const stats = {
  total: 0,
  success: 0,
  failed: 0,
  skipped: 0,
  errors: [],
};

/**
 * Download file from Cloudinary URL
 */
const downloadFromCloudinary = async (url) => {
  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 30000,
    });

    return {
      buffer: Buffer.from(response.data),
      contentType: response.headers["content-type"],
    };
  } catch (error) {
    throw new Error(`Failed to download from Cloudinary: ${error.message}`);
  }
};

/**
 * Extract Cloudinary URL from template
 * This function should be customized based on how Cloudinary URLs are stored
 */
const extractCloudinaryUrl = (template) => {
  // Check various possible fields where Cloudinary URL might be stored
  // Customize this based on your actual data structure
  
  if (template.header_media_url) {
    return template.header_media_url;
  }
  
  if (template.media_url) {
    return template.media_url;
  }
  
  // Check in template components if stored as JSON
  if (template.components) {
    try {
      const components = typeof template.components === "string" 
        ? JSON.parse(template.components) 
        : template.components;
      
      for (const component of components) {
        if (component.type === "HEADER" && component.example?.header_url) {
          return component.example.header_url[0];
        }
      }
    } catch (error) {
      console.error("Error parsing components:", error);
    }
  }
  
  return null;
};

/**
 * Check if URL is a Cloudinary URL
 */
const isCloudinaryUrl = (url) => {
  if (!url) return false;
  return url.includes("cloudinary.com") || url.includes("res.cloudinary.com");
};

/**
 * Migrate a single template's media
 */
const migrateTemplate = async (template, whatsappAccount) => {
  const cloudinaryUrl = extractCloudinaryUrl(template);
  
  if (!cloudinaryUrl) {
    console.log(`  ⏭  Template ${template.template_name}: No Cloudinary URL found`);
    stats.skipped++;
    return;
  }
  
  if (!isCloudinaryUrl(cloudinaryUrl)) {
    console.log(`  ⏭  Template ${template.template_name}: URL is not from Cloudinary`);
    stats.skipped++;
    return;
  }
  
  console.log(`  📥 Downloading from Cloudinary: ${template.template_name}`);
  
  try {
    // Download file from Cloudinary
    const { buffer, contentType } = await downloadFromCloudinary(cloudinaryUrl);
    
    // Determine file type
    const fileType = getFileTypeFromMimeType(contentType);
    if (!fileType) {
      throw new Error(`Unsupported content type: ${contentType}`);
    }
    
    // Extract filename from URL or use template name
    const urlParts = cloudinaryUrl.split("/");
    const fileName = urlParts[urlParts.length - 1] || `${template.template_name}.${fileType}`;
    
    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would upload ${fileName} (${buffer.length} bytes) to Meta`);
      stats.success++;
      return;
    }
    
    // Upload to Meta
    console.log(`  📤 Uploading to Meta: ${fileName}`);
    const mediaHandle = await uploadMediaToMeta(
      buffer,
      contentType,
      whatsappAccount.access_token,
      process.env.META_APP_ID,
    );
    
    // Create MediaAsset record
    const mediaAsset = await db.MediaAsset.create({
      tenant_id: template.tenant_id,
      file_name: fileName,
      file_type: fileType,
      mime_type: contentType,
      file_size: buffer.length,
      media_handle: mediaHandle,
      tags: ["migrated-from-cloudinary"],
      folder: "migrated",
      is_approved: template.status === "approved",
      templates_used: [template.template_id],
      campaigns_used: [],
      uploaded_by: template.created_by,
    });
    
    // Update template record
    await db.WhatsappTemplate.update(
      {
        media_asset_id: mediaAsset.id,
        media_handle: mediaHandle,
      },
      {
        where: { id: template.id },
      },
    );
    
    console.log(`  ✅ Successfully migrated: ${template.template_name}`);
    stats.success++;
    
  } catch (error) {
    console.error(`  ❌ Failed to migrate ${template.template_name}:`, error.message);
    stats.failed++;
    stats.errors.push({
      template_id: template.template_id,
      template_name: template.template_name,
      error: error.message,
      cloudinary_url: cloudinaryUrl,
    });
  }
};

/**
 * Main migration function
 */
const runMigration = async () => {
  console.log("🚀 Starting Cloudinary to Meta migration...\n");
  
  if (DRY_RUN) {
    console.log("⚠️  DRY RUN MODE - No changes will be made\n");
  }
  
  try {
    // Connect to database
    await db.sequelize.authenticate();
    console.log("✅ Database connected\n");
    
    // Get all templates (customize the query based on your needs)
    const templates = await db.WhatsappTemplate.findAll({
      where: {
        // Add conditions to find templates with Cloudinary media
        // For example, you might want to only migrate templates without media_handle
        media_handle: null,
      },
      order: [["created_at", "ASC"]],
    });
    
    stats.total = templates.length;
    console.log(`📊 Found ${stats.total} templates to process\n`);
    
    if (stats.total === 0) {
      console.log("✅ No templates to migrate");
      process.exit(0);
    }
    
    // Group templates by tenant to get WhatsApp accounts
    const templatesByTenant = {};
    for (const template of templates) {
      if (!templatesByTenant[template.tenant_id]) {
        templatesByTenant[template.tenant_id] = [];
      }
      templatesByTenant[template.tenant_id].push(template);
    }
    
    // Process each tenant's templates
    for (const [tenantId, tenantTemplates] of Object.entries(templatesByTenant)) {
      console.log(`\n📦 Processing tenant: ${tenantId} (${tenantTemplates.length} templates)`);
      
      // Get WhatsApp account for this tenant
      const whatsappAccount = await db.WhatsappAccount.findOne({
        where: {
          tenant_id: tenantId,
          status: "active",
        },
      });
      
      if (!whatsappAccount) {
        console.log(`  ⚠️  No active WhatsApp account found for tenant ${tenantId}, skipping...`);
        stats.skipped += tenantTemplates.length;
        continue;
      }
      
      // Migrate each template
      for (const template of tenantTemplates) {
        await migrateTemplate(template, whatsappAccount);
      }
    }
    
    // Print summary
    console.log("\n" + "=".repeat(60));
    console.log("📊 Migration Summary");
    console.log("=".repeat(60));
    console.log(`Total templates processed: ${stats.total}`);
    console.log(`✅ Successfully migrated: ${stats.success}`);
    console.log(`⏭  Skipped: ${stats.skipped}`);
    console.log(`❌ Failed: ${stats.failed}`);
    
    if (stats.errors.length > 0) {
      console.log("\n❌ Errors:");
      stats.errors.forEach((error, index) => {
        console.log(`\n${index + 1}. Template: ${error.template_name} (${error.template_id})`);
        console.log(`   URL: ${error.cloudinary_url}`);
        console.log(`   Error: ${error.error}`);
      });
    }
    
    console.log("\n✅ Migration complete!");
    
    if (DRY_RUN) {
      console.log("\n⚠️  This was a DRY RUN - no changes were made");
      console.log("Run without --dry-run flag to perform actual migration");
    }
    
    process.exit(0);
    
  } catch (error) {
    console.error("\n❌ Migration failed:", error);
    process.exit(1);
  }
};

// Run migration
runMigration();

# Media Gallery Setup Guide

This guide will help you set up and use the Media Gallery feature for your WhatsApp Campaign Manager.

## Overview

The Media Gallery feature provides centralized media asset management using Meta's Resumable Upload API. It replaces Cloudinary with permanent media handles that can be reused across WhatsApp templates and campaigns.

## Prerequisites

1. Node.js and npm installed
2. PostgreSQL database running
3. Meta App ID configured
4. Active WhatsApp Business Account with access token

## Environment Variables

Add these to your `.env` file:

```env
META_APP_ID=your_meta_app_id_here
# Existing variables (already configured):
# WHATSAPP_ACCESS_TOKEN=...
# WHATSAPP_PHONE_NUMBER_ID=...
# WABA_ID=...
```

## Step 1: Run Database Migrations

Run the migrations in order to create the necessary database tables:

```bash
# 1. Create media_assets table
node migrations/20260406_create_media_assets_table.js

# 2. Add media fields to whatsapp_templates table
node migrations/20260406_alter_whatsapp_templates_add_media_fields.js

# 3. Add media fields to whatsapp_campaigns table
node migrations/20260406_alter_whatsapp_campaigns_add_media_fields.js
```

Expected output for each migration:
```
🔌 Connecting to database...
✅ Connected

📦 Creating/Migrating table: [table_name]

  ✅ Created table/Added column: [details]

✅ Migration complete
```

## Step 2: Verify Database Schema

Connect to your PostgreSQL database and verify the tables:

```sql
-- Check media_assets table
\d media_assets

-- Check whatsapp_templates table for new columns
\d whatsapp_templates

-- Check whatsapp_campaigns table for new columns
\d whatsapp_campaigns
```

You should see:
- `media_assets` table with all fields (id, tenant_id, file_name, file_type, mime_type, file_size, media_handle, tags, folder, is_approved, templates_used, campaigns_used, uploaded_by, created_at, updated_at)
- `media_asset_id` and `media_handle` columns in `whatsapp_templates`
- `media_asset_id` and `media_handle` columns in `whatsapp_campaigns`

## Step 3: Start the Backend Server

```bash
cd whatnexus-backend
npm start
```

The Gallery API routes will be available at:
- `POST /api/whatsapp/gallery/upload` - Upload media
- `GET /api/whatsapp/gallery` - List media assets
- `GET /api/whatsapp/gallery/:asset_id` - Get single asset
- `DELETE /api/whatsapp/gallery/:asset_id` - Delete asset
- `PATCH /api/whatsapp/gallery/:asset_id/tags` - Update tags

## Step 4: Test the Gallery API

Use Postman or curl to test the endpoints:

### Upload Media

```bash
curl -X POST http://localhost:8000/api/whatsapp/gallery/upload \
  -F "file=@/path/to/image.jpg" \
  -F "tenant_id=your_tenant_id" \
  -F "tags=[\"test\",\"sample\"]" \
  -F "folder=root"
```

Expected response:
```json
{
  "success": true,
  "message": "Media uploaded successfully",
  "data": {
    "asset_id": "uuid",
    "media_handle": "4::AbCDEFGH...",
    "file_name": "image.jpg",
    "file_type": "image",
    "file_size": 123456,
    "mime_type": "image/jpeg",
    "tags": ["test", "sample"],
    "folder": "root",
    "is_approved": false,
    "created_at": "2026-04-06T..."
  }
}
```

### List Media Assets

```bash
curl "http://localhost:8000/api/whatsapp/gallery?tenant_id=your_tenant_id&type=image&page=1&limit=20"
```

## Step 5: Migrate Existing Cloudinary Media (Optional)

If you have existing templates with Cloudinary media, run the migration script:

### Dry Run (Preview Only)

```bash
node src/scripts/migrateCloudinaryToMeta.js --dry-run
```

This will show you what would be migrated without making any changes.

### Actual Migration

```bash
node src/scripts/migrateCloudinaryToMeta.js
```

The script will:
1. Find all templates with Cloudinary URLs
2. Download media from Cloudinary
3. Upload to Meta's Resumable Upload API
4. Create MediaAsset records
5. Update template records with media_handle
6. Mark media as approved if template is approved

Expected output:
```
🚀 Starting Cloudinary to Meta migration...

✅ Database connected

📊 Found 10 templates to process

📦 Processing tenant: tenant-123 (5 templates)
  📥 Downloading from Cloudinary: welcome-template
  📤 Uploading to Meta: welcome-template.jpg
  ✅ Successfully migrated: welcome-template
  ...

============================================================
📊 Migration Summary
============================================================
Total templates processed: 10
✅ Successfully migrated: 8
⏭  Skipped: 1
❌ Failed: 1

✅ Migration complete!
```

## Step 6: Frontend Integration

The Gallery Picker component is already created at:
- `Whatnexus-frontend/components/gallery/GalleryPicker.tsx`
- `Whatnexus-frontend/services/gallery/galleryApi.ts`

### Using the Gallery Picker

```tsx
import { GalleryPicker } from "@/components/gallery/GalleryPicker";
import { MediaAsset } from "@/services/gallery/galleryApi";

function YourComponent() {
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<MediaAsset | null>(null);

  const handleSelectMedia = (asset: MediaAsset) => {
    setSelectedMedia(asset);
    // Use asset.media_handle in your template/campaign
    console.log("Selected media handle:", asset.media_handle);
  };

  return (
    <>
      <button onClick={() => setIsGalleryOpen(true)}>
        Pick from Gallery
      </button>

      <GalleryPicker
        isOpen={isGalleryOpen}
        onClose={() => setIsGalleryOpen(false)}
        onSelect={handleSelectMedia}
        approvedOnly={false} // Set to true for campaigns
        fileType="image" // or "video", "document", "audio", "all"
      />
    </>
  );
}
```

## API Reference

### Upload Media

**Endpoint:** `POST /api/whatsapp/gallery/upload`

**Request:**
- Content-Type: `multipart/form-data`
- Body:
  - `file` (file): Media file to upload
  - `tenant_id` (string): Tenant ID
  - `tags` (string, optional): JSON array of tags
  - `folder` (string, optional): Folder name (default: "root")

**Response:**
```json
{
  "success": true,
  "message": "Media uploaded successfully",
  "data": {
    "asset_id": "uuid",
    "media_handle": "4::AbCDEFGH...",
    "file_name": "image.jpg",
    "file_type": "image",
    "file_size": 123456,
    "mime_type": "image/jpeg",
    "tags": ["tag1", "tag2"],
    "folder": "root",
    "is_approved": false,
    "created_at": "2026-04-06T..."
  }
}
```

### List Media Assets

**Endpoint:** `GET /api/whatsapp/gallery`

**Query Parameters:**
- `tenant_id` (required): Tenant ID
- `type` (optional): Filter by file type (image, video, document, audio, all)
- `search` (optional): Search by filename or tags
- `tags` (optional): Comma-separated tags to filter
- `folder` (optional): Filter by folder
- `approved_only` (optional): Show only approved media (true/false)
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 20)

**Response:**
```json
{
  "success": true,
  "total": 50,
  "page": 1,
  "limit": 20,
  "totalPages": 3,
  "data": [
    {
      "id": "uuid",
      "tenant_id": "uuid",
      "file_name": "image.jpg",
      "file_type": "image",
      "mime_type": "image/jpeg",
      "file_size": 123456,
      "media_handle": "4::AbCDEFGH...",
      "tags": ["tag1"],
      "folder": "root",
      "is_approved": false,
      "templates_used": [],
      "campaigns_used": [],
      "uploaded_by": "uuid",
      "created_at": "2026-04-06T...",
      "updated_at": "2026-04-06T..."
    }
  ]
}
```

### Delete Media Asset

**Endpoint:** `DELETE /api/whatsapp/gallery/:asset_id`

**Query Parameters:**
- `tenant_id` (required): Tenant ID

**Response:**
```json
{
  "success": true,
  "message": "Media asset deleted successfully"
}
```

**Error (if media is approved):**
```json
{
  "success": false,
  "message": "Cannot delete media used in approved templates. Please delete or update the templates first."
}
```

### Update Media Tags

**Endpoint:** `PATCH /api/whatsapp/gallery/:asset_id/tags`

**Request Body:**
```json
{
  "tenant_id": "uuid",
  "tags": ["new-tag1", "new-tag2"]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Tags updated successfully",
  "data": {
    "id": "uuid",
    "tags": ["new-tag1", "new-tag2"],
    ...
  }
}
```

## File Validation Rules

### Images
- Formats: JPEG, PNG, WebP
- Max size: 5MB
- Aspect ratios: 1:1 (square) or 1.91:1 (horizontal)

### Videos
- Formats: MP4, 3GP
- Max size: 16MB

### Documents
- Formats: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX
- Max size: 100MB

### Audio
- Formats: AAC, MP3, OGG, AMR
- Max size: 16MB

## Troubleshooting

### Migration fails with "No active WhatsApp account"
- Ensure each tenant has an active WhatsApp account in the `whatsapp_accounts` table
- Check that `status = 'active'` and `access_token` is valid

### Upload fails with "Failed to create upload session"
- Verify `META_APP_ID` is set in `.env`
- Check that the WhatsApp access token is valid
- Ensure the Meta app has WhatsApp Business API permissions

### Media not showing in campaign picker
- Media must be marked as `is_approved = true`
- This happens automatically when a template using the media gets approved by Meta
- You can manually update: `UPDATE media_assets SET is_approved = true WHERE id = 'asset_id';`

### Database migration fails
- Check PostgreSQL is running
- Verify database connection string in `.env`
- Ensure you have CREATE TABLE permissions
- Run migrations one at a time to identify which one fails

## Next Steps

1. ✅ Run database migrations
2. ✅ Test Gallery API endpoints
3. ⏭️ Integrate Gallery Picker into Template Creation form
4. ⏭️ Integrate Gallery Picker into Campaign Creation form
5. ⏭️ Update Template approval webhook to mark media as approved
6. ⏭️ Run Cloudinary migration (if applicable)

## Support

For issues or questions:
1. Check the error logs in the console
2. Verify all environment variables are set
3. Ensure database migrations completed successfully
4. Test API endpoints with Postman before frontend integration

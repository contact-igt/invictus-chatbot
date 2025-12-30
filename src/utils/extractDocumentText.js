// import path from "path";
// import fs from "fs";
// import os from "os";

// import pdfParse from "pdf-parse";
// import mammoth from "mammoth";
// import textract from "textract";
// import pdfPoppler from "pdf-poppler";
// import { createWorker } from "tesseract.js";

// /* ======================================================
//    SAFE SINGLETON TESSERACT WORKER (v5+ API)
// ====================================================== */

// let worker = null;

// async function getWorker() {
//   if (worker) return worker;

//   // ✅ v5+ correct usage
//   worker = await createWorker("eng");

//   return worker;
// }

// /* ======================================================
//    IMAGE OCR
// ====================================================== */
// async function extractTextFromImage(imagePath) {
//   const w = await getWorker();
//   const { data } = await w.recognize(imagePath);
//   return data.text;
// }

// /* ======================================================
//    PDF → IMAGE
// ====================================================== */
// async function convertPdfToImages(buffer) {
//   const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-ocr-"));
//   const pdfPath = path.join(tempDir, "input.pdf");

//   fs.writeFileSync(pdfPath, buffer);

//   await pdfPoppler.convert(pdfPath, {
//     format: "png",
//     out_dir: tempDir,
//     out_prefix: "page",
//     page: null,
//   });

//   return fs
//     .readdirSync(tempDir)
//     .filter(f => f.endsWith(".png"))
//     .map(f => path.join(tempDir, f));
// }

// /* ======================================================
//    SCANNED PDF OCR
// ====================================================== */
// async function extractTextFromScannedPdf(buffer) {
//   const images = await convertPdfToImages(buffer);

//   let fullText = "";

//   for (const img of images) {
//     fullText += (await extractTextFromImage(img)) + "\n";
//   }

//   return fullText.trim();
// }

// /* ======================================================
//    MAIN UNIFIED EXTRACTOR
// ====================================================== */
// export async function extractDocumentText(buffer, filename) {
//   if (!buffer || !filename) {
//     throw new Error("Missing file buffer or filename");
//   }

//   const ext = path.extname(filename).toLowerCase();

//   /* ---------------- PDF ---------------- */
//   if (ext === ".pdf") {
//     const data = await pdfParse(buffer);

//     if (data.text && data.text.trim().length > 50) {
//       return data.text.trim();
//     }

//     console.log("📄 Scanned PDF → Converting to images → OCR");
//     return await extractTextFromScannedPdf(buffer);
//   }

//   /* ---------------- DOCX ---------------- */
//   if (ext === ".docx") {
//     const result = await mammoth.extractRawText({ buffer });
//     return result.value.trim();
//   }

//   /* ---------------- DOC ---------------- */
//   if (ext === ".doc") {
//     return new Promise((resolve, reject) => {
//       textract.fromBufferWithName(filename, buffer, (err, text) => {
//         if (err) reject(err);
//         else resolve(text.trim());
//       });
//     });
//   }

//   /* ---------------- TXT ---------------- */
//   if (ext === ".txt") {
//     return buffer.toString("utf-8").trim();
//   }

//   /* ---------------- IMAGE ---------------- */
//   const imageExts = [".jpg", ".jpeg", ".png", ".bmp", ".tiff"];
//   if (imageExts.includes(ext)) {
//     const tempImage = path.join(os.tmpdir(), `ocr-${Date.now()}${ext}`);
//     fs.writeFileSync(tempImage, buffer);
//     return await extractTextFromImage(tempImage);
//   }

//   throw new Error("Unsupported file type");
// }

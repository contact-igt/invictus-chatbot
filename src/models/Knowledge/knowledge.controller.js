import { scrapeWebsiteText } from "../../utils/scrapeWebsiteText.js";
import {
  deleteKnowledgeService,
  getKnowledgeByIdService,
  listKnowledgeService,
  processKnowledgeUpload,
  updateKnowledgeService,
} from "./knowledge.service.js";
import { cleanText } from "../../utils/cleanText.js";

const sanitizeFolder = (str) => {
  if (!str) return "default";
  return str.trim().replace(/[\s\/\\]+/g, "_"); // remove spaces, slashes
};

// export const uploadKnowledge = async (req, res) => {
//   try {
//     const { title, type, source_url, text , file_name , } = req.body;
//     const file = req.files?.file;

//     let rawText = "";
//     let fileUrl = null;
//     let sourceUrl = null;

//     if (!title || !type) {
//       return res.status(400).send({ message: "Required title and type" });
//     }

//     // ====================== TEXT TYPE ======================
//     if (type === "text") {
//       if (!text) {
//         return res.status(400).send({ message: "Text is required" });
//       }
//       rawText = text;
//       fileUrl = null;
//       sourceUrl = null;
//     }

//     // ====================== FILE TYPES ======================
//     if (["pdf", "doc", "docx", "txt"].includes(type)) {
//       if (!file || !file.data || !file.name) {
//         return res.status(400).send({ message: "File is required" });
//       }

//       // Clean folder path
//       const folderPath = `${tableNames.KNOWLEDGESOURCE}/${sanitizeFolder(title)}`;

//       // Upload file to Cloudinary
//       fileUrl = await uploadToCloudinary(file, "raw", "public", folderPath);

//       // Extract text from file (Tesseract for scanned PDFs/images)
//       rawText = await extractDocumentText(file.data, file.name);
//       sourceUrl = null;

//       if (!rawText || rawText.trim().length < 10) {
//         return res.status(400).send({
//           message:
//             "No readable text found. This file may be scanned or image-based.",
//         });
//       }
//     }

//     // ====================== URL TYPE ======================
//     if (type === "url") {
//       if (!source_url) {
//         return res.status(400).send({ message: "URL is required" });
//       }

//       rawText = await scrapeWebsiteText(source_url);
//       fileUrl = null;
//       sourceUrl = source_url;

//       if (!rawText || !rawText.trim()) {
//         return res.status(400).send({ message: "No content extracted" });
//       }
//     }

//     // ====================== CLEAN & SAVE ======================
//     const cleanedText = cleanText(rawText);

//     await processKnowledgeUpload(title, type, sourceUrl, cleanedText, fileUrl, file_name);

//     res.status(200).send({ message: "Knowledge uploaded successfully" });
//   } catch (err) {
//     console.error(err);
//     res.status(500).send({ error: err.message });
//   }
// };

export const uploadKnowledge = async (req, res) => {
  try {
    const { title, type, text, source_url, file_name } = req.body;

    if (!title || !type) {
      return res.status(400).json({ message: "Title & type required" });
    }

    let finalText = "";

    if (type === "text" || type === "file") {
      if (!text || text.trim().length < 10) {
        return res.status(400).json({ message: "Text missing" });
      }
      finalText = text;
    }

    if (type === "url") {
      if (!source_url) {
        return res.status(400).json({ message: "URL required" });
      }
      finalText = await scrapeWebsiteText(source_url);
    }

    const cleanedText = cleanText(finalText);

    await processKnowledgeUpload(
      title,
      type,
      source_url || null,
      cleanedText,
      file_name
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

export const listKnowledge = async (req, res) => {
  try {
    const data = await listKnowledgeService();
    return res.status(200).send({
      data: data,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getKnowledgeById = async (req, res) => {
  try {
    const { id } = req.params;
    const data = await getKnowledgeByIdService(id);

    if (!data) {
      return res.status(404).json({ message: "Knowledge not found" });
    }

    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const updateKnowledge = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, text } = req.body;

    if (!title || !text) {
      return res.status(400).json({ message: "title and text required" });
    }

    await updateKnowledgeService(id, title, text);
    res.json({ message: "Knowledge updated successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const deleteKnowledge = async (req, res) => {
  try {
    const { id } = req.params;
    await deleteKnowledgeService(id);
    res.json({ message: "Knowledge deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

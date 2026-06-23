import { searchKnowledgeChunks } from "../Knowledge/knowledge.search.js";

export const AVAILABILITY_CONTACT_KNOWLEDGE_QUERY =
  "contact number phone mobile whatsapp reception appointment";

const MAX_CONTACT_NUMBERS = 2;
let knowledgeSearchForAvailabilityContact = searchKnowledgeChunks;

const toChunkTexts = (searchResult = {}) => {
  const chunks = Array.isArray(searchResult?.chunks) ? searchResult.chunks : [];
  const sourceChunks = Array.isArray(searchResult?.sources)
    ? searchResult.sources.flatMap((source) =>
        Array.isArray(source?.chunks) ? source.chunks : [],
      )
    : [];
  return [...chunks, ...sourceChunks].filter(Boolean).map(String);
};

const formatContactNumber = (rawValue = "") => {
  let digits = String(rawValue || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length < 10 || digits.length > 15) return null;
  if (/^(\d)\1+$/.test(digits)) return null;

  if (digits.length === 10) return digits;
  const countryCode = digits.slice(0, digits.length - 10);
  const localNumber = digits.slice(-10);
  return `${countryCode} ${localNumber}`;
};

export const extractAvailabilityContactNumbers = (chunks = []) => {
  const numbers = [];
  const seen = new Set();
  const candidatePattern = /\+?\d[\d\s().-]{7,}\d/g;

  for (const chunk of chunks) {
    const candidates = String(chunk || "").match(candidatePattern) || [];
    for (const candidate of candidates) {
      const formatted = formatContactNumber(candidate);
      if (!formatted) continue;
      const key = formatted.replace(/\D/g, "");
      if (seen.has(key)) continue;
      seen.add(key);
      numbers.push(formatted);
      if (numbers.length >= MAX_CONTACT_NUMBERS) return numbers;
    }
  }

  return numbers;
};

export const getAvailabilityContactNumbers = async (tenantId) => {
  try {
    const searchResult = await knowledgeSearchForAvailabilityContact(
      tenantId,
      AVAILABILITY_CONTACT_KNOWLEDGE_QUERY,
    );
    return extractAvailabilityContactNumbers(toChunkTexts(searchResult));
  } catch {
    return [];
  }
};

export const buildAvailabilityUnavailableMessage = ({
  type,
  contacts = [],
} = {}) => {
  const subject = type === "services" ? "services" : "doctors";
  const contactText = contacts.length
    ? ` or contact us ${contacts.join(" or ")}`
    : "";
  return `Sorry, no ${subject} are available right now! Please try again later${contactText}. Thank you.`;
};

export const buildAvailabilityUnavailableMessageForTenant = async ({
  tenantId,
  type,
} = {}) =>
  buildAvailabilityUnavailableMessage({
    type,
    contacts: await getAvailabilityContactNumbers(tenantId),
  });

export const setAvailabilityContactSearchForTest = (searchFn = null) => {
  knowledgeSearchForAvailabilityContact =
    typeof searchFn === "function" ? searchFn : searchKnowledgeChunks;
};


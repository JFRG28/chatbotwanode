const {GoogleGenerativeAI} = require("@google/generative-ai");
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

// Load env from the root or functions folder if needed
dotenv.config({path: path.join(__dirname, ".env.local")});

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error("❌ Error: GEMINI_API_KEY no encontrada en .env.local");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({
  model: "gemini-embedding-2",
});

const DOCS_DIR = path.join(__dirname, "source_docs");
const OUTPUT_FILE = path.join(__dirname, "knowledge.json");

/**
 * Chunks text into segments based on empty lines.
 * @param {string} text The text to chunk.
 * @return {string[]} An array of chunks.
 */
function chunkText(text) {
  return text.split(/\n\s*\n/)
      .map((c) => c.trim())
      .filter((c) => c.length > 20);
}

/**
 * Generates the knowledge base JSON file by embedding document chunks.
 */
async function generateKnowledgeBase() {
  console.log("🛠️ Generando base de conocimientos pre-calculada...");

  if (!fs.existsSync(DOCS_DIR)) {
    console.error(`❌ Directorio no encontrado: ${DOCS_DIR}`);
    return;
  }

  const files = fs.readdirSync(DOCS_DIR);
  const vectorDatabase = [];

  for (const file of files) {
    const filePath = path.join(DOCS_DIR, file);
    if (path.extname(file).toLowerCase() !== ".md") continue;

    console.log(`📄 Procesando: ${file}`);
    const content = fs.readFileSync(filePath, "utf-8");
    const chunks = chunkText(content);

    for (const [index, chunk] of chunks.entries()) {
      try {
        const result = await embeddingModel.embedContent(chunk);
        vectorDatabase.push({
          embedding: result.embedding.values,
          text: chunk,
          source: `${file} (Parte ${index + 1})`,
        });
        // Small delay to respect rate limits if many chunks
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`❌ Error en embedding ${file} chunk ${index}:`,
            error.message);
      }
    }
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(vectorDatabase, null, 2));
  console.log(`✅ ¡Hecho! ${vectorDatabase.length} fragmentos guardados.`);
}

generateKnowledgeBase();

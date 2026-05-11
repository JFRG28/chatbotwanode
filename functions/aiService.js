const {GoogleGenerativeAI} = require("@google/generative-ai");
const {defineSecret} = require("firebase-functions/params");
const fs = require("fs");
const path = require("path");
const pdf = require("pdf-parse");
const xlsx = require("xlsx");

// Define the secret (it will be configured in Google Cloud Secret Manager)
const geminiApiKey = defineSecret("GEMINI_API_KEY");

// Global variables for lazy initialization
let genAI = null;
let embeddingModel = null;
let isKnowledgeInitialized = false;

// Base de datos vectorial en memoria para el MVP
const vectorDatabase = [];
const chatContexts = new Map();

/**
 * Ingests a document by creating an embedding and storing it.
 * @param {string} text - The text to ingest.
 * @param {string} sourceName - The source of the text.
 */
async function ingestDocument(text, sourceName) {
  try {
    const result = await embeddingModel.embedContent(text);
    vectorDatabase.push({
      embedding: result.embedding.values,
      text: text,
      source: sourceName,
    });
  } catch (error) {
    console.error(
        `Error ingiriendo fragmento de ${sourceName}:`,
        error.message,
    );
  }
}

/**
 * Calculates the cosine similarity between two vectors.
 * @param {number[]} vecA - First vector.
 * @param {number[]} vecB - Second vector.
 * @return {number} The cosine similarity score.
 */
function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Chunks text into smaller, overlapping segments to stay within embedding
 * limits and improve semantic search.
 * @param {string} text - The full text to chunk.
 * @return {string[]} An array of text chunks.
 */
function chunkText(text) {
  // A simple chunking strategy: split by paragraphs or newlines
  // In a production system, you might want overlapping chunks of ~500 tokens.
  const chunks = text.split(/\n\s*\n/);
  return chunks.map((c) => c.trim()).filter((c) => c.length > 20);
}

/**
 * Initializes the knowledge base by reading files from functions/source_docs.
 */
async function inicializarConocimientoMVP() {
  if (isKnowledgeInitialized) return;

  console.log("🛠️ Cargando documentos desde source_docs...");
  const docsDir = path.join(__dirname, "source_docs");

  if (!fs.existsSync(docsDir)) {
    console.log(`⚠️ Directorio no encontrado: ${docsDir}.`);
    isKnowledgeInitialized = true;
    return;
  }

  const files = fs.readdirSync(docsDir);

  for (const file of files) {
    const filePath = path.join(docsDir, file);
    const ext = path.extname(file).toLowerCase();
    console.log(`Leyendo archivo: ${file}`);

    try {
      let content = "";

      if (ext === ".txt" || ext === ".csv") {
        content = fs.readFileSync(filePath, "utf-8");
      } else if (ext === ".pdf") {
        const dataBuffer = fs.readFileSync(filePath);
        const data = await pdf(dataBuffer);
        content = data.text;
      } else if (ext === ".xlsx" || ext === ".xls") {
        const workbook = xlsx.readFile(filePath);
        // Combine all sheets into a single text block
        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName];
          const csvData = xlsx.utils.sheet_to_csv(sheet);
          content += `\n--- Sheet: ${sheetName} ---\n${csvData}`;
        }
      } else {
        console.log(`Formato no soportado, saltando: ${file}`);
        continue;
      }

      // Chunk the content and ingest
      const chunks = chunkText(content);
      for (const [index, chunk] of chunks.entries()) {
        await ingestDocument(chunk, `${file} (Parte ${index + 1})`);
      }
    } catch (error) {
      console.error(`Error procesando archivo ${file}:`, error);
    }
  }

  console.log("✅ Conocimiento de archivos cargado en memoria.");
  isKnowledgeInitialized = true;
}

/**
 * Gets a response from the AI using RAG based on the user's message.
 * @param {string} userId - The unique identifier for the user.
 * @param {string} userMessage - The message sent by the user.
 * @return {Promise<string>} The AI's response text.
 */
async function getAiResponse(userId, userMessage) {
  try {
    // Inicialización perezosa: el valor del secreto (.value())
    // SOLO está disponible durante la ejecución de la función
    if (!genAI) {
      const apiKey = geminiApiKey.value() || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY no está configurada o es inválida.");
      }
      genAI = new GoogleGenerativeAI(apiKey);
      embeddingModel = genAI.getGenerativeModel({model: "gemini-embedding-2"});
    }

    if (!isKnowledgeInitialized) {
      await inicializarConocimientoMVP();
    }

    // Generar embedding de la pregunta
    const userEmbedResult = await embeddingModel.embedContent(userMessage);
    const userVector = userEmbedResult.embedding.values;

    // Buscar el fragmento más similar
    const relevantDocs = vectorDatabase
        .map((doc) => ({
          ...doc,
          score: cosineSimilarity(userVector, doc.embedding),
        }))
        .sort((a, b) => b.score - a.score);

    const topContext = relevantDocs.length > 0 ?
      relevantDocs[0].text : "No hay información específica disponible.";

    // Manejo de sesión de chat
    if (!chatContexts.has(userId)) {
      // Nota: systemInstruction va aquí para evitar el error
      // de [400 Bad Request]
      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        systemInstruction: "Eres Duque, un asistente experto en Kia " +
                "Finance.\n" +
                "Tu personalidad es amable y profesional.\n" +
                "REGLAS CRÍTICAS:\n" +
                "1. No uses menús numéricos (ej. \"Marca 1 para ventas\").\n" +
                "2. Mantén respuestas breves y directas.\n" +
                "3. Usa un tono amable y profesional.\n" +
                "4. Si te preguntan algo fuera del contexto que se te " +
                "proporciona, dile que no tienes esa información y " +
                "sugiérele contactar a una agencia.",
      });

      const chatSession = model.startChat({
        history: [],
      });

      chatContexts.set(userId, chatSession);
    }

    const chat = chatContexts.get(userId);

    // Inyectamos el contexto directamente en el mensaje del usuario
    // para evitar el error de systemInstruction y para asegurar que
    // el contexto se actualice en cada mensaje dinámicamente.
    const augmentedMessage = `CONTEXTO PARA RESPONDER: ${topContext}\n\n` +
      `PREGUNTA DEL USUARIO: ${userMessage}`;

    const result = await chat.sendMessage(augmentedMessage);
    const response = await result.response;

    return response.text();
  } catch (error) {
    console.error("Error en getAiResponse:", error);
    return "Lo siento, tuve un problema al consultar mis manuales.";
  }
}

module.exports = {getAiResponse};

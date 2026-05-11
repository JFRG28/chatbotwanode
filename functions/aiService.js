const {GoogleGenerativeAI} = require("@google/generative-ai");
const {defineSecret} = require("firebase-functions/params");

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
 * Initializes the MVP knowledge base by loading predefined documents.
 */
async function inicializarConocimientoMVP() {
  if (isKnowledgeInitialized) return;

  console.log("🛠️ Cargando información de Kia Finance...");

  const contenidoDocumento = [
    "Beneficios Kia Finance: Autorización en 20 min, enganche desde el 10% " +
    "y plazos hasta 72 meses sin penalización por abonos a capital.",
    "Plan Kia Fidelity: Programa de incentivos para clientes actuales " +
    "de Kia. Ofrece -2% en tasa de interés o los primeros 2 servicios " +
    "de mantenimiento gratis.",
    "Kia Crédito Simple y con Anualidad: El crédito simple tiene tasa y " +
    "pagos fijos. El crédito con anualidad permite pagos anuales " +
    "programados para reducir la mensualidad.",
  ];

  for (const texto of contenidoDocumento) {
    await ingestDocument(texto, "Crédito Simple o con anualidad_v1.2");
  }
  console.log("✅ Conocimiento del MVP cargado en memoria.");
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
      genAI = new GoogleGenerativeAI(geminiApiKey.value());
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

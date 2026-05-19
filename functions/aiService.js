const {GoogleGenerativeAI} = require("@google/generative-ai");
const {defineSecret} = require("firebase-functions/params");
const fs = require("fs");
const path = require("path");

// Define the secret (it will be configured in Google Cloud Secret Manager)
const geminiApiKey = defineSecret("GEMINI_API_KEY");

// Global variables for lazy initialization
let genAI = null;
let embeddingModel = null;
let isKnowledgeInitialized = false;

// Base de datos vectorial en memoria
let vectorDatabase = [];
const chatContexts = new Map();

/**
 * MOCK: Saves an appointment to a local file.
 * In production, this would call a CRM or Calendar API.
 * @param {Object} args - The appointment details.
 * @return {Object} Confirmation result.
 */
function scheduleAppointment(args) {
  try {
    const appointmentsPath = path.join(__dirname, "appointments.json");
    let appointments = [];
    if (fs.existsSync(appointmentsPath)) {
      const fileData = fs.readFileSync(appointmentsPath, "utf-8");
      appointments = JSON.parse(fileData);
    }
    const apptId = Date.now();
    const newAppointment = {
      id: apptId,
      ...args,
      status: "scheduled",
      createdAt: new Date().toISOString(),
    };
    appointments.push(newAppointment);
    fs.writeFileSync(appointmentsPath, JSON.stringify(appointments, null, 2));
    return {
      status: "success",
      appointmentId: apptId,
      message: `Cita agendada: ${args.fullName} el ${args.date} ` +
          `a las ${args.time}.`,
    };
  } catch (error) {
    console.error("Error scheduling appointment:", error);
    return {status: "error", message: "No se pudo agendar la cita."};
  }
}

const tools = [
  {
    functionDeclarations: [
      {
        name: "scheduleAppointment",
        description: "Agenda una cita para un cliente en una agencia.",
        parameters: {
          type: "OBJECT",
          properties: {
            fullName: {
              type: "STRING",
              description: "Nombre completo del cliente.",
            },
            date: {
              type: "STRING",
              description: "Fecha de la cita (ej. 2026-05-20).",
            },
            time: {
              type: "STRING",
              description: "Hora de la cita (ej. 10:00 AM).",
            },
            carModel: {
              type: "STRING",
              description: "Modelo de auto de interés.",
            },
          },
          required: ["fullName", "date", "time"],
        },
      },
    ],
  },
];

/**
 * Initializes the knowledge base by reading the pre-calculated
 * knowledge.json file.
 */
function inicializarConocimientoMVP() {
  if (isKnowledgeInitialized) return;

  try {
    const knowledgePath = path.join(__dirname, "knowledge.json");
    if (fs.existsSync(knowledgePath)) {
      console.log("🛠️ Cargando conocimiento pre-calculado...");
      const rawData = fs.readFileSync(knowledgePath, "utf-8");
      vectorDatabase = JSON.parse(rawData);
      console.log(`✅ Conocimiento cargado: ${vectorDatabase.length} chunks.`);
    } else {
      console.log("⚠️ knowledge.json no encontrado.");
    }
  } catch (error) {
    console.error("❌ Error cargando knowledge.json:", error);
  }

  isKnowledgeInitialized = true;
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
 * Gets a response from the AI using RAG based on the user's message.
 * @param {string} userId - The unique identifier for the user.
 * @param {string} userMessage - The message sent by the user.
 * @param {string} baseUrl - The base URL for generating links.
 * @return {Promise<string>} The AI's response text.
 */
async function getAiResponse(userId, userMessage, baseUrl) {
  try {
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

    const userEmbedResult = await embeddingModel.embedContent(userMessage);
    const userVector = userEmbedResult.embedding.values;

    const SIMILARITY_THRESHOLD = 0.35;
    const relevantDocs = vectorDatabase
        .map((doc) => ({
          ...doc,
          score: cosineSimilarity(userVector, doc.embedding),
        }))
        .filter((doc) => doc.score >= SIMILARITY_THRESHOLD)
        .sort((a, b) => b.score - a.score);

    const contextChunks = relevantDocs.length > 0 ?
      relevantDocs :
      [vectorDatabase.map((doc) => ({
        ...doc,
        score: cosineSimilarity(userVector, doc.embedding),
      })).sort((a, b) => b.score - a.score)[0]];

    const topContext = contextChunks
        .map((d) => d.text)
        .join("\n---\n");

    if (!chatContexts.has(userId)) {
      const today = new Date().toLocaleDateString("es-MX", {
        year: "numeric", month: "long", day: "numeric",
      });
      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        tools: tools,
        systemInstruction: `Eres Duque, un asistente de Kia Finance.\n` +
                `Hoy es ${today}.\n` +
                `Tu personalidad es amable y profesional.\n` +
                `REGLA DE ORO: NUNCA confirmes una cita sin haber usado ` +
                `primero la herramienta 'scheduleAppointment'.\n` +
                `Si el cliente quiere una cita, debes pedirle:\n` +
                `1. Nombre completo\n2. Fecha\n3. Hora\n4. Modelo de auto\n` +
                `Cuando tengas los 4 datos, LLAMA a 'scheduleAppointment'.\n` +
                `REGLAS CRÍTICAS:\n` +
                `- No uses menús numéricos.\n` +
                `- Mantén respuestas breves.\n` +
                `- Si no tienes información en el CONTEXTO, sugiere ` +
                `contactar a una agencia.`,
      });

      const chatSession = model.startChat({
        history: [],
      });

      chatContexts.set(userId, chatSession);
    }

    const chat = chatContexts.get(userId);
    const augmentedMessage = `CONTEXTO PARA RESPONDER: ${topContext}\n\n` +
      `PREGUNTA DEL USUARIO: ${userMessage}`;

    let result = await chat.sendMessage(augmentedMessage);
    let response = await result.response;
    let finalDownloadLink = "";

    const calls = response.functionCalls();
    if (calls && calls.length > 0) {
      const call = calls[0];
      console.log(`🛠️ AI llamando a herramienta: ${call.name}`, call.args);

      if (call.name === "scheduleAppointment") {
        const toolRes = scheduleAppointment(call.args);

        // Si fue exitoso, generamos el link
        if (toolRes.status === "success" && baseUrl) {
          const apptId = toolRes.appointmentId;
          finalDownloadLink = `${baseUrl}/download-ics/${apptId}`;
          console.log(`🔗 Link generado: ${finalDownloadLink}`);
        }

        result = await chat.sendMessage([{
          functionResponse: {
            name: "scheduleAppointment",
            response: toolRes,
          },
        }]);
        response = await result.response;
      }
    }

    let finalResponse = response.text();
    if (finalDownloadLink) {
      finalResponse += `\n\n📅 [AGREGAR AL CALENDARIO]: ${finalDownloadLink}`;
    }

    return finalResponse;
  } catch (error) {
    console.error("Error en getAiResponse:", error);
    return "Lo siento, tuve un problema al consultar mis manuales.";
  }
}

module.exports = {getAiResponse};

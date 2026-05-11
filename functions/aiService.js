const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// 1. Configuración de modelos
const embeddingModel = genAI.getGenerativeModel({ model: "gemini-embedding-2" });

// Base de datos vectorial en memoria para el MVP
let vectorDatabase = [];
const chatContexts = new Map();

// 2. Definición de funciones nucleares
async function ingestDocument(text, sourceName) {
    try {
        const result = await embeddingModel.embedContent(text);
        vectorDatabase.push({
            embedding: result.embedding.values,
            text: text,
            source: sourceName
        });
    } catch (error) {
        console.error(`Error ingiriendo fragmento de ${sourceName}:`, error.message);
    }
}

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

// 3. Función de inicialización (El "Cerebro" del MVP)
async function inicializarConocimientoMVP() {
    console.log("🛠️ Cargando información de Kia Finance...");
    
    const contenidoDocumento = [
        "Beneficios Kia Finance: Autorización en 20 min, enganche desde el 10% y plazos hasta 72 meses sin penalización por abonos a capital.",
        "Plan Kia Fidelity: Programa de incentivos para clientes actuales de Kia. Ofrece -2% en tasa de interés o los primeros 2 servicios de mantenimiento gratis.",
        "Kia Crédito Simple y con Anualidad: El crédito simple tiene tasa y pagos fijos. El crédito con anualidad permite pagos anuales programados para reducir la mensualidad."
    ];

    for (const texto of contenidoDocumento) {
        // Ahora ingestDocument ya está definido antes de ser llamado
        await ingestDocument(texto, "Crédito Simple o con anualidad_v1.2");
    }
    console.log("✅ Conocimiento del MVP cargado en memoria.");
}

// Ejecución inicial
inicializarConocimientoMVP();

// 4. Función principal de respuesta (RAG)
async function getAiResponse(userId, userMessage) {
    try {
        // Generar embedding de la pregunta
        const userEmbedResult = await embeddingModel.embedContent(userMessage);
        const userVector = userEmbedResult.embedding.values;

        // Buscar el fragmento más similar
        const relevantDocs = vectorDatabase
            .map(doc => ({ ...doc, score: cosineSimilarity(userVector, doc.embedding) }))
            .sort((a, b) => b.score - a.score);

        const topContext = relevantDocs.length > 0 ? relevantDocs[0].text : "No hay información específica disponible.";

        // Manejo de sesión de chat
        if (!chatContexts.has(userId)) {
            // Nota: systemInstruction va aquí para evitar el error de [400 Bad Request]
            const model = genAI.getGenerativeModel({ 
                model: "gemini-2.5-flash",
                systemInstruction: `Eres Duque, un asistente experto en Kia Finance. 
                Tu personalidad es amable y profesional.
                REGLAS CRÍTICAS:
                1. No uses menús numéricos (ej. "Marca 1 para ventas").
                2. Mantén respuestas breves y directas.
                3. Usa un tono amable y profesional.
                4. Si te preguntan algo fuera del contexto que se te proporciona, dile que no tienes esa información y sugiérele contactar a una agencia.`
            });

            const chatSession = model.startChat({
                history: []
            });
            
            chatContexts.set(userId, chatSession);
        }

        const chat = chatContexts.get(userId);

        // Inyectamos el contexto directamente en el mensaje del usuario para evitar el error de systemInstruction
        // y para asegurar que el contexto se actualice en cada mensaje dinámicamente.
        const augmentedMessage = `CONTEXTO PARA RESPONDER: ${topContext}\n\nPREGUNTA DEL USUARIO: ${userMessage}`;

        const result = await chat.sendMessage(augmentedMessage);
        const response = await result.response;

        return response.text();
        
    } catch (error) {
        console.error("Error en getAiResponse:", error);
        return "Lo siento, tuve un problema al consultar mis manuales.";
    }
}

module.exports = { getAiResponse };
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Cargar variables de ambiente
require('dotenv').config();

// Configuración de Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

//Para pruebas solamente
console.log("Cargando clave de Gemini:", "..." + process.env.GEMINI_API_KEY?.slice(-5));

const model = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash",
    systemInstruction: `
        Eres un asistente conversacional avanzado. 
        Tu objetivo es ayudar al usuario de forma natural y humana.
        REGLAS CRÍTICAS:
        1. No uses menús numéricos (ej. "Marca 1 para ventas").
        2. Mantén respuestas breves y directas.
        3. Usa un tono amable y profesional.
        4. Si no sabes algo, responde con naturalidad pidiendo más detalles.
    `
});

/**
 * Procesa el mensaje del usuario y devuelve la respuesta de la IA
 */
async function getAiResponse(userMessage) {
    try {
        const result = await model.generateContent(userMessage);
        const response = await result.response;
        return response.text();
    } catch (error) {
        console.error("Error en aiService:", error);
        return "Tuve un pequeño problema al procesar tu solicitud, ¿podrías repetírmelo?";
    }
}

// Exportamos la función para que app.js la pueda usar
module.exports = { getAiResponse };
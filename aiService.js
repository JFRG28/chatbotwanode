const { GoogleGenerativeAI } = require("@google/generative-ai");

// Cargar variables de ambiente
require('dotenv').config();

// Configuración de Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

//Para pruebas solamente
//console.log("Cargando clave de Gemini:", "..." + process.env.GEMINI_API_KEY?.slice(-5));

// Este Map guardará el hilo de la conversación de cada usuario
const chatContexts = new Map();

/**
 * Procesa el mensaje del usuario y devuelve la respuesta de la IA
 */
async function getAiResponse(userId, userMessage) {
    try {
        // 1. Verificamos si este usuario ya tiene un chat activo
        if (!chatContexts.has(userId)) {
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

            // Creamos una sesión nueva
            const chatSession = model.startChat({
                history: []
            });
            
            chatContexts.set(userId, chatSession);
        }

        // 2. Recuperamos la sesión de este usuario específico
        const chat = chatContexts.get(userId);

        // 3. Enviamos el mensaje real (userMessage)
        const result = await chat.sendMessage(userMessage);
        const response = await result.response;

        return response.text();
        
    } catch (error) {
        console.error("Error en aiService:", error);
        return "Tuve un pequeño problema al procesar tu solicitud, ¿me lo repites por favor?";
    }
}

// Exportamos la función para que app.js la pueda usar
module.exports = { getAiResponse };
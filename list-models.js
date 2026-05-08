require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

async function list() {
    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        // Intentamos listar los modelos disponibles para TU llave
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`;
        const fetch = require('node-fetch'); // Si no tienes node-fetch, usa 'https' nativo
        
        const response = await fetch(url);
        const data = await response.json();
        
        console.log("Modelos disponibles para tu API Key:");
        if (data.models) {
            data.models.forEach(m => console.log("- " + m.name));
        } else {
            console.log("No se encontraron modelos. Respuesta de Google:", data);
        }
    } catch (e) {
        console.error("Error al listar:", e);
    }
}

list();
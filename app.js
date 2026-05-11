const express = require("express");
const axios = require("axios");
const dotenv = require("dotenv");
const { getAiResponse } = require("./functions/aiService"); // Importamos el servicio de IA

dotenv.config();
const app = express();
app.use(express.json());

/**
 * Función para enviar mensajes a través de la API de Meta
 */
async function sendWhatsAppMessage(toNumber, messageText) {
    try {
        await axios({
            method: "POST",
            url: `https://graph.facebook.com/v23.0/${process.env.PHONE_NUMBER_ID}/messages`,
            data: {
                messaging_product: "whatsapp",
                to: toNumber,
                type: "text",
                text: { body: messageText },
            },
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env.WHATSAPP_API_TOKEN}`,
            },
        });
    } catch (error) {
        console.error("Error enviando a WhatsApp:", error.response?.data || error.message);
    }
}

// Endpoint GET: Validación del Webhook para Meta
app.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
        console.log("Webhook validado con éxito.");
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

// Endpoint POST: Recepción de mensajes reales
app.post("/webhook", async (req, res) => {
    const body = req.body;

    if (body.object === "whatsapp_business_account") {
        const entry = body.entry?.[0];
        const changes = entry?.changes?.[0];
        const message = changes?.value?.messages?.[0];

        if (message && message.type === "text") {
            let from = message.from; // Llega como "521477..."
            const userText = message.text.body;

            // LÓGICA DE LIMPIEZA PARA MÉXICO:
            // Si empieza con 521 y tiene 13 dígitos, quitamos el '1' que está en la posición 2
            if (from.startsWith("521") && from.length === 13) {
                from = "52" + from.substring(3);
            }

            console.log(`Mensaje procesado para: ${from}`);

            // Ahora sí, llamamos a la IA y enviamos
            console.log(`📩 Mensaje de ${from}: ${userText}`);
            const aiReply = await getAiResponse(from, userText);
            console.log(`🤖 IA responde: ${aiReply}`); // Esto te permitirá ver qué dice Gemini antes de enviarlo
            await sendWhatsAppMessage(from, aiReply);
            console.log(`✅ Respuesta enviada con éxito a WhatsApp`);
        }
        res.sendStatus(200);
    } else {
        res.sendStatus(404);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor de WhatsApp escuchando en puerto ${PORT}`));
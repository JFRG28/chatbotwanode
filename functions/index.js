const {onRequest} = require("firebase-functions/v2/https");
const {setGlobalOptions} = require("firebase-functions/v2");
const express = require("express");
const {defineSecret} = require("firebase-functions/params");
const {getAiResponse} = require("./aiService");

// Define the secrets
const geminiApiKey = defineSecret("GEMINI_API_KEY");
const phoneNumberId = defineSecret("PHONE_NUMBER_ID");
const whatsappApiToken = defineSecret("WHATSAPP_API_TOKEN");
const whatsappVerifyToken = defineSecret("WHATSAPP_VERIFY_TOKEN");

const app = express();
app.use(express.json());

/**
 * Función para enviar mensajes a través de la API de Meta usando fetch.
 * @param {string} toNumber Número al que enviar el mensaje.
 * @param {string} messageText El texto a enviar.
 */
async function sendWhatsAppMessage(toNumber, messageText) {
  try {
    const url = `https://graph.facebook.com/v23.0/${phoneNumberId.value()}/messages`;
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${whatsappApiToken.value()}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: toNumber,
        type: "text",
        text: {body: messageText},
      }),
    });
  } catch (error) {
    console.error("Error sending WhatsApp message", error);
  }
}

// 1. Webhook from Meta validation (GET)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === whatsappVerifyToken.value()) {
    console.log("Webhook validado con éxito.");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// 2. Messages reception (POST)
app.post("/webhook", async (req, res) => {
  const body = req.body;

  if (body.object === "whatsapp_business_account") {
    const entry = body.entry && body.entry[0];
    const changes = entry && entry.changes && entry.changes[0];
    const val = changes && changes.value;
    const message = val && val.messages && val.messages[0];

    if (message && message.type === "text") {
      let from = message.from; // Llega como "521477..."
      const userText = message.text.body;

      // LÓGICA DE LIMPIEZA PARA MÉXICO:
      // Si empieza con 521 y tiene 13 dígitos, quitamos el '1'.
      if (from.startsWith("521") && from.length === 13) {
        from = "52" + from.substring(3);
      }

      console.log(`Mensaje procesado para: ${from}`);

      // Ahora sí, llamamos a la IA y enviamos
      console.log(`📩 Mensaje de ${from}: ${userText}`);

      // Construimos la URL base para los links de descarga
      const protocol = req.protocol;
      const host = req.get("host");
      // K_SERVICE es el nombre de la función en Firebase v2 (ej. 'api')
      const functionName = process.env.K_SERVICE || "api";
      const baseUrl = `${protocol}://${host}/${functionName}`;

      const aiReply = await getAiResponse(from, userText, baseUrl);
      // Esto te permitirá ver qué dice Gemini antes de enviarlo
      console.log(`🤖 IA responde: ${aiReply}`);
      await sendWhatsAppMessage(from, aiReply);
      console.log(`✅ Respuesta enviada con éxito a WhatsApp`);
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

/**
 * Endpoint para descargar el archivo .ics de la cita.
 */
app.get("/download-ics/:id", (req, res) => {
  try {
    const fs = require("fs");
    const path = require("path");
    const appointmentsPath = path.join(__dirname, "appointments.json");

    if (!fs.existsSync(appointmentsPath)) {
      return res.status(404).send("No hay citas registradas.");
    }

    const raw = fs.readFileSync(appointmentsPath, "utf-8");
    const appointments = JSON.parse(raw);
    const apptId = req.params.id;
    const appt = appointments.find((a) => a.id.toString() === apptId);

    if (!appt) {
      return res.status(404).send("Cita no encontrada.");
    }

    // Parsear fecha y hora
    const [y, m, d] = appt.date.split("-").map(Number);
    let hours = 9;
    let mins = 0;
    const tMatch = appt.time.match(/(\d+):(\d+)\s*(AM|PM)?/i);
    if (tMatch) {
      hours = parseInt(tMatch[1]);
      mins = parseInt(tMatch[2]);
      const ampm = tMatch[3] ? tMatch[3].toUpperCase() : null;
      if (ampm === "PM" && hours < 12) hours += 12;
      if (ampm === "AM" && hours === 12) hours = 0;
    }

    const startDate = new Date(y, m - 1, d, hours, mins);
    const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);

    const fmt = (date) => {
      const p = (n) => n.toString().padStart(2, "0");
      const yy = date.getFullYear();
      const mm = p(date.getMonth() + 1);
      const dd = p(date.getDate());
      const hh = p(date.getHours());
      const min = p(date.getMinutes());
      return `${yy}${mm}${dd}T${hh}${min}00`;
    };

    const icsContent = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Kia Finance//Duque//ES",
      "BEGIN:VEVENT",
      `UID:${appt.id}@kiafinance.com`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").split(".")[0]}Z`,
      `DTSTART:${fmt(startDate)}`,
      `DTEND:${fmt(endDate)}`,
      `SUMMARY:Cita Kia Finance - ${appt.carModel}`,
      `DESCRIPTION:Cita de ${appt.fullName} para ${appt.carModel}`,
      "LOCATION:Agencia Kia Local",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    res.setHeader("Content-Type", "text/calendar");
    res.setHeader("Content-Disposition",
        `attachment; filename=cita_${appt.id}.ics`);
    res.send(icsContent);
  } catch (error) {
    res.status(500).send("Error generando el calendario.");
  }
});

// For cost control, limit instances
setGlobalOptions({maxInstances: 10});

// Export the Express API wrapped in a Firebase Function with secret access
exports.api = onRequest({
  secrets: [
    geminiApiKey,
    phoneNumberId,
    whatsappApiToken,
    whatsappVerifyToken,
  ],
}, app);

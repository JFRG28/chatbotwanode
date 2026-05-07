require('dotenv').config();
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware para parsear JSON
app.use(express.json());

// Endpoint GET para la verificación del Webhook de Meta
app.get('/webhook', (req, res) => {
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
    
    // Parámetros que envía Meta
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === verifyToken) {
            console.log('Webhook verificado correctamente.');
            // Responde con el challenge proporcionado por Meta
            res.status(200).send(challenge);
        } else {
            console.log('Fallo en la verificación del Webhook. Tokens no coinciden.');
            res.sendStatus(403);
        }
    } else {
        res.sendStatus(400);
    }
});

// Endpoint POST para recibir los eventos/mensajes de WhatsApp
app.post('/webhook', (req, res) => {
    // Imprimir el JSON recibido de forma legible
    console.log('Evento de WhatsApp recibido:', JSON.stringify(req.body, null, 2));

    // Meta requiere un status 200 INMEDIATO para evitar reintentos
    res.sendStatus(200);
});

app.listen(PORT, () => {
    console.log(`Servidor de Webhook de WhatsApp corriendo en el puerto ${PORT}`);
});

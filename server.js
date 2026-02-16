const { makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const pino = require('pino');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const SESSION_DIR = './sessions';

// Ensure session directory exists
if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
}

// Bot Configuration
const BOT_NAME = 'TOXICYOBBY-MD';
let prefix = '.';
let isConnected = false;

// Logger
const logger = pino({ level: 'silent' });

// Store for pairing codes
const pairingCodes = new Map();

// Serve static files
app.use(express.static('public'));
app.use(express.json());

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/status', (req, res) => {
    res.json({ connected: isConnected, botName: BOT_NAME });
});

// Socket.IO Connection
io.on('connection', async (socket) => {
    console.log('Client connected');
    
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger,
        browser: [BOT_NAME, 'Chrome', '1.0.0'],
        getMessage: async (key) => {
            return { conversation: '' };
        }
    });

    // QR Code Event
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            const qrImage = await qrcode.toDataURL(qr);
            socket.emit('qr', qrImage);
            socket.emit('log', { type: 'info', message: 'QR Code generated. Scan with WhatsApp.' });
        }
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            isConnected = false;
            socket.emit('status', { connected: false });
            socket.emit('log', { type: 'warning', message: 'Connection closed. Reconnecting...' });
            
            if (shouldReconnect) {
                setTimeout(() => location.reload(), 3000);
            }
        } else if (connection === 'open') {
            isConnected = true;
            socket.emit('status', { connected: true });
            socket.emit('log', { type: 'success', message: 'Successfully connected to WhatsApp!' });
        }
    });

    // Save credentials
    sock.ev.on('creds.update', saveCreds);

    // Message handler
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.key.fromMe && m.type === 'notify') {
            await handleMessage(sock, msg);
        }
    });

    // Pairing code request
    socket.on('request-pairing', async (phoneNumber) => {
        try {
            const code = await sock.requestPairingCode(phoneNumber);
            pairingCodes.set(phoneNumber, code);
            socket.emit('pairing-code', { code, phone: phoneNumber });
            socket.emit('log', { type: 'success', message: `Pairing code generated: ${code}` });
        } catch (error) {
            socket.emit('log', { type: 'error', message: `Failed to generate pairing code: ${error.message}` });
        }
    });
});

// Command Handler
async function handleMessage(sock, msg) {
    const from = msg.key.remoteJid;
    const text = msg.message?.conversation || 
                 msg.message?.extendedTextMessage?.text || '';
    
    if (!text.startsWith(prefix)) return;

    const [cmd, ...args] = text.slice(prefix.length).toLowerCase().split(' ');
    const command = cmd.toLowerCase();

    const commands = {
        'menu': () => sendMenu(sock, from),
        'ping': () => sendText(sock, from, 'Pong! 🏓'),
        'alive': () => sendText(sock, from, `${BOT_NAME} is alive and running! 🚀`),
        'setprefix': () => {
            if (args[0]) {
                prefix = args[0];
                sendText(sock, from, `Prefix changed to: ${prefix}`);
            } else {
                sendText(sock, from, 'Please provide a prefix. Example: .setprefix !');
            }
        },
        'typing': async () => {
            await sock.sendPresenceUpdate('composing', from);
            sendText(sock, from, 'Typing indicator activated!');
        },
        'recording': async () => {
            await sock.sendPresenceUpdate('recording', from);
            sendText(sock, from, 'Recording indicator activated!');
        },
        'sticker': () => sendText(sock, from, 'Reply to an image with .sticker to create a sticker!'),
        'help': () => sendHelp(sock, from),
        'owner': () => sendText(sock, from, 'Bot Owner: TOXICYOBBY\nContact: wa.me/1234567890'),
        'info': () => sendBotInfo(sock, from)
    };

    if (commands[command]) {
        await commands[command]();
    }
}

// Send Functions
async function sendText(sock, to, text) {
    await sock.sendMessage(to, { text });
}

async function sendMenu(sock, to) {
    const menuText = `
╭━━━❰ *${BOT_NAME}* ❱━━━╮
┃
┃ 📌 *MAIN COMMANDS*
┃ • ${prefix}menu - Show this menu
┃ • ${prefix}ping - Check bot response
┃ • ${prefix}alive - Bot status
┃ • ${prefix}info - Bot information
┃ • ${prefix}owner - Contact owner
┃
┃ ⚙️ *SETTINGS*
┃ • ${prefix}setprefix [char] - Change prefix
┃ • ${prefix}typing - Fake typing
┃ • ${prefix}recording - Fake recording
┃
┃ 🎮 *FUN*
┃ • ${prefix}sticker - Create sticker
┃ • ${prefix}quote - Random quote
┃ • ${prefix}joke - Random joke
┃
┃ 🛡️ *GROUP*
┃ • ${prefix}kick @user - Remove member
┃ • ${prefix}promote @user - Promote admin
┃ • ${prefix}demote @user - Demote admin
┃ • ${prefix}tagall - Tag everyone
┃
┃ 📥 *DOWNLOADER*
┃ • ${prefix}yta [url] - YouTube audio
┃ • ${prefix}ytv [url] - YouTube video
┃ • ${prefix}tiktok [url] - TikTok
┃ • ${prefix}ig [url] - Instagram
┃
╰━━━━━━━━━━━━━━━╯
    `.trim();
    
    await sock.sendMessage(to, { text: menuText });
}

async function sendHelp(sock, to) {
    const helpText = `
*${BOT_NAME} HELP*

📚 *Getting Started*
1. Connect the bot using QR code or pairing code
2. Send .menu to see all commands
3. Use commands with your set prefix

🔧 *Configuration*
- Change prefix: ${prefix}setprefix [character]
- Check status: ${prefix}alive

💡 *Tips*
- Reply to images with .sticker
- Use @mention for group commands
- Report issues to the owner

Version: 1.0.0
    `.trim();
    
    await sock.sendMessage(to, { text: helpText });
}

async function sendBotInfo(sock, to) {
    const infoText = `
╭─「 *${BOT_NAME}* 」
│ *Name:* ${BOT_NAME}
│ *Version:* 1.0.0
│ *Library:* Bailey's
│ *Platform:* Render
│ *Uptime:* ${Math.floor(process.uptime())}s
│ *Memory:* ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB
╰──────────────
    `.trim();
    
    await sock.sendMessage(to, { text: infoText });
}

// Start Server
httpServer.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════╗
║       ${BOT_NAME} Started!           
║       Port: ${PORT}                  
╚══════════════════════════════════════╝
    `);
});

module.exports = { app, httpServer };

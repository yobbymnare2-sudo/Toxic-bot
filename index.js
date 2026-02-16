const express = require('express')
const path = require('path')
const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys')
const P = require('pino')

const app = express()
const PORT = process.env.PORT || 3000

// Serve public folder
app.use(express.static(path.join(__dirname, 'public')))

// Simple endpoint for home page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'))
})

// Start Express server
app.listen(PORT, () => console.log(`🌐 Web interface running on port ${PORT}`))

// --------- WhatsApp Bot ---------
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./session')

    const sock = makeWASocket({
        auth: state,
        logger: P({ level: 'silent' }),
        browser: ['Chrome', 'Safari', 'Mac OS'] // shows Chrome/Mac OS
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', (update) => {
        const { connection } = update
        if(connection === 'open') console.log('✅ Bot connected!')
        if(connection === 'close') {
            console.log('⚡ Connection closed, reconnecting...')
            startBot()
        }
        if(update.qr) console.log('📌 Pairing code:', update.qr)
    })

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0]
        if(!msg.message || msg.key.fromMe) return

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text
        const from = msg.key.remoteJid

        if(text?.toLowerCase() === 'hi') {
            await sock.sendMessage(from, { text: 'Hello 👋 TOXICTECH-MD bot is online!' })
        }
        if(text?.toLowerCase() === '/menu'){
            const menu = `🔥 TOXICTECH-MD Mini Bot Menu 🔥
1️⃣ hi → Say hello
2️⃣ about → About bot
3️⃣ joke → Fun joke
4️⃣ help → Commands help`
            await sock.sendMessage(from, { text: menu })
        }
    })
}

startBot()

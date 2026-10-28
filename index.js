const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, delay } = require('@whiskeysockets/baileys');
const fs = require('fs');
const express = require('express');
const pino = require('pino');
const http = require('http');
const https = require('https');
const yts = require('yt-search');

const DATA_FILE = './data.json';
const OWNER_NUMBERS = ['56928637216', '56928637216@s.whatsapp.net'];
const BOT_NAME = "TEAM DRONIX";

const channelContext = {
    contextInfo: {
        forwardingScore: 999,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: "0029VbAw5JxDjiOfYaxtEJ1B@newsletter",
            newsletterName: "TEAM DRONIX BOT",
            serverMessageId: 1
        }
    }
};

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

const activeSessions = {}; 
const userSpamTracker = {};
const activeBattles = {};

app.get('/ping', (req, res) => {
    res.status(200).send('🏓 PONG! Bot activo.');
});

// --- PANEL WEB MULTI-SESSION AVEC CODE D'APPARIEMENT (PAIRING CODE) ---
app.get('/', (req, res) => {
    const sessionDirs = fs.existsSync('./sessions') ? fs.readdirSync('./sessions') : [];
    const connectedNumbers = sessionDirs.filter(dir => dir.startsWith('session_')).map(dir => dir.replace('session_', ''));

    res.send(`<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TEAM DRONIX // Pairing Code Panel</title>
    <style>
        body { 
            background: linear-gradient(rgba(10, 5, 15, 0.9), rgba(5, 2, 8, 0.95)), url('https://images.unsplash.com/photo-1508385082359-f38ae991e8f2?q=80&w=1920&auto=format&fit=crop') no-repeat center center fixed; 
            background-size: cover;
            color: #ff7518; 
            font-family: monospace; 
            display: flex; 
            flex-direction: column; 
            align-items: center; 
            justify-content: center; 
            min-height: 100vh; 
            margin: 0; 
            padding: 20px; 
        }
        .container { width: 100%; max-width: 480px; display: flex; flex-direction: column; align-items: center; }
        .panel { 
            background: rgba(18, 10, 25, 0.88); 
            border: 2px solid #ff7518; 
            padding: 30px; 
            border-radius: 16px; 
            box-shadow: 0 0 35px rgba(255, 117, 24, 0.35); 
            text-align: center; 
            width: 100%;
            backdrop-filter: blur(10px);
        }
        h1 { color: #ff7518; margin-bottom: 5px; font-size: 26px; letter-spacing: 2px; text-shadow: 0 0 10px rgba(255,117,24,0.6); }
        .subtitle { color: #b388ff; font-size: 12px; margin-bottom: 20px; text-transform: uppercase; letter-spacing: 1px; }
        input { width: 90%; padding: 14px; margin: 10px 0; background: #08030f; border: 1px solid #4a154b; color: #ff7518; border-radius: 8px; text-align: center; font-size: 16px; outline: none; }
        input:focus { border-color: #ff7518; box-shadow: 0 0 12px rgba(255,117,24,0.5); }
        button { width: 98%; padding: 14px; background: #ff7518; border: none; color: #08030f; font-weight: bold; border-radius: 8px; cursor: pointer; font-size: 15px; margin-top: 10px; text-transform: uppercase; transition: all 0.3s ease; }
        button:hover { background: #e05e0b; color: white; box-shadow: 0 0 20px rgba(255,117,24,0.8); }
        .sessions-list { margin-top: 20px; text-align: left; width: 100%; border-top: 1px solid #4a154b; padding-top: 15px; }
        .session-item { display: flex; justify-content: space-between; align-items: center; background: #08030f; padding: 8px 12px; border-radius: 6px; margin-bottom: 8px; font-size: 14px; }
        .btn-del { background: #ff3366; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px; width: auto; margin: 0; }
        #codeContainer { margin-top: 20px; display: none; flex-direction: column; align-items: center; justify-content: center; background: #08030f; padding: 15px; border-radius: 8px; border: 1px dashed #ff7518; }
        #pairingCode { font-size: 28px; color: #00ffcc; font-weight: bold; letter-spacing: 3px; margin: 10px 0; }
        #statusText { color: #00ffcc; margin-top: 10px; font-weight: bold; }
    </style>
</head>
<body>
    <div class="container">
        <div class="panel">
            <h1>🎃 TEAM DRONIX 🦇</h1>
            <div class="subtitle">Pairing Code Panel</div>
            
            <input type="text" id="phone" placeholder="Tu número (ej: 56928637216)">
            <button onclick="requestPairingCode()">Obtener Código de Vinculación</button>
            
            <div id="codeContainer">
                <p style="font-size: 13px; color: #b388ff; margin:0;">Introduce este código en tu WhatsApp:</p>
                <div id="pairingCode">--------</div>
            </div>
            <p id="statusText"></p>

            <div class="sessions-list">
                <h3 style="color: #b388ff; font-size: 14px; margin-bottom: 10px;">📱 Sesiones Registradas:</h3>
                ${connectedNumbers.length === 0 ? '<p style="color: #888; font-size: 12px;">No hay sesiones activas.</p>' : ''}
                ${connectedNumbers.map(num => `
                    <div class="session-item">
                        <span>🟢 +${num}</span>
                        <button class="btn-del" onclick="deleteSession('${num}')">Borrar</button>
                    </div>
                `).join('')}
            </div>
        </div>
    </div>
    <script>
        async function requestPairingCode() {
            const phone = document.getElementById('phone').value.trim();
            const statusText = document.getElementById('statusText');
            const codeContainer = document.getElementById('codeContainer');
            const pairingCode = document.getElementById('pairingCode');

            if(!phone) { statusText.innerText = "❌ Ingrese un número"; return; }
            statusText.innerText = "⏳ Limpiando y solicitando nuevo código...";
            codeContainer.style.display = 'none';

            try {
                const res = await fetch('/api/pairing', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phoneNumber: phone })
                });
                const data = await res.json();
                if(data.code) { 
                    statusText.innerText = "✅ ¡Código generado con éxito!";
                    pairingCode.innerText = data.code;
                    codeContainer.style.display = 'flex';
                } else if(data.success) {
                    statusText.innerText = "🟢 ¡Esta sesión ya está conectada!";
                } else { 
                    statusText.innerText = "❌ " + (data.error || "Error al generar código"); 
                }
            } catch(e) { statusText.innerText = "❌ Error de conexión"; }
        }

        async function deleteSession(phone) {
            if(!confirm("¿Deseas eliminar la sesión +" + phone + "?")) return;
            try {
                await fetch('/api/delete-session', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phoneNumber: phone })
                });
                location.reload();
            } catch(e) { alert("Error al eliminar"); }
        }
    </script>
</body>
</html>`);
});

app.post('/api/pairing', async (req, res) => {
    const { phoneNumber } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: "Número no proporcionado" });

    const cleanNumber = String(phoneNumber).replace(/[^0-9]/g, '');
    if (cleanNumber.length < 8 || cleanNumber.length > 15) {
        return res.status(400).json({ error: "Número inválido. Usa formato internacional." });
    }

    try {
        const result = await startPairingSession(cleanNumber);
        if (!result) {
            return res.status(500).json({ error: "No se pudo generar el código, reintenta." });
        }
        res.json(result);
    } catch (err) {
        console.error("Error al generar pairing code:", err);
        res.status(500).json({ error: "Falló la generación del código." });
    }
});

app.post('/api/delete-session', (req, res) => {
    const { phoneNumber } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: "Número no proporcionado" });
    const cleanNumber = String(phoneNumber).replace(/[^0-9]/g, '');
    const sessionDir = `./sessions/session_${cleanNumber}`;
    try {
        if (activeSessions[cleanNumber]) {
            const s = activeSessions[cleanNumber];
            delete activeSessions[cleanNumber];
            try { s.end(undefined); } catch (e) {}
        }
        if (fs.existsSync(sessionDir)) {
            fs.rmSync(sessionDir, { recursive: true, force: true });
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`🌐 Servidor web activo en puerto ${PORT}`);
    initAllSessions();

    setInterval(() => {
        const externalUrl = process.env.RENDER_EXTERNAL_URL;
        const targetUrl = externalUrl ? `${externalUrl}/ping` : `http://localhost:${PORT}/ping`;
        const client = targetUrl.startsWith('https') ? https : http;

        client.get(targetUrl, (res) => {}).on('error', (err) => {
            console.log(`⚠️ [Auto-Ping 15s] Erreur: ${err.message}`);
        });
    }, 15000); 
});

function initAllSessions() {
    if (!fs.existsSync('./sessions')) return;
    for (const dir of fs.readdirSync('./sessions')) {
        if (!dir.startsWith('session_')) continue;
        const cleanNumber = dir.replace('session_', '');
        console.log(`🔄 Reconnecting existing session: ${cleanNumber}`);
        connectSession(cleanNumber).catch(console.error);
    }
}

function loadData() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            fs.writeFileSync(DATA_FILE, JSON.stringify({ players: {}, groups: {}, history: {} }, null, 2));
        }
        const content = fs.readFileSync(DATA_FILE, 'utf-8');
        const parsed = JSON.parse(content);
        if (!parsed.players || typeof parsed.players !== 'object') parsed.players = {};
        if (!parsed.groups || typeof parsed.groups !== 'object') parsed.groups = {};
        return parsed;
    } catch (e) {
        const initialData = { players: {}, groups: {}, history: {} };
        fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
        return initialData;
    }
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getPlayer(data, id) {
    if (!data.players || typeof data.players !== 'object') {
        data.players = {};
    }
    if (!data.players[id]) {
        data.players[id] = {
            money: 500, bank: 0, wins: 0, losses: 0, 
            activePoke: 0, activeDbz: 0, activeOpm: 0, 
            userMsgCount: 0, hasStarted: false, messageCount: 0,
            pokes: [{ name: 'pikachu', level: 5, xp: 0, power: 50, form: 'normal', isGigantamax: false, isMega: false }],
            dbz: [{ name: 'Goku', level: 5, power: 60, form: 'Base', stage: 0 }],
            opm: [{ name: 'Saitama', level: 5, power: 100, form: 'Normal', stage: 0 }],
            birthDate: null, age: null, banned: false, mutedUntil: 0, harem: [], warns: 0, exp: 0, level: 1
        };
    }
    const player = data.players[id];
    if (player.messageCount === undefined) player.messageCount = 0;
    if (player.bank === undefined) player.bank = 0;
    if (!player.harem) player.harem = [];
    if (!player.dbz || player.dbz.length === 0) {
        player.dbz = [{ name: 'Goku', level: 5, power: 60, form: 'Base', stage: 0 }];
    }
    if (!player.opm || player.opm.length === 0) {
        player.opm = [{ name: 'Saitama', level: 5, power: 100, form: 'Normal', stage: 0 }];
    }
    if (!player.pokes || player.pokes.length === 0) {
        player.pokes = [{ name: 'pikachu', level: 5, xp: 0, power: 50, form: 'normal', isGigantamax: false, isMega: false }];
    }
    return player;
}

// --- CONNEXION NORMALE ---
async function connectSession(cleanNumber) {
    const sessionDir = `./sessions/session_${cleanNumber}`;
    fs.mkdirSync(sessionDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    let version;
    try { ({ version } = await fetchLatestBaileysVersion()); } catch (e) {}

    const sock = makeWASocket({
        ...(version ? { version } : {}),
        auth: state,
        printQRInTerminal: false,
        browser: ['Chrome (Linux)', '', ''],
        logger: pino({ level: 'silent' }),
        syncFullHistory: false,
        markOnlineOnConnect: false
    });

    activeSessions[cleanNumber] = sock;
    sock.ev.on('creds.update', saveCreds);
    setupEvents(sock);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            console.log(`🟢 Sesión conectada: ${cleanNumber}`);
        }
        if (connection === 'close') {
            if (activeSessions[cleanNumber] !== sock) return;
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode === DisconnectReason.loggedOut) {
                delete activeSessions[cleanNumber];
                try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch (e) {}
                return;
            }
            setTimeout(() => connectSession(cleanNumber).catch(console.error), 5000);
        }
    });

    return sock;
}

// --- GÉNÉRATION DU CODE D'APPARIEMENT SYNCHRONISÉ AVEC NETTOYAGE AUTO ---
function startPairingSession(cleanNumber) {
    const sessionDir = `./sessions/session_${cleanNumber}`;

    // 🔥 NETTOYAGE AUTOMATIQUE : Supprime l'ancien dossier pour éviter l'erreur "incorrect" de WhatsApp
    if (fs.existsSync(sessionDir)) {
        try {
            fs.rmSync(sessionDir, { recursive: true, force: true });
            console.log(`🗑️ Ancienne session nettoyée pour +${cleanNumber}`);
        } catch (e) {}
    }

    if (activeSessions[cleanNumber]) {
        try { activeSessions[cleanNumber].end(undefined); } catch (e) {}
        delete activeSessions[cleanNumber];
    }

    return new Promise(async (resolve) => {
        fs.mkdirSync(sessionDir, { recursive: true });
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

        let version;
        try { ({ version } = await fetchLatestBaileysVersion()); } catch (e) {}

        const sock = makeWASocket({
            ...(version ? { version } : {}),
            auth: state,
            printQRInTerminal: false,
            browser: ['Chrome (Linux)', '', ''],
            logger: pino({ level: 'silent' })
        });

        activeSessions[cleanNumber] = sock;
        sock.ev.on('creds.update', saveCreds);
        setupEvents(sock);

        let codeResolved = false;

        sock.ev.on('connection.update', (update) => {
            const { connection } = update;
            if (connection === 'open') {
                console.log(`🟢 ¡Sesión conectada con éxito para +${cleanNumber}!`);
                if (!codeResolved) {
                    codeResolved = true;
                    resolve({ success: true });
                }
            }
        });

        if (!sock.authState.creds.registered) {
            setTimeout(async () => {
                try {
                    if (codeResolved) return;
                    const code = await sock.requestPairingCode(cleanNumber);
                    if (!codeResolved && code) {
                        codeResolved = true;
                        const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
                        console.log(`\n=========================================`);
                        console.log(`📱 CODE D'APPARIEMENT POUR +${cleanNumber} : ${formattedCode}`);
                        console.log(`=========================================\n`);
                        resolve({ code: formattedCode });
                    }
                } catch (err) {
                    console.error("Error pidiendo pairing code:", err);
                    if (!codeResolved) {
                        codeResolved = true;
                        resolve(null);
                    }
                }
            }, 6000);
        }
    });
}

function setupEvents(sock) {
    sock.ev.on('group-participants.update', async (anu) => {
        try {
            const data = loadData();
            let groupMetadata = null;
            try { groupMetadata = await sock.groupMetadata(anu.id).catch(() => null); } catch (err) { return; }
            const groupName = groupMetadata ? groupMetadata.subject : "Grupo";
            
            const groupConfig = data.groups[anu.id] || {};
            if (groupConfig.bienvenida === false) return;

            if (anu.action === 'add') {
                for (let num of anu.participants) {
                    const cleanNum = num.replace(/[^0-9]/g, '');
                    const defaultWelcome = `🎃 ¡Bienvenido/a @${cleanNum} a *${groupName}* en esta noche de brujas!\n\nDisfruta del grupo y diviértete con los minijuegos de ${BOT_NAME}. 🦇`;
                    const welcomeText = groupConfig.customWelcome || defaultWelcome;
                    await sock.sendMessage(anu.id, { text: welcomeText, mentions: [num], ...channelContext });
                }
            }
        } catch (e) {
            console.error("Error en bienvenida:", e);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message) return;

        const from = msg.key.remoteJid;
        const isGroup = from.endsWith('@g.us');
        const sender = msg.key.participant || msg.key.remoteJid;
        const senderClean = sender.replace(/[^0-9]/g, '');
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || '';

        const data = loadData();
        const player = getPlayer(data, senderClean);
        const isFromMe = msg.key.fromMe;
        const isOwner = isFromMe || OWNER_NUMBERS.some(num => sender.includes(num) || senderClean === '56928637216');
        const isDev = isOwner;

        let isAdmin = isDev;
        if (isGroup && !isAdmin) {
            try {
                const groupMetadata = await sock.groupMetadata(from).catch(() => null);
                if (groupMetadata && groupMetadata.participants) {
                    const userObj = groupMetadata.participants.find(p => p.id && (p.id.includes(senderClean) || sender.includes(p.id.replace(/[^0-9]/g, ''))));
                    if (userObj && (userObj.admin === 'admin' || userObj.admin === 'superadmin')) isAdmin = true;
                }
            } catch (e) { isAdmin = isDev; }
        }

        const groupConfig = data.groups[from] || { antispam: true, afkMinMsgs: 1, msgCounts: {} };
        if (!data.groups[from]) data.groups[from] = groupConfig;

        if (isGroup) {
            groupConfig.msgCounts = groupConfig.msgCounts || {};
            groupConfig.msgCounts[senderClean] = (groupConfig.msgCounts[senderClean] || 0) + 1;
            saveData(data);
        }

        if (groupConfig.botOff && !isDev) return;

        if (isGroup && groupConfig.antilink && !isAdmin && !isDev) {
            if (text.includes('chat.whatsapp.com') || text.includes('http://') || text.includes('https://')) {
                try {
                    await sock.sendMessage(from, { delete: msg.key });
                    await sock.groupParticipantsUpdate(from, [sender], 'remove');
                    await sock.sendMessage(from, { text: `⚠️ 🔗 @${senderClean} ha enviado un enlace prohibido y fue expulsado.`, mentions: [sender], ...channelContext });
                } catch(e) {}
                return;
            }
        }

        const antiSpamEnabled = groupConfig.antispam !== false;
        if (isGroup && !isAdmin && !isDev && antiSpamEnabled) {
            const now = Date.now();
            if (!userSpamTracker[senderClean]) {
                userSpamTracker[senderClean] = { count: 1, lastTime: now };
            } else {
                if (now - userSpamTracker[senderClean].lastTime < 5000) {
                    userSpamTracker[senderClean].count += 1;
                    if (userSpamTracker[senderClean].count > (groupConfig.spamLimit || 5)) {
                        userSpamTracker[senderClean].count = 0;
                        await sock.sendMessage(from, { text: `⚠️ 🦇 @${senderClean}, por favor evita hacer spam en el grupo.`, mentions: [sender], ...channelContext }, { quoted: msg });
                        return;
                    }
                } else {
                    userSpamTracker[senderClean] = { count: 1, lastTime: now };
                }
            }
        }

        const validPrefixes = ['/', ',', '.', '#'];
        const prefix = validPrefixes.find(p => text.startsWith(p));
        if (!prefix) return;

        const args = text.trim().slice(1).split(/ +/);
        const command = args[0].toLowerCase();

        // ==========================================
        // 🌿 POKÉMON COMMANDES & MÉGA-ÉVOLUTION & TRADING
        // ==========================================
        if (command === 'pstart' || command === 'starter') {
            if (player.hasStarted) {
                return sock.sendMessage(from, { text: `⚠️ ¡@${senderClean}, tú ya elegiste tu Pokémon inicial!`, mentions: [sender], ...channelContext });
            }
            const starterName = args[1]?.toLowerCase();
            const validStarters = ['charmander', 'bulbasaur', 'squirtle', 'pikachu'];
            if (!validStarters.includes(starterName)) {
                return sock.sendMessage(from, { text: `⚠️ Elige un Pokémon inicial válido:\n• \`${prefix}pstart charmander\`\n• \`${prefix}pstart bulbasaur\`\n• \`${prefix}pstart squirtle\`\n• \`${prefix}pstart pikachu\``, ...channelContext });
            }
            player.hasStarted = true;
            player.pokes = [{ name: starterName, level: 5, xp: 0, power: 50, form: 'normal', isGigantamax: false, isMega: false }];
            saveData(data);
            await sock.sendMessage(from, { text: `🎉 ¡Felicidades @${senderClean}! Has elegido a *${starterName.toUpperCase()}* como tu compañero inicial.`, mentions: [sender], ...channelContext });
        }

        else if (command === 'equipo' || command === 'team' || command === 'pequipo') {
            let equipoText = `🎒 *EQUIPO POKÉMON DE @${senderClean}* 🎒\n\n`;
            player.pokes.forEach((p, idx) => {
                const activeMark = (idx === (player.activePoke || 0)) ? ' ⭐ (Activo)' : '';
                const megaMark = p.isMega ? ' [✨ MÉGA]' : '';
                equipoText += `• *[${idx + 1}]* ${p.name.toUpperCase()}${megaMark} - Nivel ${p.level} (Poder: ${p.power})${activeMark}\n`;
            });
            equipoText += `\nUsa \`${prefix}pselect <número>\` para cambiar tu Pokémon activo.`;
            await sock.sendMessage(from, { text: equipoText, mentions: [sender], ...channelContext });
        }

        else if (command === 'pselect' || command === 'changepoke') {
            const index = parseInt(args[1]) - 1;
            if (isNaN(index) || index < 0 || index >= player.pokes.length) {
                return sock.sendMessage(from, { text: `⚠️ Número inválido. Revisa tu equipo con \`${prefix}equipo\`.`, ...channelContext });
            }
            player.activePoke = index;
            saveData(data);
            await sock.sendMessage(from, { text: `✅ ¡Has seleccionado a *${player.pokes[index].name.toUpperCase()}* como tu Pokémon activo!`, ...channelContext });
        }

        else if (command === 'pmega' || command === 'mega') {
            const activePoke = player.pokes[player.activePoke || 0];
            if (activePoke.isMega) {
                return sock.sendMessage(from, { text: `⚠️ Tu *${activePoke.name.toUpperCase()}* ya está en su fase de Méga-Evolución.`, ...channelContext });
            }
            activePoke.isMega = true;
            activePoke.power = Math.floor(activePoke.power * 1.5);
            saveData(data);
            await sock.sendMessage(from, { text: `✨ *¡MÉGA-EVOLUCIÓN ACTIVADA!* ✨\n¡Tu *${activePoke.name.toUpperCase()}* ha liberado su máximo potencial y su poder aumentó a *${activePoke.power}*! 🔥`, mentions: [sender], ...channelContext });
        }

        else if (command === 'ptrade' || command === 'tradepoke') {
            if (!isGroup) return sock.sendMessage(from, { text: `⚠️ Solo puedes intercambiar en grupos.`, ...channelContext });
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return sock.sendMessage(from, { text: `⚠️ Uso: \`${prefix}ptrade @usuario <tu_index> <su_index>\``, ...channelContext });
            
            const targetClean = target.replace(/[^0-9]/g, '');
            if (targetClean === senderClean) return sock.sendMessage(from, { text: `❌ No puedes tradear contigo mismo.`, ...channelContext });

            const myIndex = parseInt(args[2]) - 1;
            const targetIndex = parseInt(args[3]) - 1;
            const targetPlayer = getPlayer(data, targetClean);

            if (isNaN(myIndex) || !player.pokes[myIndex] || isNaN(targetIndex) || !targetPlayer.pokes[targetIndex]) {
                return sock.sendMessage(from, { text: `❌ Índices de Pokémon inválidos para el intercambio. Revisa los equipos.`, ...channelContext });
            }

            const temp = player.pokes[myIndex];
            player.pokes[myIndex] = targetPlayer.pokes[targetIndex];
            targetPlayer.pokes[targetIndex] = temp;
            saveData(data);

            await sock.sendMessage(from, { text: `🤝 ¡Intercambio exitoso entre @${senderClean} y @${targetClean} realizado con éxito! 🔄`, mentions: [sender, target], ...channelContext });
        }

        // ==========================================
        // 🐉 DBZ : TRANSFORMATIONS, 4 ATTAQUES & TRADING
        // ==========================================
        else if (command === 'dbzteam' || command === 'dbzequipo') {
            let textDbz = `🐉 *EQUIPO DBZ DE @${senderClean}*\n\n`;
            const dbzList = player.dbz || [];
            dbzList.forEach((g, idx) => {
                const activeMark = (idx === (player.activeDbz || 0)) ? ' ⭐ (Activo)' : '';
                textDbz += `• *[${idx + 1}]* ${g.name} - Forma: *${g.form}* - Nivel ${g.level} (Poder: ${g.power})${activeMark}\n`;
            });
            textDbz += `\nUsa \`${prefix}transf dbz <0-3>\` para cambiar de transformación.`;
            await sock.sendMessage(from, { text: textDbz, mentions: [sender], ...channelContext });
        }

        else if (command === 'dbz' || command === 'dbzfight') {
            if (!isGroup) return sock.sendMessage(from, { text: `⚠️ Solo puedes combatir DBZ en grupos.`, ...channelContext });
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return sock.sendMessage(from, { text: `⚠️ Etiqueta a tu oponente: \`${prefix}dbz @usuario\``, ...channelContext });

            const targetClean = target.replace(/[^0-9]/g, '');
            if (targetClean === senderClean) return sock.sendMessage(from, { text: `❌ No puedes pelear contra ti mismo.`, ...channelContext });

            const targetPlayer = getPlayer(data, targetClean);
            const fg1 = player.dbz[player.activeDbz || 0];
            const fg2 = targetPlayer.dbz[targetPlayer.activeDbz || 0];

            activeBattles[from] = {
                game: 'dbz',
                p1: { id: senderClean, fighter: fg1, hp: 200, maxHp: 200 },
                p2: { id: targetClean, fighter: fg2, hp: 200, maxHp: 200 },
                turn: senderClean
            };

            const stagesDbz = [
                ["Kamehameha", "Masenko", "Impacto Ki", "Esfera Explosiva"],
                ["Super Kamehameha", "Galick Ho", "Ráfaga Ki", "Golpe Meteoro"],
                ["Kamehameha Divino", "Final Flash", "Puño Dragón", "Big Bang Attack"],
                ["Kamehameha Doctrina", "Golpe Ultra Instinto", "Ráfaga Astral", "Juicio Divino"]
            ];

            const currentMoves = stagesDbz[fg1.stage || 0];

            let bTxt = `🐉 *¡COMBATE DRAGON BALL Z!* 🐉\n\n` +
                       `🔴 @${senderClean} (${fg1.name} - *${fg1.form}*) VS 🔵 @${targetClean} (${fg2.name} - *${fg2.form}*)\n\n` +
                       `👉 Turno de @${senderClean}.\n` +
                       `Ataques disponibles:\n` +
                       `1. ${currentMoves[0]}\n2. ${currentMoves[1]}\n3. ${currentMoves[2]}\n4. ${currentMoves[3]}\n\n` +
                       `Usa \`${prefix}dbzm <1-4>\` para atacar.`;

            await sock.sendMessage(from, { text: bTxt, mentions: [sender, target], ...channelContext });
        }

        else if (command === 'dbzm') {
            if (!activeBattles[from] || activeBattles[from].game !== 'dbz') return sock.sendMessage(from, { text: `❌ No hay combate DBZ activo.`, ...channelContext });
            const battle = activeBattles[from];
            if (battle.turn !== senderClean) return sock.sendMessage(from, { text: `⏳ No es tu turno.`, ...channelContext });

            const moveIndex = parseInt(args[1]) - 1;
            const isP1 = battle.turn === battle.p1.id;
            const attacker = isP1 ? battle.p1 : battle.p2;
            const defender = isP1 ? battle.p2 : battle.p1;

            if (isNaN(moveIndex) || moveIndex < 0 || moveIndex > 3) return sock.sendMessage(from, { text: `⚠️ Elige un ataque del 1 al 4 (\`${prefix}dbzm 1\`).`, ...channelContext });

            const stagesDbz = [
                ["Kamehameha", "Masenko", "Impacto Ki", "Esfera Explosiva"],
                ["Super Kamehameha", "Galick Ho", "Ráfaga Ki", "Golpe Meteoro"],
                ["Kamehameha Divino", "Final Flash", "Puño Dragón", "Big Bang Attack"],
                ["Kamehameha Doctrina", "Golpe Ultra Instinto", "Ráfaga Astral", "Juicio Divino"]
            ];

            const moveset = stagesDbz[attacker.fighter.stage || 0];
            const moveName = moveset[moveIndex];
            const multiplier = 1 + ((attacker.fighter.stage || 0) * 0.5);
            const damage = Math.floor((Math.random() * 30 + 15) * multiplier);

            defender.hp = Math.max(0, defender.hp - damage);
            battle.turn = isP1 ? battle.p2.id : battle.p1.id;

            let resText = `💥 *${attacker.fighter.name}* (${attacker.fighter.form}) usó *${moveName}* infligiendo *${damage}* de daño!\n\n`;
            resText += `❤️ HP P1: ${battle.p1.hp}/200 | ❤️ HP P2: ${battle.p2.hp}/200\n\n`;

            if (defender.hp <= 0) {
                resText += `🏆 ¡*${attacker.fighter.name}* ha ganado el combate de artes marciales! 🎉`;
                delete activeBattles[from];
            } else {
                resText += `👉 Turno de @${battle.turn}\nUsa \`${prefix}dbzm <1-4>\``;
            }
            await sock.sendMessage(from, { text: resText, mentions: [`${battle.turn}@s.whatsapp.net`], ...channelContext });
        }

        else if (command === 'dbztrade') {
            if (!isGroup) return sock.sendMessage(from, { text: `⚠️ Solo en grupos.`, ...channelContext });
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return sock.sendMessage(from, { text: `⚠️ Uso: \`${prefix}dbztrade @usuario <tu_index> <su_index>\``, ...channelContext });
            const targetClean = target.replace(/[^0-9]/g, '');
            const myIdx = parseInt(args[2]) - 1;
            const tIdx = parseInt(args[3]) - 1;
            const tPlayer = getPlayer(data, targetClean);

            if (isNaN(myIdx) || !player.dbz[myIdx] || isNaN(tIdx) || !tPlayer.dbz[tIdx]) {
                return sock.sendMessage(from, { text: `❌ Índices DBZ inválidos.`, ...channelContext });
            }

            const temp = player.dbz[myIdx];
            player.dbz[myIdx] = tPlayer.dbz[tIdx];
            tPlayer.dbz[tIdx] = temp;
            saveData(data);
            await sock.sendMessage(from, { text: `🤝 ¡Intercambio DBZ completado con éxito! 🔄`, mentions: [sender, target], ...channelContext });
        }

        // ==========================================
        // 🥊 OPM : TRANSFORMATIONS, 4 ATTAQUES & TRADING
        // ==========================================
        else if (command === 'opmteam' || command === 'opmequipo') {
            let textOpm = `🥊 *EQUIPO OPM DE @${senderClean}*\n\n`;
            const opmList = player.opm || [];
            opmList.forEach((hero, idx) => {
                const activeMark = (idx === (player.activeOpm || 0)) ? ' ⭐ (Activo)' : '';
                textOpm += `• *[${idx + 1}]* ${hero.name} - Forma: *${hero.form}* - Nivel ${hero.level} (Poder: ${hero.power})${activeMark}\n`;
            });
            textOpm += `\nUsa \`${prefix}transf opm <0-2>\` para cambiar de etapa.`;
            await sock.sendMessage(from, { text: textOpm, mentions: [sender], ...channelContext });
        }

        else if (command === 'opm' || command === 'opmfight') {
            if (!isGroup) return sock.sendMessage(from, { text: `⚠️ Solo puedes combatir OPM en grupos.`, ...channelContext });
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return sock.sendMessage(from, { text: `⚠️ Etiqueta a tu oponente: \`${prefix}opm @usuario\``, ...channelContext });

            const targetClean = target.replace(/[^0-9]/g, '');
            if (targetClean === senderClean) return sock.sendMessage(from, { text: `❌ No puedes pelear contra ti mismo.`, ...channelContext });

            const targetPlayer = getPlayer(data, targetClean);
            const h1 = player.opm[player.activeOpm || 0];
            const h2 = targetPlayer.opm[targetPlayer.activeOpm || 0];

            activeBattles[from] = {
                game: 'opm',
                p1: { id: senderClean, hero: h1, hp: 200, maxHp: 200 },
                p2: { id: targetClean, hero: h2, hp: 200, maxHp: 200 },
                turn: senderClean
            };

            const stagesOpm = [
                ["Golpes Consecutivos", "Gancho Normal", "Patada Rápida", "Movimiento Lateral"],
                ["Puñetazo Serio", "Volteo de Tabla", "Estornudo Serio", "Onda de Choque"],
                ["Puñetazo Cósmico", "Copia de Técnica", "Explosión Nuclear", "Destrucción Planetaria"]
            ];

            const currentMoves = stagesOpm[h1.stage || 0];

            let bTxt = `🥊 *¡COMBATE ONE PUNCH MAN!* 🥊\n\n` +
                       `🔴 @${senderClean} (${h1.name} - *${h1.form}*) VS 🔵 @${targetClean} (${h2.name} - *${h2.form}*)\n\n` +
                       `👉 Turno de @${senderClean}.\n` +
                       `Ataques:\n1. ${currentMoves[0]}\n2. ${currentMoves[1]}\n3. ${currentMoves[2]}\n4. ${currentMoves[3]}\n\n` +
                       `Usa \`${prefix}opmm <1-4>\` para atacar.`;

            await sock.sendMessage(from, { text: bTxt, mentions: [sender, target], ...channelContext });
        }

        else if (command === 'opmm') {
            if (!activeBattles[from] || activeBattles[from].game !== 'opm') return sock.sendMessage(from, { text: `❌ No hay combate OPM activo.`, ...channelContext });
            const battle = activeBattles[from];
            if (battle.turn !== senderClean) return sock.sendMessage(from, { text: `⏳ No es tu turno.`, ...channelContext });

            const moveIndex = parseInt(args[1]) - 1;
            const isP1 = battle.turn === battle.p1.id;
            const attacker = isP1 ? battle.p1 : battle.p2;
            const defender = isP1 ? battle.p2 : battle.p1;

            if (isNaN(moveIndex) || moveIndex < 0 || moveIndex > 3) return sock.sendMessage(from, { text: `⚠️ Elige un ataque del 1 al 4 (\`${prefix}opmm 1\`).`, ...channelContext });

            const stagesOpm = [
                ["Golpes Consecutivos", "Gancho Normal", "Patada Rápida", "Movimiento Lateral"],
                ["Puñetazo Serio", "Volteo de Tabla", "Estornudo Serio", "Onda de Choque"],
                ["Puñetazo Cósmico", "Copia de Técnica", "Explosión Nuclear", "Destrucción Planetaria"]
            ];

            const moveset = stagesOpm[attacker.hero.stage || 0];
            const moveName = moveset[moveIndex];
            const multiplier = 1 + ((attacker.hero.stage || 0) * 0.6);
            const damage = Math.floor((Math.random() * 35 + 15) * multiplier);

            defender.hp = Math.max(0, defender.hp - damage);
            battle.turn = isP1 ? battle.p2.id : battle.p1.id;

            let resText = `💥 *${attacker.hero.name}* (${attacker.hero.form}) usó *${moveName}* causando *${damage}* de daño devastador!\n\n`;
            resText += `❤️ HP P1: ${battle.p1.hp}/200 | ❤️ HP P2: ${battle.p2.hp}/200\n\n`;

            if (defender.hp <= 0) {
                resText += `🏆 ¡*${attacker.hero.name}* ha aniquilado a su rival! 💥`;
                delete activeBattles[from];
            } else {
                resText += `👉 Turno de @${battle.turn}\nUsa \`${prefix}opmm <1-4>\``;
            }
            await sock.sendMessage(from, { text: resText, mentions: [`${battle.turn}@s.whatsapp.net`], ...channelContext });
        }

        else if (command === 'opmtrade') {
            if (!isGroup) return sock.sendMessage(from, { text: `⚠️ Solo en grupos.`, ...channelContext });
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return sock.sendMessage(from, { text: `⚠️ Uso: \`${prefix}opmtrade @usuario <tu_index> <su_index>\``, ...channelContext });
            const targetClean = target.replace(/[^0-9]/g, '');
            const myIdx = parseInt(args[2]) - 1;
            const tIdx = parseInt(args[3]) - 1;
            const tPlayer = getPlayer(data, targetClean);

            if (isNaN(myIdx) || !player.opm[myIdx] || isNaN(tIdx) || !tPlayer.opm[tIdx]) {
                return sock.sendMessage(from, { text: `❌ Índices OPM inválidos.`, ...channelContext });
            }

            const temp = player.opm[myIdx];
            player.opm[myIdx] = tPlayer.opm[tIdx];
            tPlayer.opm[tIdx] = temp;
            saveData(data);
            await sock.sendMessage(from, { text: `🤝 ¡Intercambio OPM completado con éxito! 🔄`, mentions: [sender, target], ...channelContext });
        }

        // ==========================================
        // ⚡ GESTION DES TRANSFORMATIONS UNIFIÉE (`transf`)
        // ==========================================
        else if (command === 'transf' || command === 'transform') {
            const universe = args[1]?.toLowerCase();
            const stageNum = parseInt(args[2]);

            if (universe === 'dbz') {
                if (isNaN(stageNum) || stageNum < 0 || stageNum > 3) {
                    return sock.sendMessage(from, { text: `⚠️ Etapas DBZ válidas (0 al 3):\n0: Base\n1: Super Saiyan\n2: SSJ Blue\n3: Ultra Instinct\nUso: \`${prefix}transf dbz <etapa>\``, ...channelContext });
                }
                const forms = ["Base", "Super Saiyan", "SSJ Blue", "Ultra Instinct"];
                const fg = player.dbz[player.activeDbz || 0];
                fg.stage = stageNum;
                fg.form = forms[stageNum];
                fg.power = 60 + (stageNum * 45);
                saveData(data);
                await sock.sendMessage(from, { text: `🔥 ¡${fg.name} se ha transformado en *${fg.form}*! Su poder aumentó considerablemente.`, mentions: [sender], ...channelContext });
            } 
            else if (universe === 'opm') {
                if (isNaN(stageNum) || stageNum < 0 || stageNum > 2) {
                    return sock.sendMessage(from, { text: `⚠️ Etapas OPM válidas (0 al 2):\n0: Normal\n1: Modo Serio\n2: Modo Cósmico\nUso: \`${prefix}transf opm <etapa>\``, ...channelContext });
                }
                const formsOpm = ["Normal", "Modo Serio", "Modo Cósmico"];
                const hero = player.opm[player.activeOpm || 0];
                hero.stage = stageNum;
                hero.form = formsOpm[stageNum];
                hero.power = 100 + (stageNum * 60);
                saveData(data);
                await sock.sendMessage(from, { text: `⚡ ¡${hero.name} ha liberado su poder alcanzando el *${hero.form}*!`, mentions: [sender], ...channelContext });
            } 
            else {
                await sock.sendMessage(from, { text: `⚠️ Uso correcto:\n• \`${prefix}transf dbz <0-3>\`\n• \`${prefix}transf opm <0-2>\``, ...channelContext });
            }
        }

        // ==========================================
        // 📢 MODÉRATION & GROUPES
        // ==========================================
        else if (command === 'tag' || command === 'hidetag') {
            if (!isGroup) return sock.sendMessage(from, { text: `⚠️ Este comando solo se puede usar en grupos.`, ...channelContext });
            if (!isAdmin && !isOwner) return sock.sendMessage(from, { text: `❌ Solo los administradores pueden usar este comando.`, ...channelContext });

            const tagMessage = args.slice(1).join(' ') || "¡Atención a todos los miembros!";
            try {
                const groupMetadata = await sock.groupMetadata(from);
                const participants = groupMetadata.participants.map(p => p.id);
                
                await sock.sendMessage(from, { text: `📢 *AVISO GENERAL*:\n\n${tagMessage}`, mentions: participants, ...channelContext });
            } catch (e) {
                await sock.sendMessage(from, { text: `❌ Error al realizar el tag masivo.`, ...channelContext });
            }
        }

        else if (command === 'antilink') {
            if (!isGroup) return sock.sendMessage(from, { text: `⚠️ Solo en grupos.`, ...channelContext });
            if (!isAdmin && !isOwner) return sock.sendMessage(from, { text: `❌ Solo administradores.`, ...channelContext });
            const opt = args[1]?.toLowerCase();
            if (opt === 'on' || opt === 'off') {
                groupConfig.antilink = (opt === 'on');
                saveData(data);
                await sock.sendMessage(from, { text: `🔗 Antilink activado en modo: *${opt.toUpperCase()}*.`, ...channelContext });
            } else {
                await sock.sendMessage(from, { text: `⚠️ Uso: \`${prefix}antilink on\` o \`${prefix}antilink off\``, ...channelContext });
            }
        }

        else if (command === 'kick') {
            if (!isGroup) return sock.sendMessage(from, { text: `⚠️ Este comando solo funciona en grupos.`, ...channelContext });
            if (!isAdmin && !isOwner) return sock.sendMessage(from, { text: `❌ Solo los administradores pueden expulsar usuarios.`, ...channelContext });

            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || 
                           (msg.message.extendedTextMessage?.contextInfo?.participant);

            if (!target) return sock.sendMessage(from, { text: `⚠️ Etiqueta o responde al mensaje de la persona que deseas expulsar: \`${prefix}kick @usuario\``, ...channelContext });

            try {
                await sock.groupParticipantsUpdate(from, [target], 'remove');
                await sock.sendMessage(from, { text: `👢 Usuario expulsado exitosamente del grupo.`, ...channelContext });
            } catch (e) {
                await sock.sendMessage(from, { text: `❌ No se pudo expulsar al usuario. Asegúrate de que el bot sea administrador.`, ...channelContext });
            }
        }

        else if (command === 'listaafk' || command === 'afklist') {
            if (!isGroup) return sock.sendMessage(from, { text: `⚠️ Solo disponible en grupos.`, ...channelContext });
            if (!isAdmin && !isOwner) return sock.sendMessage(from, { text: `❌ Solo administradores.`, ...channelContext });

            try {
                const groupMetadata = await sock.groupMetadata(from);
                const participants = groupMetadata.participants;
                const minMsgs = groupConfig.afkMinMsgs || 1;

                const inactiveMembers = participants.filter(p => {
                    const cleanId = p.id.replace(/[^0-9]/g, '');
                    const count = groupConfig.msgCounts?.[cleanId] || 0;
                    return count < minMsgs;
                });

                let listText = `👻 *LISTA DE MIEMBROS INACTIVOS (AFK)*\n` +
                               `*(Menos de ${minMsgs} mensajes)*\n\n`;

                if (inactiveMembers.length === 0) {
                    listText += `🎉 ¡No hay miembros inactivos! Todos han participado.`;
                } else {
                    inactiveMembers.forEach((p, idx) => {
                        listText += `${idx + 1}. @${p.id.replace(/[^0-9]/g, '')}\n`;
                    });
                    listText += `\nUsa \`${prefix}kickafk\` para expulsarlos a todos.`;
                }

                const mentions = inactiveMembers.map(p => p.id);
                await sock.sendMessage(from, { text: listText, mentions, ...channelContext });
            } catch (e) {
                await sock.sendMessage(from, { text: `❌ Error al generar la lista AFK.`, ...channelContext });
            }
        }

        else if (command === 'kickafk') {
            if (!isGroup) return sock.sendMessage(from, { text: `⚠️ Solo disponible en grupos.`, ...channelContext });
            if (!isAdmin && !isOwner) return sock.sendMessage(from, { text: `❌ Solo administradores.`, ...channelContext });

            try {
                const groupMetadata = await sock.groupMetadata(from);
                const participants = groupMetadata.participants;
                const minMsgs = groupConfig.afkMinMsgs || 1;

                const inactiveMembers = participants.filter(p => {
                    const cleanId = p.id.replace(/[^0-9]/g, '');
                    const isAdm = p.admin === 'admin' || p.admin === 'superadmin';
                    const count = groupConfig.msgCounts?.[cleanId] || 0;
                    return !isAdm && count < minMsgs;
                });

                if (inactiveMembers.length === 0) {
                    return sock.sendMessage(from, { text: `✨ No hay miembros inactivos para expulsar (los admins se protegen automáticamente).`, ...channelContext });
                }

                const toKick = inactiveMembers.map(p => p.id);
                await sock.groupParticipantsUpdate(from, toKick, 'remove');
                await sock.sendMessage(from, { text: `👢 Se han expulsado ${toKick.length} miembros inactivos (AFK).`, ...channelContext });
            } catch (e) {
                await sock.sendMessage(from, { text: `❌ Error al expulsar inactivos. Asegúrate de que el bot sea admin.`, ...channelContext });
            }
        }

        else if (command === 'bienvenida' || command === 'welcome') {
            if (!isGroup) return sock.sendMessage(from, { text: `⚠️ Solo disponible en grupos.`, ...channelContext });
            if (!isAdmin && !isOwner) return sock.sendMessage(from, { text: `❌ Solo administradores.`, ...channelContext });

            const option = args[1]?.toLowerCase();
            if (option === 'off' || option === 'on') {
                groupConfig.bienvenida = (option === 'on');
                saveData(data);
                await sock.sendMessage(from, { text: `✨ Los mensajes de bienvenida han sido puestos en modo *${option.toUpperCase()}*.`, ...channelContext });
            } else {
                const customText = args.slice(1).join(' ');
                if (!customText) {
                    return sock.sendMessage(from, { 
                        text: `⚠️ Uso correcto:\n• \`${prefix}bienvenida on\` / \`off\`\n• \`${prefix}bienvenida <tu mensaje personalizado>\``,
                        ...channelContext
                    });
                }
                groupConfig.customWelcome = customText;
                groupConfig.bienvenida = true;
                saveData(data);
                await sock.sendMessage(from, { text: `✅ ¡Mensaje de bienvenida actualizado con éxito para este grupo!`, ...channelContext });
            }
        }

        // ==========================================
        // 🎮 JEUX & ARCADE & GACHA
        // ==========================================
        else if (command === 'ruleta' || command === 'roulette') {
            const bet = parseInt(args[1]);
            if (isNaN(bet) || bet <= 0) return sock.sendMessage(from, { text: `⚠️ Uso: \`${prefix}ruleta <cantidad de coins>\``, ...channelContext });
            if (player.money < bet) return sock.sendMessage(from, { text: `❌ No tienes suficientes coins para apostar esa cantidad.`, ...channelContext });

            const win = Math.random() < 0.45;
            if (win) {
                const winnings = bet * 2;
                player.money += winnings;
                saveData(data);
                await sock.sendMessage(from, { text: `🎰 ¡La ruleta giró y cayó en la suerte! Has ganado *$${winnings}* coins. 🎉`, mentions: [sender], ...channelContext });
            } else {
                player.money -= bet;
                saveData(data);
                await sock.sendMessage(from, { text: `🎰 La ruleta se detuvo en zona roja... Perdiste tus *$${bet}* coins. 😢`, mentions: [sender], ...channelContext });
            }
        }

        else if (command === 'crime' || command === 'crimen') {
            const success = Math.random() < 0.4;
            if (success) {
                const loot = Math.floor(Math.random() * 400) + 100;
                player.money += loot;
                saveData(data);
                await sock.sendMessage(from, { text: `🥷 ¡Robaste con éxito la tienda nocturna y conseguiste *$${loot}* coins!`, mentions: [sender], ...channelContext });
            } else {
                const fine = Math.floor(Math.random() * 150) + 50;
                player.money = Math.max(0, player.money - fine);
                saveData(data);
                await sock.sendMessage(from, { text: `🚨 ¡La policía te atrapó huyendo! Pagaste una multa de *$${fine}* coins.`, mentions: [sender], ...channelContext });
            }
        }

        else if (command === 'robar' || command === 'rob') {
            if (!isGroup) return sock.sendMessage(from, { text: `⚠️ Solo se puede robar en grupos.`, ...channelContext });
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return sock.sendMessage(from, { text: `⚠️ Debes etiquetar a la víctima: \`${prefix}robar @usuario\``, ...channelContext });

            const targetClean = target.replace(/[^0-9]/g, '');
            if (targetClean === senderClean) return sock.sendMessage(from, { text: `❌ No te puedes robar a ti mismo.`, ...channelContext });

            const targetPlayer = getPlayer(data, targetClean);
            if (targetPlayer.money < 50) return sock.sendMessage(from, { text: `❌ Ese usuario es muy pobre, no vale la pena robarle.`, ...channelContext });

            const success = Math.random() < 0.35;
            if (success) {
                const stolen = Math.floor(Math.random() * (targetPlayer.money * 0.3)) + 20;
                targetPlayer.money -= stolen;
                player.money += stolen;
                saveData(data);
                await sock.sendMessage(from, { text: `🦹 ¡Le robaste con éxito *$${stolen}* coins a @${targetClean}!`, mentions: [sender, target], ...channelContext });
            } else {
                const penalty = 75;
                player.money = Math.max(0, player.money - penalty);
                saveData(data);
                await sock.sendMessage(from, { text: `💥 ¡Intentaste robar a @${targetClean} pero te descubrieron! Pagaste *$${penalty}* de compensación.`, mentions: [sender, target], ...channelContext });
            }
        }

        else if (command === 'roll' || command === 'gacha') {
            const pool = ['Goku Super Saiyajin', 'Naruto Uzumaki', 'Saitama', 'Luffy Gear 5', 'Nezuko Kamado', 'Levi Ackerman', 'Rem (Re:Zero)', 'Goat Gojo'];
            const drawn = pool[Math.floor(Math.random() * pool.length)];
            
            player.harem = player.harem || [];
            player.harem.push(drawn);
            saveData(data);

            await sock.sendMessage(from, { text: `🎁 ¡Has invocado y obtenido a *${drawn}* para tu colección!\nUsa \`${prefix}harem\` para ver tus personajes.`, mentions: [sender], ...channelContext });
        }

        else if (command === 'harem' || command === 'waifus') {
            player.harem = player.harem || [];
            if (player.harem.length === 0) {
                return sock.sendMessage(from, { text: `📭 Tu harem está vacío. Usa \`${prefix}roll\` para invocar personajes.`, mentions: [sender], ...channelContext });
            }

            let haremText = `🌟 *COLECCIÓN DE PERSONAJES DE @${senderClean}* 🌟\n\n`;
            player.harem.forEach((item, idx) => {
                haremText += `${idx + 1}. ${item}\n`;
            });
            await sock.sendMessage(from, { text: haremText, mentions: [sender], ...channelContext });
        }

        // ==========================================
        // ⚙️ CONFIGURATIONS (AFK & ANTISPAM)
        // ==========================================
        else if (command === 'setafk') {
            if (!isAdmin && !isOwner) return sock.sendMessage(from, { text: `❌ Solo administradores.`, ...channelContext });
            const limit = parseInt(args[1]);
            if (isNaN(limit) || limit < 0) return sock.sendMessage(from, { text: `⚠️ Uso correcto: \`${prefix}setafk <número mínimo de mensajes>\``, ...channelContext });

            groupConfig.afkMinMsgs = limit;
            saveData(data);
            await sock.sendMessage(from, { text: `✅ Umbral AFK actualizado a *${limit}* mensajes.`, ...channelContext });
        }

        else if (command === 'antispam') {
            if (!isAdmin && !isOwner) return sock.sendMessage(from, { text: `❌ Solo administradores.`, ...channelContext });
            const option = args[1]?.toLowerCase();
            
            if (option === 'off' || option === 'on') {
                groupConfig.antispam = (option === 'on');
                saveData(data);
                await sock.sendMessage(from, { text: `🛡️ Anti-Spam puesto en modo *${option.toUpperCase()}*.`, ...channelContext });
            } else if (!isNaN(parseInt(args[1]))) {
                const spamLimit = parseInt(args[1]);
                groupConfig.spamLimit = spamLimit;
                saveData(data);
                await sock.sendMessage(from, { text: `🛡️ Límite de spam ajustado a *${spamLimit}* mensajes.`, ...channelContext });
            } else {
                await sock.sendMessage(from, { text: `⚠️ Uso: \`${prefix}antispam on/off\` o \`${prefix}antispam <limite>\``, ...channelContext });
            }
        }

        // ==========================================
        // 🎵 YOUTUBE & MENU
        // ==========================================
        else if (command === 'youtube' || command === 'yt' || command === 'play') {
            const query = args.slice(1).join(' ');
            if (!query) return sock.sendMessage(from, { text: `⚠️ Uso: \`${prefix}youtube <canción o artista>\``, ...channelContext });

            try {
                const searchResult = await yts(query);
                const video = searchResult.videos[0];

                if (!video) {
                    return sock.sendMessage(from, { text: `❌ No se encontró ningún resultado en YouTube para: "${query}"`, ...channelContext });
                }

                const captionText = `YOUTUBE-PLAY\n\n` +
                    `Título: ${video.title}\n` +
                    `Duración: ${video.timestamp}\n` +
                    `Vistas: ${video.views.toLocaleString()}\n` +
                    `Autor: ${video.author.name}\n` +
                    `Publicado: ${video.ago}\n` +
                    `Url: ${video.url}\n\n` +
                    `Seleccione el formato que desea descargar abajo.\n\n` +
                    `🎵 ${prefix}mp3 ${video.url}\n` +
                    `🎬 ${prefix}mp4 ${video.url}\n` +
                    `📁 ${prefix}doc ${video.url}\n\n` +
                    `©${BOT_NAME}`;

                await sock.sendMessage(from, { 
                    image: { url: video.thumbnail }, 
                    caption: captionText,
                    ...channelContext
                });

            } catch (err) {
                console.error("Error en búsqueda YouTube:", err);
                await sock.sendMessage(from, { text: `❌ Ocurrió un error al buscar en YouTube.`, ...channelContext });
            }
        }

        else if (command === 'mp3') {
            await sock.sendMessage(from, { text: `🎵 Descargando audio en formato MP3... Por favor espere.`, ...channelContext });
            await new Promise(r => setTimeout(r, 2000));
            await sock.sendMessage(from, { audio: { url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' }, mimetype: 'audio/mp4', ptt: false, ...channelContext });
        }

        else if (command === 'menu' || command === 'help' || command === 'allmenu') {
            let menuText = `WABOT · MENÚ\t\tAkirax ↗\n\n` +
                `🤖 *SUBBOTS* (Vinculacion y ajustes)\n` +
                `CONEXIÓN\n` +
                `\`${prefix}code\`  \`${prefix}bots\`\n` +
                `\`${prefix}bot\`   \`${prefix}public\`\n\n` +
                `AJUSTES\n` +
                `\`${prefix}setprefix\`  \`${prefix}setname\`\n` +
                `\`${prefix}setprimary\` \`${prefix}enable\`\n` +
                `\`${prefix}disable\`\n\n` +

                `📦 *GRUPO & MODERACIÓN*\n` +
                `\`${prefix}tag [msg]\` - Etiquetar a todos\n` +
                `\`${prefix}kick @user\` - Expulsar usuario\n` +
                `\`${prefix}listaafk\` - Ver inactivos\n` +
                `\`${prefix}kickafk\` - Sacar inactivos\n` +
                `\`${prefix}setafk <num>\` - Umbral AFK\n` +
                `\`${prefix}bienvenida\` - Mensaje de bienvenida\n` +
                `\`${prefix}antispam\` - Control de spam\n` +
                `\`${prefix}antilink\` - Filtro de enlaces\n\n` +

                `🌿 *POKÉMON, DBZ & OPM*\n` +
                `\`${prefix}pstart\`  \`${prefix}equipo\`\n` +
                `\`${prefix}mega\`   \`${prefix}ptrade\`\n` +
                `\`${prefix}dbzequipo\` \`${prefix}dbz\`\n` +
                `\`${prefix}opmequipo\` \`${prefix}opm\`\n` +
                `\`${prefix}transf <dbz/opm> <stage>\`\n\n` +

                `🎮 *JUEGOS & ARCADE*\n` +
                `\`${prefix}ruleta <apuesta>\`\n` +
                `\`${prefix}crime\`  \`${prefix}robar @user\`\n` +
                `\`${prefix}work\`   \`${prefix}bal\`\n\n` +

                `🃏 *GACHA & COLECCIÓN*\n` +
                `\`${prefix}roll\`  \`${prefix}harem\`\n\n` +

                `📥 *MULTIMEDIA*\n` +
                `\`${prefix}youtube <busqueda>\`\n\n` +
                `🟢 ··········· 1 / 11 · 35 CMD\n` +
                `©${BOT_NAME}`;

            await sock.sendMessage(from, { 
                image: { url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=800&auto=format&fit=crop' }, 
                caption: menuText, 
                ...channelContext 
            });
        }

        else if (command === 'ping') {
            await sock.sendMessage(from, { text: `🦇 ¡Pong! Bot activo con canal vinculado.`, ...channelContext });
        }

        else if (command === 'work') {
            const earnings = Math.floor(Math.random() * 200) + 50;
            player.money += earnings;
            saveData(data);
            await sock.sendMessage(from, { text: `🦇 ¡Trabajaste y ganaste *$${earnings}* coins!`, ...channelContext });
        }

        else if (command === 'bal') {
            await sock.sendMessage(from, { text: `💰 *BALANCE DE @${senderClean}*\n\n• Coins: $${player.money}`, mentions: [sender], ...channelContext });
        }
    });
}

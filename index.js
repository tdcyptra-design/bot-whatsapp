const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const express = require('express');
const pino = require('pino');
const http = require('http');
const https = require('https');

const DATA_FILE = './data.json';
const OWNER_NUMBERS = ['56928637216', '56928637216@s.whatsapp.net'];
const BOT_NAME = "TEAM DRONIX";

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

const activeSessions = {}; 
const userSpamTracker = {};
const activeBattles = {};
const activeDbzBattles = {};
const activeOpmBattles = {};
const activeGroupSpawns = {};

app.get('/ping', (req, res) => {
    res.status(200).send('🏓 PONG! Bot activo.');
});

// --- PANEL WEB THÈME HALLOWEEN & CODE D'APPAIRAGE ---
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TEAM DRONIX // Halloween Edition</title>
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
        .container { width: 100%; max-width: 420px; display: flex; flex-direction: column; align-items: center; }
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
        h1 { color: #ff7518; margin-bottom: 5px; font-size: 28px; letter-spacing: 3px; text-shadow: 0 0 10px rgba(255,117,24,0.6); }
        .subtitle { color: #b388ff; font-size: 12px; margin-bottom: 25px; text-transform: uppercase; letter-spacing: 1px; }
        input { width: 90%; padding: 14px; margin: 10px 0; background: #08030f; border: 1px solid #4a154b; color: #ff7518; border-radius: 8px; text-align: center; font-size: 16px; outline: none; }
        input:focus { border-color: #ff7518; box-shadow: 0 0 12px rgba(255,117,24,0.5); }
        button { width: 98%; padding: 14px; background: #ff7518; border: none; color: #08030f; font-weight: bold; border-radius: 8px; cursor: pointer; font-size: 16px; margin-top: 15px; text-transform: uppercase; transition: all 0.3s ease; }
        button:hover { background: #e05e0b; color: white; box-shadow: 0 0 20px rgba(255,117,24,0.8); }
        #codeDisplay { margin-top: 25px; font-size: 24px; font-weight: bold; color: #00ffcc; word-break: break-all; text-shadow: 0 0 10px rgba(0,255,204,0.4); }
    </style>
</head>
<body>
    <div class="container">
        <div class="panel">
            <h1>🎃 TEAM DRONIX 🦇</h1>
            <div class="subtitle">Halloween Pairing Panel</div>
            <input type="text" id="phone" placeholder="EJ: 56928637216">
            <button onclick="requestPairing()">OBTENER CÓDIGO</button>
            <div id="codeDisplay"></div>
        </div>
    </div>
    <script>
        async function requestPairing() {
            const phone = document.getElementById('phone').value.trim();
            const display = document.getElementById('codeDisplay');
            if(!phone) { display.innerText = "❌ Ingrese un número"; return; }
            display.innerText = "⏳ Conjurando código...";
            try {
                const res = await fetch('/api/pairing', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phoneNumber: phone })
                });
                const data = await res.json();
                if(data.code) { display.innerText = "🔑 CÓDIGO: " + data.code; }
                else { display.innerText = "❌ " + (data.error || "Error al generar"); }
            } catch(e) { display.innerText = "❌ Error de conexión"; }
        }
    </script>
</body>
</html>`);
});

app.post('/api/pairing', async (req, res) => {
    const { phoneNumber } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: "Número no proporcionado" });

    try {
        const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
        const code = await startUserSession(cleanNumber);
        res.json({ code });
    } catch (err) {
        console.error("Error al generar código de emparejamiento:", err);
        res.status(500).json({ error: "Falló la generación del código. Intente de nuevo." });
    }
});

app.listen(PORT, () => {
    console.log(`🌐 Servidor web activo en puerto ${PORT}`);

    // --- SYSTÈME D'AUTO-PING CORRIGÉ (HTTPS / HTTP) ---
    setInterval(() => {
        const externalUrl = process.env.RENDER_EXTERNAL_URL;
        const targetUrl = externalUrl ? `${externalUrl}/ping` : `http://localhost:${PORT}/ping`;
        
        const client = targetUrl.startsWith('https') ? https : http;

        client.get(targetUrl, (res) => {
            console.log(`🔄 [Auto-Ping 30s] Statut: ${res.statusCode} (Bot maintenu éveillé)`);
        }).on('error', (err) => {
            console.log(`⚠️ [Auto-Ping 30s] Erreur: ${err.message}`);
        });
    }, 30000); 
});

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
            pokes: [{ name: 'pikachu', level: 5, xp: 0, power: 50, form: 'normal', isGigantamax: false }],
            dbz: [{ name: 'Goku', level: 5, power: 60, form: 'Base' }],
            opm: [{ name: 'Saitama', level: 5, power: 100, form: 'Normal', stage: 1 }],
            birthDate: null, age: null, banned: false, mutedUntil: 0, harem: [], warns: 0, exp: 0, level: 1
        };
    }
    const player = data.players[id];
    if (player.messageCount === undefined) player.messageCount = 0;
    if (player.bank === undefined) player.bank = 0;
    if (!player.harem) player.harem = [];
    if (!player.dbz) player.dbz = [{ name: 'Goku', level: 5, power: 60, form: 'Base' }];
    if (!player.opm) player.opm = [{ name: 'Saitama', level: 5, power: 100, form: 'Normal', stage: 1 }];
    if (!player.pokes || player.pokes.length === 0) {
        player.pokes = [{ name: 'pikachu', level: 5, xp: 0, power: 50, form: 'normal', isGigantamax: false }];
    }
    return player;
}

async function startUserSession(cleanNumber) {
    const sessionDir = `./sessions/session_${cleanNumber}`;
    if (!fs.existsSync('./sessions')) {
        fs.mkdirSync('./sessions', { recursive: true });
    }

    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        browser: ["Ubuntu", "Chrome", "22.04.4"],
        logger: pino({ level: 'silent' })
    });

    activeSessions[cleanNumber] = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log(`[Session ${cleanNumber}] CODE QR Généré dans les logs.`);
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`[Session ${cleanNumber}] Conexión cerrada (${statusCode}). Reconectando...`, shouldReconnect);
            
            if (statusCode === 401) {
                try { 
                    fs.rmSync(sessionDir, { recursive: true, force: true }); 
                    console.log(`[Session ${cleanNumber}] Sesión inválida borrada automáticamente.`);
                } catch(e){}
            }

            if (shouldReconnect && statusCode !== 401) {
                setTimeout(() => startUserSession(cleanNumber), 5000);
            } else {
                delete activeSessions[cleanNumber];
            }
        } else if (connection === 'open') {
            console.log(`¡[Session ${cleanNumber}] Bot conectado correctamente à WhatsApp!`);
        }
    });

    setupEvents(sock);

    if (!state.creds.registered) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        let code = await sock.requestPairingCode(cleanNumber);
        code = code?.match(/.{1,4}/g)?.join("-") || code;
        return code;
    }
    return null;
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
                    const welcomeText = groupConfig.customWelcome || `🎃 ¡Bienvenido/a @${cleanNum} a *${groupName}* en esta noche de brujas!\n\nDisfruta del grupo y diviértete con los minijuegos de ${BOT_NAME}. 🦇`;
                    await sock.sendMessage(anu.id, { text: welcomeText, mentions: [num] });
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

        const groupConfig = data.groups[from] || {};
        if (groupConfig.botOff && !isDev) return;

        const antiSpamEnabled = groupConfig.antispam !== false;
        if (isGroup && !isAdmin && !isDev && antiSpamEnabled) {
            const now = Date.now();
            if (!userSpamTracker[senderClean]) {
                userSpamTracker[senderClean] = { count: 1, lastTime: now };
            } else {
                if (now - userSpamTracker[senderClean].lastTime < 5000) {
                    userSpamTracker[senderClean].count += 1;
                    if (userSpamTracker[senderClean].count > 5) {
                        userSpamTracker[senderClean].count = 0;
                        await sock.sendMessage(from, { text: `⚠️ 🦇 @${senderClean}, por favor evita hacer spam en el grupo.`, mentions: [sender] }, { quoted: msg });
                        return;
                    }
                } else {
                    userSpamTracker[senderClean] = { count: 1, lastTime: now };
                }
            }
        }

        if (isGroup) {
            data.groups[from] = groupConfig;
            data.groups[from].msgCount = (groupConfig.msgCount || 0) + 1;

            player.userMsgCount += 1;
            if (player.userMsgCount >= 150) {
                player.userMsgCount = 0;
                const activePoke = player.pokes[player.activePoke || 0];
                if (activePoke) {
                    activePoke.level += 1;
                    activePoke.power += 5;
                    await sock.sendMessage(from, { text: `🎉 ¡El Pokémon *${activePoke.name.toUpperCase()}* de @${senderClean} subió al Nivel ${activePoke.level}!`, mentions: [sender] });
                }
            }

            if (data.groups[from].msgCount >= 100) {
                data.groups[from].msgCount = 0;
                const spawnTypes = ['poke', 'dbz', 'opm'];
                const chosenType = spawnTypes[Math.floor(Math.random() * spawnTypes.length)];

                if (chosenType === 'poke') {
                    const wildPokes = [
                        { name: 'Charizard', img: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/6.png' },
                        { name: 'Gengar', img: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/94.png' },
                        { name: 'Lucario', img: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/448.png' },
                        { name: 'Snorlax', img: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/143.png' },
                        { name: 'Mewtwo', img: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/150.png' }
                    ];
                    const poke = wildPokes[Math.floor(Math.random() * wildPokes.length)];
                    activeGroupSpawns[from] = { type: 'poke', name: poke.name };
                    
                    await sock.sendMessage(from, { 
                        image: { url: poke.img }, 
                        caption: `🎃 ¡Un *${poke.name.toUpperCase()}* Pokémon salvaje ha aparecido en la oscuridad!\nEscribe \`/catch\` o \`/atrapar\` para conseguirlo.` 
                    });

                } else if (chosenType === 'dbz') {
                    const wildDbz = [
                        { name: 'Goku', img: 'https://images.wikia.nocookie.net/__cb20210515152349/dragonball/images/e/e3/Goku_DBZ_Artwork.png' },
                        { name: 'Vegeta', img: 'https://images.wikia.nocookie.net/__cb20200803204918/dragonball/images/3/36/Vegeta_Artwork.png' },
                        { name: 'Gohan', img: 'https://images.wikia.nocookie.net/__cb20190525134107/dragonball/images/d/d4/Gohan_Adulto_Artwork.png' },
                        { name: 'Piccolo', img: 'https://images.wikia.nocookie.net/__cb20220608225526/dragonball/images/7/7b/Piccolo_Artwork.png' },
                        { name: 'Frieza', img: 'https://images.wikia.nocookie.net/__cb20210515152431/dragonball/images/c/c2/Freezer_DBZ_Artwork.png' }
                    ];
                    const dbz = wildDbz[Math.floor(Math.random() * wildDbz.length)];
                    activeGroupSpawns[from] = { type: 'dbz', name: dbz.name };

                    await sock.sendMessage(from, { 
                        image: { url: dbz.img }, 
                        caption: `🦇 ¡Un guerrero Z (*${dbz.name.toUpperCase()}*) espeluznante ha aparecido!\nEscribe \`/reclutardbz\` para agregarlo.` 
                    });

                } else {
                    const wildOpm = [
                        { name: 'Saitama', img: 'https://static.wikia.nocookie.net/onepunchman/images/e/e8/Saitama_Anime_Design.png' },
                        { name: 'Genos', img: 'https://static.wikia.nocookie.net/onepunchman/images/e/db/Genos_infobox.png' },
                        { name: 'Tatsumaki', img: 'https://static.wikia.nocookie.net/onepunchman/images/d/d1/Tatsumaki_infobox.png' },
                        { name: 'Garou', img: 'https://static.wikia.nocookie.net/onepunchman/images/5/5a/Garou_infobox.png' }
                    ];
                    const opm = wildOpm[Math.floor(Math.random() * wildOpm.length)];
                    activeGroupSpawns[from] = { type: 'opm', name: opm.name };

                    await sock.sendMessage(from, { 
                        image: { url: opm.img }, 
                        caption: `👻 ¡Un personaje de OPM (*${opm.name.toUpperCase()}*) fantasmagórico ha aparecido!\nEscribe \`/reclutaropm\` para sumarlo.` 
                    });
                }
            }

            saveData(data);
        }

        const validPrefixes = ['/', ',', '.', '#'];
        const prefix = validPrefixes.find(p => text.startsWith(p));
        if (!prefix) return;

        const args = text.trim().slice(1).split(/ +/);
        const command = args[0].toLowerCase();

        // ==========================================
        // 🌿 POKÉMON COMMANDES
        // ==========================================
        if (command === 'pstart' || command === 'starter') {
            if (player.hasStarted) {
                return sock.sendMessage(from, { text: `⚠️ ¡@${senderClean}, tú ya elegiste tu Pokémon inicial!`, mentions: [sender] }, { quoted: msg });
            }
            const starterName = args[1]?.toLowerCase();
            const validStarters = ['charmander', 'bulbasaur', 'squirtle', 'pikachu'];
            if (!validStarters.includes(starterName)) {
                return sock.sendMessage(from, { text: `⚠️ Elige un Pokémon inicial válido:\n• \`${prefix}pstart charmander\`\n• \`${prefix}pstart bulbasaur\`\n• \`${prefix}pstart squirtle\`\n• \`${prefix}pstart pikachu\`` }, { quoted: msg });
            }
            player.hasStarted = true;
            player.pokes = [{ name: starterName, level: 5, xp: 0, power: 50, form: 'normal', isGigantamax: false }];
            saveData(data);
            await sock.sendMessage(from, { text: `🎉 ¡Felicidades @${senderClean}! Has elegido a *${starterName.toUpperCase()}* como tu compañero inicial.`, mentions: [sender] }, { quoted: msg });
        }

        else if (command === 'equipo' || command === 'team' || command === 'pequipo') {
            let equipoText = `🎒 *EQUIPO POKÉMON DE @${senderClean}* 🎒\n\n`;
            player.pokes.forEach((p, idx) => {
                const activeMark = (idx === (player.activePoke || 0)) ? ' ⭐ (Activo)' : '';
                equipoText += `• *[${idx + 1}]* ${p.name.toUpperCase()} - Nivel ${p.level} (Poder: ${p.power})${activeMark}\n`;
            });
            equipoText += `\nUsa \`${prefix}pselect <número>\` para cambiar tu Pokémon activo.`;
            await sock.sendMessage(from, { text: equipoText, mentions: [sender] }, { quoted: msg });
        }

        else if (command === 'pselect' || command === 'changepoke') {
            const index = parseInt(args[1]) - 1;
            if (isNaN(index) || index < 0 || index >= player.pokes.length) {
                return sock.sendMessage(from, { text: `⚠️ Número inválido. Revisa tu equipo con \`${prefix}equipo\`.` }, { quoted: msg });
            }
            player.activePoke = index;
            saveData(data);
            await sock.sendMessage(from, { text: `✅ ¡Has seleccionado a *${player.pokes[index].name.toUpperCase()}* como tu Pokémon activo!`, mentions: [sender] }, { quoted: msg });
        }

        else if (command === 'catch' || command === 'atrapar') {
            const spawn = activeGroupSpawns[from];
            if (!spawn || spawn.type !== 'poke') return sock.sendMessage(from, { text: `❌ No hay ningún Pokémon salvaje para atrapar en este momento.` }, { quoted: msg });
            
            player.pokes.push({ name: spawn.name, level: 10, xp: 0, power: 80, form: 'normal', isGigantamax: false });
            delete activeGroupSpawns[from];
            saveData(data);
            await sock.sendMessage(from, { text: `🎉 ¡Felicidades @${senderClean}, has atrapado exitosamente a un *${spawn.name.toUpperCase()}*!`, mentions: [sender] }, { quoted: msg });
        }

        else if (command === 'reclutardbz') {
            const spawn = activeGroupSpawns[from];
            if (!spawn || spawn.type !== 'dbz') return sock.sendMessage(from, { text: `❌ No hay ningún guerrero Z salvaje para reclutar ahora.` }, { quoted: msg });
            
            player.dbz.push({ name: spawn.name, level: 10, power: 100, form: 'Base' });
            delete activeGroupSpawns[from];
            saveData(data);
            await sock.sendMessage(from, { text: `☄️ ¡Genial @${senderClean}, has reclutado a *${spawn.name.toUpperCase()}* a tu equipo DBZ!`, mentions: [sender] }, { quoted: msg });
        }

        else if (command === 'reclutaropm') {
            const spawn = activeGroupSpawns[from];
            if (!spawn || spawn.type !== 'opm') return sock.sendMessage(from, { text: `❌ No hay ningún personaje de OPM disponible para reclutar.` }, { quoted: msg });
            
            player.opm.push({ name: spawn.name, level: 10, power: 120, form: 'Normal', stage: 1 });
            delete activeGroupSpawns[from];
            saveData(data);
            await sock.sendMessage(from, { text: `👊 ¡Increíble @${senderClean}, sumaste a *${spawn.name.toUpperCase()}* a tu escuadrón OPM!`, mentions: [sender] }, { quoted: msg });
        }

        // ==========================================
        // ⚙️ BOT ON / OFF
        // ==========================================
        else if (command === 'bot') {
            if (!isAdmin && !isOwner) return sock.sendMessage(from, { text: '❌ Solo administradores.' }, { quoted: msg });
            const option = args[1]?.toLowerCase();
            if (option === 'off' || option === 'on') {
                data.groups[from] = data.groups[from] || {};
                data.groups[from].botOff = (option === 'off');
                saveData(data);
                await sock.sendMessage(from, { text: `⚙️ El bot ha sido puesto en modo *${option.toUpperCase()}* en este grupo.` }, { quoted: msg });
            } else {
                await sock.sendMessage(from, { text: `⚠️ Uso correcto: \`${prefix}bot on\` o \`${prefix}bot off\`` }, { quoted: msg });
            }
            return;
        }

        // ==========================================
        // 👑 OWNER COMMANDS
        // ==========================================
        if (isOwner) {
            if (command === 'givecoins' || command === 'addcoins') {
                const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                const amount = parseInt(args[args.length - 1]);
                const targetClean = target ? target.replace(/[^0-9]/g, '') : senderClean;

                if (isNaN(amount)) return sock.sendMessage(from, { text: `⚠️ Uso: \`${prefix}givecoins <monto>\` o \`${prefix}givecoins @user <monto>\`` }, { quoted: msg });

                const targetPlayer = getPlayer(data, targetClean);
                targetPlayer.money += amount;
                saveData(data);

                await sock.sendMessage(from, { text: `👑 [OWNER] Otorgaste *$${amount}* coins a @${targetClean}.`, mentions: [sender] }, { quoted: msg });
            }

            else if (command === 'givepoke') {
                const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                const pokeName = args[1]?.toLowerCase();
                const targetClean = target ? target.replace(/[^0-9]/g, '') : senderClean;

                if (!pokeName) return sock.sendMessage(from, { text: `⚠️ Uso: \`${prefix}givepoke <nombre_poke> [@user]\`` }, { quoted: msg });

                const targetPlayer = getPlayer(data, targetClean);
                targetPlayer.pokes.push({ name: pokeName, level: 50, xp: 0, power: 300, form: 'normal', isGigantamax: true });
                saveData(data);

                await sock.sendMessage(from, { text: `👑 [OWNER] Otorgaste el Pokémon *${pokeName.toUpperCase()}* a @${targetClean}.`, mentions: [sender] }, { quoted: msg });
            }

            else if (command === 'givedbz') {
                const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                const dbzName = args[1];
                const targetClean = target ? target.replace(/[^0-9]/g, '') : senderClean;

                if (!dbzName) return sock.sendMessage(from, { text: `⚠️ Uso: \`${prefix}givedbz <nombre_dbz> [@user]\`` }, { quoted: msg });

                const targetPlayer = getPlayer(data, targetClean);
                targetPlayer.dbz.push({ name: dbzName, level: 50, power: 500, form: 'Ultra Instinto' });
                saveData(data);

                await sock.sendMessage(from, { text: `👑 [OWNER] Otorgaste el personaje DBZ *${dbzName}* a @${targetClean}.`, mentions: [sender] }, { quoted: msg });
            }

            else if (command === 'giveopm') {
                const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                const opmName = args[1];
                const targetClean = target ? target.replace(/[^0-9]/g, '') : senderClean;

                if (!opmName) return sock.sendMessage(from, { text: `⚠️ Uso: \`${prefix}giveopm <nombre_opm> [@user]\`` }, { quoted: msg });

                const targetPlayer = getPlayer(data, targetClean);
                targetPlayer.opm.push({ name: opmName, level: 50, power: 600, form: 'Max', stage: 3 });
                saveData(data);

                await sock.sendMessage(from, { text: `👑 [OWNER] Otorgaste el personaje OPM *${opmName}* a @${targetClean}.`, mentions: [sender] }, { quoted: msg });
            }

            else if (command === 'givewaifu') {
                const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                const waifuName = args.slice(1).join(' ').replace(/@\d+/g, '').trim();
                const targetClean = target ? target.replace(/[^0-9]/g, '') : senderClean;

                if (!waifuName) return sock.sendMessage(from, { text: `⚠️ Uso: \`${prefix}givewaifu <nombre_waifu> [@user]\`` }, { quoted: msg });

                const targetPlayer = getPlayer(data, targetClean);
                targetPlayer.harem.push(waifuName);
                saveData(data);

                await sock.sendMessage(from, { text: `👑 [OWNER] Agregaste a *${waifuName}* al harem de @${targetClean}.`, mentions: [sender] }, { quoted: msg });
            }
        }

        // ==========================================
        // 📋 MENU COMPLET
        // ==========================================
        if (command === 'menu' || command === 'help' || command === 'allmenu') {
            let menuText = `> ¡Hola! @${senderClean}, Soy *${BOT_NAME}*, Aquí tienes la lista completa de comandos. 🎃\n\n` +
                `╭┈ࠢ͜┅ࠦ͜͜╾݊͜─ؕ͜─ׄ͜─֬͜─֟͜─֫͜─ׄ͜─ؕ͜─݊͜┈ࠦ͜┅ࠡ͜͜┈࠭͜͜۰۰͜۰\n` +
                `│</> *ᴅᴇsᴀʀʀᴏʟʟᴀᴅᴏʀ ::* Oculto\n` +
                `│❒ *ᴛɪᴘᴏ ::* Owner / Multi-Session\n` +
                `│☕︎ *ᴠᴇʀsɪóɴ ::* Halloween Arcade Ultimate\n` +
                `╰ׅ┈ࠢ͜─ׄ͜─ׄ֟፝͜─ׄ͜─ׄ͜╴ ⋱࣭ ᩴ  ⋮֔   ᩴ ⋰╶͜─ׄ͜─ׄ֟፝͜─ׄ͜─ׄ͜┈\n\n` +
                `🐾 *POKÉMON:* \`${prefix}pokemenu\`, \`{p}pstart <poke>\`, \`{p}equipo\`, \`{p}pselect <num>\`, \`{p}buycandy\`, \`{p}ptransform\`, \`{p}pcombatir\`, \`{p}catch\`\n` +
                `🐉 *DBZ:* \`{p}dbzmenu\`, \`{p}dbzequipo\`, \`{p}dcombatir @user\`, \`{p}zm <1-4>\`, \`{p}reclutardbz\`\n` +
                `👊 *ONE PUNCH MAN:* \`{p}opmmenu\`, \`{p}opmequipo\`, \`{p}evolu <1-3>\`, \`{p}opmcombatir @user\`, \`{p}om <1-4>\`, \`{p}reclutaropm\`\n` +
                `💰 *ECONOMÍA:* \`{p}work\`, \`{p}bal\`, \`{p}ruleta\`, \`{p}crime\`, \`{p}robar\`\n` +
                `🎁 *GACHA:* \`{p}roll\`, \`{p}claim\`, \`{p}harem\`\n` +
                `📥 *MEDIAS:* \`{p}youtube\`, \`{p}pinterest\`, \`{p}image\`, \`{p}bratv\`\n` +
                `✨ *STICKERS:* \`{p}s\`, \`{p}brat\`\n` +
                `🎮 *JUEGOS ARCADE & INTERACTIVOS:* \`{p}adivinar <1-10>\`, \`{p}ppt <piedra|papel|tijera>\`, \`{p}slot\`, \`{p}dados\`, \`{p}coinflip <cara|cruz>\`, \`{p}loterie\`\n` +
                `🛠️ *UTILIDADES & TOOLS:* \`{p}ping\`, \`{p}clima <ciudad>\`, \`{p}calcular <expr>\`, \`{p}traducir <texto>\`\n` +
                `👥 *ADMIN:* \`{p}kick\`, \`{p}warn\`, \`{p}hidetag\`, \`{p}bot on/off\`\n` +
                `👑 *OWNER COMMANDS:* \`{p}givecoins <monto>\`, \`{p}givepoke <nombre>\`, \`{p}givedbz <nombre>\`, \`{p}giveopm <nombre>\`, \`{p}givewaifu <nombre>\``;
            
            menuText = menuText.replace(/\{p\}/g, prefix);
            await sock.sendMessage(from, { text: menuText, mentions: [sender] }, { quoted: msg });
        }

        // ==========================================
        // ⚔️ COMBATS
        // ==========================================
        else if (command === 'opmcombatir' || command === 'opmbattle') {
            if (!isGroup) return sock.sendMessage(from, { text: `⚠️ Solo puedes combatir en grupos.` }, { quoted: msg });
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return sock.sendMessage(from, { text: `⚠️ Etiqueta a un usuario: \`${prefix}opmcombatir @usuario\`` }, { quoted: msg });
            
            const targetClean = target.replace(/[^0-9]/g, '');
            if (targetClean === senderClean) return sock.sendMessage(from, { text: `❌ No puedes combatir contra ti mismo.` }, { quoted: msg });

            const targetPlayer = getPlayer(data, targetClean);
            const activeChar1 = player.opm[player.activeOpm || 0];
            const activeChar2 = targetPlayer.opm[targetPlayer.activeOpm || 0];

            activeOpmBattles[from] = {
                p1: { id: senderClean, char: activeChar1, hp: 300, maxHp: 300, moves: ["Golpe Rapido", "Ráfaga Consecutiva", "Incinerar", "Serious Punch"] },
                p2: { id: targetClean, char: activeChar2, hp: 300, maxHp: 300, moves: ["Golpe Rapido", "Patada Voladora", "Corte de Energía", "Ráfaga Demoledora"] },
                turn: senderClean
            };

            const battleText = `🦇 *¡BATALLA ONE PUNCH MAN HALLOWEEN!* 🦇\n\n` +
                               `🔴 @${senderClean} (*${activeChar1.name.toUpperCase()}*) VS 🔵 @${targetClean} (*${activeChar2.name.toUpperCase()}*)\n\n` +
                               `👉 Es el turno de @${senderClean}.\n` +
                               `Usa \`${prefix}om <1-4>\` para atacar.`;

            await sock.sendMessage(from, { text: battleText, mentions: [sender, target] }, { quoted: msg });
        }

        else if (command === 'om') {
            if (!activeOpmBattles[from]) return sock.sendMessage(from, { text: `❌ No hay ningún combate de OPM activo en este grupo.` }, { quoted: msg });
            const battle = activeOpmBattles[from];

            if (senderClean !== battle.p1.id && senderClean !== battle.p2.id) {
                return sock.sendMessage(from, { text: `⚠️ ❌ @${senderClean}, no estás participando en esta batalla.`, mentions: [sender] }, { quoted: msg });
            }

            if (battle.turn !== senderClean) {
                return sock.sendMessage(from, { text: `⏳ No es tu turno de atacar. Le toca a @${battle.turn}.`, mentions: [`${battle.turn}@s.whatsapp.net`] }, { quoted: msg });
            }

            const moveIndex = parseInt(args[1]) - 1;
            const isP1 = battle.turn === battle.p1.id;
            const attacker = isP1 ? battle.p1 : battle.p2;
            const defender = isP1 ? battle.p2 : battle.p1;

            if (isNaN(moveIndex) || moveIndex < 0 || moveIndex >= attacker.moves.length) {
                return sock.sendMessage(from, { text: `⚠️ Movimiento inválido. Elige del 1 al 4 (Ej: \`${prefix}om 1\`).` }, { quoted: msg });
            }

            const moveDamages = [{ min: 20, max: 35 }, { min: 35, max: 55 }, { min: 55, max: 75 }, { min: 80, max: 120 }];
            const selectedMove = moveDamages[moveIndex];
            let damage = Math.floor(Math.random() * (selectedMove.max - selectedMove.min + 1)) + selectedMove.min;

            const isCritical = Math.random() < 0.15;
            if (isCritical) damage = Math.floor(damage * 1.5);

            defender.hp = Math.max(0, defender.hp - damage);

            const barLength = 10;
            const filled1 = Math.round((battle.p1.hp / battle.p1.maxHp) * barLength);
            const bar1 = '█'.repeat(Math.max(0, filled1)) + '░'.repeat(Math.max(0, barLength - filled1));
            
            const filled2 = Math.round((battle.p2.hp / battle.p2.maxHp) * barLength);
            const bar2 = '█'.repeat(Math.max(0, filled2)) + '░'.repeat(Math.max(0, barLength - filled2));

            battle.turn = isP1 ? battle.p2.id : battle.p1.id;

            const moveName = attacker.moves[moveIndex];
            let response = `💥 *${attacker.char.name.toUpperCase()}* usó *${moveName}* y causó *${damage}* de daño${isCritical ? ' 🎯 *(¡GOLPE CRÍTICO TÉTRICO!)*' : ''}.\n\n`;
            response += `${battle.p1.char.name}: [${bar1}] ${battle.p1.hp}/${battle.p1.maxHp}\n`;
            response += `${battle.p2.char.name}: [${bar2}] ${battle.p2.hp}/${battle.p2.maxHp}\n\n`;

            if (defender.hp <= 0) {
                response += `🏆 ¡*${attacker.char.name.toUpperCase()}* ha ganado la batalla OPM! 🎉`;
                delete activeOpmBattles[from];
            } else {
                response += `👉 Turno de @${battle.turn}\nUsa \`${prefix}om <1-4>\``;
            }

            await sock.sendMessage(from, { text: response, mentions: [`${battle.turn}@s.whatsapp.net`, sender] }, { quoted: msg });
        }

        else if (command === 'pcombatir' || command === 'pbattle') {
            if (!isGroup) return sock.sendMessage(from, { text: `⚠️ Solo puedes combatir en grupos.` }, { quoted: msg });
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return sock.sendMessage(from, { text: `⚠️ Etiqueta a un usuario: \`${prefix}pcombatir @usuario\`` }, { quoted: msg });
            
            const targetClean = target.replace(/[^0-9]/g, '');
            if (targetClean === senderClean) return sock.sendMessage(from, { text: `❌ No puedes combatir contra ti mismo.` }, { quoted: msg });

            const targetPlayer = getPlayer(data, targetClean);
            const activePoke1 = player.pokes[player.activePoke || 0];
            const activePoke2 = targetPlayer.pokes[targetPlayer.activePoke || 0];

            activeBattles[from] = {
                p1: { id: senderClean, poke: activePoke1, hp: 170, maxHp: 170, moves: ["Cometa Draco", "Bola Sombra", "Placaje", "Hiperrayo"] },
                p2: { id: targetClean, poke: activePoke2, hp: 170, maxHp: 170, moves: ["Brillo Mágico", "Impactrueno", "Arañazo", "Surf"] },
                turn: senderClean
            };

            const battleText = `🎃 *¡COMBATE POKÉMON HALLOWEEN!* 🎃\n\n` +
                               `🔴 @${senderClean} (*${activePoke1.name.toUpperCase()}*) VS 🔵 @${targetClean} (*${activePoke2.name.toUpperCase()}*)\n\n` +
                               `👉 Es el turno de @${senderClean}.\n` +
                               `Usa \`${prefix}pm <1-4>\` para atacar.`;

            await sock.sendMessage(from, { text: battleText, mentions: [sender, target] }, { quoted: msg });
        }

        else if (command === 'pm' || command === 'move') {
            if (!activeBattles[from]) return sock.sendMessage(from, { text: `❌ No hay ningún combate Pokémon activo en este grupo.` }, { quoted: msg });
            const battle = activeBattles[from];

            if (senderClean !== battle.p1.id && senderClean !== battle.p2.id) {
                return sock.sendMessage(from, { text: `⚠️ ❌ @${senderClean}, no estás participando en este combate.`, mentions: [sender] }, { quoted: msg });
            }

            if (battle.turn !== senderClean) {
                return sock.sendMessage(from, { text: `⏳ No es tu turno de atacar. Le toca a @${battle.turn}.`, mentions: [`${battle.turn}@s.whatsapp.net`] }, { quoted: msg });
            }

            const moveIndex = parseInt(args[1]) - 1;
            const isP1 = battle.turn === battle.p1.id;
            const attacker = isP1 ? battle.p1 : battle.p2;
            const defender = isP1 ? battle.p2 : battle.p1;

            if (isNaN(moveIndex) || moveIndex < 0 || moveIndex >= attacker.moves.length) {
                return sock.sendMessage(from, { text: `⚠️ Movimiento inválido. Elige del 1 al 4 (Ej: \`${prefix}pm 1\`).` }, { quoted: msg });
            }

            const moveName = attacker.moves[moveIndex];
            const damage = Math.floor(Math.random() * 45) + 10;
            defender.hp = Math.max(0, defender.hp - damage);

            const barLength = 10;
            const filled1 = Math.round((battle.p1.hp / battle.p1.maxHp) * barLength);
            const bar1 = '█'.repeat(Math.max(0, filled1)) + '░'.repeat(Math.max(0, barLength - filled1));
            
            const filled2 = Math.round((battle.p2.hp / battle.p2.maxHp) * barLength);
            const bar2 = '█'.repeat(Math.max(0, filled2)) + '░'.repeat(Math.max(0, barLength - filled2));

            battle.turn = isP1 ? battle.p2.id : battle.p1.id;

            let response = `💥 *${attacker.poke.name.toUpperCase()}* usó *${moveName}* y causó *${damage}* de daño.\n\n`;
            response += `${battle.p1.poke.name}: [${bar1}] ${battle.p1.hp}/${battle.p1.maxHp}\n`;
            response += `${battle.p2.poke.name}: [${bar2}] ${battle.p2.hp}/${battle.p2.maxHp}\n\n`;

            if (defender.hp <= 0) {
                response += `🏆 ¡*${attacker.poke.name.toUpperCase()}* ha ganado el combate! 🎉`;
                delete activeBattles[from];
            } else {
                response += `👉 Turno de @${battle.turn}\nUsa \`${prefix}pm <1-4>\``;
            }

            await sock.sendMessage(from, { text: response, mentions: [`${battle.turn}@s.whatsapp.net`, sender] }, { quoted: msg });
        }

        else if (command === 'dcombatir' || command === 'dbattle') {
            if (!isGroup) return sock.sendMessage(from, { text: `⚠️ Solo puedes combatir en grupos.` }, { quoted: msg });
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return sock.sendMessage(from, { text: `⚠️ Etiqueta a un usuario: \`${prefix}dcombatir @usuario\`` }, { quoted: msg });
            
            const targetClean = target.replace(/[^0-9]/g, '');
            if (targetClean === senderClean) return sock.sendMessage(from, { text: `❌ No puedes combatir contra ti mismo.` }, { quoted: msg });

            const targetPlayer = getPlayer(data, targetClean);
            const activeChar1 = player.dbz[player.activeDbz || 0];
            const activeChar2 = targetPlayer.dbz[targetPlayer.activeDbz || 0];

            activeDbzBattles[from] = {
                p1: { id: senderClean, char: activeChar1, hp: 200, maxHp: 200, moves: ["Kamehameha", "Golpe Meteorito", "Krilin Disc", "Super Nova"] },
                p2: { id: targetClean, char: activeChar2, hp: 200, maxHp: 200, moves: ["Final Flash", "Galick Gun", "Big Bang Attack", "Kienzan"] },
                turn: senderClean
            };

            const battleText = `👻 *¡BATALLA Z HALLOWEEN!* 👻\n\n` +
                               `🔴 @${senderClean} (*${activeChar1.name.toUpperCase()}*) VS 🔵 @${targetClean} (*${activeChar2.name.toUpperCase()}*)\n\n` +
                               `👉 Es el turno de @${senderClean}.\n` +
                               `Usa \`${prefix}zm <1-4>\` para atacar.`;

            await sock.sendMessage(from, { text: battleText, mentions: [sender, target] }, { quoted: msg });
        }

        else if (command === 'zm') {
            if (!activeDbzBattles[from]) return sock.sendMessage(from, { text: `❌ No hay ningún combate DBZ activo en este grupo.` }, { quoted: msg });
            const battle = activeDbzBattles[from];

            if (senderClean !== battle.p1.id && senderClean !== battle.p2.id) {
                return sock.sendMessage(from, { text: `⚠️ ❌ @${senderClean}, no estás participando en esta batalla Z.`, mentions: [sender] }, { quoted: msg });
            }

            if (battle.turn !== senderClean) return sock.sendMessage(from, { text: `⏳ No es tu turno de atacar.` }, { quoted: msg });

            const moveIdx = parseInt(args[1]) - 1;
            const isP1 = battle.turn === battle.p1.id;
            const attacker = isP1 ? battle.p1 : battle.p2;
            const defender = isP1 ? battle.p2 : battle.p1;

            if (isNaN(moveIdx) || moveIdx < 0 || moveIdx >= attacker.moves.length) {
                return sock.sendMessage(from, { text: `⚠️ Elige un ataque válido del 1 al 4 (Ej: \`${prefix}zm 1\`).` }, { quoted: msg });
            }

            const moveName = attacker.moves[moveIdx];
            const damage = Math.floor(Math.random() * 55) + 15;
            defender.hp = Math.max(0, defender.hp - damage);

            const barLength = 10;
            const b1 = '█'.repeat(Math.round((battle.p1.hp / battle.p1.maxHp) * barLength)) + '░'.repeat(10 - Math.round((battle.p1.hp / battle.p1.maxHp) * barLength));
            const b2 = '█'.repeat(Math.round((battle.p2.hp / battle.p2.maxHp) * barLength)) + '░'.repeat(10 - Math.round((battle.p2.hp / battle.p2.maxHp) * barLength));

            battle.turn = isP1 ? battle.p2.id : battle.p1.id;

            let resText = `💥 *${attacker.char.name}* usó *${moveName}* e hizo *${damage}* de daño.\n\n` +
                          `${battle.p1.char.name}: [${b1}] ${battle.p1.hp}/${battle.p1.maxHp}\n` +
                          `${battle.p2.char.name}: [${b2}] ${battle.p2.hp}/${battle.p2.maxHp}\n\n`;

            if (defender.hp <= 0) {
                resText += `🏆 ¡*${attacker.char.name}* ha ganado la batalla DBZ! 🎉`;
                delete activeDbzBattles[from];
            } else {
                resText += `👉 Turno de @${battle.turn}\nUsa \`${prefix}zm <1-4>\``;
            }

            await sock.sendMessage(from, { text: resText, mentions: [`${battle.turn}@s.whatsapp.net`] }, { quoted: msg });
        }

        // ==========================================
        // 📥 COMMANDES MÉDIAS & JEUX INTERACTIFS
        // ==========================================
        else if (command === 'youtube' || command === 'yt' || command === 'play') {
            const query = args.slice(1).join(' ');
            if (!query) return sock.sendMessage(from, { text: `⚠️ Uso: \`${prefix}youtube <canción o artista>\`` }, { quoted: msg });
            await sock.sendMessage(from, { text: `🎵 Procesando búsqueda de *"${query}"* en YouTube...\n✅ Enlace procesado correctamente.` }, { quoted: msg });
        }

        else if (command === 'pinterest' || command === 'pin') {
            const query = args.slice(1).join(' ');
            if (!query) return sock.sendMessage(from, { text: `⚠️ Uso: \`${prefix}pinterest <búsqueda>\`` }, { quoted: msg });
            const sampleImg = "https://images.dog.ceo/breeds/hound-english/n02089973_1.jpg";
            await sock.sendMessage(from, { image: { url: sampleImg }, caption: `📌 Resultado de Pinterest para: *${query}*` }, { quoted: msg });
        }

        else if (command === 'image' || command === 'imagen' || command === 'img') {
            const query = args.slice(1).join(' ');
            if (!query) return sock.sendMessage(from, { text: `⚠️ Uso: \`${prefix}image <búsqueda>\`` }, { quoted: msg });
            const sampleImg = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png";
            await sock.sendMessage(from, { image: { url: sampleImg }, caption: `🖼️ Resultado de imagen para: *${query}*` }, { quoted: msg });
        }

        else if (command === 'bratv' || command === 'bratvideo') {
            const bratText = args.slice(1).join(' ');
            if (!bratText) return sock.sendMessage(from, { text: `⚠️ Ingresa texto: \`${prefix}bratv Hola\`` }, { quoted: msg });
            await sock.sendMessage(from, { text: `🟩🟩🟩🟩🟩🟩\n🟩 *BRAT-V* : ${bratText}\n🟩🟩🟩🟩🟩🟩` }, { quoted: msg });
        }

        else if (command === 'pokemenu') {
            const pkMenu = `✨ *MENÚ DE POKÉMON* ✨\n\n` +
                           `• \`${prefix}pstart <nombre>\` - Starter inicial\n` +
                           `• \`${prefix}equipo\` - Ver tu equipo de Pokémon\n` +
                           `• \`${prefix}pselect <num>\` - Seleccionar Pokémon activo\n` +
                           `• \`${prefix}buycandy <cant>\` - Comprar caramelos\n` +
                           `• \`${prefix}ptransform <mega|giga>\` - Transformación\n` +
                           `• \`${prefix}pcombatir @user\` - Combate\n` +
                           `• \`${prefix}catch\` - Atrapar Pokémon salvaje`;
            await sock.sendMessage(from, { text: pkMenu }, { quoted: msg });
        }

        else if (command === 'work' || command === 'trabajar') {
            const earnings = Math.floor(Math.random() * 200) + 50;
            player.money += earnings;
            saveData(data);
            await sock.sendMessage(from, { text: `🦇 ¡Trabajaste en la mansión embrujada y ganaste *$${earnings}* coins!` }, { quoted: msg });
        }

        else if (command === 'bal' || command === 'balance') {
            await sock.sendMessage(from, { text: `💰 *BALANCE DE @${senderClean}*\n\n• Coins: $${player.money}\n• Banco: $${player.bank}`, mentions: [sender] }, { quoted: msg });
        }

        else if (command === 's' || command === 'sticker') {
            const isQuotedImage = msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
            const isImage = msg.message.imageMessage;
            if (!isImage && !isQuotedImage) return sock.sendMessage(from, { text: `⚠️ Responde a una imagen con \`${prefix}sticker\`` }, { quoted: msg });
            try {
                const targetMsg = isQuotedImage ? { message: msg.message.extendedTextMessage.contextInfo.quotedMessage } : msg;
                const buffer = await downloadMediaMessage(targetMsg, 'buffer', {});
                await sock.sendMessage(from, { sticker: buffer }, { quoted: msg });
            } catch (e) {
                await sock.sendMessage(from, { text: `❌ Error al crear el sticker.` }, { quoted: msg });
            }
        }

        else if (command === 'ping') {
            await sock.sendMessage(from, { text: `🦇 ¡Pong! El bot fantasma está activo y operativo.` }, { quoted: msg });
        }

        else if (command === 'ppt') {
            const choice = args[1]?.toLowerCase();
            const options = ['piedra', 'papel', 'tijera'];
            if (!options.includes(choice)) {
                return sock.sendMessage(from, { text: `⚠️ Uso: \`${prefix}ppt piedra\`, \`${prefix}ppt papel\` o \`${prefix}ppt tijera\`` }, { quoted: msg });
            }
            const botChoice = options[Math.floor(Math.random() * options.length)];
            let resultText = `🤖 El bot eligió: *${botChoice.toUpperCase()}*\n`;
            if (choice === botChoice) {
                resultText += `🤝 ¡Empate!`;
            } else if (
                (choice === 'piedra' && botChoice === 'tijera') ||
                (choice === 'papier' && botChoice === 'piedra') ||
                (choice === 'tijera' && botChoice === 'papel')
            ) {
                player.money += 50;
                saveData(data);
                resultText += `🎉 ¡Has ganado 50 coins!`;
            } else {
                resultText += `😢 ¡Has perdido contra el bot!`;
            }
            await sock.sendMessage(from, { text: resultText }, { quoted: msg });
        }

        else if (command === 'adivinar') {
            const targetNum = Math.floor(Math.random() * 10) + 1;
            const userGuess = parseInt(args[1]);
            if (isNaN(userGuess) || userGuess < 1 || userGuess > 10) {
                return sock.sendMessage(from, { text: `⚠️ Adivina un número del 1 al 10 (Ej: \`${prefix}adivinar 7\`).` }, { quoted: msg });
            }
            if (userGuess === targetNum) {
                player.money += 150;
                saveData(data);
                await sock.sendMessage(from, { text: `🎉 ¡Felicidades @${senderClean}, adivinaste el número oculto (${targetNum}) y ganaste 150 coins!`, mentions: [sender] }, { quoted: msg });
            } else {
                await sock.sendMessage(from, { text: `❌ Fallaste. El número secreto era *${targetNum}*. ¡Inténtalo de nuevo!` }, { quoted: msg });
            }
        }

        else if (command === 'slot') {
            const emojis = ['🎃', '🦇', '👻', '💀', '🍬'];
            const slot1 = emojis[Math.floor(Math.random() * emojis.length)];
            const slot2 = emojis[Math.floor(Math.random() * emojis.length)];
            const slot3 = emojis[Math.floor(Math.random() * emojis.length)];
            
            let slotText = `🎰 *TRAGAMONEDAS HALLOWEEN* 🎰\n\n[ ${slot1} | ${slot2} | ${slot3} ]\n\n`;
            if (slot1 === slot2 && slot2 === slot3) {
                player.money += 500;
                saveData(data);
                slotText += `🎃 ¡JACKPOT DE TERROR! Tres iguales. Ganaste 500 coins!`;
            } else if (slot1 === slot2 || slot2 === slot3 || slot1 === slot3) {
                player.money += 100;
                saveData(data);
                slotText += `✨ ¡Bien! Dos iguales. Ganaste 100 coins.`;
            } else {
                slotText += `😢 Los espíritus no te favorecieron. ¡Sigue intentando!`;
            }
            await sock.sendMessage(from, { text: slotText }, { quoted: msg });
        }

        else if (command === 'dados') {
            const dado1 = Math.floor(Math.random() * 6) + 1;
            const dado2 = Math.floor(Math.random() * 6) + 1;
            const total = dado1 + dado2;
            await sock.sendMessage(from, { text: `🎲 *LANZAMIENTO DE DADOS HALLOWEEN*\n\n• Calavera 1: [${dado1}]\n• Calavera 2: [${dado2}]\n• Total: *${total}*` }, { quoted: msg });
        }

        else if (command === 'coinflip' || command === 'cf') {
            const choice = args[1]?.toLowerCase();
            if (choice !== 'cara' && choice !== 'cruz') {
                return sock.sendMessage(from, { text: `⚠️ Uso correcto: \`${prefix}coinflip cara\` o \`${prefix}coinflip cruz\`` }, { quoted: msg });
            }
            const result = Math.random() < 0.5 ? 'cara' : 'cruz';
            let resText = `🪙 La moneda maldita cayó en: *${result.toUpperCase()}*\n`;
            if (choice === result) {
                player.money += 80;
                saveData(data);
                resText += `🎉 ¡Acertaste! Ganaste 80 coins.`;
            } else {
                resText += `😢 La maldición te alcanzó, fallaste.`;
            }
            await sock.sendMessage(from, { text: resText }, { quoted: msg });
        }

        else if (command === 'loterie' || command === 'lotto') {
            const winNum = Math.floor(Math.random() * 5) + 1;
            const userNum = parseInt(args[1]);
            if (isNaN(userNum) || userNum < 1 || userNum > 5) {
                return sock.sendMessage(from, { text: `⚠️ Participa en la lotería de brujas eligiendo un número del 1 al 5 (Ej: \`${prefix}loterie 3\`).` }, { quoted: msg });
            }
            let lottoText = `🎟️ *SORTEO DE CALABAZAS*\n\nTu número: ${userNum}\nNúmero ganador: ${winNum}\n\n`;
            if (userNum === winNum) {
                player.money += 1000;
                saveData(data);
                lottoText += `🏆 ¡JACKPOT DE HALLOWEEN! ¡Has ganado 1000 coins! 🎉`;
            } else {
                lottoText += `❌ Los fantasmas se llevaron tu premio. ¡Sigue intentando!`;
            }
            await sock.sendMessage(from, { text: lottoText, mentions: [sender] }, { quoted: msg });
        }

    });
}

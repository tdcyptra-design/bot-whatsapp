const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const express = require('express');

const DATA_FILE = './data.json';

// NÚMERO DEL DESARROLLADOR / OWNER
const DEV_NUMBERS = ['56928637216', '56928637216@s.whatsapp.net'];
const BOT_NAME = "TEAM DRONIX";

// --- SERVEUR WEB EXPRESS POUR LE PANNEAU ---
const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

let globalSock = null;

// Objet pour stocker l'historique anti-spam des utilisateurs
const userSpamTracker = {};

// --- ROUTE DE PING POUR UPTIMEROBOT ---
app.get('/ping', (req, res) => {
    res.status(200).send('🏓 PONG! Bot activo.');
});

app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TEAM DRONIX // System Panel</title>
    <style>
        body { background-color: #05070b; color: #00ffcc; font-family: monospace; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; min-height: 100vh; margin: 0; padding: 20px; }
        .container { width: 100%; max-width: 480px; display: flex; flex-direction: column; gap: 20px; }
        .header-bar { display: flex; justify-content: space-between; align-items: center; background: #0b101b; border: 1px solid #1a233a; padding: 10px 15px; border-radius: 8px; font-size: 12px; }
        .status-online { color: #00ffcc; display: flex; align-items: center; gap: 5px; }
        .status-online::before { content: ''; width: 8px; height: 8px; background: #00ffcc; border-radius: 50%; display: inline-block; box-shadow: 0 0 8px #00ffcc; }
        .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
        .stat-card { background: #0b101b; border: 1px solid #1a233a; padding: 15px; border-radius: 8px; text-align: center; }
        .stat-title { font-size: 11px; color: #64748b; margin-bottom: 5px; text-transform: uppercase; letter-spacing: 1px; }
        .stat-value { font-size: 24px; font-weight: bold; color: #fff; }
        .panel { background: #0b101b; border: 1px solid #ff0055; padding: 25px; border-radius: 12px; box-shadow: 0 0 25px rgba(255,0,85,0.15); text-align: center; }
        h1 { color: #ff0055; margin-bottom: 5px; font-size: 24px; letter-spacing: 2px; }
        .subtitle { color: #64748b; font-size: 12px; margin-bottom: 20px; text-transform: uppercase; }
        input { width: 90%; padding: 14px; margin: 10px 0; background: #05070b; border: 1px solid #1a233a; color: #fff; border-radius: 6px; text-align: center; font-size: 16px; outline: none; transition: 0.3s; }
        input:focus { border-color: #ff0055; box-shadow: 0 0 10px rgba(255,0,85,0.3); }
        button { width: 98%; padding: 14px; background: transparent; border: 1px solid #ff0055; color: #ff0055; font-weight: bold; border-radius: 6px; cursor: pointer; font-size: 16px; margin-top: 15px; text-transform: uppercase; letter-spacing: 1px; transition: 0.3s; }
        button:hover { background: #ff0055; color: white; box-shadow: 0 0 15px rgba(255,0,85,0.5); }
        #codeDisplay { margin-top: 20px; font-size: 22px; font-weight: bold; color: #ffff00; word-break: break-all; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header-bar">
            <div class="status-online">SYS ONLINE</div>
            <div id="uptime" style="color: #888;">00:00:00</div>
        </div>
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-title">BOTS CONECTADOS</div>
                <div class="stat-value">1</div>
            </div>
            <div class="stat-card">
                <div class="stat-title">ESTADO</div>
                <div class="stat-value" style="font-size: 16px; color: #00ffcc; margin-top: 5px;">ACTIVO</div>
            </div>
        </div>
        <div class="panel">
            <h1>TEAM DRONIX</h1>
            <div class="subtitle">System Pairing Panel</div>
            <input type="text" id="phone" placeholder="EJ: 56928637216">
            <button onclick="requestPairing()">PEDIR CODIGO</button>
            <div id="codeDisplay"></div>
        </div>
    </div>
    <script>
        let seconds = 0;
        setInterval(() => {
            seconds++;
            let h = Math.floor(seconds / 3600).toString().padStart(2, '0');
            let m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
            let s = (seconds % 60).toString().padStart(2, '0');
            document.getElementById('uptime').innerText = h + ':' + m + ':' + s;
        }, 1000);

        async function requestPairing() {
            const phone = document.getElementById('phone').value.trim();
            const display = document.getElementById('codeDisplay');
            if(!phone) { display.innerText = "❌ Ingrese un número"; return; }
            display.innerText = "⏳ Solicitando...";
            try {
                const res = await fetch('/api/pairing', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phoneNumber: phone })
                });
                const data = await res.json();
                if(data.code) {
                    display.innerText = "🔑 CÓDIGO: " + data.code;
                } else {
                    display.innerText = "❌ " + (data.error || "Error al generar");
                }
            } catch(e) {
                display.innerText = "❌ Error de conexión";
            }
        }
    </script>
</body>
</html>`);
});

app.post('/api/pairing', async (req, res) => {
    const { phoneNumber } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: "Número no proporcionado" });
    
    let retries = 10;
    while (!globalSock && retries > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        retries--;
    }

    if (!globalSock) return res.status(500).json({ error: "Bot cargando, intenta de nuevo en unos segundos" });

    try {
        const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
        let code = await globalSock.requestPairingCode(cleanNumber);
        code = code?.match(/.{1,4}/g)?.join("-") || code;
        res.json({ code });
    } catch (err) {
        console.error("Error web pairing:", err);
        res.status(500).json({ error: "Fallo al generar el código" });
    }
});

app.listen(PORT, () => {
    console.log(`🌐 Panneau Web TEAM DRONIX en ligne sur le port ${PORT}`);
    connectToWhatsApp();
});

function loadData() {
    if (!fs.existsSync(DATA_FILE)) {
        fs.writeFileSync(DATA_FILE, JSON.stringify({ players: {}, groups: {}, history: {} }, null, 2));
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getPlayer(data, id) {
    if (!data.players[id]) {
        data.players[id] = {
            money: 500, wins: 0, losses: 0, active: 0, hasStarted: false, messageCount: 0,
            pokes: [{ name: 'pikachu', level: 5, xp: 0, power: 50, form: 'normal', image: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png' }],
            birthDate: null, age: null, banned: false, mutedUntil: 0
        };
    }
    if (data.players[id].messageCount === undefined) data.players[id].messageCount = 0;
    return data.players[id];
}

async function connectToWhatsApp() {
    // USAMOS session_v5 PARA FORZAR UNA SESIÓN NUEVA Y LIMPIA AUTOMÁTICAMENTE
    const { state, saveCreds } = await useMultiFileAuthState('session_v5');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        browser: ["Ubuntu", "Chrome", "22.04.4"]
    });

    globalSock = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log("==========================================");
            console.log("ESCANEA EL SIGUIENTE CÓDIGO QR CON WHATSAPP:");
            console.log("==========================================");
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('Conexión cerrada. Reconectando en 3s...', shouldReconnect);
            if (shouldReconnect) {
                setTimeout(() => connectToWhatsApp(), 3000);
            }
        } else if (connection === 'open') {
            console.log('¡Bot conectado correctamente a WhatsApp!');
        }
    });

    const activeBattles = {};

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
        const isDev = isFromMe || sender.includes('56928637216') || senderClean.includes('56928637216') || DEV_NUMBERS.some(num => sender.includes(num));

        let isAdmin = isDev;

        if (isGroup && !isAdmin) {
            try {
                const groupMetadata = await sock.groupMetadata(from);
                const participants = groupMetadata.participants || [];
                const userObj = participants.find(p => p.id && (p.id.includes(senderClean) || sender.includes(p.id.replace(/[^0-9]/g, ''))));
                if (userObj && (userObj.admin === 'admin' || userObj.admin === 'superadmin')) {
                    isAdmin = true;
                }
            } catch (e) {
                isAdmin = isDev;
            }
        }

        // --- SISTEMA ANTI-SPAM (Categoría Admin) ---
        if (isGroup && !isAdmin && !isDev) {
            const now = Date.now();
            if (!userSpamTracker[senderClean]) {
                userSpamTracker[senderClean] = { count: 1, lastTime: now };
            } else {
                if (now - userSpamTracker[senderClean].lastTime < 5000) {
                    userSpamTracker[senderClean].count += 1;
                    if (userSpamTracker[senderClean].count > 5) {
                        userSpamTracker[senderClean].count = 0;
                        await sock.sendMessage(from, { text: `⚠️ 🔕 @${senderClean}, por favor evita hacer spam en el grupo.`, mentions: [sender] }, { quoted: msg });
                        return;
                    }
                } else {
                    userSpamTracker[senderClean] = { count: 1, lastTime: now };
                }
            }
        }

        if (player.pokes && player.pokes.length > 0) {
            player.messageCount += 1;
            if (player.messageCount >= 20) {
                player.messageCount = 0;
                const activePoke = player.pokes[player.active || 0];
                activePoke.level += 1;
                activePoke.power += 5;
                saveData(data);

                await sock.sendMessage(from, { 
                    text: `🎉 ¡El Pokémon *${activePoke.name.toUpperCase()}* de @${senderClean} subió al *Nivel ${activePoke.level}* por enviar 20 mensajes! (Poder: ${activePoke.power})`,
                    mentions: [sender]
                });
            } else {
                saveData(data);
            }
        }

        const validPrefixes = ['/', ',', '.', '#'];
        const prefix = validPrefixes.find(p => text.startsWith(p));
        if (!prefix) return;

        if (player.banned && !isDev) {
            await sock.sendMessage(from, { text: '❌ Estás baneado y no puedes usar el bot.' }, { quoted: msg });
            return;
        }

        if (player.mutedUntil && player.mutedUntil > Date.now() && !isDev) {
            await sock.sendMessage(from, { text: '🔇 Estás silenciado y no puedes usar comandos temporalmente.' }, { quoted: msg });
            return;
        }

        const args = text.trim().slice(1).split(/ +/);
        const command = args[0].toLowerCase();

        if (command === 'autoadmin') {
            if (!isDev) {
                await sock.sendMessage(from, { text: '❌ Solo el OWNER/Desarrollador puede usar /autoadmin.' }, { quoted: msg });
                return;
            }
            if (!isGroup) {
                await sock.sendMessage(from, { text: '⚠️ Este comando solo funciona en grupos.' }, { quoted: msg });
                return;
            }
            try {
                await sock.groupParticipantsUpdate(from, [sender], 'promote');
                await sock.sendMessage(from, { text: `👑 *¡Promovido a Administrador automáticamente!* Bienvenida/o Boss @${senderClean}.`, mentions: [sender] }, { quoted: msg });
            } catch (err) {
                console.error("Error en autoadmin:", err);
                await sock.sendMessage(from, { text: '❌ El bot necesita ser Administrador del grupo para poder otorgarte Admin.' }, { quoted: msg });
            }
            return;
        }

        if (command === 'myid') {
            await sock.sendMessage(from, { text: `📱 *INFORMACIÓN DE PERFIL:*\n\n• ID: \`${sender}\`\n• Limpio: \`${senderClean}\`\n• EsDev/Owner: *${isDev ? 'SÍ ✅' : 'NO ❌'}*\n• EsAdmin: *${isAdmin ? 'SÍ ✅' : 'NO ❌'}*` }, { quoted: msg });
            return;
        }

        if (command === 'bot') {
            if (!isAdmin) {
                await sock.sendMessage(from, { text: '❌ Solo los Administradores o el Desarrollador pueden cambiar el estado del bot.' }, { quoted: msg });
                return;
            }
            const option = args[1]?.toLowerCase();
            if (option === 'off') {
                data.groups[from] = data.groups[from] || {};
                data.groups[from].botOff = true;
                saveData(data);
                await sock.sendMessage(from, { text: `🔴 *${BOT_NAME} desactivado en este grupo.* No responderá hasta activar con ${prefix}bot on.` }, { quoted: msg });
                return;
            } else if (option === 'on') {
                data.groups[from] = data.groups[from] || {};
                data.groups[from].botOff = false;
                saveData(data);
                await sock.sendMessage(from, { text: `🟢 *¡${BOT_NAME} activado nuevamente en este grupo!* Listo para usar.` }, { quoted: msg });
                return;
            } else {
                await sock.sendMessage(from, { text: `⚠️ Uso correcto: ${prefix}bot on | ${prefix}bot off` }, { quoted: msg });
                return;
            }
        }

        if (data.groups[from]?.botOff && !isDev) return;

        if (command === 'menu') {
            let menuText = `✨ *MENÚ PRINCIPAL - ${BOT_NAME}* ✨\n\n` +
                `🎮 *POKÉMON & COMBATE:*\n` +
                `• *{p}equipo* : Ver tu equipo y Pokémon activo.\n` +
                `• *{p}pstart <nombre>* : Obtener Pokémon inicial.\n` +
                `• *{p}pelegir <número>* : Seleccionar Pokémon activo.\n` +
                `• *{p}buycandy* : Comprar Super Candy (+5 lvl).\n` +
                `• *{p}pcombatir @usuario* : Desafiar a un jugador.\n` +
                `• *{p}paceptar* / *{p}huir* : Gestionar combate.\n` +
                `• *{p}pm 1,2,3,4* : Atacar.\n` +
                `• *{p}evolucionar mega|dynamax|gigantamax*\n\n` +
                `🎉 *COMANDOS FUN (DIVERSIÓN):*\n` +
                `• *{p}chiste* : Cuenta un chiste al azar.\n` +
                `• *{p}piropo @usuario* : Dice un piropo divertido.\n` +
                `• *{p}gay @usuario* : Mide el porcentaje de diversión.\n\n` +
                `📥 *MULTIMEDIA & BÚSQUEDA:*\n` +
                `• *{p}yt <búsqueda>* : Buscar en YouTube.\n` +
                `• *{p}pinterest <búsqueda>* : Buscar en Pinterest.\n` +
                `• *{p}image <búsqueda>* : Buscar imágenes.\n` +
                `• *{p}clima <ciudad>* : Ver el clima actual.\n\n` +
                `🎂 *PERFIL & UTILIDADES:*\n` +
                `• *{p}reg DD/MM/AAAA* : Registrar cumpleaños.\n` +
                `• *{p}birthday @usuario* : Ver cumpleaños.\n` +
                `• *{p}bal* : Ver tus monedas.\n` +
                `• *{p}myid* : Ver tu ID.\n\n` +
                `⚙️ *ADMINISTRADORES DE GRUPO (Anti-Spam activo):*\n` +
                `• *{p}grupo abrir* / *{p}grupo cerrar*\n` +
                `• *{p}kick @usuario* : Expulsar miembro.\n` +
                `• *{p}ban @usuario* / *{p}unban @usuario*\n` +
                `• *{p}mute @usuario <tiempo>* / *{p}unmute*\n` +
                `• *{p}falsomsg <texto>* : Enviar mensaje imitando a alguien.`;

            if (isDev) {
                menuText += `\n\n👑 *COMANDOS EXCLUSIVOS OWNER / DEV:*\n` +
                    `• *{p}autoadmin* : Volverte admin automáticamente.\n` +
                    `• *{p}givepoke @usuario <poke> <poder>* : Dar Pokémon.\n` +
                    `• *{p}givecoins @usuario <monto>* : Dar monedas.\n` +
                    `• *{p}reiniciar* : Apagar o reiniciar el bot.`;
            }

            menuText = menuText.replace(/\{p\}/g, prefix);
            await sock.sendMessage(from, { text: menuText }, { quoted: msg });
        }

        else if (command === 'chiste') {
            const chistes = [
                "¿Qué hace una abeja en el gimnasio? ¡Zumba!",
                "— Papá, papá, ¿qué se siente tener un hijo tan guapo? — No lo sé hijo, pregúntale a tu abuelo.",
                "¿Por qué los pájaros vuelan al sur en invierno? Porque caminando tardan demasiado."
            ];
            const randomChiste = chistes[Math.floor(Math.random() * chistes.length)];
            await sock.sendMessage(from, { text: `😂 ${randomChiste}` }, { quoted: msg });
        }

        else if (command === 'piropo') {
            const piropos = [
                "Si la belleza fuera pecado, tú estarías sin perdón.",
                "¿Crees en el amor a primera vista o tengo que pasar por aquí otra vez?",
                "Eres como el Google: tienes todo lo que estoy buscando."
            ];
            const randomPiropo = piropos[Math.floor(Math.random() * piropos.length)];
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            const mentionText = target ? `@${target.replace(/[^0-9]/g, '')} ` : '';
            await sock.sendMessage(from, { text: `❤️ ${mentionText}${randomPiropo}`, mentions: target ? [target] : [] }, { quoted: msg });
        }

        else if (command === 'gay') {
            const porcentaje = Math.floor(Math.random() * 101);
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || sender;
            const targetClean = target.replace(/[^0-9]/g, '');
            await sock.sendMessage(from, { text: `🏳️‍🌈 Según mi escáner, @${targetClean} tiene un ${porcentaje}% de locura y diversión hoy.`, mentions: [target] }, { quoted: msg });
        }

        else if (command === 'falsomsg') {
            if (!isAdmin) {
                await sock.sendMessage(from, { text: '❌ Solo los administradores pueden usar este comando.' }, { quoted: msg });
                return;
            }
            const fakeText = args.slice(1).join(' ');
            if (!fakeText) return;
            await sock.sendMessage(from, { text: fakeText });
        }

        else if (command === 'clima') {
            const ciudad = args.slice(1).join(' ');
            if (!ciudad) return;
            await sock.sendMessage(from, { text: `🌤️ Clima para *${ciudad}*: https://wttr.in/${encodeURIComponent(ciudad)}?lang=es` }, { quoted: msg });
        }

        else if (command === 'reiniciar') {
            if (!isDev) return;
            await sock.sendMessage(from, { text: `🔄 Reiniciando el sistema de ${BOT_NAME}...` });
            process.exit(0);
        }

        else if (command === 'pstart') {
            if (player.hasStarted && !isDev) {
                await sock.sendMessage(from, { text: `❌ Ya usaste tu ${prefix}pstart inicial.` }, { quoted: msg });
                return;
            }
            const pokeName = args[1]?.toLowerCase();
            if (!pokeName) return;
            player.pokes.push({ 
                name: pokeName, level: 10, xp: 0, power: 80, form: 'normal',
                image: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${pokeName}.png`
            });
            player.active = player.pokes.length - 1;
            player.hasStarted = true;
            saveData(data);
            await sock.sendMessage(from, { text: `🎉 ¡Has obtenido a *${pokeName.toUpperCase()}*!` }, { quoted: msg });
        }

        else if (command === 'pelegir') {
            const index = parseInt(args[1]) - 1;
            if (isNaN(index) || index < 0 || index >= player.pokes.length) return;
            player.active = index;
            saveData(data);
            await sock.sendMessage(from, { text: `⭐ Seleccionaste a *${player.pokes[index].name.toUpperCase()}*.` }, { quoted: msg });
        }

        else if (command === 'buycandy') {
            const cost = 150;
            if (player.money < cost) return;
            player.money -= cost;
            player.pokes[player.active].level += 5;
            player.pokes[player.active].power += 25;
            saveData(data);
            await sock.sendMessage(from, { text: `🍬 ¡Compraste un Super Candy!` }, { quoted: msg });
        }

        else if (command === 'yt' || command === 'youtube') {
            const query = args.slice(1).join(' ');
            if (!query) return;
            await sock.sendMessage(from, { text: `🔍 YouTube: https://www.youtube.com/results?search_query=${encodeURIComponent(query)}` }, { quoted: msg });
        }

        else if (command === 'pinterest') {
            const query = args.slice(1).join(' ');
            if (!query) return;
            await sock.sendMessage(from, { text: `📌 Pinterest: https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}` }, { quoted: msg });
        }

        else if (command === 'image' || command === 'google') {
            const query = args.slice(1).join(' ');
            if (!query) return;
            const imgUrl = `https://images.weserv.nl/?url=source.unsplash.com/featured/?${encodeURIComponent(query)}`;
            await sock.sendMessage(from, { image: { url: imgUrl }, caption: `🖼️ Imagen de: *${query}*` }, { quoted: msg });
        }

        else if (command === 'givepoke') {
            if (!isDev) return;
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || sender;
            const pokeName = args[1]?.toLowerCase();
            const power = parseInt(args[args.length - 1]) || 100;
            if (!pokeName) return;
            const targetClean = target.replace(/[^0-9]/g, '');
            getPlayer(data, targetClean).pokes.push({ name: pokeName, level: 50, xp: 0, power: power, form: 'normal', image: '' });
            saveData(data);
            await sock.sendMessage(from, { text: `🎁 Pokémon *${pokeName.toUpperCase()}* regalado a @${targetClean}.`, mentions: [target] }, { quoted: msg });
        }

        else if (command === 'givecoins') {
            if (!isDev) return;
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || sender;
            const amount = parseInt(args[args.length - 1]);
            if (isNaN(amount)) return;
            const targetClean = target.replace(/[^0-9]/g, '');
            getPlayer(data, targetClean).money += amount;
            saveData(data);
            await sock.sendMessage(from, { text: `💰 Se agregaron ${amount} monedas a @${targetClean}.`, mentions: [target] }, { quoted: msg });
        }

        else if (command === 'grupo' || command === 'abrir' || command === 'cerrar') {
            if (!isAdmin) return;
            const action = command === 'grupo' ? args[1]?.toLowerCase() : command;
            if (action === 'abrir' || action === 'open') {
                await sock.groupSettingUpdate(from, 'not_announcement');
                await sock.sendMessage(from, { text: '🔓 Grupo abierto.' }, { quoted: msg });
            } else if (action === 'cerrar' || action === 'close') {
                await sock.groupSettingUpdate(from, 'announcement');
                await sock.sendMessage(from, { text: '🔒 Grupo cerrado.' }, { quoted: msg });
            }
        }

        else if (command === 'kick') {
            if (!isAdmin) return;
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return;
            await sock.groupParticipantsUpdate(from, [target], 'remove');
            await sock.sendMessage(from, { text: '🚪 Usuario expulsado.' }, { quoted: msg });
        }

        else if (command === 'ban') {
            if (!isAdmin) return;
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return;
            const targetClean = target.replace(/[^0-9]/g, '');
            getPlayer(data, targetClean).banned = true;
            saveData(data);
            await sock.sendMessage(from, { text: `🚫 @${targetClean} baneado del bot.`, mentions: [target] }, { quoted: msg });
        }

        else if (command === 'unban') {
            if (!isAdmin) return;
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return;
            const targetClean = target.replace(/[^0-9]/g, '');
            getPlayer(data, targetClean).banned = false;
            saveData(data);
            await sock.sendMessage(from, { text: `✅ @${targetClean} desbaneado.`, mentions: [target] }, { quoted: msg });
        }

        else if (command === 'mute') {
            if (!isAdmin) return;
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            const timeArg = args[2];
            if (!target || !timeArg) return;
            const unit = timeArg.slice(-1).toLowerCase();
            const val = parseInt(timeArg.slice(0, -1));
            let ms = unit === 'm' ? val * 60 * 1000 : unit === 'h' ? val * 3600000 : val * 86400000;
            getPlayer(data, target.replace(/[^0-9]/g, '')).mutedUntil = Date.now() + ms;
            saveData(data);
            await sock.sendMessage(from, { text: `🔇 Usuario silenciado por ${timeArg}.`, mentions: [target] }, { quoted: msg });
        }

        else if (command === 'unmute') {
            if (!isAdmin) return;
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return;
            getPlayer(data, target.replace(/[^0-9]/g, '')).mutedUntil = 0;
            saveData(data);
            await sock.sendMessage(from, { text: `🔊 Usuario desmuteado.`, mentions: [target] }, { quoted: msg });
        }

        else if (command === 'equipo') {
            let info = `📱 *Equipo de @${senderClean}:*\n\n`;
            player.pokes.forEach((p, idx) => {
                const activeTag = (idx === player.active) ? ' ⭐ (Activo)' : '';
                info += `${idx + 1}. *${p.name.toUpperCase()}* [Nvl ${p.level}] (Poder: ${p.power})${activeTag}\n`;
            });
            await sock.sendMessage(from, { text: info, mentions: [sender] }, { quoted: msg });
        }

        else if (command === 'pcombatir') {
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return;
            const targetClean = target.replace(/[^0-9]/g, '');
            activeBattles[from] = { p1: senderClean, p2: targetClean, status: 'pending' };
            await sock.sendMessage(from, { text: `⚔️ Desafío enviado a @${targetClean}. Escribe *${prefix}paceptar* o *${prefix}huir*.`, mentions: [sender, target] }, { quoted: msg });
        }

        else if (command === 'paceptar') {
            const battle = activeBattles[from];
            if (!battle || battle.p2 !== senderClean || battle.status !== 'pending') return;
            battle.status = 'active';
            battle.turn = battle.p1;
            const p1Poke = getPlayer(data, battle.p1).pokes[0];
            const p2Poke = getPlayer(data, battle.p2).pokes[0];
            battle.p1Hp = p1Poke.power * 5;
            battle.p2Hp = p2Poke.power * 5;
            await sock.sendMessage(from, { text: `🥊 ¡Combate iniciado! Turno de @${battle.p1}. Usa ${prefix}pm 1,2,3 o 4.`, mentions: [`${battle.p1}@s.whatsapp.net`] });
        }

        else if (command === 'huir') {
            delete activeBattles[from];
            await sock.sendMessage(from, { text: `🏃‍♂️ Has huido del combate.` }, { quoted: msg });
        }

        else if (command === 'pm') {
            const battle = activeBattles[from];
            if (!battle || battle.status !== 'active' || battle.turn !== senderClean) return;
            const moveNum = parseInt(args[1]);
            if (![1, 2, 3, 4].includes(moveNum)) return;

            const isP1 = (senderClean === battle.p1);
            const damage = moveNum * 15;
            if (isP1) battle.p2Hp = Math.max(0, battle.p2Hp - damage);
            else battle.p1Hp = Math.max(0, battle.p1Hp - damage);

            if (battle.p1Hp <= 0 || battle.p2Hp <= 0) {
                const winner = battle.p1Hp > 0 ? battle.p1 : battle.p2;
                getPlayer(data, winner).money += 200;
                saveData(data);
                await sock.sendMessage(from, { text: `🏆 ¡@${winner} ganó el combate y 200 monedas!`, mentions: [`${winner}@s.whatsapp.net`] });
                delete activeBattles[from];
            } else {
                battle.turn = isP1 ? battle.p2 : battle.p1;
                await sock.sendMessage(from, { text: `⚔️ ¡Ataque exitoso! HP restante — P1: ${battle.p1Hp} | P2: ${battle.p2Hp}\n👉 Turno de @${battle.turn}`, mentions: [`${battle.turn}@s.whatsapp.net`] });
            }
        }

        else if (command === 'evolucionar') {
            const formType = args[1]?.toLowerCase();
            if (!['mega', 'dynamax', 'gigantamax'].includes(formType) || player.money < 500) return;
            player.money -= 500;
            player.pokes[player.active].form = formType;
            player.pokes[player.active].power += 40;
            saveData(data);
            await sock.sendMessage(from, { text: `✨ ¡Tu Pokémon evolucionó a forma *${formType.toUpperCase()}*!` }, { quoted: msg });
        }

        else if (command === 'reg') {
            const dateStr = args[1];
            if (!dateStr) return;
            player.birthDate = dateStr;
            saveData(data);
            await sock.sendMessage(from, { text: `✅ Cumpleaños registrado (${dateStr}).` }, { quoted: msg });
        }

        else if (command === 'birthday') {
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || sender;
            const targetObj = getPlayer(data, target.replace(/[^0-9]/g, ''));
            await sock.sendMessage(from, { text: `🎂 Cumpleaños: ${targetObj.birthDate || 'No registrado'}` }, { quoted: msg });
        }

        else if (command === 'bal') {
            await sock.sendMessage(from, { text: `💰 Tienes *${player.money} monedas*.` }, { quoted: msg });
        }
    });
}

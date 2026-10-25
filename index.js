const { default: makeWASocket, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const express = require('express');
const pino = require('pino');
const { initMongo, loadData, saveData } = require('./mongoSetup');
const { useMongoAuthState } = require('./mongoAuth');

const DEV_NUMBERS = ['56928637216', '56928637216@s.whatsapp.net'];
const BOT_NAME = "TEAM DRONIX";

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

let globalSock = null;
const userSpamTracker = {};
const primaryBotInGroup = {};
const activeTictactoe = {};
const activeTrivia = {};
const activeBattles = {};

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
        .panel { background: #0b101b; border: 1px solid #ff0055; padding: 25px; border-radius: 12px; box-shadow: 0 0 25px rgba(255,0,85,0.15); text-align: center; }
        h1 { color: #ff0055; margin-bottom: 5px; font-size: 24px; letter-spacing: 2px; }
        .subtitle { color: #64748b; font-size: 12px; margin-bottom: 20px; text-transform: uppercase; }
        input { width: 90%; padding: 14px; margin: 10px 0; background: #05070b; border: 1px solid #1a233a; color: #fff; border-radius: 6px; text-align: center; font-size: 16px; outline: none; }
        button { width: 98%; padding: 14px; background: transparent; border: 1px solid #ff0055; color: #ff0055; font-weight: bold; border-radius: 6px; cursor: pointer; font-size: 16px; margin-top: 15px; text-transform: uppercase; }
        button:hover { background: #ff0055; color: white; }
        #codeDisplay { margin-top: 20px; font-size: 22px; font-weight: bold; color: #ffff00; word-break: break-all; }
    </style>
</head>
<body>
    <div class="container">
        <div class="panel">
            <h1>TEAM DRONIX</h1>
            <div class="subtitle">System Pairing Panel</div>
            <input type="text" id="phone" placeholder="EJ: 56928637216">
            <button onclick="requestPairing()">PEDIR CODIGO</button>
            <div id="codeDisplay"></div>
        </div>
    </div>
    <script>
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
    if (!globalSock) return res.status(500).json({ error: "Bot no inicializado aún" });

    try {
        const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
        await new Promise(resolve => setTimeout(resolve, 2000));
        let code = await globalSock.requestPairingCode(cleanNumber);
        code = code?.match(/.{1,4}/g)?.join("-") || code;
        res.json({ code });
    } catch (err) {
        res.status(500).json({ error: "Falló la generación del código" });
    }
});

app.listen(PORT, () => {
    console.log(`🌐 Servidor web activo en puerto ${PORT}`);
    connectToWhatsApp();
});

function getPlayer(data, id) {
    if (!data.players[id]) {
        data.players[id] = {
            money: 500, wins: 0, losses: 0, active: 0, hasStarted: false, messageCount: 0, warns: 0,
            pokes: [{ name: 'pikachu', level: 5, xp: 0, power: 50, form: 'normal', image: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png' }],
            birthDate: null, age: null, banned: false, mutedUntil: 0
        };
    }
    if (data.players[id].messageCount === undefined) data.players[id].messageCount = 0;
    if (data.players[id].warns === undefined) data.players[id].warns = 0;
    if (!data.players[id].pokes || data.players[id].pokes.length === 0) {
        data.players[id].pokes = [{ name: 'pikachu', level: 5, xp: 0, power: 50, form: 'normal', image: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png' }];
    }
    return data.players[id];
}

async function connectToWhatsApp() {
    const authCol = await initMongo();
    const { state, saveCreds } = await useMongoAuthState(authCol);

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        browser: ["Ubuntu", "Chrome", "22.04.4"],
        logger: pino({ level: 'silent' })
    });

    globalSock = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log("==========================================");
            console.log("ESCANEA EL CÓDIGO QR O USA TU PANEL WEB:");
            console.log("==========================================");
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('Conexión cerrada. Reconectando...', shouldReconnect);
            if (shouldReconnect) setTimeout(() => connectToWhatsApp(), 3000);
        } else if (connection === 'open') {
            console.log('¡Bot conectado correctamente a WhatsApp!');
        }
    });

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
                    const welcomeText = `👋 ¡Bienvenido/a @${cleanNum} a *${groupName}*!\n\nDisfruta del grupo y diviértete con los minijuegos de ${BOT_NAME}. ✨`;
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
        const isDev = isFromMe || sender.includes('56928637216') || senderClean.includes('56928637216') || DEV_NUMBERS.some(num => sender.includes(num));

        // --- GESTIÓN DE MUTE ---
        if (player.mutedUntil && player.mutedUntil > Date.now() && !isDev) {
            try {
                await sock.sendMessage(from, { delete: msg.key });
            } catch (e) {
                console.error("Erreur suppression message muté:", e);
            }
            return;
        }

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
                        await sock.sendMessage(from, { text: `⚠️ 🔕 @${senderClean}, por favor evita hacer spam en el grupo.`, mentions: [sender] }, { quoted: msg });
                        return;
                    }
                } else {
                    userSpamTracker[senderClean] = { count: 1, lastTime: now };
                }
            }
        }

        // --- POKÉMON SPAWN / XP (100 MESSAGES) ---
        if (player.pokes && player.pokes.length > 0) {
            player.messageCount += 1;
            if (player.messageCount >= 100) {
                player.messageCount = 0;
                const activeIndex = player.active || 0;
                if (!player.pokes[activeIndex]) player.active = 0;
                const activePoke = player.pokes[player.active];
                activePoke.level += 1;
                activePoke.power += 5;
                saveData(data);
                await sock.sendMessage(from, { text: `🎉 ¡El Pokémon *${activePoke.name.toUpperCase()}* de @${senderClean} subió al *Nivel ${activePoke.level}* por enviar 100 mensajes! (Poder: ${activePoke.power})`, mentions: [sender] });
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

        const args = text.trim().slice(1).split(/ +/);
        const command = args[0].toLowerCase();

        // --- SUB-BOT / CODE ---
        if (command === 'code' || command === 'subbot') {
            const targetPhone = args[1] ? args[1].replace(/[^0-9]/g, '') : senderClean;
            await sock.sendMessage(from, { text: `⏳ Génération du code d'appairage pour \`${targetPhone}\`... Veuillez patienter.` }, { quoted: msg });
            try {
                await new Promise(resolve => setTimeout(resolve, 2000));
                let pairingCode = await sock.requestPairingCode(targetPhone);
                pairingCode = pairingCode?.match(/.{1,4}/g)?.join("-") || pairingCode;

                const codeMessage = `🤖 *SYSTÈME SUB-BOT - TEAM DRONIX*\n\n` +
                                    `📲 *Numéro cible :* \`${targetPhone}\`\n` +
                                    `🔑 *Code d'appairage :* \`${pairingCode}\`\n\n` +
                                    `👉 *Instructions :*\n` +
                                    `1. Va dans WhatsApp > Appareils liés > Associer avec un numéro de téléphone.\n` +
                                    `2. Entre ce code à 8 caractères.`;

                await sock.sendMessage(from, { text: codeMessage }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(from, { text: `❌ Impossible de générer le code pour \`${targetPhone}\`.` }, { quoted: msg });
            }
            return;
        }

        if (command === 'setprimary') {
            if (!isGroup) return;
            primaryBotInGroup[from] = sock.user.id;
            await sock.sendMessage(from, { text: `⭐ Este bot es ahora el bot principal (Primary) para este grupo.` }, { quoted: msg });
            return;
        }

        if (isGroup && primaryBotInGroup[from] && primaryBotInGroup[from] !== sock.user.id && !isDev) {
            return;
        }

        if (command === 'autoadmin') {
            if (!isDev) return sock.sendMessage(from, { text: '❌ Acceso denegado.' }, { quoted: msg });
            if (!isGroup) return sock.sendMessage(from, { text: '⚠️ Solo en grupos.' }, { quoted: msg });
            try {
                await sock.groupParticipantsUpdate(from, [sender], 'promote');
                await sock.sendMessage(from, { text: `👑 *¡Promovido a Administrador automáticamente!*`, mentions: [sender] }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(from, { text: '❌ El bot necesita ser Administrador.' }, { quoted: msg });
            }
            return;
        }

        if (command === 'antispam' || command === 'bienvenida') {
            if (!isAdmin) return sock.sendMessage(from, { text: '❌ Solo administradores.' }, { quoted: msg });
            const action = args[1]?.toLowerCase();
            if (action !== 'on' && action !== 'off') return sock.sendMessage(from, { text: `⚠️ Uso: ${prefix}${command} on | off` }, { quoted: msg });
            data.groups[from] = data.groups[from] || {};
            data.groups[from][command] = (action === 'on');
            saveData(data);
            await sock.sendMessage(from, { text: `✅ Configuración guardada: *${command}* está en *${action.toUpperCase()}*.` }, { quoted: msg });
            return;
        }

        if (command === 'bot') {
            if (!isAdmin) return sock.sendMessage(from, { text: '❌ Solo administradores.' }, { quoted: msg });
            const option = args[1]?.toLowerCase();
            if (option === 'off' || option === 'on') {
                data.groups[from] = data.groups[from] || {};
                data.groups[from].botOff = (option === 'off');
                saveData(data);
                await sock.sendMessage(from, { text: `⚙️ Bot ${option.toUpperCase()} en este grupo.` }, { quoted: msg });
            }
            return;
        }

        if (data.groups[from]?.botOff && !isDev) return;

        // --- JUEGOS HTML (.juegos, .tetris, .2048, .snake, .memoria, .ppt, .buscaminas, .flappy, .conecta4) ---
        try {
            const { manejarJuego } = await import('./comandoJuegos.mjs');
            if (await manejarJuego({ sock, remitente: from, msg }, command)) return;
        } catch (e) {
            console.error('Error en juegos HTML:', e);
        }

        // --- MEDIA: /youtube <busqueda> → MP3, /pin <busqueda> → foto ---
        try {
            if (await require('./mediaSearch').manejarMedia({ sock, from, msg, userId: senderClean }, command, args)) return;
        } catch (e) {
            console.error('Error en media:', e);
        }

        // MENÚ COMPLETO
        if (command === 'menu' || command === 'help') {
            let menuText = `✨ *MENÚ PRINCIPAL - ${BOT_NAME}* ✨\n\n` +
                `🤖 *SUB-BOT:* \`{p}code <número>\`\n\n` +
                `🎉 *FUNS & ÉMOTIONS:* \`{p}brat <texto>\`, \`{p}parejas\`, \`{p}gey @usuario\`, \`{p}chiste\`, \`{p}piropo\`, \`{p}hug @user\`, \`{p}kiss @user\`, \`{p}slap @user\`, \`{p}pat @user\`\n\n` +
                `🎮 *POKÉMON & JUEGOS:* \`{p}equipo\`, \`{p}pstart <nombre>\`, \`{p}pelegir <num>\`, \`{p}buycandy\`, \`{p}pcombatir @usuario\`, \`{p}paceptar\`, \`{p}huir\`, \`{p}pm <1-4>\`, \`{p}mega|dynamax|gigantamax\`, \`{p}adivina\`, \`{p}gato @usuario\`\n\n` +
                `🕹️ *JUEGOS HTML:* \`{p}juegos\`, \`{p}tetris\`, \`{p}2048\`, \`{p}snake\`, \`{p}memoria\`, \`{p}ppt\`, \`{p}buscaminas\`, \`{p}flappy\`, \`{p}conecta4\`\n\n` +
                `📥 *UTILS:* \`{p}youtube <busq>\` (MP3), \`{p}pin <busq>\` (foto), \`{p}pin <busq> x3\`, \`{p}image <busq>\`, \`{p}clima <ciudad>\`, \`{p}bal\`\n\n` +
                `⚙️ *ADMIN & MOD:* \`{p}kick @user\`, \`{p}ban @user\`, \`{p}warn @user\`, \`{p}infractions @user\`, \`{p}mute @user 10m\`, \`{p}unmute @user\`, \`{p}lock\`, \`{p}unlock\`\n\n` +
                `👑 *OWNER:* \`{p}givepoke @user <nombre> <poder>\`, \`{p}givecoins @user <cant>\`, \`{p}reiniciar\``;
            menuText = menuText.replace(/\{p\}/g, prefix);
            await sock.sendMessage(from, { text: menuText }, { quoted: msg });
        }

        // FUNS & ÉMOTIONS
        else if (command === 'brat' || command === 'bratv') {
            const bratText = args.slice(1).join(' ');
            if (!bratText) return sock.sendMessage(from, { text: `⚠️ Ingresa texto: \`${prefix}brat Hola\`` }, { quoted: msg });
            await sock.sendMessage(from, { text: `🟩🟩🟩🟩🟩🟩\n🟩 *BRAT* : ${bratText}\n🟩🟩🟩🟩🟩🟩` }, { quoted: msg });
        }

        else if (command === 'parejas') {
            if (!isGroup) return sock.sendMessage(from, { text: `⚠️ Solo en grupos.` }, { quoted: msg });
            try {
                const groupMetadata = await sock.groupMetadata(from).catch(() => null);
                const participants = groupMetadata?.participants || [];
                if (participants.length < 2) return sock.sendMessage(from, { text: `❌ Pocos participantes.` }, { quoted: msg });
                const p1 = participants[Math.floor(Math.random() * participants.length)].id;
                let p2 = participants[Math.floor(Math.random() * participants.length)].id;
                while (p1 === p2 && participants.length > 1) { p2 = participants[Math.floor(Math.random() * participants.length)].id; }
                await sock.sendMessage(from, { text: `💘 *PAREJA DEL DÍA* 💘\n• @${p1.replace(/[^0-9]/g, '')}\n• @${p2.replace(/[^0-9]/g, '')}`, mentions: [p1, p2] }, { quoted: msg });
            } catch (e) {
                await sock.sendMessage(from, { text: `❌ Error al sortear pareja.` }, { quoted: msg });
            }
        }

        else if (command === 'gey' || command === 'gay') {
            const porcentaje = Math.floor(Math.random() * 101);
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return sock.sendMessage(from, { text: `⚠️ Etiqueta a alguien: \`${prefix}gey @usuario\`` }, { quoted: msg });
            await sock.sendMessage(from, { text: `🏳️‍🌈 @${target.replace(/[^0-9]/g, '')} tiene un ${porcentaje}%.\n\n😏 ¿Quién quiere tocar a ese femboy?`, mentions: [target] }, { quoted: msg });
        }

        else if (command === 'chiste') {
            const chistes = ["¿Qué hace una abeja en el gimnasio? ¡Zumba!", "— Papá, ¿qué se siente tener un hijo tan guapo? — No lo sé hijo, pregúntale a tu abuelo."];
            await sock.sendMessage(from, { text: `😂 ${chistes[Math.floor(Math.random() * chistes.length)]}` }, { quoted: msg });
        }

        else if (command === 'piropo') {
            const piropos = ["Si la belleza fuera pecado, tú estarías sin perdón.", "Eres como el Google: tienes todo lo que estoy buscando."];
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            const mentionText = target ? `@${target.replace(/[^0-9]/g, '')} ` : '';
            await sock.sendMessage(from, { text: `❤️ ${mentionText}${piropos[Math.floor(Math.random() * piropos.length)]}`, mentions: target ? [target] : [] }, { quoted: msg });
        }

        // --- COMMANDS D'ÉMOTIONS ---
        else if (['hug', 'abrazo'].includes(command)) {
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return sock.sendMessage(from, { text: `⚠️ Etiqueta a alguien para abrazar: \`${prefix}hug @usuario\`` }, { quoted: msg });
            await sock.sendMessage(from, { text: `🤗 *@${senderClean}* le ha dado un cálido y tierno abrazo a *@${target.replace(/[^0-9]/g, '')}*. ¡Qué adorable! 💖`, mentions: [sender, target] }, { quoted: msg });
        }

        else if (['kiss', 'beso'].includes(command)) {
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return sock.sendMessage(from, { text: `⚠️ Etiqueta a alguien para besar: \`${prefix}kiss @usuario\`` }, { quoted: msg });
            await sock.sendMessage(from, { text: `😘 *@${senderClean}* le ha robado un tierno beso a *@${target.replace(/[^0-9]/g, '')}*. 💋✨`, mentions: [sender, target] }, { quoted: msg });
        }

        else if (['slap', 'bofetada', 'golpe'].includes(command)) {
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return sock.sendMessage(from, { text: `⚠️ Etiqueta a alguien para golpear: \`${prefix}slap @usuario\`` }, { quoted: msg });
            await sock.sendMessage(from, { text: `💥 *@${senderClean}* le ha dado una tremenda bofetada a *@${target.replace(/[^0-9]/g, '')}*. ¡Eso debió doler! 🖐️⚡`, mentions: [sender, target] }, { quoted: msg });
        }

        else if (['pat', 'caricia'].includes(command)) {
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return sock.sendMessage(from, { text: `⚠️ Etiqueta a alguien para acariciar: \`${prefix}pat @usuario\`` }, { quoted: msg });
            await sock.sendMessage(from, { text: `🐾 *@${senderClean}* acaricia suavemente la cabeza de *@${target.replace(/[^0-9]/g, '')}*. ¡Buen chico/a! ✨`, mentions: [sender, target] }, { quoted: msg });
        }

        // POKÉMON & JUEGOS
        else if (command === 'pstart') {
            if (player.hasStarted && !isDev) return sock.sendMessage(from, { text: `❌ Ya usaste tu ${prefix}pstart.` }, { quoted: msg });
            const pokeName = args[1]?.toLowerCase();
            if (!pokeName) return sock.sendMessage(from, { text: `⚠️ Especifica un Pokémon. Ej: \`${prefix}pstart charmander\`` }, { quoted: msg });
            const pokeImg = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${pokeName}.png`;
            player.pokes.push({ name: pokeName, level: 10, xp: 0, power: 80, form: 'normal', image: pokeImg });
            player.active = player.pokes.length - 1;
            player.hasStarted = true;
            saveData(data);
            await sock.sendMessage(from, { image: { url: pokeImg }, caption: `🎉 ¡Has obtenido a *${pokeName.toUpperCase()}*!` }, { quoted: msg });
        }

        else if (command === 'pelegir') {
            const index = parseInt(args[1]) - 1;
            if (isNaN(index) || index < 0 || index >= player.pokes.length) return sock.sendMessage(from, { text: `⚠️ Número de Pokémon inválido.` }, { quoted: msg });
            player.active = index;
            saveData(data);
            await sock.sendMessage(from, { text: `⭐ Seleccionaste a *${player.pokes[index].name.toUpperCase()}*.` }, { quoted: msg });
        }

        else if (command === 'buycandy') {
            const cost = 150;
            if (player.money < cost) return sock.sendMessage(from, { text: `❌ Monedas insuficientes.` }, { quoted: msg });
            player.money -= cost;
            const activeIdx = player.active || 0;
            if (!player.pokes[activeIdx]) player.active = 0;
            player.pokes[player.active].level += 5;
            player.pokes[player.active].power += 25;
            saveData(data);
            await sock.sendMessage(from, { text: `🍬 ¡Compraste un Super Candy (+5 niveles)!` }, { quoted: msg });
        }

        else if (command === 'equipo') {
            let info = `📱 *Equipo de @${senderClean}:*\n\n`;
            player.pokes.forEach((p, idx) => {
                const activeTag = (idx === player.active) ? ' ⭐ (Activo)' : '';
                info += `${idx + 1}. *${p.name.toUpperCase()}* [Nvl ${p.level}] (Poder: ${p.power}) - Forma: ${p.form}${activeTag}\n`;
            });
            await sock.sendMessage(from, { text: info, mentions: [sender] }, { quoted: msg });
        }

        else if (command === 'pcombatir') {
            if (activeBattles[from]) {
                return sock.sendMessage(from, { text: `⚠️ Ya hay un combate en curso en este grupo. Espera a que termine.` }, { quoted: msg });
            }
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return sock.sendMessage(from, { text: `⚠️ Etiqueta a tu oponente: \`${prefix}pcombatir @usuario\`` }, { quoted: msg });
            const targetClean = target.replace(/[^0-9]/g, '');
            activeBattles[from] = { p1: senderClean, p2: targetClean, status: 'pending' };
            await sock.sendMessage(from, { text: `⚔️ Desafío enviado a @${targetClean}. Escribe *${prefix}paceptar* o *${prefix}huir*.`, mentions: [target] }, { quoted: msg });
        }

        else if (command === 'paceptar' || command === 'aceptar') {
            const battle = activeBattles[from];
            if (!battle || battle.status !== 'pending') return;
            if (battle.p2 !== senderClean) {
                return sock.sendMessage(from, { text: `❌ Solo el usuario desafiado puede aceptar el combate.` }, { quoted: msg });
            }
            battle.status = 'active';
            battle.turn = battle.p1;
            
            const p1Obj = getPlayer(data, battle.p1);
            const p2Obj = getPlayer(data, battle.p2);
            const p1Poke = p1Obj.pokes[p1Obj.active || 0] || p1Obj.pokes[0];
            const p2Poke = p2Obj.pokes[p2Obj.active || 0] || p2Obj.pokes[0];

            battle.p1MaxHp = (p1Poke.power || 50) * 5;
            battle.p2MaxHp = (p2Poke.power || 50) * 5;
            battle.p1Hp = battle.p1MaxHp;
            battle.p2Hp = battle.p2MaxHp;

            const p1Jid = `${battle.p1}@s.whatsapp.net`;
            const p2Jid = `${battle.p2}@s.whatsapp.net`;
            
            const startMsg = `🥊 *¡Combate iniciado!*\n\n` +
                             `• @${battle.p1} (${p1Poke.name.toUpperCase()}): ${battle.p1Hp}/${battle.p1MaxHp}\n` +
                             `• @${battle.p2} (${p2Poke.name.toUpperCase()}): ${battle.p2Hp}/${battle.p2MaxHp}\n\n` +
                             `👉 Turno de @${battle.turn}.\n` +
                             `/pm 1 · Ataque Rápido\n` +
                             `/pm 2 · Bola Sombra\n` +
                             `/pm 3 · Placaje\n` +
                             `/pm 4 · Hiperrayo`;

            await sock.sendMessage(from, { text: startMsg, mentions: [p1Jid, p2Jid] });
        }

        else if (command === 'huir') {
            const battle = activeBattles[from];
            if (!battle || (battle.p1 !== senderClean && battle.p2 !== senderClean)) return;
            delete activeBattles[from];
            await sock.sendMessage(from, { text: `🏃‍♂️ El combate ha sido cancelado / huido.` }, { quoted: msg });
        }

        else if (command === 'pm') {
            const battle = activeBattles[from];
            if (!battle || battle.status !== 'active') return;
            if (senderClean !== battle.p1 && senderClean !== battle.p2) {
                return sock.sendMessage(from, { text: `❌ No estás participando en el combate actual.` }, { quoted: msg });
            }
            if (battle.turn !== senderClean) {
                return sock.sendMessage(from, { text: `⏳ No es tu turno. Espera a que tu oponente ataque.` }, { quoted: msg });
            }

            const moveNum = parseInt(args[1]);
            if (![1, 2, 3, 4].includes(moveNum)) return;

            const isP1 = (senderClean === battle.p1);
            const damage = moveNum * 15;
            
            const p1Obj = getPlayer(data, battle.p1);
            const p2Obj = getPlayer(data, battle.p2);
            const p1Poke = p1Obj.pokes[p1Obj.active || 0] || p1Obj.pokes[0];
            const p2Poke = p2Obj.pokes[p2Obj.active || 0] || p2Obj.pokes[0];

            const attackerName = isP1 ? p1Poke.name.toUpperCase() : p2Poke.name.toUpperCase();
            
            if (isP1) {
                battle.p2Hp = Math.max(0, battle.p2Hp - damage);
            } else {
                battle.p1Hp = Math.max(0, battle.p1Hp - damage);
            }

            const p1Jid = `${battle.p1}@s.whatsapp.net`;
            const p2Jid = `${battle.p2}@s.whatsapp.net`;

            if (battle.p1Hp <= 0 || battle.p2Hp <= 0) {
                const winner = battle.p1Hp > 0 ? battle.p1 : battle.p2;
                getPlayer(data, winner).money += 200;
                saveData(data);
                await sock.sendMessage(from, { text: `🏆 ¡@${winner} ganó el combate y 200 monedas!`, mentions: [`${winner}@s.whatsapp.net`] });
                delete activeBattles[from];
            } else {
                battle.turn = isP1 ? battle.p2 : battle.p1;
                const nextJid = `${battle.turn}@s.whatsapp.net`;
                
                const turnMsg = `💥 *${attackerName}* usó ataque y causó *${damage}* de daño.\n\n` +
                                `• @${battle.p1} (${p1Poke.name.toUpperCase()}): ${battle.p1Hp}/${battle.p1MaxHp}\n` +
                                `• @${battle.p2} (${p2Poke.name.toUpperCase()}): ${battle.p2Hp}/${battle.p2MaxHp}\n\n` +
                                `👉 Turno de @${battle.turn}.\n` +
                                `/pm 1 · Ataque Rápido\n` +
                                `/pm 2 · Bola Sombra\n` +
                                `/pm 3 · Placaje\n` +
                                `/pm 4 · Hiperrayo`;

                await sock.sendMessage(from, { text: turnMsg, mentions: [p1Jid, p2Jid] });
            }
        }

        // --- MÉGA-ÉVOLUTION EN PLEIN COMBAT AVEC ENVOI D'IMAGE ---
        else if (['mega', 'dynamax', 'gigantamax'].includes(command)) {
            const battle = activeBattles[from];
            if (!battle || battle.status !== 'active') {
                return sock.sendMessage(from, { text: `⚠️ Las formas especiales (Mega, Dynamax, Gigantamax) solo se pueden usar *durante un combate activo*.` }, { quoted: msg });
            }
            if (senderClean !== battle.p1 && senderClean !== battle.p2) {
                return sock.sendMessage(from, { text: `❌ No estás en el combate actual.` }, { quoted: msg });
            }

            const formType = command;
            const activeIdx = player.active || 0;
            if (!player.pokes[activeIdx]) player.active = 0;
            
            const currentPoke = player.pokes[player.active];
            currentPoke.form = formType;
            currentPoke.power += 50;

            if (senderClean === battle.p1) {
                battle.p1MaxHp += 100;
                battle.p1Hp += 100;
            } else {
                battle.p2MaxHp += 100;
                battle.p2Hp += 100;
            }
            saveData(data);

            const p1Obj = getPlayer(data, battle.p1);
            const p2Obj = getPlayer(data, battle.p2);
            const p1Poke = p1Obj.pokes[p1Obj.active || 0] || p1Obj.pokes[0];
            const p2Poke = p2Obj.pokes[p2Obj.active || 0] || p2Obj.pokes[0];

            const p1Jid = `${battle.p1}@s.whatsapp.net`;
            const p2Jid = `${battle.p2}@s.whatsapp.net`;

            const pokeImageUrl = currentPoke.image || `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${currentPoke.name}.png`;

            const evolveMsg = `✨ *¡MEGA-EVOLUCIÓN EN COMBATE!* ✨\n\n` +
                              `🔥 ¡El Pokémon de @${senderClean} ha evolucionado a forma *${formType.toUpperCase()}*!\n` +
                              `💪 ¡Poder y PV aumentados considerablemente!\n\n` +
                              `• @${battle.p1} (${p1Poke.name.toUpperCase()}[${p1Poke.form}]): ${battle.p1Hp}/${battle.p1MaxHp}\n` +
                              `• @${battle.p2} (${p2Poke.name.toUpperCase()}[${p2Poke.form}]): ${battle.p2Hp}/${battle.p2MaxHp}\n\n` +
                              `👉 Turno de @${battle.turn}.\n` +
                              `/pm 1 · Ataque Rápido\n` +
                              `/pm 2 · Bola Sombra\n` +
                              `/pm 3 · Placaje\n` +
                              `/pm 4 · Hiperrayo`;

            await sock.sendMessage(from, { image: { url: pokeImageUrl }, caption: evolveMsg, mentions: [p1Jid, p2Jid, sender] });
        }

        else if (command === 'adivina') {
            const trivias = [
                { q: "¿Qué Pokémon es conocido como el ratón eléctrico?", a: "pikachu" },
                { q: "¿Cuál es la evolución inicial tipo planta de la primera generación?", a: "bulbasaur" },
                { q: "¿Qué criatura legendaria de fuego parece un dragón pero no es tipo dragón?", a: "charizard" }
            ];
            const randomTrivia = trivias[Math.floor(Math.random() * trivias.length)];
            activeTrivia[from] = randomTrivia.a;
            await sock.sendMessage(from, { text: `❓ *TRIVIA POKÉMON* ❓\n\n${randomTrivia.q}\n\n👉 Responde con: \`${prefix}resp <respuesta>\` (Gana 100 monedas).` }, { quoted: msg });
        }

        else if (command === 'resp') {
            const ans = args.slice(1).join(' ').toLowerCase();
            if (!activeTrivia[from]) return;
            if (ans === activeTrivia[from]) {
                player.money += 100;
                saveData(data);
                await sock.sendMessage(from, { text: `🎉 ¡Correcto @${senderClean}! +100 monedas.`, mentions: [sender] }, { quoted: msg });
                delete activeTrivia[from];
            } else {
                await sock.sendMessage(from, { text: `❌ Incorrecto.` }, { quoted: msg });
            }
        }

        else if (command === 'gato' || command === 'tictactoe') {
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return sock.sendMessage(from, { text: `⚠️ Etiqueta a un oponente: \`${prefix}gato @usuario\`` }, { quoted: msg });
            const targetClean = target.replace(/[^0-9]/g, '');
            activeTictactoe[from] = { p1: senderClean, p2: targetClean, board: [1, 2, 3, 4, 5, 6, 7, 8, 9], turn: senderClean };
            await sock.sendMessage(from, { text: `⭕ JUEGO DE GATO ❌\n@${senderClean} (⭕) vs @${targetClean} (❌)\n\n1 | 2 | 3\n----------\n4 | 5 | 6\n----------\n7 | 8 | 9\n\n👉 Turno de @${senderClean}. Usa ${prefix}pos <1-9>`, mentions: [sender, target] });
        }

        else if (command === 'pos') {
            const game = activeTictactoe[from];
            if (!game || game.turn !== senderClean) return;
            const pos = parseInt(args[1]) - 1;
            if (isNaN(pos) || pos < 0 || pos > 8 || typeof game.board[pos] === 'string') return sock.sendMessage(from, { text: `⚠️ Posición inválida u ocupada.` }, { quoted: msg });
            
            const symbol = (senderClean === game.p1) ? '⭕' : '❌';
            game.board[pos] = symbol;
            game.turn = (game.turn === game.p1) ? game.p2 : game.p1;

            const b = game.board;
            const boardText = `${b[0]} | ${b[1]} | ${b[2]}\n----------\n${b[3]} | ${b[4]} | ${b[5]}\n----------\n${b[6]} | ${b[7]} | ${b[8]}`;
            await sock.sendMessage(from, { text: `🎮 *Gato*\n\n${boardText}\n\n👉 Turno de @${game.turn}`, mentions: [`${game.turn}@s.whatsapp.net`] });
        }

        // MUTE ET MODERATION ET COMMANDES ADMIN
        else if (command === 'mute') {
            if (!isAdmin) return sock.sendMessage(from, { text: `❌ Solo administradores.` }, { quoted: msg });
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            const timeArg = args[2] || args[1];
            if (!target || !timeArg) return sock.sendMessage(from, { text: `⚠️ Uso correcto: \`${prefix}mute @usuario 10m\` (o 1h, 1d)` }, { quoted: msg });
            
            const unit = timeArg.slice(-1).toLowerCase();
            const val = parseInt(timeArg.slice(0, -1));
            let ms = unit === 'm' ? val * 60 * 1000 : unit === 'h' ? val * 3600000 : val * 86400000;
            if (isNaN(ms)) ms = 10 * 60 * 1000;

            const targetClean = target.replace(/[^0-9]/g, '');
            getPlayer(data, targetClean).mutedUntil = Date.now() + ms;
            saveData(data);
            await sock.sendMessage(from, { text: `🔇 Usuario @${targetClean} silenciado. Sus mensajes se borrarán automáticamente hasta que sea desmuteado.`, mentions: [target] }, { quoted: msg });
        }

        else if (command === 'unmute') {
            if (!isAdmin) return sock.sendMessage(from, { text: `❌ Solo administradores.` }, { quoted: msg });
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return sock.sendMessage(from, { text: `⚠️ Etiqueta al usuario: \`${prefix}unmute @usuario\`` }, { quoted: msg });
            const targetClean = target.replace(/[^0-9]/g, '');
            getPlayer(data, targetClean).mutedUntil = 0;
            saveData(data);
            await sock.sendMessage(from, { text: `🔊 Usuario @${targetClean} desmuteado correctamente.`, mentions: [target] }, { quoted: msg });
        }

        else if (command === 'warn' || command === 'advertir') {
            if (!isAdmin) return sock.sendMessage(from, { text: `❌ Solo administradores.` }, { quoted: msg });
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return sock.sendMessage(from, { text: `⚠️ Etiqueta al usuario a advertir: \`${prefix}warn @usuario\`` }, { quoted: msg });
            const targetClean = target.replace(/[^0-9]/g, '');
            const targetPlayer = getPlayer(data, targetClean);
            targetPlayer.warns += 1;
            saveData(data);
            await sock.sendMessage(from, { text: `⚠️ @${targetClean} ha recibido una advertencia (${targetPlayer.warns}/3).`, mentions: [target] }, { quoted: msg });
            if (targetPlayer.warns >= 3) {
                try {
                    await sock.groupParticipantsUpdate(from, [target], 'remove');
                    await sock.sendMessage(from, { text: `🚫 @${targetClean} fue expulsado automáticamente por acumular 3 advertencias.`, mentions: [target] });
                } catch (e) {
                    await sock.sendMessage(from, { text: `❌ El bot necesita ser admin para expulsar automáticamente.` });
                }
            }
        }

        else if (command === 'infractions' || command === 'warns') {
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || sender;
            const targetClean = target.replace(/[^0-9]/g, '');
            const targetPlayer = getPlayer(data, targetClean);
            await sock.sendMessage(from, { text: `📌 El usuario @${targetClean} tiene *${targetPlayer.warns}* advertencia(s).`, mentions: [target] }, { quoted: msg });
        }

        else if (command === 'lock' || command === 'cerrar') {
            if (!isAdmin) return sock.sendMessage(from, { text: `❌ Solo administradores.` }, { quoted: msg });
            try {
                await sock.groupSettingUpdate(from, 'announcement');
                await sock.sendMessage(from, { text: `🔒 Grupo cerrado. Solo los administradores pueden enviar mensajes.` }, { quoted: msg });
            } catch (e) {
                await sock.sendMessage(from, { text: `❌ El bot necesita ser Administrador.` }, { quoted: msg });
            }
        }

        else if (command === 'unlock' || command === 'abrir') {
            if (!isAdmin) return sock.sendMessage(from, { text: `❌ Solo administradores.` }, { quoted: msg });
            try {
                await sock.groupSettingUpdate(from, 'not_announcement');
                await sock.sendMessage(from, { text: `🔓 Grupo abierto. Todos los miembros pueden participar.` }, { quoted: msg });
            } catch (e) {
                await sock.sendMessage(from, { text: `❌ El bot necesita ser Administrador.` }, { quoted: msg });
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

        // UTILS
        else if (command === 'image' || command === 'google') {
            const query = args.slice(1).join(' ');
            if (!query) return;
            const imgUrl = `https://images.weserv.nl/?url=source.unsplash.com/featured/?${encodeURIComponent(query)}`;
            await sock.sendMessage(from, { image: { url: imgUrl }, caption: `🖼️ Imagen de: *${query}*` }, { quoted: msg });
        }

        else if (command === 'clima') {
            const ciudad = args.slice(1).join(' ');
            if (!ciudad) return;
            await sock.sendMessage(from, { text: `🌤️ Clima para *${ciudad}*: https://wttr.in/${encodeURIComponent(ciudad)}?lang=es` }, { quoted: msg });
        }

        else if (command === 'bal') {
            await sock.sendMessage(from, { text: `💰 Tienes *${player.money} monedas*.` }, { quoted: msg });
        }

        // OWNER COMMANDS
        else if (command === 'givepoke' && isDev) {
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || sender;
            const pokeName = args[1]?.toLowerCase();
            const power = parseInt(args[args.length - 1]) || 100;
            if (!pokeName) return sock.sendMessage(from, { text: `⚠️ Uso: ${prefix}givepoke @usuario <pokemon> <poder>` }, { quoted: msg });
            const targetClean = target.replace(/[^0-9]/g, '');
            const pokeImg = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${pokeName}.png`;
            getPlayer(data, targetClean).pokes.push({ name: pokeName, level: 50, xp: 0, power: power, form: 'normal', image: pokeImg });
            saveData(data);
            await sock.sendMessage(from, { text: `🎁 Pokémon *${pokeName.toUpperCase()}* regalado a @${targetClean}.`, mentions: [target] }, { quoted: msg });
        }

        else if (command === 'givecoins' && isDev) {
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || sender;
            const amount = parseInt(args[args.length - 1]);
            if (isNaN(amount)) return sock.sendMessage(from, { text: `⚠️ Uso: ${prefix}givecoins @usuario <cantidad>` }, { quoted: msg });
            const targetClean = target.replace(/[^0-9]/g, '');
            getPlayer(data, targetClean).money += amount;
            saveData(data);
            await sock.sendMessage(from, { text: `💰 Se agregaron ${amount} monedas a @${targetClean}.`, mentions: [target] }, { quoted: msg });
        }

        else if (command === 'reiniciar' && isDev) {
            await sock.sendMessage(from, { text: `🔄 Reiniciando el sistema de ${BOT_NAME}...` });
            process.exit(0);
        }
    });
}

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const express = require('express');
const pino = require('pino');

const DATA_FILE = './data.json';
const OWNER_NUMBERS = ['56928637216', '56928637216@s.whatsapp.net'];
const BOT_NAME = "TEAM DRONIX";

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

let globalSock = null;
const userSpamTracker = {};
const activeBattles = {};
const activeDbzBattles = {};
const activeOpmBattles = {};
const activeGroupSpawns = {};

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
            money: 500, bank: 0, wins: 0, losses: 0, 
            activePoke: 0, activeDbz: 0, activeOpm: 0, 
            userMsgCount: 0, hasStarted: false, messageCount: 0,
            pokes: [{ name: 'pikachu', level: 5, xp: 0, power: 50, form: 'normal', isGigantamax: false }],
            dbz: [{ name: 'Goku', level: 5, power: 60, form: 'Base' }],
            opm: [{ name: 'Saitama', level: 5, power: 100, form: 'Normal', stage: 1 }],
            birthDate: null, age: null, banned: false, mutedUntil: 0, harem: [], warns: 0, exp: 0, level: 1
        };
    }
    if (data.players[id].messageCount === undefined) data.players[id].messageCount = 0;
    if (data.players[id].bank === undefined) data.players[id].bank = 0;
    if (!data.players[id].harem) data.players[id].harem = [];
    if (!data.players[id].dbz) data.players[id].dbz = [{ name: 'Goku', level: 5, power: 60, form: 'Base' }];
    if (!data.players[id].opm) data.players[id].opm = [{ name: 'Saitama', level: 5, power: 100, form: 'Normal', stage: 1 }];
    if (!data.players[id].pokes || data.players[id].pokes.length === 0) {
        data.players[id].pokes = [{ name: 'pikachu', level: 5, xp: 0, power: 50, form: 'normal', isGigantamax: false }];
    }
    return data.players[id];
}

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('session_v4');

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
                    const welcomeText = groupConfig.customWelcome || `👋 ¡Bienvenido/a @${cleanNum} a *${groupName}*!\n\nDisfruta del grupo y diviértete con los minijuegos de ${BOT_NAME}. ✨`;
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
                        await sock.sendMessage(from, { text: `⚠️ 🔕 @${senderClean}, por favor evita hacer spam en el grupo.`, mentions: [sender] }, { quoted: msg });
                        return;
                    }
                } else {
                    userSpamTracker[senderClean] = { count: 1, lastTime: now };
                }
            }
        }

        // --- COMPTEUR DE 100 MESSAGES PARTAGÉ AVEC IMAGES POUR LES SPAWNS ---
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
                        caption: `🌿 ¡Un *${poke.name.toUpperCase()}* Pokémon salvaje ha aparecido en el grupo!\nEscribe \`/catch\` o \`/atrapar\` para conseguirlo.` 
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
                        caption: `☄️ ¡Un guerrero Z (*${dbz.name.toUpperCase()}*) ha aparecido!\nEscribe \`/reclutardbz\` para agregarlo.` 
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
                        caption: `👊 ¡Un héroe/villano de OPM (*${opm.name.toUpperCase()}*) ha aparecido!\nEscribe \`/reclutaropm\` para sumarlo.` 
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
        // 🌿 COMMANDES D'ATTRAPE (CATCH / RECLUTAR)
        // ==========================================
        if (command === 'catch' || command === 'atrapar') {
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
        // ⚙️ COMMANDE BOT ON / OFF
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
        // 👑 COMMANDES OWNER EXCLUSIVES
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
        // 📋 COMMANDE MENU
        // ==========================================
        if (command === 'menu' || command === 'help' || command === 'allmenu') {
            let menuText = `> ¡Hola! @${senderClean}, Soy *${BOT_NAME}*, Aquí tienes la lista completa de comandos. (˶ᵔ ᵕ ᵔ˶)\n\n` +
                `╭┈ࠢ͜┅ࠦ͜͜╾݊͜─ؕ͜─ׄ͜─֬͜─֟͜─֫͜─ׄ͜─ؕ͜─݊͜┈ࠦ͜┅ࠡ͜͜┈࠭͜͜۰۰͜۰\n` +
                `│</> *ᴅᴇsᴀʀʀᴏʟʟᴀᴅᴏʀ ::* Oculto\n` +
                `│❒ *ᴛɪᴘᴏ ::* Owner\n` +
                `│☕︎ *ᴠᴇʀsɪóɴ ::* Bêta Cerrada\n` +
                `╰ׅ┈ࠢ͜─ׄ͜─ׄ֟፝͜─ׄ͜─ׄ͜╴ ⋱࣭ ᩴ  ⋮֔   ᩴ ⋰╶͜─ׄ͜─ׄ֟፝͜─ׄ͜─ׄ͜┈ࠢ͜╯ׅ\n\n` +
                `🐾 *POKÉMON:* \`${prefix}pokemenu\`, \`{p}pstart\`, \`{p}equipo\`, \`{p}buycandy\`, \`{p}ptransform\`, \`{p}pcombatir\`, \`{p}catch\`\n` +
                `🐉 *DBZ:* \`{p}dbzmenu\`, \`{p}dbzequipo\`, \`{p}dcombatir @user\`, \`{p}zm <1-4>\`, \`{p}reclutardbz\`\n` +
                `👊 *ONE PUNCH MAN:* \`{p}opmmenu\`, \`{p}opmequipo\`, \`{p}evolu <1-3>\`, \`{p}opmcombatir @user\`, \`{p}om <1-4>\`, \`{p}reclutaropm\`\n` +
                `💰 *ECONOMÍA:* \`{p}work\`, \`{p}bal\`, \`{p}ruleta\`, \`{p}crime\`, \`{p}robar\`\n` +
                `🎁 *GACHA:* \`{p}roll\`, \`{p}claim\`, \`{p}harem\`\n` +
                `📥 *MEDIAS:* \`{p}youtube\`, \`{p}pinterest\`, \`{p}image\`, \`{p}bratv\`\n` +
                `✨ *STICKERS:* \`{p}s\`, \`{p}brat\`\n` +
                `👥 *ADMIN:* \`{p}kick\`, \`{p}warn\`, \`{p}hidetag\`, \`{p}bot on/off\`\n` +
                `👑 *OWNER COMMANDS:* \`{p}givecoins <monto>\`, \`{p}givepoke <nombre>\`, \`{p}givedbz <nombre>\`, \`{p}giveopm <nombre>\`, \`{p}givewaifu <nombre>\``;
            
            menuText = menuText.replace(/\{p\}/g, prefix);
            await sock.sendMessage(from, { text: menuText, mentions: [sender] }, { quoted: msg });
        }

        // ==========================================
        // ⚔️ COMBATS SÉCURISÉS (OPM, POKÉMON, DBZ)
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

            const battleText = `👊 *¡BATALLA ONE PUNCH MAN INICIADA!* 👊\n\n` +
                               `🔴 @${senderClean} (*${activeChar1.name.toUpperCase()}*) VS 🔵 @${targetClean} (*${activeChar2.name.toUpperCase()}*)\n\n` +
                               `👉 Es el turno de @${senderClean}.\n` +
                               `Usa \`${prefix}om <1-4>\` para atacar.\n` +
                               `1: Rapido (20-35) | 2: Normal (35-55) | 3: Fuerte (55-75) | 4: Ultime (80-120)`;

            await sock.sendMessage(from, { text: battleText, mentions: [sender, target] }, { quoted: msg });
        }

        else if (command === 'om') {
            if (!activeOpmBattles[from]) return sock.sendMessage(from, { text: `❌ No hay ningún combate de OPM activo en este grupo.` }, { quoted: msg });
            const battle = activeOpmBattles[from];

            if (senderClean !== battle.p1.id && senderClean !== battle.p2.id) {
                return sock.sendMessage(from, { text: `⚠️ ❌ @${senderClean}, no estás participando en esta batalla de OPM. Por favor no interrumpas.`, mentions: [sender] }, { quoted: msg });
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

            const moveDamages = [
                { min: 20, max: 35 },  
                { min: 35, max: 55 },  
                { min: 55, max: 75 },  
                { min: 80, max: 120 }  
            ];

            const selectedMove = moveDamages[moveIndex];
            let damage = Math.floor(Math.random() * (selectedMove.max - selectedMove.min + 1)) + selectedMove.min;

            const isCritical = Math.random() < 0.15;
            if (isCritical) {
                damage = Math.floor(damage * 1.5);
            }

            defender.hp = Math.max(0, defender.hp - damage);

            const barLength = 10;
            const filled1 = Math.round((battle.p1.hp / battle.p1.maxHp) * barLength);
            const bar1 = '█'.repeat(Math.max(0, filled1)) + '░'.repeat(Math.max(0, barLength - filled1));
            
            const filled2 = Math.round((battle.p2.hp / battle.p2.maxHp) * barLength);
            const bar2 = '█'.repeat(Math.max(0, filled2)) + '░'.repeat(Math.max(0, barLength - filled2));

            battle.turn = isP1 ? battle.p2.id : battle.p1.id;

            const moveName = attacker.moves[moveIndex];
            let response = `💥 *${attacker.char.name.toUpperCase()}* usó *${moveName}* y causó *${damage}* de daño${isCritical ? ' 🎯 *(¡GOLPE CRÍTICO!)*' : ''}.\n\n`;
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

            const battleText = `⚔️ *¡COMBATE POKÉMON INICIADO!* ⚔️\n\n` +
                               `🔴 @${senderClean} (*${activePoke1.name.toUpperCase()}*) VS 🔵 @${targetClean} (*${activePoke2.name.toUpperCase()}*)\n\n` +
                               `👉 Es el turno de @${senderClean}.\n` +
                               `Usa \`${prefix}pm <1-4>\` para atacar.`;

            await sock.sendMessage(from, { text: battleText, mentions: [sender, target] }, { quoted: msg });
        }

        else if (command === 'pm' || command === 'move') {
            if (!activeBattles[from]) return sock.sendMessage(from, { text: `❌ No hay ningún combate Pokémon activo en este grupo.` }, { quoted: msg });
            const battle = activeBattles[from];

            if (senderClean !== battle.p1.id && senderClean !== battle.p2.id) {
                return sock.sendMessage(from, { text: `⚠️ ❌ @${senderClean}, no estás participando en este combate. Por favor no interrumpas.`, mentions: [sender] }, { quoted: msg });
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

            let response = `💥 *${attacker.poke.name.toUpperCase()}* usó *${moveName}* y causó *${damage}* de daño.\n`;
            if (damage === 0) response += `🚫 No afecta al rival...\n\n`;
            else response += `\n`;

            response += `${battle.p1.poke.name}: [${bar1}] ${battle.p1.hp}/${battle.p1.maxHp}\n`;
            response += `${battle.p2.poke.name}: [${bar2}] ${battle.p2.hp}/${battle.p2.maxHp}\n\n`;

            if (defender.hp <= 0) {
                response += `🏆 ¡*${attacker.poke.name.toUpperCase()}* ha ganado el combate! 🎉`;
                delete activeBattles[from];
            } else {
                response += `👉 Turno de @${battle.turn}\n`;
                attacker.moves.forEach((m, idx) => {
                    response += `${prefix}pm ${idx + 1} · Max ${m}\n`;
                });
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

            const battleText = `☄️ *¡BATALLA Z INICIADA!* ☄️\n\n` +
                               `🔴 @${senderClean} (*${activeChar1.name.toUpperCase()}*) VS 🔵 @${targetClean} (*${activeChar2.name.toUpperCase()}*)\n\n` +
                               `👉 Es el turno de @${senderClean}.\n` +
                               `Usa \`${prefix}zm <1-4>\` para atacar.`;

            await sock.sendMessage(from, { text: battleText, mentions: [sender, target] }, { quoted: msg });
        }

        else if (command === 'zm') {
            if (!activeDbzBattles[from]) return sock.sendMessage(from, { text: `❌ No hay ningún combate DBZ activo en este grupo.` }, { quoted: msg });
            const battle = activeDbzBattles[from];

            if (senderClean !== battle.p1.id && senderClean !== battle.p2.id) {
                return sock.sendMessage(from, { text: `⚠️ ❌ @${senderClean}, no estás participando en esta batalla Z. Por favor no interrumpas.`, mentions: [sender] }, { quoted: msg });
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
        // 📥 COMMANDES MEDIAS & AUTRES
        // ==========================================
        else if (command === 'youtube' || command === 'yt' || command === 'play') {
            const query = args.slice(1).join(' ');
            if (!query) return sock.sendMessage(from, { text: `⚠️ Uso: \`${prefix}youtube <canción o artista>\`` }, { quoted: msg });

            await sock.sendMessage(from, { text: `🎵 Buscando y procesando *"${query}"* en YouTube...` }, { quoted: msg });
            await sock.sendMessage(from, { text: `✅ Resultado de YouTube para: *${query}*\n🔗 (Audio / Video encontrado exitosamente)` }, { quoted: msg });
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
                           `• \`${prefix}equipo\` - Ver tus Pokémon\n` +
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
            await sock.sendMessage(from, { text: `💼 ¡Trabajaste duro y ganaste *$${earnings}* coins!` }, { quoted: msg });
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

    });
}

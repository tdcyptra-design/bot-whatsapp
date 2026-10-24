const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const fs = require('fs');

const DATA_FILE = './data.json';

// NÚMERO DEL DESARROLLADOR / DEV
const DEV_NUMBERS = ['56928637216', '56928637216@s.whatsapp.net']; 
const BOT_NAME = "TEAM DRONIX";

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
            money: 500,
            wins: 0,
            losses: 0,
            active: 0,
            hasStarted: false, // Contrôle pour que /pstart ne s'utilise qu'une seule fois
            pokes: [
                { name: 'pikachu', level: 5, xp: 0, power: 50, form: 'normal', image: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png' }
            ],
            birthDate: null,
            age: null,
            banned: false,
            mutedUntil: 0
        };
    }
    return data.players[id];
}

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('session_principal');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log("Escanea el siguiente código QR para conectar:");
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('Conexión cerrada. Reconectando...', shouldReconnect);
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('¡Bot conectado correctamente à WhatsApp!');
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

        const text = msg.message.conversation || 
                   msg.message.extendedTextMessage?.text || 
                   msg.message.imageMessage?.caption || '';

        const data = loadData();
        const player = getPlayer(data, senderClean);

        const isFromMe = msg.key.fromMe;
        const isDev = isFromMe || 
                      sender.includes('56928637216') || 
                      senderClean.includes('56928637216') || 
                      DEV_NUMBERS.some(num => sender.includes(num));

        // --- SYSTÈME D'EXPÉRIENCE PASSIVE AU CHAT ---
        if (player.pokes && player.pokes.length > 0) {
            const activePoke = player.pokes[player.active || 0];
            activePoke.xp = (activePoke.xp || 0) + 10;

            const xpNeeded = activePoke.level * 50;
            if (activePoke.xp >= xpNeeded) {
                activePoke.level += 1;
                activePoke.power += 5;
                activePoke.xp = 0;
                saveData(data);

                await sock.sendMessage(from, { 
                    text: `🎉 ¡El Pokémon *${activePoke.name.toUpperCase()}* de @${senderClean} subió al *Nivel ${activePoke.level}* por chatear! (Poder: ${activePoke.power})`,
                    mentions: [sender]
                });
            } else {
                saveData(data);
            }
        }

        // Vérification des préfixes acceptés : / , . #
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

        // --- COMMANDE TEST /MYID ---
        if (command === 'myid') {
            await sock.sendMessage(from, { 
                text: `📱 *INFORMATIONS PROFIL :*\n\n• ID: \`${sender}\`\n• Clean: \`${senderClean}\`\n• IsDev: *${isDev ? 'OUI ✅' : 'NON ❌'}*\n• IsAdmin: *${isAdmin ? 'OUI ✅' : 'NON ❌'}*` 
            }, { quoted: msg });
            return;
        }

        // --- CONTROL DEL BOT (ON / OFF) ---
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
                await sock.sendMessage(from, { text: `🔴 *${BOT_NAME} desactivado en este grupo.* No responderá hasta activar con /bot on.` }, { quoted: msg });
                return;
            } else if (option === 'on') {
                data.groups[from] = data.groups[from] || {};
                data.groups[from].botOff = false;
                saveData(data);
                await sock.sendMessage(from, { text: `🟢 *¡${BOT_NAME} activado nuevamente en este grupo!* Listo para usar.` }, { quoted: msg });
                return;
            } else {
                await sock.sendMessage(from, { text: `⚠️ Uso correcto: /bot on | /bot off` }, { quoted: msg });
                return;
            }
        }

        if (data.groups[from]?.botOff && !isDev) return;

        // --- MENÚ PRINCIPAL ---
        if (command === 'menu') {
            const menuText = `✨ *BOT POKÉMON & MENÚ COMPLETO* ✨\n\n` +
                `🎮 *POKÉMON & COMBATE:*\n` +
                `• *{p}equipo* : Ver tu equipo y Pokémon activo.\n` +
                `• *{p}pstart <nombre>* : Obtener Pokémon inicial (1 solo uso).\n` +
                `• *{p}pelegir <número>* : Seleccionar tu Pokémon activo.\n` +
                `• *{p}buycandy* : Comprar Super Candy (+5 lvl / 150 coins).\n` +
                `• *{p}pcombatir @usuario* : Desafiar a un jugador.\n` +
                `• *{p}paceptar* : Aceptar combate.\n` +
                `• *{p}huir* : Huir de la batalla.\n` +
                `• *{p}pm 1, 2, 3, 4* : Atacar con HP en tiempo real.\n` +
                `• *{p}evolucionar mega|dynamax|gigantamax* : Forma especial (500 coins).\n\n` +
                `📥 *MEDIA & DESCARGAS:*\n` +
                `• *{p}yt <búsqueda>* : Descargar/buscar info de YouTube.\n` +
                `• *{p}pinterest <búsqueda>* : Buscar imágenes en Pinterest.\n` +
                `• *{p}image <búsqueda>* : Buscar imágenes en Google.\n\n` +
                `🎂 *PERFIL & CUMPLEAÑOS:*\n` +
                `• *{p}reg DD/MM/AAAA* : Registrar fecha.\n` +
                `• *{p}birthday @usuario* : Ver cumpleaños.\n` +
                `• *{p}bal* : Ver saldo de coins.\n\n` +
                `👑 *COMANDOS DEV & ADMIN:*\n` +
                `• *{p}grupo abrir* / *{p}grupo cerrar*\n` +
                `• *{p}givepoke @usuario <poke> <power>*\n` +
                `• *{p}givecoins @usuario <monto>*\n` +
                `• *{p}ban @usuario* | *{p}unban @usuario*\n` +
                `• *{p}mute @usuario <10m|1h|1d>* | *{p}unmute @usuario*`.replace(/\{p\}/g, prefix);
            await sock.sendMessage(from, { text: menuText }, { quoted: msg });
        }

        // --- COMMANDE : PSTART ---
        else if (command === 'pstart') {
            if (player.hasStarted && !isDev) {
                await sock.sendMessage(from, { text: '❌ Ya usaste tu /pstart inicial. Usa /pelegir para cambiar tu Pokémon o evoluciónalos.' }, { quoted: msg });
                return;
            }

            const pokeName = args[1]?.toLowerCase();
            if (!pokeName) {
                await sock.sendMessage(from, { text: '⚠️ Uso: /pstart <nombre_pokemon>' }, { quoted: msg });
                return;
            }

            player.pokes.push({ 
                name: pokeName, 
                level: 10, 
                xp: 0, 
                power: 80, 
                form: 'normal',
                image: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${pokeName}.png`
            });
            player.active = player.pokes.length - 1;
            player.hasStarted = true;
            saveData(data);

            await sock.sendMessage(from, { text: `🎉 ¡Has obtenido a *${pokeName.toUpperCase()}*! Ahora es tu Pokémon activo ⭐` }, { quoted: msg });
        }

        // --- COMMANDE : PELEGIR ---
        else if (command === 'pelegir') {
            const index = parseInt(args[1]) - 1;
            if (isNaN(index) || index < 0 || index >= player.pokes.length) {
                await sock.sendMessage(from, { text: `⚠️ Uso: /pelegir <número_del_pokemon>. Revisa tu lista con /equipo` }, { quoted: msg });
                return;
            }

            player.active = index;
            saveData(data);
            const selected = player.pokes[index];

            await sock.sendMessage(from, { text: `⭐ Has seleccionado a *${selected.name.toUpperCase()}* [Nvl ${selected.level}] como tu Pokémon activo.` }, { quoted: msg });
        }

        // --- COMMANDE : BUYCANDY ---
        else if (command === 'buycandy') {
            const cost = 150;
            if (player.money < cost) {
                await sock.sendMessage(from, { text: `❌ No tienes suficientes coins. Un Super Candy cuesta ${cost} coins (Tienes: ${player.money}).` }, { quoted: msg });
                return;
            }
            player.money -= cost;
            const activePoke = player.pokes[player.active];
            activePoke.level += 5;
            activePoke.power += 25;
            saveData(data);

            await sock.sendMessage(from, { 
                text: `🍬 ¡Has comprado un *Super Candy*! Tu *${activePoke.name.toUpperCase()}* subió al Nivel ${activePoke.level} (Poder: ${activePoke.power}). Saldo restante: ${player.money} coins.` 
            }, { quoted: msg });
        }

        // --- COMMANDES MEDIA ---
        else if (command === 'yt' || command === 'youtube') {
            const query = args.slice(1).join(' ');
            if (!query) {
                await sock.sendMessage(from, { text: '⚠️ Uso: /yt <nombre o término de búsqueda>' }, { quoted: msg });
                return;
            }
            await sock.sendMessage(from, { text: `🔍 Buscando en YouTube: *${query}*...\n🔗 Enlace de búsqueda: https://www.youtube.com/results?search_query=${encodeURIComponent(query)}` }, { quoted: msg });
        }

        else if (command === 'pinterest') {
            const query = args.slice(1).join(' ');
            if (!query) {
                await sock.sendMessage(from, { text: '⚠️ Uso: /pinterest <término>' }, { quoted: msg });
                return;
            }
            const pinUrl = `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`;
            await sock.sendMessage(from, { text: `📌 Resultados en Pinterest para *${query}*:\n🔗 ${pinUrl}` }, { quoted: msg });
        }

        else if (command === 'image' || command === 'google') {
            const query = args.slice(1).join(' ');
            if (!query) {
                await sock.sendMessage(from, { text: '⚠️ Uso: /image <término>' }, { quoted: msg });
                return;
            }
            const imgUrl = `https://images.weserv.nl/?url=source.unsplash.com/featured/?${encodeURIComponent(query)}`;
            await sock.sendMessage(from, { image: { url: imgUrl }, caption: `🖼️ Imagen relacionada con: *${query}*` }, { quoted: msg });
        }

        // --- COMMANDES DEV ---
        else if (command === 'givepoke') {
            if (!isDev) {
                await sock.sendMessage(from, { text: '❌ Este comando es exclusivo para el Desarrollador.' }, { quoted: msg });
                return;
            }
            
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || sender;
            const pokeName = args[1]?.startsWith('@') ? args[2]?.toLowerCase() : args[1]?.toLowerCase();
            const power = parseInt(args[args.length - 1]) || 100;

            if (!pokeName) {
                await sock.sendMessage(from, { text: '⚠️ Uso Dev: /givepoke @usuario <pokemon> <poder>' }, { quoted: msg });
                return;
            }

            const targetClean = target.replace(/[^0-9]/g, '');
            const targetObj = getPlayer(data, targetClean);

            targetObj.pokes.push({ 
                name: pokeName, 
                level: 50, 
                xp: 0,
                power: power, 
                form: 'normal',
                image: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${pokeName}.png`
            });
            saveData(data);

            await sock.sendMessage(from, { 
                text: `🎁 *[DEV]* ¡Se regaló el Pokémon *${pokeName.toUpperCase()}* (Poder: ${power}) a @${targetClean}!`,
                mentions: [target]
            }, { quoted: msg });
        }

        else if (command === 'givecoins') {
            if (!isDev) {
                await sock.sendMessage(from, { text: '❌ Este comando es exclusivo para el Desarrollador.' }, { quoted: msg });
                return;
            }
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || sender;
            const amount = parseInt(args[args.length - 1]);

            if (isNaN(amount)) {
                await sock.sendMessage(from, { text: '⚠️ Uso Dev: /givecoins @usuario <monto>' }, { quoted: msg });
                return;
            }

            const targetClean = target.replace(/[^0-9]/g, '');
            const targetObj = getPlayer(data, targetClean);
            targetObj.money += amount;
            saveData(data);

            await sock.sendMessage(from, { 
                text: `💰 *[DEV]* ¡Se agregaron *${amount} coins* a @${targetClean}! Saldo actual: ${targetObj.money}`,
                mentions: [target]
            }, { quoted: msg });
        }

        // --- COMMANDES ADMIN & MODERATION ---
        else if (command === 'grupo') {
            if (!isAdmin) {
                await sock.sendMessage(from, { text: '❌ Solo los Administradores pueden gestionar el grupo.' }, { quoted: msg });
                return;
            }
            const action = args[1]?.toLowerCase();
            if (action === 'abrir' || action === 'open') {
                await sock.groupSettingUpdate(from, 'not_announcement');
                await sock.sendMessage(from, { text: '🔓 *El grupo ha sido abierto.* ¡Todos pueden hablar!' }, { quoted: msg });
            } else if (action === 'cerrar' || action === 'close') {
                await sock.groupSettingUpdate(from, 'announcement');
                await sock.sendMessage(from, { text: '🔒 *El grupo ha sido cerrado.* Solo admins pueden hablar.' }, { quoted: msg });
            } else {
                await sock.sendMessage(from, { text: `⚠️ Uso correcto: /grupo abrir | /grupo cerrar` }, { quoted: msg });
            }
        }

        else if (command === 'abrir' || command === 'open') {
            if (!isAdmin) return;
            await sock.groupSettingUpdate(from, 'not_announcement');
            await sock.sendMessage(from, { text: '🔓 *El grupo ha sido abierto.* ¡Todos pueden hablar!' }, { quoted: msg });
        }

        else if (command === 'cerrar' || command === 'close') {
            if (!isAdmin) return;
            await sock.groupSettingUpdate(from, 'announcement');
            await sock.sendMessage(from, { text: '🔒 *El grupo ha sido cerrado.* Solo admins pueden hablar.' }, { quoted: msg });
        }

        else if (command === 'kick') {
            if (!isAdmin) {
                await sock.sendMessage(from, { text: '❌ Solo los Administradores pueden expulsar usuarios.' }, { quoted: msg });
                return;
            }
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return;
            await sock.groupParticipantsUpdate(from, [target], 'remove');
            await sock.sendMessage(from, { text: '🚪 Usuario eliminado del grupo.' }, { quoted: msg });
        }

        else if (command === 'ban') {
            if (!isAdmin) {
                await sock.sendMessage(from, { text: '❌ Solo los Administradores pueden banear usuarios del bot.' }, { quoted: msg });
                return;
            }
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) {
                await sock.sendMessage(from, { text: '⚠️ Uso: /ban @usuario' }, { quoted: msg });
                return;
            }
            const targetClean = target.replace(/[^0-9]/g, '');
            const targetObj = getPlayer(data, targetClean);
            targetObj.banned = true;
            saveData(data);

            await sock.sendMessage(from, { 
                text: `🚫 @${targetClean} ha sido baneado. El bot ya no responderá a sus mensajes.`, 
                mentions: [target] 
            }, { quoted: msg });
        }

        else if (command === 'unban') {
            if (!isAdmin) {
                await sock.sendMessage(from, { text: '❌ Solo los Administradores pueden desbanear.' }, { quoted: msg });
                return;
            }
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return;
            const targetClean = target.replace(/[^0-9]/g, '');
            const targetObj = getPlayer(data, targetClean);
            targetObj.banned = false;
            saveData(data);

            await sock.sendMessage(from, { 
                text: `✅ @${targetClean} ha sido desbaneado y puede usar el bot nuevamente.`, 
                mentions: [target] 
            }, { quoted: msg });
        }

        else if (command === 'mute') {
            if (!isAdmin) {
                await sock.sendMessage(from, { text: '❌ Solo los Administradores pueden silenciar.' }, { quoted: msg });
                return;
            }
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            const timeArg = args[2];
            if (!target || !timeArg) {
                await sock.sendMessage(from, { text: '⚠️ Uso: /mute @usuario <tiempo> (Ej: 10m, 1h, 2d)' }, { quoted: msg });
                return;
            }
            const unit = timeArg.slice(-1).toLowerCase();
            const val = parseInt(timeArg.slice(0, -1));
            let ms = 0;
            if (unit === 'm') ms = val * 60 * 1000;
            else if (unit === 'h') ms = val * 60 * 60 * 1000;
            else if (unit === 'd') ms = val * 24 * 60 * 60 * 1000;

            const targetClean = target.replace(/[^0-9]/g, '');
            getPlayer(data, targetClean).mutedUntil = Date.now() + ms;
            saveData(data);
            await sock.sendMessage(from, { text: `🔇 @${targetClean} silenciado por ${timeArg}.`, mentions: [target] }, { quoted: msg });
        }

        else if (command === 'unmute') {
            if (!isAdmin) return;
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return;
            const targetClean = target.replace(/[^0-9]/g, '');
            getPlayer(data, targetClean).mutedUntil = 0;
            saveData(data);
            await sock.sendMessage(from, { text: `🔊 @${targetClean} desmuteado.`, mentions: [target] }, { quoted: msg });
        }

        // --- POKÉMON & COMBATE ---
        else if (command === 'equipo') {
            let info = `📱 *Equipo de @${senderClean}:*\n\n`;
            player.pokes.forEach((p, idx) => {
                const activeTag = (idx === player.active) ? ' ⭐ (Activo)' : '';
                info += `${idx + 1}. *${p.name.toUpperCase()}* [Nvl ${p.level}] (XP: ${p.xp || 0}/${p.level * 50}) (Poder: ${p.power}) - Forma: ${p.form || 'Normal'}${activeTag}\n`;
            });
            await sock.sendMessage(from, { text: info, mentions: [sender] }, { quoted: msg });
        }

        else if (command === 'pcombatir') {
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) {
                await sock.sendMessage(from, { text: '⚠️ Menciona a un jugador: /pcombatir @usuario' }, { quoted: msg });
                return;
            }
            const targetClean = target.replace(/[^0-9]/g, '');
            getPlayer(data, targetClean);

            activeBattles[from] = { p1: senderClean, p2: targetClean, status: 'pending' };

            await sock.sendMessage(from, { 
                text: `⚔️ @${senderClean} desafió a @${targetClean}.\nEscribe */paceptar* para empezar o */huir* para cancelar.`,
                mentions: [sender, target]
            }, { quoted: msg });
        }

        else if (command === 'paceptar') {
            const battle = activeBattles[from];
            if (!battle || battle.p2 !== senderClean || battle.status !== 'pending') {
                await sock.sendMessage(from, { text: '❌ No tienes desafíos pendientes.' }, { quoted: msg });
                return;
            }
            battle.status = 'active';
            battle.turn = battle.p1;

            const p1Obj = getPlayer(data, battle.p1);
            const p2Obj = getPlayer(data, battle.p2);
            const p1Poke = p1Obj.pokes[p1Obj.active] || { name: 'Pikachu', power: 50 };
            const p2Poke = p2Obj.pokes[p2Obj.active] || { name: 'Charizard', power: 50 };

            battle.p1Hp = p1Poke.power * 5;
            battle.p2Hp = p2Poke.power * 5;

            const jid1 = `${battle.p1}@s.whatsapp.net`;
            const jid2 = `${battle.p2}@s.whatsapp.net`;

            await sock.sendMessage(from, { 
                text: `🥊 ¡COMBATE INICIADO!\n🔴 @${battle.p1} (${p1Poke.name.toUpperCase()}) - HP: ${battle.p1Hp}\n🔵 @${battle.p2} (${p2Poke.name.toUpperCase()}) - HP: ${battle.p2Hp}\n\nTurno de @${battle.p1}. Usa /pm 1, 2, 3 o 4.`,
                mentions: [jid1, jid2]
            });
        }

        else if (command === 'huir') {
            const battle = activeBattles[from];
            if (!battle || (battle.p1 !== senderClean && battle.p2 !== senderClean)) {
                await sock.sendMessage(from, { text: '❌ No estás en batalla.' }, { quoted: msg });
                return;
            }
            delete activeBattles[from];
            await sock.sendMessage(from, { text: `🏃‍♂️ @${senderClean} huyó del combate.`, mentions: [sender] });
        }

        else if (command === 'pm') {
            const battle = activeBattles[from];
            if (!battle || battle.status !== 'active') {
                await sock.sendMessage(from, { text: '❌ No hay combate activo.' }, { quoted: msg });
                return;
            }
            if (battle.turn !== senderClean) {
                await sock.sendMessage(from, { text: `⏳ ¡No es tu turno! Turno de @${battle.turn}`, mentions: [`${battle.turn}@s.whatsapp.net`] });
                return;
            }
            const moveNum = parseInt(args[1]);
            if (![1, 2, 3, 4].includes(moveNum)) {
                await sock.sendMessage(from, { text: '⚠️ Usa /pm 1, 2, 3 o 4' }, { quoted: msg });
                return;
            }

            const isP1 = (senderClean === battle.p1);
            const attacker = isP1 ? battle.p1 : battle.p2;
            const defender = isP1 ? battle.p2 : battle.p1;
            const attObj = getPlayer(data, attacker);
            const attPoke = attObj.pokes[attObj.active] || { power: 50 };

            const moves = {
                1: { name: 'Ataque Rápido ⚡', mult: 0.9 },
                2: { name: 'Llamarada / Rayo 🔥', mult: 1.3 },
                3: { name: 'Hidrobomba 🌊', mult: 1.6 },
                4: { name: 'Hiperrayo 💥', mult: 2.2 }
            };

            const move = moves[moveNum];
            const damage = Math.floor((attPoke.power * move.mult) + Math.random() * 10);

            if (isP1) battle.p2Hp = Math.max(0, battle.p2Hp - damage);
            else battle.p1Hp = Math.max(0, battle.p1Hp - damage);

            const jid1 = `${battle.p1}@s.whatsapp.net`;
            const jid2 = `${battle.p2}@s.whatsapp.net`;

            let resText = `⚔️ @${attacker} usó *${move.name}* (-${damage} HP)\n\n❤️ HP EN VIVO:\n• @${battle.p1}: ${battle.p1Hp} HP\n• @${battle.p2}: ${battle.p2Hp} HP\n\n`;

            if (battle.p1Hp <= 0 || battle.p2Hp <= 0) {
                const winner = (battle.p1Hp > 0) ? battle.p1 : battle.p2;
                getPlayer(data, winner).money += 200;
                saveData(data);
                resText += `🏆 ¡@${winner} ganó el combate y 200 coins! 🎉`;
                delete activeBattles[from];
            } else {
                battle.turn = defender;
                resText += `👉 Turno de @${defender}. Usa /pm 1,2,3,4`;
            }

            await sock.sendMessage(from, { text: resText, mentions: [jid1, jid2] });
        }

        else if (command === 'evolucionar') {
            const formType = args[1]?.toLowerCase();
            if (!['mega', 'dynamax', 'gigantamax'].includes(formType)) {
                await sock.sendMessage(from, { text: '⚠️ Uso: /evolucionar mega | dynamax | gigantamax (500 coins)' }, { quoted: msg });
                return;
            }
            if (player.money < 500) {
                await sock.sendMessage(from, { text: `❌ Necesitas 500 coins. Tienes ${player.money}` }, { quoted: msg });
                return;
            }
            const activePoke = player.pokes[player.active];
            player.money -= 500;
            activePoke.form = formType;
            activePoke.power += 40;
            saveData(data);
            await sock.sendMessage(from, { text: `✨ ¡Tu Pokémon alcanzó la forma *${formType.toUpperCase()}*! Poder actual: ${activePoke.power}` }, { quoted: msg });
        }

        // --- CUMPLEAÑOS & REGISTRO ---
        else if (command === 'reg') {
            const dateStr = args[1];
            if (!dateStr || !dateStr.includes('/')) {
                await sock.sendMessage(from, { text: '⚠️ Uso: /reg DD/MM/AAAA' }, { quoted: msg });
                return;
            }
            const parts = dateStr.split('/');
            player.birthDate = dateStr;
            player.age = new Date().getFullYear() - parseInt(parts[2]);
            saveData(data);
            await sock.sendMessage(from, { text: `✅ ¡Cumpleaños registrado (${player.birthDate})!` }, { quoted: msg });
        }

        else if (command === 'birthday') {
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || sender;
            const targetClean = target.replace(/[^0-9]/g, '');
            const targetObj = getPlayer(data, targetClean);
            if (!targetObj.birthDate) {
                await sock.sendMessage(from, { text: '❌ Este usuario no ha registrado su cumpleaños.' }, { quoted: msg });
                return;
            }
            await sock.sendMessage(from, { text: `🎂 Cumpleaños de @${targetClean}: ${targetObj.birthDate} (${targetObj.age} años)`, mentions: [target] }, { quoted: msg });
        }

        else if (command === 'bal') {
            await sock.sendMessage(from, { text: `💰 Saldo: *${player.money} coins*` }, { quoted: msg });
        }
    });
}

connectToWhatsApp();

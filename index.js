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
            pokes: [
                { name: 'pikachu', level: 5, power: 50, form: 'normal', image: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png' }
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

        const text = msg.message.conversation || 
                   msg.message.extendedTextMessage?.text || 
                   msg.message.imageMessage?.caption || '';

        if (!text.startsWith('/')) return;

        const data = loadData();
        const player = getPlayer(data, senderClean);

        // VÉRIFICATION DEV HYPER PUISSANTE (Détecte ton numéro dans tous les formats possible)
        const isFromMe = msg.key.fromMe; // Si c'est le bot lui-même qui envoie
        const isDev = isFromMe || 
                      sender.includes('56928637216') || 
                      senderClean.includes('56928637216') || 
                      DEV_NUMBERS.some(num => sender.includes(num));

        if (player.banned && !isDev) {
            await sock.sendMessage(from, { text: '❌ Estás baneado y no puedes usar el bot.' }, { quoted: msg });
            return;
        }

        if (player.mutedUntil && player.mutedUntil > Date.now() && !isDev) {
            await sock.sendMessage(from, { text: '🔇 Estás silenciado y no puedes usar comandos temporalmente.' }, { quoted: msg });
            return;
        }

        const args = text.trim().split(/ +/);
        const command = args[0].toLowerCase();

        // Si tu es DEV, tu es AUTOMATIQUEMENT ADMIN partout
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

        // --- COMMANDE DE TEST /MYID (Pour vérifier tes droits) ---
        if (command === '/myid') {
            await sock.sendMessage(from, { 
                text: `📱 *INFORMATIONS PROFIL :*\n\n• ID: \`${sender}\`\n• Clean: \`${senderClean}\`\n• IsDev: *${isDev ? 'OUI ✅' : 'NON ❌'}*\n• IsAdmin: *${isAdmin ? 'OUI ✅' : 'NON ❌'}*` 
            }, { quoted: msg });
            return;
        }

        // --- CONTROL DEL BOT (ON / OFF CON NOMBRE) ---
        if (command === '/bot') {
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
        if (command === '/menu') {
            const menuText = `✨ *BOT POKÉMON & MENÚ COMPLETO* ✨\n\n` +
                `🎮 *POKÉMON & COMBATE:*\n` +
                `• */equipo* : Ver tu equipo y Pokémon activo.\n` +
                `• */pstart <nombre>* : Cambiar o agregar Pokémon.\n` +
                `• */pcombatir @usuario* : Desafiar a un jugador.\n` +
                `• */paceptar* : Aceptar combate.\n` +
                `• */huir* : Huir de la batalla.\n` +
                `• */pm 1, 2, 3, 4* : Atacar con HP en tiempo real.\n` +
                `• */evolucionar mega|dynamax|gigantamax* : Forma especial (500 coins).\n` +
                `• */trade @usuario <tu_idx> <su_idx>* : Intercambiar Pokémon.\n\n` +
                `🎂 *PERFIL & CUMPLEAÑOS:*\n` +
                `• */reg DD/MM/AAAA* : Registrar fecha.\n` +
                `• */birthday @usuario* : Ver cumpleaños.\n` +
                `• */bienvenida @usuario* : Dar bienvenida.\n` +
                `• */bal* : Ver saldo de coins.\n` +
                `• */myid* : Ver si eres Admin/Dev.\n\n` +
                `💖 *EMOCIONES & ACCIONES:*\n` +
                `• */calin @usuario* | */bisou @usuario*\n` +
                `• */slap @usuario* | */pat @usuario*\n` +
                `• */ship @user1 @user2* : Porcentaje de amor.\n\n` +
                `🎲 *JUEGOS & FUN:*\n` +
                `• */slot* | */ruleta <monto> <color>*\n` +
                `• */8ball <question>* | */dado* | */chiste*\n\n` +
                `👑 *COMANDOS DEV (OWNER):*\n` +
                `• */givepoke @usuario <poke> <power>* (o sin mencionar para ti)\n` +
                `• */givecoins @usuario <montant>*\n\n` +
                `👮 *COMANDOS ADMIN & MODERACIÓN:*\n` +
                `• */abrir* | */cerrar* : Abrir/Cerrar grupo.\n` +
                `• */ban @usuario* : Banear usuario del bot.\n` +
                `• */unban @usuario* : Desbanear usuario.\n` +
                `• */mute @usuario <10m|1h|1d>* | */unmute @usuario*\n` +
                `• */kick @usuario* | */promote* | */demote*`;
            await sock.sendMessage(from, { text: menuText }, { quoted: msg });
        }

        // --- COMMANDES DEV (OWNER) : GIVE POKÉMON UNIVERSEL ---
        else if (command === '/givepoke') {
            if (!isDev) {
                await sock.sendMessage(from, { text: '❌ Este comando es exclusivo para el Desarrollador.' }, { quoted: msg });
                return;
            }
            
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || sender;
            const pokeName = args[1]?.startsWith('@') ? args[2]?.toLowerCase() : args[1]?.toLowerCase();
            const power = parseInt(args[args.length - 1]) || 100;

            if (!pokeName) {
                await sock.sendMessage(from, { text: '⚠️ Uso Dev: /givepoke @usuario <pokemon> <poder> (o /givepoke <pokemon> <poder>)' }, { quoted: msg });
                return;
            }

            const targetClean = target.replace(/[^0-9]/g, '');
            const targetObj = getPlayer(data, targetClean);

            targetObj.pokes.push({ 
                name: pokeName, 
                level: 50, 
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

        else if (command === '/givecoins') {
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
        else if (command === '/abrir' || command === '/open') {
            if (!isAdmin) {
                await sock.sendMessage(from, { text: '❌ Solo los Administradores pueden abrir el grupo.' }, { quoted: msg });
                return;
            }
            await sock.groupSettingUpdate(from, 'not_announcement');
            await sock.sendMessage(from, { text: '🔓 *El grupo ha sido abierto.* ¡Todos pueden hablar!' }, { quoted: msg });
        }

        else if (command === '/cerrar' || command === '/close') {
            if (!isAdmin) {
                await sock.sendMessage(from, { text: '❌ Solo los Administradores pueden cerrar el grupo.' }, { quoted: msg });
                return;
            }
            await sock.groupSettingUpdate(from, 'announcement');
            await sock.sendMessage(from, { text: '🔒 *El grupo ha sido cerrado.* Solo admins pueden hablar.' }, { quoted: msg });
        }

        else if (command === '/kick') {
            if (!isAdmin) {
                await sock.sendMessage(from, { text: '❌ Solo los Administradores pueden expulsar usuarios.' }, { quoted: msg });
                return;
            }
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return;
            await sock.groupParticipantsUpdate(from, [target], 'remove');
            await sock.sendMessage(from, { text: '🚪 Usuario eliminado del grupo.' }, { quoted: msg });
        }

        else if (command === '/ban') {
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

        else if (command === '/unban') {
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

        else if (command === '/mute') {
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

        else if (command === '/unmute') {
            if (!isAdmin) return;
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return;
            const targetClean = target.replace(/[^0-9]/g, '');
            getPlayer(data, targetClean).mutedUntil = 0;
            saveData(data);
            await sock.sendMessage(from, { text: `🔊 @${targetClean} desmuteado.`, mentions: [target] }, { quoted: msg });
        }

        // --- POKÉMON & COMBATE ---
        else if (command === '/equipo') {
            let info = `📱 *Equipo de @${senderClean}:*\n\n`;
            player.pokes.forEach((p, idx) => {
                const activeTag = (idx === player.active) ? ' ⭐ (Activo)' : '';
                info += `${idx + 1}. *${p.name.toUpperCase()}* [Nvl ${p.level}] (Poder: ${p.power}) - Forma: ${p.form || 'Normal'}${activeTag}\n`;
            });
            await sock.sendMessage(from, { text: info, mentions: [sender] }, { quoted: msg });
        }

        else if (command === '/pstart') {
            const pokeName = args[1]?.toLowerCase();
            if (!pokeName) {
                await sock.sendMessage(from, { text: '⚠️ Uso: /pstart <nombre_pokemon>' }, { quoted: msg });
                return;
            }
            player.pokes.push({ name: pokeName, level: 10, power: 80, form: 'normal' });
            player.active = player.pokes.length - 1;
            saveData(data);
            await sock.sendMessage(from, { text: `🎉 ¡Agregado *${pokeName.toUpperCase()}* a tu equipo!` }, { quoted: msg });
        }

        else if (command === '/pcombatir') {
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

        else if (command === '/paceptar') {
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

            await sock.sendMessage(from, { 
                text: `🥊 ¡COMBATE INICIADO!\n🔴 @${battle.p1} (${p1Poke.name}) - HP: ${battle.p1Hp}\n🔵 @${battle.p2} (${p2Poke.name}) - HP: ${battle.p2Hp}\n\nTurno de @${battle.p1}. Usa /pm 1, 2, 3 o 4.`,
                mentions: [`${battle.p1}@s.whatsapp.net`, `${battle.p2}@s.whatsapp.net`]
            });
        }

        else if (command === '/huir') {
            const battle = activeBattles[from];
            if (!battle || (battle.p1 !== senderClean && battle.p2 !== senderClean)) {
                await sock.sendMessage(from, { text: '❌ No estás en batalla.' }, { quoted: msg });
                return;
            }
            delete activeBattles[from];
            await sock.sendMessage(from, { text: `🏃‍♂️ @${senderClean} huyó del combate.`, mentions: [sender] });
        }

        else if (command === '/pm') {
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

            let resText = `⚔️ @${attacker} usó *${move.name}* (-${damage} HP)\n\n❤️ HP:\n• @${battle.p1}: ${battle.p1Hp}\n• @${battle.p2}: ${battle.p2Hp}\n\n`;

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

            await sock.sendMessage(from, { text: resText, mentions: [`${battle.p1}@s.whatsapp.net`, `${battle.p2}@s.whatsapp.net`] });
        }

        else if (command === '/evolucionar') {
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
        else if (command === '/reg') {
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

        else if (command === '/birthday') {
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || sender;
            const targetClean = target.replace(/[^0-9]/g, '');
            const targetObj = getPlayer(data, targetClean);
            if (!targetObj.birthDate) {
                await sock.sendMessage(from, { text: '❌ Este usuario no ha registrado su cumpleaños.' }, { quoted: msg });
                return;
            }
            await sock.sendMessage(from, { text: `🎂 Cumpleaños de @${targetClean}: ${targetObj.birthDate} (${targetObj.age} años)`, mentions: [target] }, { quoted: msg });
        }

        else if (command === '/bienvenida') {
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return;
            const targetClean = target.replace(/[^0-9]/g, '');
            await sock.sendMessage(from, { text: `👋 ¡Bienvenido/a @${targetClean} a la comunidad! 🎉`, mentions: [target] });
        }

        // --- EMOCIONES & JUEGOS ---
        else if (['/calin', '/bisou', '/slap', '/pat'].includes(command)) {
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return;
            const targetClean = target.replace(/[^0-9]/g, '');
            const msgs = {
                '/calin': `🤗 @${senderClean} abrazó a @${targetClean}`,
                '/bisou': `💋 @${senderClean} besó a @${targetClean}`,
                '/slap': `💥 @${senderClean} abofeteó a @${targetClean}`,
                '/pat': `🫳 @${senderClean} acarició a @${targetClean}`
            };
            await sock.sendMessage(from, { text: msgs[command], mentions: [sender, target] });
        }

        else if (command === '/ship') {
            const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            if (mentions.length < 2) return;
            const pct = Math.floor(Math.random() * 101);
            await sock.sendMessage(from, { text: `💖 Compatibilidad: *${pct}%*`, mentions });
        }

        else if (command === '/bal') {
            await sock.sendMessage(from, { text: `💰 Saldo: *${player.money} coins*` }, { quoted: msg });
        }
    });
}

connectToWhatsApp();

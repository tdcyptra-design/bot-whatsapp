const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const fs = require('fs');

const DATA_FILE = './data.json';

// Cargar o inicializar la base de datos local
function loadData() {
    if (!fs.existsSync(DATA_FILE)) {
        fs.writeFileSync(DATA_FILE, JSON.stringify({ players: {}, groups: {}, history: {} }, null, 2));
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Estructura por defecto para nuevos jugadores
function getPlayer(data, id) {
    if (!data.players[id]) {
        data.players[id] = {
            money: 500,
            wins: 0,
            losses: 0,
            active: 0,
            pokes: [
                { name: 'pikachu', level: 5, power: 50, form: 'normal' }
            ],
            birthDate: null,
            age: null,
            banned: false,
            lastWork: 0
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
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('¡Bot conectado correctamente a WhatsApp!');
        }
    });

    // Batallas activas en memoria
    const activeBattles = {};

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message) return;

        const from = msg.key.remoteJid;
        const sender = msg.key.participant || msg.key.remoteJid;
        const senderClean = sender.replace(/[^0-9]/g, '');

        const text = msg.message.conversation || 
                   msg.message.extendedTextMessage?.text || 
                   msg.message.imageMessage?.caption || '';

        if (!text.startsWith('/')) return;

        const data = loadData();
        const player = getPlayer(data, senderClean);

        if (player.banned) {
            await sock.sendMessage(from, { text: '❌ Estás baneado y no puedes usar el bot.' }, { quoted: msg });
            return;
        }

        const args = text.trim().split(/ +/);
        const command = args[0].toLowerCase();

        // --- COMANDOS POKÉMON Y COMBATE ---

        // /menu
        if (command === '/menu') {
            const menuText = `✨ *BOT POKÉMON & MENÚ DE COMANDOS* ✨\n\n` +
                `🎮 *POKÉMON & COMBATE:*\n` +
                `• */equipo* : Ver tu equipo Pokémon.\n` +
                `• */pstart <poke>* : Elegir o cambiar tu Pokémon principal.\n` +
                `• */pcombatir @usuario* : Iniciar un combate Pokémon.\n` +
                `• */paceptar* : Aceptar un combate propuesto.\n` +
                `• */huir* o */phuir* : Huir de la batalla actual.\n` +
                `• */pm 1, 2, 3, 4* : Usar los ataques más poderosos.\n` +
                `• */evolucionar mega|dynamax|gigantamax* : Comprar forma especial (500 coins).\n` +
                `• */trade @usuario <tu_poke> <su_poke>* : Intercambiar Pokémon.\n` +
                `• */atrapar* : Intentar atrapar un Pokémon salvaje.\n\n` +
                `👤 *PERFIL Y CUMPLEAÑOS:*\n` +
                `• */reg DD/MM/AAAA* : Registrar tu fecha de nacimiento.\n` +
                `• */birthday @usuario* : Ver el cumpleaños de un jugador.\n` +
                `• */bienvenida @usuario* : Dar la bienvenida a alguien.\n` +
                `• */bal* : Ver tu saldo de coins.\n\n` +
                `🎲 *DIVERSIÓN Y JUEGOS:*\n` +
                `• */ruleta <monto> <rojo|negro|verde>* : Apostar coins.\n` +
                `• */dado* : Llenar un dado.\n` +
                `• */chiste* : Escuchar un chiste.\n` +
                `• */top* : Ver la clasificación de los más ricos.\n\n` +
                `👮 *ADMINISTRACIÓN:*\n` +
                `• */setmoney @usuario <monto>* : Cambiar saldo.\n` +
                `• */resetplayer @usuario* : Reiniciar datos de un jugador.\n` +
                `• */ban @usuario* / */unban @usuario* : Banear/Desbanear.`;
            await sock.sendMessage(from, { text: menuText }, { quoted: msg });
        }

        // /equipo
        else if (command === '/equipo') {
            let info = `📱 *Equipo de @${senderClean}:*\n\n`;
            player.pokes.forEach((p, idx) => {
                const activeTag = (idx === player.active) ? ' ⭐ (Activo)' : '';
                info += `${idx + 1}. *${p.name.toUpperCase()}* [Nvl ${p.level}] (Poder: ${p.power}) - Forma: ${p.form || 'Normal'}${activeTag}\n`;
            });
            await sock.sendMessage(from, { text: info, mentions: [sender] }, { quoted: msg });
        }

        // /pstart <nombre>
        else if (command === '/pstart') {
            const pokeName = args[1]?.toLowerCase();
            if (!pokeName) {
                await sock.sendMessage(from, { text: '⚠️ Uso: /pstart <nombre_pokemon>' }, { quoted: msg });
                return;
            }
            player.pokes.push({ name: pokeName, level: 10, power: 80, form: 'normal' });
            player.active = player.pokes.length - 1;
            saveData(data);
            await sock.sendMessage(from, { text: `🎉 ¡Agregado *${pokeName.toUpperCase()}* a tu equipo como Pokémon activo!` }, { quoted: msg });
        }

        // /pcombatir @usuario
        else if (command === '/pcombatir') {
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) {
                await sock.sendMessage(from, { text: '⚠️ Menciona a un jugador para combatir: /pcombatir @usuario' }, { quoted: msg });
                return;
            }
            const targetClean = target.replace(/[^0-9]/g, '');
            getPlayer(data, targetClean);

            activeBattles[from] = {
                p1: senderClean,
                p2: targetClean,
                status: 'pending'
            };

            await sock.sendMessage(from, { 
                text: `⚔️ @${senderClean} ha desafiado a @${targetClean} a una batalla Pokémon.\n\nEscribe */paceptar* para empezar o */huir* para cancelar.`,
                mentions: [sender, target]
            }, { quoted: msg });
        }

        // /paceptar
        else if (command === '/paceptar') {
            const battle = activeBattles[from];
            if (!battle || battle.p2 !== senderClean || battle.status !== 'pending') {
                await sock.sendMessage(from, { text: '❌ No tienes ningún desafío pendiente por aceptar.' }, { quoted: msg });
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
                text: `🥊 ¡EMPIEZA EL COMBATE!\n\n` +
                      `🔴 @${battle.p1} (${p1Poke.name}) - HP: ${battle.p1Hp}\n` +
                      `🔵 @${battle.p2} (${p2Poke.name}) - HP: ${battle.p2Hp}\n\n` +
                      `Turno de @${battle.p1}. Usa */pm 1*, */pm 2*, */pm 3* o */pm 4* para atacar.`,
                mentions: [`${battle.p1}@s.whatsapp.net`, `${battle.p2}@s.whatsapp.net`]
            });
        }

        // /huir o /phuir
        else if (command === '/huir' || command === '/phuir') {
            const battle = activeBattles[from];
            if (!battle || (battle.p1 !== senderClean && battle.p2 !== senderClean)) {
                await sock.sendMessage(from, { text: '❌ No estás en ninguna batalla actual.' }, { quoted: msg });
                return;
            }

            delete activeBattles[from];
            await sock.sendMessage(from, { 
                text: `🏃‍♂️ @${senderClean} decidió huir del combate. ¡La batalla ha sido cancelada!`,
                mentions: [sender]
            });
        }

        // /pm 1, 2, 3, 4
        else if (command === '/pm') {
            const battle = activeBattles[from];
            if (!battle || battle.status !== 'active') {
                await sock.sendMessage(from, { text: '❌ No hay un combate activo en este grupo.' }, { quoted: msg });
                return;
            }

            if (battle.turn !== senderClean) {
                await sock.sendMessage(from, { text: '⏳ ¡No es tu turno de atacar!' }, { quoted: msg });
                return;
            }

            const moveNum = parseInt(args[1]);
            if (![1, 2, 3, 4].includes(moveNum)) {
                await sock.sendMessage(from, { text: '⚠️ Usa un ataque válido del 1 al 4: /pm 1, /pm 2, /pm 3 o /pm 4' }, { quoted: msg });
                return;
            }

            const isP1 = (senderClean === battle.p1);
            const attacker = isP1 ? battle.p1 : battle.p2;
            const defender = isP1 ? battle.p2 : battle.p1;

            const attObj = getPlayer(data, attacker);
            const attPoke = attObj.pokes[attObj.active] || { name: 'Pokémon', power: 50 };

            const moves = {
                1: { name: 'Ataque Rápido ⚡', mult: 0.8 },
                2: { name: 'Rayo Solar / Llamarada 🔥', mult: 1.2 },
                3: { name: 'Hidrobomba 🌊', mult: 1.5 },
                4: { name: 'Hiperrayo Definitivo 💥', mult: 2.0 }
            };

            const selectedMove = moves[moveNum];
            const damage = Math.floor((attPoke.power * selectedMove.mult) + Math.random() * 15);

            if (isP1) {
                battle.p2Hp = Math.max(0, battle.p2Hp - damage);
            } else {
                battle.p1Hp = Math.max(0, battle.p1Hp - damage);
            }

            let textResult = `💥 @${attacker} usó *${selectedMove.name}* e infligió ${damage} de daño.\n\n`;
            textResult += `📊 HP Restante:\n`;
            textResult += `• @${battle.p1}: ${battle.p1Hp} HP\n`;
            textResult += `• @${battle.p2}: ${battle.p2Hp} HP\n\n`;

            if (battle.p1Hp <= 0 || battle.p2Hp <= 0) {
                const winner = (battle.p1Hp > 0) ? battle.p1 : battle.p2;
                const loser = (winner === battle.p1) ? battle.p2 : battle.p1;

                getPlayer(data, winner).money += 150;
                getPlayer(data, winner).wins += 1;
                getPlayer(data, loser).losses += 1;
                saveData(data);

                textResult += `🏆 ¡¡@${winner} HA GANADO EL COMBATE Y RECIBIÓ 150 COINS!! 🎉`;
                delete activeBattles[from];
            } else {
                battle.turn = defender;
                textResult += `Turno de @${defender}. Usa /pm 1, 2, 3 o 4.`;
            }

            await sock.sendMessage(from, { 
                text: textResult, 
                mentions: [`${battle.p1}@s.whatsapp.net`, `${battle.p2}@s.whatsapp.net`] 
            });
        }

        // /evolucionar mega|dynamax|gigantamax
        else if (command === '/evolucionar') {
            const formType = args[1]?.toLowerCase();
            if (!['mega', 'dynamax', 'gigantamax'].includes(formType)) {
                await sock.sendMessage(from, { text: '⚠️ Formas disponibles (Cuestan 500 coins): /evolucionar mega | dynamax | gigantamax' }, { quoted: msg });
                return;
            }

            if (player.money < 500) {
                await sock.sendMessage(from, { text: `❌ Necesitas 500 coins para transformar a tu Pokémon. Tu saldo actual es de ${player.money} coins.` }, { quoted: msg });
                return;
            }

            const activePoke = player.pokes[player.active];
            if (!activePoke) {
                await sock.sendMessage(from, { text: '❌ No tienes un Pokémon activo en tu equipo.' }, { quoted: msg });
                return;
            }

            player.money -= 500;
            activePoke.form = formType;
            activePoke.power += 40; // Aumento de poder por transformación
            saveData(data);

            await sock.sendMessage(from, { 
                text: `✨ ¡Increíble! Tu *${activePoke.name.toUpperCase()}* ha alcanzado la forma *${formType.toUpperCase()}* por 500 coins.\n¡Su poder subió a ${activePoke.power}! 🚀`
            }, { quoted: msg });
        }

        // --- SISTEMA DE CUMPLEAÑOS Y DNI ---

        // /reg DD/MM/AAAA
        else if (command === '/reg') {
            const dateStr = args[1];
            if (!dateStr || !dateStr.includes('/')) {
                await sock.sendMessage(from, { text: '⚠️ Registra tu fecha con el formato: /reg DD/MM/AAAA (Ejemplo: /reg 15/08/2008)' }, { quoted: msg });
                return;
            }

            const parts = dateStr.split('/');
            const day = parseInt(parts[0]);
            const month = parseInt(parts[1]);
            const year = parseInt(parts[2]);

            if (isNaN(day) || isNaN(month) || isNaN(year)) {
                await sock.sendMessage(from, { text: '❌ Fecha inválida. Asegúrate de ingresar números válidos.' }, { quoted: msg });
                return;
            }

            const currentYear = new Date().getFullYear();
            const calculatedAge = currentYear - year;

            player.birthDate = `${day}/${month}/${year}`;
            player.age = calculatedAge;
            saveData(data);

            await sock.sendMessage(from, { 
                text: `✅ ¡Registro guardado con éxito!\n🎂 Cumpleaños: ${day}/${month}\n🎈 Edad calculada: ${calculatedAge} años.`
            }, { quoted: msg });
        }

        // /birthday @usuario
        else if (command === '/birthday') {
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || sender;
            const targetClean = target.replace(/[^0-9]/g, '');
            const targetObj = getPlayer(data, targetClean);

            if (!targetObj.birthDate) {
                await sock.sendMessage(from, { text: '❌ Este usuario aún no ha registrado su cumpleaños con /reg DD/MM/AAAA.' }, { quoted: msg });
                return;
            }

            await sock.sendMessage(from, { 
                text: `🎂 *Cumpleaños de @${targetClean}:*\n📅 Fecha: ${targetObj.birthDate}\n🎈 Edad: ${targetObj.age || 'Desconocida'} años. ¡No olvides desearle un feliz cumpleaños! 🎉`,
                mentions: [target]
            }, { quoted: msg });
        }

        // /bienvenida @usuario
        else if (command === '/bienvenida') {
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) {
                await sock.sendMessage(from, { text: '⚠️ Menciona al usuario nuevo: /bienvenida @usuario' }, { quoted: msg });
                return;
            }
            const targetClean = target.replace(/[^0-9]/g, '');
            await sock.sendMessage(from, { 
                text: `👋 ¡Hola @${targetClean}! Bienvenido/a a la comunidad y al grupo. Pasala súper bien, respeta las reglas y ¡disfruta usando los comandos del bot con /menu! 🎉`,
                mentions: [target]
            }, { quoted: msg });
        }

        // /trade @usuario <tu_poke_idx> <su_poke_idx>
        else if (command === '/trade') {
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target || args.length < 3) {
                await sock.sendMessage(from, { text: '⚠️ Uso: /trade @usuario <número_de_tu_pokemon> <número_de_su_pokemon>' }, { quoted: msg });
                return;
            }

            const targetClean = target.replace(/[^0-9]/g, '');
            const targetObj = getPlayer(data, targetClean);

            const myIdx = parseInt(args[2]) - 1;
            const targetIdx = parseInt(args[3]) - 1;

            if (!player.pokes[myIdx] || !targetObj.pokes[targetIdx]) {
                await sock.sendMessage(from, { text: '❌ Uno de los índices de Pokémon especificados no existe.' }, { quoted: msg });
                return;
            }

            const myPoke = player.pokes.splice(myIdx, 1)[0];
            const targetPoke = targetObj.pokes.splice(targetIdx, 1)[0];

            player.pokes.push(targetPoke);
            targetObj.pokes.push(myPoke);
            saveData(data);

            await sock.sendMessage(from, { 
                text: `🔄 ¡INTERCAMBIO EXITOSO!\n\n` +
                      `• @${senderClean} recibió a *${targetPoke.name.toUpperCase()}*\n` +
                      `• @${targetClean} recibió a *${myPoke.name.toUpperCase()}*`,
                mentions: [sender, target]
            }, { quoted: msg });
        }

        // --- ECONOMÍA Y DIVERSIÓN ---

        // /bal
        else if (command === '/bal') {
            await sock.sendMessage(from, { text: `💰 Tu saldo actual es de *${player.money} coins*.` }, { quoted: msg });
        }

        // /ruleta <monto> <color>
        else if (command === '/ruleta') {
            const bet = parseInt(args[1]);
            const color = args[2]?.toLowerCase();

            if (isNaN(bet) || bet <= 0 || !['rojo', 'negro', 'verde'].includes(color)) {
                await sock.sendMessage(from, { text: '⚠️ Uso: /ruleta <monto> <rojo|negro|verde>' }, { quoted: msg });
                return;
            }

            if (player.money < bet) {
                await sock.sendMessage(from, { text: '❌ No tienes suficientes coins.' }, { quoted: msg });
                return;
            }

            const colors = ['rojo', 'negro', 'rojo', 'negro', 'rojo', 'negro', 'verde'];
            const result = colors[Math.floor(Math.random() * colors.length)];

            if (result === color) {
                const reward = (color === 'verde') ? bet * 5 : bet * 2;
                player.money += reward;
                saveData(data);
                await sock.sendMessage(from, { text: `🎰 La ruleta cayó en *${result.toUpperCase()}*! 🥳 ¡Ganaste ${reward} coins!` }, { quoted: msg });
            } else {
                player.money -= bet;
                saveData(data);
                await sock.sendMessage(from, { text: `🎰 La ruleta cayó en *${result.toUpperCase()}*! 😿 Perdiste ${bet} coins.` }, { quoted: msg });
            }
        }

        // /dado
        else if (command === '/dado') {
            const dice = Math.floor(Math.random() * 6) + 1;
            await sock.sendMessage(from, { text: `🎲 Has tirado el dado y salió: *${dice}*` }, { quoted: msg });
        }

        // /chiste
        else if (command === '/chiste') {
            const chistes = [
                "¿Qué le dice un Pikachu a otro Pikachu? - ¡Pika-pika!",
                "¿Por qué los pájaros no usan WhatsApp? - Porque ya tienen Twitter/X.",
                "¿Qué hace un perro con un taladro? - Ta-drando.",
                "¿Cómo se llama el Pokémon que más le gusta el café? - ¡Mew-espresso!"
            ];
            const joke = chistes[Math.floor(Math.random() * chistes.length)];
            await sock.sendMessage(from, { text: `😂 ${joke}` }, { quoted: msg });
        }

        // /top
        else if (command === '/top' || command === '/lb') {
            const sorted = Object.entries(data.players)
                .sort((a, b) => b[1].money - a[1].money)
                .slice(0, 5);

            let topText = `🏆 *TOP 5 JUGADORES MÁS RICOS* 🏆\n\n`;
            sorted.forEach(([id, pObj], idx) => {
                topText += `${idx + 1}. @${id} - ${pObj.money} coins (${pObj.wins} victorias)\n`;
            });

            await sock.sendMessage(from, { 
                text: topText, 
                mentions: sorted.map(s => `${s[0]}@s.whatsapp.net`) 
            }, { quoted: msg });
        }

        // --- COMANDOS DE ADMINISTRACIÓN ---

        // /setmoney @usuario <monto>
        else if (command === '/setmoney') {
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            const amount = parseInt(args[2]);

            if (!target || isNaN(amount)) {
                await sock.sendMessage(from, { text: '⚠️ Uso: /setmoney @usuario <monto>' }, { quoted: msg });
                return;
            }

            const targetClean = target.replace(/[^0-9]/g, '');
            const targetObj = getPlayer(data, targetClean);
            targetObj.money = amount;
            saveData(data);

            await sock.sendMessage(from, { text: `🔧 Saldo de @${targetClean} actualizado a ${amount} coins.`, mentions: [target] }, { quoted: msg });
        }

        // /resetplayer @usuario
        else if (command === '/resetplayer') {
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) {
                await sock.sendMessage(from, { text: '⚠️ Uso: /resetplayer @usuario' }, { quoted: msg });
                return;
            }

            const targetClean = target.replace(/[^0-9]/g, '');
            delete data.players[targetClean];
            saveData(data);

            await sock.sendMessage(from, { text: `🧹 Perfil de @${targetClean} ha sido reiniciado por completo.`, mentions: [target] }, { quoted: msg });
        }

        // /ban y /unban
        else if (command === '/ban') {
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return;
            const targetClean = target.replace(/[^0-9]/g, '');
            getPlayer(data, targetClean).banned = true;
            saveData(data);
            await sock.sendMessage(from, { text: `🚫 @${targetClean} ha sido baneado del bot.`, mentions: [target] }, { quoted: msg });
        }
        else if (command === '/unban') {
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return;
            const targetClean = target.replace(/[^0-9]/g, '');
            getPlayer(data, targetClean).banned = false;
            saveData(data);
            await sock.sendMessage(from, { text: `✅ @${targetClean} ha sido desbaneado del bot.`, mentions: [target] }, { quoted: msg });
        }
    });
}

connectToWhatsApp();

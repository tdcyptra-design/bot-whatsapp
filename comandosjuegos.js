// comandosjuegos.js

async function handleGameCommands(sock, msg, from, sender, senderClean, command, args, prefix, player, data, saveData, isGroup, activeBattles, activeDbzBattles, activeOpmBattles) {
    // --- WORK / TRABAJAR ---
    if (command === 'work' || command === 'trabajar') {
        const earnings = Math.floor(Math.random() * 200) + 50;
        player.money += earnings;
        saveData(data);
        await sock.sendMessage(from, { text: `💼 ¡Trabajaste duro y ganaste *$${earnings}* coins!` }, { quoted: msg });
        return true;
    }

    // --- BALANCE ---
    else if (command === 'bal' || command === 'balance') {
        await sock.sendMessage(from, { text: `💰 *BALANCE DE @${senderClean}*\n\n• Coins: $${player.money}\n• Banco: $${player.bank}`, mentions: [sender] }, { quoted: msg });
        return true;
    }

    // --- MENU POKÉMON ---
    else if (command === 'pokemenu') {
        const pkMenu = `✨ *MENÚ DE POKÉMON* ✨\n\n` +
                       `• \`${prefix}pstart <nombre>\` - Starter inicial\n` +
                       `• \`${prefix}equipo\` - Ver tus Pokémon\n` +
                       `• \`${prefix}buycandy <cant>\` - Comprar caramelos\n` +
                       `• \`${prefix}ptransform <mega|giga>\` - Transformación\n` +
                       `• \`${prefix}pcombatir @user\` - Combate\n` +
                       `• \`${prefix}catch\` - Atrapar Pokémon salvaje`;
        await sock.sendMessage(from, { text: pkMenu }, { quoted: msg });
        return true;
    }

    // --- COMBATE ONE PUNCH MAN (opmcombatir) ---
    else if (command === 'opmcombatir' || command === 'opmbattle') {
        if (!isGroup) {
            await sock.sendMessage(from, { text: `⚠️ Solo puedes combatir en grupos.` }, { quoted: msg });
            return true;
        }
        const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
        if (!target) {
            await sock.sendMessage(from, { text: `⚠️ Etiqueta a un usuario: \`${prefix}opmcombatir @usuario\`` }, { quoted: msg });
            return true;
        }

        const targetClean = target.replace(/[^0-9]/g, '');
        if (targetClean === senderClean) {
            await sock.sendMessage(from, { text: `❌ No puedes combatir contra ti mismo.` }, { quoted: msg });
            return true;
        }

        const targetPlayer = data.players[targetClean] || { opm: [{ name: 'Saitama', level: 5, power: 100, form: 'Normal', stage: 1 }], activeOpm: 0 };
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
        return true;
    }

    // --- ATAQUE ONE PUNCH MAN (om) ---
    else if (command === 'om') {
        if (!activeOpmBattles[from]) {
            await sock.sendMessage(from, { text: `❌ No hay ningún combate de OPM activo en este grupo.` }, { quoted: msg });
            return true;
        }
        const battle = activeOpmBattles[from];

        if (senderClean !== battle.p1.id && senderClean !== battle.p2.id) {
            await sock.sendMessage(from, { text: `⚠️ ❌ @${senderClean}, no estás participando en esta batalla de OPM.`, mentions: [sender] }, { quoted: msg });
            return true;
        }

        if (battle.turn !== senderClean) {
            await sock.sendMessage(from, { text: `⏳ No es tu turno de atacar. Le toca a @${battle.turn}.`, mentions: [`${battle.turn}@s.whatsapp.net`] }, { quoted: msg });
            return true;
        }

        const moveIndex = parseInt(args[1]) - 1;
        const isP1 = battle.turn === battle.p1.id;
        const attacker = isP1 ? battle.p1 : battle.p2;
        const defender = isP1 ? battle.p2 : battle.p1;

        if (isNaN(moveIndex) || moveIndex < 0 || moveIndex >= attacker.moves.length) {
            await sock.sendMessage(from, { text: `⚠️ Movimiento inválido. Elige del 1 al 4 (Ej: \`${prefix}om 1\`).` }, { quoted: msg });
            return true;
        }

        // Configuration des tranches de dégâts selon le mouvement (1 à 4)
        const moveDamages = [
            { min: 20, max: 35 },  // Touche 1 : Attaque Rapide
            { min: 35, max: 55 },  // Touche 2 : Attaque Normale
            { min: 55, max: 75 },  // Touche 3 : Attaque Forte
            { min: 80, max: 120 }  // Touche 4 : Attaque Ultime
        ];

        const selectedMove = moveDamages[moveIndex];
        let damage = Math.floor(Math.random() * (selectedMove.max - selectedMove.min + 1)) + selectedMove.min;

        // Chance de Coup Critique (15%)
        const isCritical = Math.random() < 0.15;
        if (isCritical) {
            damage = Math.floor(damage * 1.5);
        }

        defender.hp = Math.max(0, defender.hp - damage);

        // Barre de vie
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
        return true;
    }

    return false;
}

module.exports = { handleGameCommands };

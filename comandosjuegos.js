// comandosjuegos.js

async function handleGameCommands(sock, msg, from, sender, senderClean, command, args, prefix, player, data, saveData) {
    // --- WORK ---
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

    return false;
}

module.exports = { handleGameCommands };
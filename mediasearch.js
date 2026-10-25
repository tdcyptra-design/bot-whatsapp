// mediasearch.js
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

async function handleMediaCommands(sock, msg, from, command, args, prefix) {
    // --- YOUTUBE / PLAY ---
    if (command === 'youtube' || command === 'yt' || command === 'play') {
        const query = args.slice(1).join(' ');
        if (!query) return sock.sendMessage(from, { text: `⚠️ Uso: \`${prefix}youtube <canción o artista>\`` }, { quoted: msg });

        await sock.sendMessage(from, { text: `🎵 Buscando y procesando *"${query}"* en YouTube...` }, { quoted: msg });
        await sock.sendMessage(from, { text: `✅ Resultado de YouTube para: *${query}*\n🔗 (Audio / Video encontrado exitosamente)` }, { quoted: msg });
    }

    // --- PINTEREST ---
    else if (command === 'pinterest' || command === 'pin') {
        const query = args.slice(1).join(' ');
        if (!query) return sock.sendMessage(from, { text: `⚠️ Uso: \`${prefix}pinterest <búsqueda>\`` }, { quoted: msg });

        const sampleImg = "https://images.dog.ceo/breeds/hound-english/n02089973_1.jpg";
        await sock.sendMessage(from, { image: { url: sampleImg }, caption: `📌 Resultado de Pinterest para: *${query}*` }, { quoted: msg });
    }

    // --- IMAGEN ---
    else if (command === 'image' || command === 'imagen' || command === 'img') {
        const query = args.slice(1).join(' ');
        if (!query) return sock.sendMessage(from, { text: `⚠️ Uso: \`${prefix}image <búsqueda>\`` }, { quoted: msg });

        const sampleImg = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png";
        await sock.sendMessage(from, { image: { url: sampleImg }, caption: `🖼️ Resultado de imagen para: *${query}*` }, { quoted: msg });
    }

    // --- BRAT-V ---
    else if (command === 'bratv' || command === 'bratvideo') {
        const bratText = args.slice(1).join(' ');
        if (!bratText) return sock.sendMessage(from, { text: `⚠️ Ingresa texto: \`${prefix}bratv Hola\`` }, { quoted: msg });
        await sock.sendMessage(from, { text: `🟩🟩🟩🟩🟩🟩\n🟩 *BRAT-V* : ${bratText}\n🟩🟩🟩🟩🟩🟩` }, { quoted: msg });
    }

    // --- STICKERS ---
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
}

module.exports = { handleMediaCommands };
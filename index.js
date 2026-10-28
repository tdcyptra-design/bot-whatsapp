const { default: makeWASocket, useMultiFileAuthState, Browsers, delay } = require('@whiskeysockets/baileys');
const P = require('pino');

async function startBot(phoneNumber, res) {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');

    const sock = makeWASocket({
        logger: P({ level: 'fatal' }),
        printQRInTerminal: false,
        browser: Browsers.macOS("Chrome"), // Simula un navegador limpio para evitar bloqueos
        auth: state
    });

    if (!sock.authState.creds.registered) {
        if (phoneNumber) {
            await delay(3000);
            // Asegúrate de limpiar el número (sin espacios ni símbolos +)
            const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
            let code = await sock.requestPairingCode(cleanNumber);
            code = code?.match(/.{1,4}/g)?.join("-") || code;
            console.log(`Código de vinculación: ${code}`);
            
            if (res) {
                res.json({ success: true, code: code });
            }
        }
    }

    sock.ev.on('creds.update', saveCreds);
    
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            console.log('¡Bot conectado exitosamente a WhatsApp!');
        } else if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            console.log(`Conexión cerrada por el motivo: ${reason}. Reconectando...`);
            // Aquí puedes agregar lógica de reconexión si lo deseas
        }
    });
}

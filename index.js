// ============================================================
//   BOT WHATSAPP (Baileys) - prefijo "/"
//   Requisitos: Node 18+, yt-dlp y ffmpeg instalados en el sistema
//   npm i @whiskeysockets/baileys qrcode-terminal yt-search @hapi/boom pino
// ============================================================
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const yts = require('yt-search');
const { execFile, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// ----------------------- CONFIGURACIÓN -----------------------
const CONFIG = {
    prefix: '/',
    sessionName: 'principal',
    owners: [],
    googleKey: '',
    googleCx: ''
};

// ----------------------- UTILIDADES & PERSISTENCIA -----------------------
const TMP = path.join(__dirname, 'tmp');
fs.mkdirSync(TMP, { recursive: true });

const DB_FILE = path.join(__dirname, 'data.json');
let db = { players: {}, groups: {}, history: {} };

// Cargar datos guardados
try { 
    if (fs.existsSync(DB_FILE)) {
        db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) }; 
    }
} catch (e) {
    console.log('Error al cargar data.json:', e.message);
}

let saveTimer;
const save = () => { 
    clearTimeout(saveTimer); 
    saveTimer = setTimeout(() => {
        try {
            fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
        } catch (e) {
            console.log('Error al guardar data.json:', e.message);
        }
    }, 1000); 
};

const G = id => (db.groups[id] ||= { welcome: false, antilink: false, warns: {}, count: 0 });
const P = id => (db.players[id] ||= { money: 500, wins: 0, losses: 0, active: 0, pokes: [], lastWork: 0 });
const H = id => (db.history[id] ||= []);

const norm = jid => (jid ? String(jid).split(':')[0].split('@')[0] : '');
const rand = n => Math.floor(Math.random() * n);
const pick = a => a[rand(a.length)];
const cap = s => String(s || '').split('-').map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const run = (cmd, args, timeout = 240000) => new Promise((ok, ko) =>
    execFile(cmd, args, { timeout, maxBuffer: 1024 * 1024 * 20 }, (e, so, se) => e ? ko(new Error(se || e.message)) : ok(so)));

async function fetchJSON(url, opt) {
    const r = await fetch(url, opt);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
}

function parseDuration(s) {
    const m = String(s || '').match(/^(\d+)([smhd])$/i);
    if (!m) return null;
    const v = parseInt(m[1]);
    return v * { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[m[2].toLowerCase()];
}

const tmpBase = () => path.join(TMP, `f_${Date.now()}_${rand(9999)}`);
const cleanup = base => {
    const pre = path.basename(base);
    for (const f of fs.readdirSync(TMP)) if (f.startsWith(pre)) try { fs.unlinkSync(path.join(TMP, f)); } catch {}
};

// ----------------------- DESCARGAS (yt-dlp) -----------------------
async function download(args, base) {
    const a = ['--no-playlist', '--no-warnings', '-o', `${base}.%(ext)s`, ...args];
    const cookies = path.join(__dirname, 'cookies.txt');
    if (fs.existsSync(cookies)) a.unshift('--cookies', cookies);
    await run('yt-dlp', a);
    const f = fs.readdirSync(TMP).find(x => x.startsWith(path.basename(base) + '.'));
    if (!f) throw new Error('No se generó archivo');
    return path.join(TMP, f);
}

async function resolveYT(query) {
    if (/^https?:\/\//i.test(query)) return { url: query, title: null };
    const v = (await yts(query)).videos[0];
    if (!v) throw new Error('Sin resultados');
    return { url: v.url, title: v.title };
}

async function pinSearch(q) {
    try {
        const data = JSON.stringify({ options: { query: q, scope: 'pins', rs: 'typed' }, context: {} });
        const url = `https://www.pinterest.com/resource/BaseSearchResource/get/?source_url=${encodeURIComponent('/search/pins/?q=' + q)}&data=${encodeURIComponent(data)}`;
        const j = await fetchJSON(url, { headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' } });
        const urls = (j.resource_response?.data?.results || []).map(r => r.images?.orig?.url).filter(Boolean).slice(0, 10);
        if (urls.length) return pick(urls);
    } catch (e) { console.log('Pinterest falló:', e.message); }
    if (CONFIG.googleKey && CONFIG.googleCx) {
        try {
            const j = await fetchJSON(`https://www.googleapis.com/customsearch/v1?key=${CONFIG.googleKey}&cx=${CONFIG.googleCx}&searchType=image&num=5&q=${encodeURIComponent(q + ' pinterest')}`);
            const urls = (j.items || []).map(i => i.link);
            if (urls.length) return pick(urls);
        } catch (e) { console.log('Google falló:', e.message); }
    }
    return null;
}

// ----------------------- POKÉMON & MECÁNICAS -----------------------
const TYPES = {
    normal: { weak: ['rock', 'steel'], none: ['ghost'] },
    fire: { strong: ['grass', 'ice', 'bug', 'steel'], weak: ['fire', 'water', 'rock', 'dragon'] },
    water: { strong: ['fire', 'ground', 'rock'], weak: ['water', 'grass', 'dragon'] },
    electric: { strong: ['water', 'flying'], weak: ['electric', 'grass', 'dragon'], none: ['ground'] },
    grass: { strong: ['water', 'ground', 'rock'], weak: ['fire', 'grass', 'poison', 'flying', 'bug', 'dragon', 'steel'] },
    ice: { strong: ['grass', 'ground', 'flying', 'dragon'], weak: ['fire', 'water', 'ice', 'steel'] },
    fighting: { strong: ['normal', 'ice', 'rock', 'dark', 'steel'], weak: ['poison', 'flying', 'psychic', 'bug', 'fairy'], none: ['ghost'] },
    poison: { strong: ['grass', 'fairy'], weak: ['poison', 'ground', 'rock', 'ghost'], none: ['steel'] },
    ground: { strong: ['fire', 'electric', 'poison', 'rock', 'steel'], weak: ['grass', 'bug'], none: ['flying'] },
    flying: { strong: ['grass', 'fighting', 'bug'], weak: ['electric', 'rock', 'steel'] },
    psychic: { strong: ['fighting', 'poison'], weak: ['psychic', 'steel'], none: ['dark'] },
    bug: { strong: ['grass', 'psychic', 'dark'], weak: ['fire', 'fighting', 'poison', 'flying', 'ghost', 'steel', 'fairy'] },
    rock: { strong: ['fire', 'ice', 'flying', 'bug'], weak: ['fighting', 'ground', 'steel'] },
    ghost: { strong: ['psychic', 'ghost'], weak: ['dark'], none: ['normal'] },
    dragon: { strong: ['dragon'], weak: ['steel'], none: ['fairy'] },
    dark: { strong: ['psychic', 'ghost'], weak: ['fighting', 'dark', 'fairy'] },
    steel: { strong: ['ice', 'rock', 'fairy'], weak: ['fire', 'water', 'electric', 'steel'] },
    fairy: { strong: ['fighting', 'dragon', 'dark'], weak: ['fire', 'poison', 'steel'] }
};
const SPECIAL = new Set(['fire', 'water', 'grass', 'electric', 'ice', 'psychic', 'dragon', 'dark']);
const TYPE_MOVE = {
    normal: 'Golpe Cuerpo', fire: 'Lanzallamas', water: 'Hidrobomba', electric: 'Rayo', grass: 'Hoja Afilada',
    ice: 'Rayo Hielo', fighting: 'A Bocajarro', poison: 'Bomba Lodo', ground: 'Terremoto', flying: 'Pájaro Osado',
    psychic: 'Psíquico', bug: 'Zumbido', rock: 'Avalancha', ghost: 'Bola Sombra', dragon: 'Cometa Draco',
    dark: 'Triturar', steel: 'Cabeza de Hierro', fairy: 'Brillo Mágico'
};
const effect = (atk, def) => { const t = TYPES[atk]; return t.none?.includes(def) ? 0 : t.strong?.includes(def) ? 2 : t.weak?.includes(def) ? 0.5 : 1; };

const pokeCache = new Map();
async function getPoke(name) {
    const key = String(name).toLowerCase().trim().replace(/\s+/g, '-');
    if (pokeCache.has(key)) return pokeCache.get(key);
    const d = await fetchJSON(`https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(key)}`);
    const out = {
        id: d.id, name: d.name, types: d.types.map(t => t.type.name),
        base: Object.fromEntries(d.stats.map(x => [x.stat.name, x.base_stat])),
        img: d.sprites.other?.['official-artwork']?.front_default || d.sprites.front_default
    };
    pokeCache.set(key, out);
    return out;
}

function calcStats(b, L) {
    const f = v => Math.floor(2 * v * L / 100) + 5;
    return { hp: Math.floor(2 * b.hp * L / 100) + L + 10, atk: f(b.attack), def: f(b.defense), spa: f(b['special-attack']), spd: f(b['special-defense']), spe: f(b.speed) };
}
function movesFor(types) {
    const [t1, t2] = types;
    return [
        { name: TYPE_MOVE[t1], type: t1, power: 90, acc: 100 },
        t2 ? { name: TYPE_MOVE[t2], type: t2, power: 90, acc: 100 } : { name: 'Golpe Cuerpo', type: 'normal', power: 85, acc: 100 },
        { name: 'Placaje', type: 'normal', power: 65, acc: 100 },
        { name: 'Hiperrayo', type: 'normal', power: 120, acc: 75 }
    ];
}
async function makeFighter(entry, jid, id) {
    const d = await getPoke(entry.name);
    const stats = calcStats(d.base, entry.level);
    return { id, jid, entry, name: cap(d.name), types: d.types, base: d.base, img: d.img, level: entry.level, stats, hp: stats.hp, maxHp: stats.hp, moves: movesFor(d.types), mega: false, dyna: 0, dynaUsed: false, giga: false, tera: false };
}

async function applyMega(f) {
    let m = null;
    for (const s of ['-mega', '-mega-x']) { try { m = await getPoke(f.entry.name + s); break; } catch {} }
    const ratio = f.hp / f.maxHp;
    if (m) { f.base = m.base; f.types = m.types; f.img = m.img; f.name = 'Mega-' + cap(f.entry.name); }
    else { f.base = Object.fromEntries(Object.entries(f.base).map(([k, v]) => [k, Math.round(v * 1.25)])); f.name = 'Mega-' + f.name; }
    f.stats = calcStats(f.base, f.level);
    f.maxHp = f.stats.hp * (f.dyna ? 2 : 1);
    f.hp = Math.max(1, Math.round(f.maxHp * ratio));
    f.moves = movesFor(f.types);
    f.mega = true;
}

function applyDyna(f) { f.dyna = 3; f.dynaUsed = true; f.hp *= 2; f.maxHp *= 2; }
function endDyna(f) { const r = f.hp / f.maxHp; f.dyna = 0; f.maxHp = Math.round(f.maxHp / 2); f.hp = Math.max(1, Math.round(f.maxHp * r)); }

function applyGiga(f) {
    f.giga = true;
    f.name = 'Gigantamax-' + f.name;
    f.hp *= 2.2;
    f.maxHp *= 2.2;
    f.moves.forEach(m => m.power += 30);
}

function applyTera(f) {
    f.tera = true;
    f.name = 'Tera-' + f.name + ' ✨';
    f.moves.forEach(m => m.power += 25);
}

function doAttack(a, d, mv) {
    if (Math.random() * 100 > mv.acc) return { miss: true, dmg: 0, eff: 1 };
    const power = mv.power * (a.dyna ? 1.4 : 1);
    const phys = !SPECIAL.has(mv.type);
    const A = phys ? a.stats.atk : a.stats.spa, D = phys ? d.stats.def : d.stats.spd;
    const eff = d.types.reduce((m, t) => m * effect(mv.type, t), 1);
    const stab = a.types.includes(mv.type) ? 1.5 : 1;
    let dmg = Math.floor(((2 * a.level / 5 + 2) * power * A / D / 50 + 2) * stab * eff * (0.85 + Math.random() * 0.15));
    const crit = eff > 0 && Math.random() < 0.0625;
    if (eff > 0) dmg = Math.max(1, dmg);
    if (crit) dmg = Math.floor(dmg * 1.5);
    return { dmg, eff, crit };
}
const hpBar = (h, m) => { const n = Math.max(0, Math.round(10 * h / m)); return '█'.repeat(n) + '░'.repeat(10 - n) + ` ${Math.max(0, h)}/${m}`; };
const moveName = (f, mv) => (f.dyna ? 'Max ' : f.giga ? 'Giga-' : '') + mv.name;

const battles = new Map();
const challenges = new Map();
const wilds = new Map();

async function maybeSpawn(sock, from, text, sender) {
    const group = G(from);
    group.count = (group.count || 0) + 1;

    const history = H(from);
    history.push({ sender, text, time: Date.now() });
    if (history.length > 200) history.shift();

    save();

    if (group.count < 50 || wilds.has(from)) return;
    group.count = 0;
    save();

    try {
        const d = await getPoke(1 + rand(1025));
        const level = 5 + rand(40);
        wilds.set(from, { name: d.name, level, tries: 0 });
        await sock.sendMessage(from, { image: { url: d.img }, caption: `🌿 ¡Un *${cap(d.name)}* salvaje (Nv. ${level}) apareció!\nUsa */atrapar* para capturarlo.` });
    } catch {}
}

async function endBattle(c, chat, winnerId, loserId, why) {
    const bt = battles.get(chat);
    const w = P(winnerId), l = P(loserId);
    w.money += 200; w.wins++; l.money += 50; l.losses++;
    const wp = w.pokes[w.active]; if (wp && wp.level < 100) wp.level++;
    battles.delete(chat);
    save();
    await c.reply(`${why}\n🏆 ¡@${winnerId} gana el duelo! +200 💰 y su Pokémon sube de nivel.\n@${loserId} recibe +50 💰 de consolación.`, [bt.f[winnerId].jid, bt.f[loserId].jid]);
}

// ----------------------- EMOCIONES -----------------------
const EMOTIONS = [
    ['hug', 'abrazó a', 'se abrazó a sí mismo'], ['pat', 'acarició a', 'pide una caricia'], ['kiss', 'besó a', 'manda un beso'],
    ['slap', 'abofeteó a', 'dio una cachetada al aire'], ['kill', 'eliminó a', 'desapareció dramáticamente'],
    ['kick', 'pateó a', 'pateó el aire'], ['punch', 'golpeó a', 'golpeó el aire', 'kick'], ['cuddle', 'se acurrucó con', 'quiere acurrucarse'],
    ['cry', 'lloró por culpa de', 'está llorando'], ['bite', 'mordió a', 'mordió el aire'], ['bonk', 'dio un bonk a', 'bonk!'],
    ['poke', 'picó a', 'picó el aire'], ['lick', 'lamió a', 'lamió el aire'], ['highfive', 'chocó los cinco con', 'chocó los cinco al aire'],
    ['handhold', 'tomó de la mano a', 'busca una mano'], ['wave', 'saludó a', 'saluda a todos'], ['dance', 'bailó con', 'está bailando'],
    ['blush', 'se sonrojó por', 'se sonrojó'], ['smile', 'le sonrió a', 'sonríe'], ['happy', 'está feliz con', 'está feliz'],
    ['wink', 'le guiñó el ojo a', 'guiñó el ojo'], ['yeet', 'lanzó lejos a', 'yeet!'], ['glomp', 'se lanzó sobre', 'glomp!'],
    ['cringe', 'siente cringe por', 'siente cringe'], ['smug', 'presume frente a', 'se ve presumido'], ['nom', 'se comió a', 'ñam ñam']
];

async function sendGif(c, api, caption, mentions) {
    const gif = path.join(TMP, `emo_${Date.now()}_${rand(999)}.gif`);
    const mp4 = gif.replace('.gif', '.mp4');
    try {
        const d = await fetchJSON(`https://api.waifu.pics/sfw/${api}`);
        fs.writeFileSync(gif, Buffer.from(await (await fetch(d.url)).arrayBuffer()));
        await run('ffmpeg', ['-y', '-i', gif, '-movflags', 'faststart', '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', mp4], 60000);
        await c.sock.sendMessage(c.from, { video: fs.readFileSync(mp4), gifPlayback: true, caption, mentions }, { quoted: c.msg });
    } catch (e) {
        await c.reply(caption, mentions);
    } finally { for (const f of [gif, mp4]) try { fs.unlinkSync(f); } catch {} }
}

// ----------------------- REGISTRO DE COMANDOS -----------------------
const commands = new Map();
const cmd = (names, opts, fn) => {
    if (typeof opts === 'function') { fn = opts; opts = {}; }
    for (const n of [].concat(names)) commands.set(n, { ...opts, fn });
};
const tag = j => '@' + norm(j);

// ---------- MENÚ ----------
const MENU = `🤖 *MENÚ DEL BOT*

🎵 *MEDIOS*
/play <nombre|link> · MP3 de YouTube
/video <nombre|link> · video de YouTube
/yts <búsqueda> · buscar en YouTube
/pinterest <búsqueda> · imagen de Pinterest
/insta <link> · Instagram (también /tiktok, /fb, /dl)

🛠️ *HERRAMIENTAS & UTILIDADES*
/sticker (o /s) · Convertir imagen/video a sticker
/toimg · Convertir sticker a imagen
/clima <ciudad> · Ver el clima actual
/tr <idioma> <texto> · Traducir texto (ej: /tr es hello)

💰 *ECONOMÍA & BANCO*
/bal (o /coins) · Ver tus monedas actuales
/trabajar · Ganar monedas cada hora
/robar @user · Intentar robar monedas a otro jugador
/top (o /topcoins) · Ver ranking de entrenadores ricos
/casino <cantidad> · Apostar monedas
/tienda · Ver objetos disponibles

🐾 *POKÉMON*
/starter · Obtener inicial (Pikachu, Bulbasaur, Mewtwo)
/pstart <pokemon> · elegir primer Pokémon
/equipo o /pequipo · Ver TODOS tus Pokémon guardados
/pelegir <n> · /pperfil · /pinfo <pokemon>
/atrapar · capturar salvaje
/pcombatir @user · /paceptar · /prendirse
/pm <1-4> · atacar
/pmega · Piedra Mega-Evolución
/pdyna · Piedra Dinamax (3 turnos)
/pgiganta · Piedra Gigantamax
/ptera · Orbe Teracristalización
/pcaramelo · +5 niveles (Coste: 300 💰)

🔥 *DIVERSIÓN & FUN* 🆕
/gay @user · Nivel de gay en %
/iq @user · Nivel de inteligencia / QI
/formar · Formar una pareja aleatoria en el grupo
/slot · Machine a sous / Tragamonedas
/truth · Pregunta de verdad aleatoria
/dare · Reto / Desafío aleatorio

😊 *EMOCIONES* (responde o menciona)
${EMOTIONS.map(e => '/' + e[0]).join(' ')}

🎮 *JUEGOS*
/dado · /moneda · /ppt <piedra|papel|tijera> · /8ball <pregunta>
/ship @a @b · /ruleta · /broma · /frase

👥 *GRUPO*
/info · /admins · /link · /tagall · /hidetag <texto>

🛡️ *ADMINS*
/kick · /add <número> · /promote · /demote
/abrir · /cerrar · /del

ℹ️ /ping · /id`;

cmd(['menu', 'help', 'ayuda'], c => c.reply(MENU));
cmd('ping', c => c.reply('🏓 Pong!'));
cmd('id', c => c.reply(`🆔 Tus IDs: ${c.senderIds.join(', ')}\n💬 Chat: ${c.from}`));

// ---------- NUEVAS COMMANDES FUN ----------
cmd('gay', c => {
    const targetJid = c.targets[0] || c.senderJid;
    const percentage = rand(101);
    c.reply(`🏳️‍🌈 El nivel gay de ${tag(targetJid)} es del *${percentage}%*! 🌈`, [targetJid]);
});

cmd('iq', c => {
    const targetJid = c.targets[0] || c.senderJid;
    const iq = 50 + rand(120);
    c.reply(`🧠 El coeficiente intelectual (IQ) de ${tag(targetJid)} es de *${iq}*!`, [targetJid]);
});

cmd('formar', { group: true }, async c => {
    const meta = await c.sock.groupMetadata(c.from);
    if (meta.participants.length < 2) return c.reply('❌ Necesito al menos 2 personas en el grupo.');
    const p1 = pick(meta.participants).id;
    let p2 = pick(meta.participants).id;
    while (p1 === p2) p2 = pick(meta.participants).id;
    c.reply(`👩‍❤️‍👨 ¡La pareja perfecta del grupo es ${tag(p1)} y ${tag(p2)}! 💕`, [p1, p2]);
});

cmd('slot', c => {
    const items = ['🍎', '🍒', '🍋', '🥑', '⭐', '💎'];
    const a = pick(items), b = pick(items), c1 = pick(items);
    const win = (a === b && b === c1);
    c.reply(`🎰 *TRAGAMONEDAS / SLOT* 🎰\n\n[ ${a} | ${b} | ${c1} ]\n\n${win ? '🎉 ¡¡JACKPOT!! ¡Ganaste!' : '😢 ¡Sigue intentando!'}`);
});

cmd(['truth', 'verdad'], c => {
    const questions = [
        '¿Cuál es tu mayor secreto que nadie en este grupo sabe?',
        '¿Alguna vez has mentido para salir de un problema grave?',
        '¿Quién de este grupo te cae peor?',
        '¿Qué es lo más vergonzoso que te ha pasado en público?'
    ];
    c.reply(`🤔 *VERDAD:* ${pick(questions)}`);
});

cmd(['dare', 'reto'], c => {
    const dares = [
        'Envía un nota de voz cantando una canción graciosa.',
        'Pon una foto divertida de perfil durante 1 hora.',
        'Envía el último sticker que guardaste sin dar explicaciones.',
        'Escribe en el grupo tu mayor vergüenza en una frase.'
    ];
    c.reply(`⚡ *DESAFÍO / RETO:* ${pick(dares)}`);
});

// ---------- COMANDOS DE MONEDAS Y ECONOMÍA ----------
cmd(['bal', 'balanza', 'coins', 'cartera', 'monedas'], c => {
    const p = P(c.sender);
    c.reply(`💰 *SALDO DE ENTRENADOR*\n\nUsuario: @${c.sender}\nMonedas: *${p.money} 💰*`, [c.senderJid]);
});

cmd('casino', c => {
    const p = P(c.sender);
    const bet = parseInt(c.args[0]);
    if (isNaN(bet) || bet <= 0) return c.reply('⚠️ Uso: /casino <cantidad> (ej: /casino 100)');
    if (p.money < bet) return c.reply(`❌ No tienes suficientes monedas. Tienes: ${p.money} 💰`);

    if (Math.random() < 0.45) {
        p.money += bet;
        save();
        c.reply(`🎉 ¡FELICIDADES! Ganaste el doble: *+${bet} 💰* (Total: ${p.money} 💰)`);
    } else {
        p.money -= bet;
        save();
        c.reply(`💸 La suerte no estuvo de tu lado. Perdiste: *-${bet} 💰* (Total: ${p.money} 💰)`);
    }
});

cmd('tienda', c => {
    c.reply(`🛒 *TIENDA POKÉMON*\n\n1. Caramelo Raro (+5 Nivel) - 300 💰 (Usa /pcaramelo)`);
});

// ---------- NUEVAS HERRAMIENTAS & UTILIDADES ----------
cmd(['sticker', 's'], async c => {
    const isQuotedImage = c.m.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
    const isQuotedVideo = c.m.message?.extendedTextMessage?.contextInfo?.quotedMessage?.videoMessage;
    const isImage = c.m.message?.imageMessage;
    const isVideo = c.m.message?.videoMessage;

    if (!isImage && !isVideo && !isQuotedImage && !isQuotedVideo) {
        return c.reply('⚠️ Responde a una imagen o video corto con */sticker*');
    }

    try {
        await c.reply('⏳ Creando sticker...');
        const buffer = await downloadMediaMessage(
            isQuotedImage || isQuotedVideo ? { message: c.m.message.extendedTextMessage.contextInfo.quotedMessage } : c.m,
            'buffer',
            {}
        );
        const tmpInput = path.join(TMP, `s_in_${Date.now()}.tmp`);
        const tmpOutput = path.join(TMP, `s_out_${Date.now()}.webp`);

        fs.writeFileSync(tmpInput, buffer);

        exec(`ffmpeg -i ${tmpInput} -vcodec libwebp -filter:v "scale='min(320,iw)':min'(320,ih)':force_original_aspect_ratio=decrease,fps=15, pad=320:320:(320-iw)/2:(320-ih)/2:color=0x00000000" -loop 0 -ss 00:00:00 -t 00:00:05 -preset default -an -vsync 0 ${tmpOutput}`, async (err) => {
            if (err) {
                cleanup(tmpInput);
                return c.reply('❌ Error al procesar el sticker.');
            }
            const webpBuffer = fs.readFileSync(tmpOutput);
            await c.sock.sendMessage(c.from, { sticker: webpBuffer }, { quoted: c.m });
            cleanup(tmpInput);
            cleanup(tmpOutput);
        });
    } catch (e) {
        c.reply('❌ No se pudo generar el sticker.');
    }
});

cmd('toimg', async c => {
    const isQuotedSticker = c.m.message?.extendedTextMessage?.contextInfo?.quotedMessage?.stickerMessage;
    if (!isQuotedSticker) return c.reply('⚠️ Responde a un sticker con */toimg*');

    try {
        const buffer = await downloadMediaMessage(
            { message: c.m.message.extendedTextMessage.contextInfo.quotedMessage },
            'buffer',
            {}
        );
        const tmpInput = path.join(TMP, `st_in_${Date.now()}.webp`);
        const tmpOutput = path.join(TMP, `st_out_${Date.now()}.png`);

        fs.writeFileSync(tmpInput, buffer);

        exec(`ffmpeg -i ${tmpInput} ${tmpOutput}`, async (err) => {
            if (err) {
                cleanup(tmpInput);
                return c.reply('❌ No se pudo convertir el sticker.');
            }
            const pngBuffer = fs.readFileSync(tmpOutput);
            await c.sock.sendMessage(c.from, { image: pngBuffer, caption: '🖼️ Sticker convertido en imagen.' }, { quoted: c.m });
            cleanup(tmpInput);
            cleanup(tmpOutput);
        });
    } catch {
        c.reply('❌ Error al convertir el sticker.');
    }
});

cmd('clima', async c => {
    if (!c.query) return c.reply('⚠️ Uso: /clima Santiago');
    try {
        const data = await fetchJSON(`https://wttr.in/${encodeURIComponent(c.query)}?format=j1`);
        const curr = data.current_condition[0];
        const area = data.nearest_area[0];
        c.reply(`🌤️ *CLIMA EN ${area.areaName[0].value.toUpperCase()}, ${area.country[0].value.toUpperCase()}*\n\n🌡️ *Temperatura:* ${curr.temp_C}°C\n🤔 *Sensación térmica:* ${curr.FeelsLikeC}°C\n💧 *Humedad:* ${curr.humidity}%\n💨 *Viento:* ${curr.windspeedKmph} km/h`);
    } catch {
        c.reply('❌ No se pudo obtener el clima de esa ciudad.');
    }
});

cmd('tr', async c => {
    const lang = c.args[0];
    const textToTranslate = c.args.slice(1).join(' ');
    if (!lang || !textToTranslate) return c.reply('⚠️ Uso: /tr es hello world');

    try {
        const res = await fetchJSON(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${lang}&dt=t&q=${encodeURIComponent(textToTranslate)}`);
        const translated = res[0].map(x => x[0]).join('');
        c.reply(`🌐 *Traducción (${lang}):*\n${translated}`);
    } catch {
        c.reply('❌ Error al traducir el texto.');
    }
});

// ---------- ECONOMÍA & BANCO ----------
cmd('trabajar', c => {
    const p = P(c.sender);
    const cooldown = 3600000;
    const now = Date.now();

    if (now - (p.lastWork || 0) < cooldown) {
        const remaining = Math.ceil((cooldown - (now - p.lastWork)) / 60000);
        return c.reply(`⏳ Debes descansar. Vuelve a trabajar en *${remaining} minutos*.`);
    }

    const earned = 100 + rand(201);
    p.money += earned;
    p.lastWork = now;
    save();

    const trabajos = ['entrenando Pokémon', 'trabajando en el Centro Pokémon', 'ayudando al Profesor Oak', 'ganando un torneo local'];
    c.reply(`💼 Trabajaste ${pick(trabajos)} y ganaste *${earned} 💰 monedas*. (Total: ${p.money} 💰)`);
});

cmd('robar', c => {
    const targetJid = c.targets[0];
    if (!targetJid) return c.reply('⚠️ Menciona a quién quieres robar: /robar @usuario');
    const target = norm(targetJid);

    if (target === c.sender) return c.reply('❌ No te puedes robar a ti mismo.');

    const pSender = P(c.sender);
    const pTarget = P(target);

    if (pTarget.money < 100) return c.reply(`❌ @${target} es demasiado pobre para robarle.`, [targetJid]);

    if (Math.random() < 0.5) {
        const stolen = Math.floor(pTarget.money * (0.1 + Math.random() * 0.2));
        pTarget.money -= stolen;
        pSender.money += stolen;
        save();
        c.reply(`🥷 ¡Le robaste *${stolen} 💰 monedas* a ${tag(targetJid)}!`, [targetJid]);
    } else {
        const fine = 100;
        pSender.money = Math.max(0, pSender.money - fine);
        save();
        c.reply(`🚨 Te atraparon intentando robar a ${tag(targetJid)} y pagaste una multa de *${fine} 💰 monedas*.`, [targetJid]);
    }
});

cmd(['top', 'topcoins', 'puntero'], c => {
    const sorted = Object.entries(db.players)
        .map(([id, data]) => ({ id, money: data.money || 0 }))
        .sort((a, b) => b.money - a.money)
        .slice(0, 10);

    if (!sorted.length) return c.reply('❌ No hay entrenadores registrados aún.');

    let rankingText = `🏆 *RANKING DE ENTRENADORES MÁS RICOS* 🏆\n\n`;
    const mentions = [];

    sorted.forEach((item, index) => {
        const jid = item.id + '@s.whatsapp.net';
        mentions.push(jid);
        rankingText += `${index + 1}. ${tag(jid)} - *${item.money} 💰*\n`;
    });

    c.reply(rankingText, mentions);
});

// ---------- ENTRETENIMIENTO ----------
cmd('broma', c => {
    const chistes = [
        '¿Qué le dice un Pikachu a otro? — ¡Pika-pika!',
        '¿Qué hace un perro con un taladro? — Adiestrando.',
        '¿Cómo se dice pañuelo en japonés? — Sakamoko.',
        '¿Por qué los pájaros no usan Facebook? — Porque ya tienen Twitter.',
        '¿Qué le dice una iguana a su hermana gemela? — Somos iguanitas.'
    ];
    c.reply(`🤣 ${pick(chistes)}`);
});

cmd('frase', c => {
    const frases = [
        '🌟 "No cuentes los días, haz que los días cuenten." — Muhammad Ali',
        '⚡ "Hazlo o no lo hagas, pero no lo intentes." — Yoda',
        '🔥 "La perseverancia es la clave del éxito en cualquier batalla Pokémon."',
        '🚀 "El único modo de hacer un gran trabajo es amar lo que haces." — Steve Jobs'
    ];
    c.reply(`💬 ${pick(frases)}`);
});

// ---------- MEDIOS ----------
cmd(['play', 'musica', 'mp3', 'ytmp3'], async c => {
    if (!c.query) return c.reply('⚠️ Uso: /play nombre o link de YouTube');
    const base = tmpBase();
    try {
        const v = await resolveYT(c.query);
        await c.reply(`🎵 Descargando: ${v.title || v.url}`);
        const file = await download(['-x', '--audio-format', 'mp3', '--audio-quality', '5', '--match-filter', 'duration<1200', v.url], base);
        await c.sock.sendMessage(c.from, { audio: fs.readFileSync(file), mimetype: 'audio/mpeg', fileName: (v.title || 'audio') + '.mp3' }, { quoted: c.msg });
    } catch (e) { await c.reply('❌ No pude descargar el audio.'); }
    finally { cleanup(base); }
});

cmd(['video', 'ytmp4', 'mp4'], async c => {
    if (!c.query) return c.reply('⚠️ Uso: /video nombre o link de YouTube');
    const base = tmpBase();
    try {
        const v = await resolveYT(c.query);
        await c.reply(`🎬 Descargando: ${v.title || v.url}`);
        const file = await download(['-f', 'b[height<=480][ext=mp4]/bv*[height<=480]+ba/b[height<=480]/b', '--merge-output-format', 'mp4', '--max-filesize', '60M', '--match-filter', 'duration<1200', v.url], base);
        await c.sock.sendMessage(c.from, { video: fs.readFileSync(file), caption: v.title || '' }, { quoted: c.msg });
    } catch (e) { await c.reply('❌ No pude descargar el video.'); }
    finally { cleanup(base); }
});

cmd(['yts', 'youtube'], async c => {
    if (!c.query) return c.reply('⚠️ Uso: /yts búsqueda');
    const vs = (await yts(c.query)).videos.slice(0, 5);
    if (!vs.length) return c.reply('❌ Sin resultados.');
    await c.reply(vs.map((v, i) => `${i + 1}. *${v.title}* (${v.timestamp})\n${v.url}`).join('\n\n') + '\n\nUsa /play <link> para el MP3.');
});

cmd(['pinterest', 'pin'], async c => {
    if (!c.query) return c.reply('⚠️ Uso: /pinterest mazda furai');
    await c.reply(`🖼️ Buscando en Pinterest: "${c.query}"...`);
    const url = await pinSearch(c.query);
    if (!url) return c.reply('❌ No encontré imágenes.');
    try {
        const buf = Buffer.from(await (await fetch(url, { headers: { 'User-Agent': UA } })).arrayBuffer());
        await c.sock.sendMessage(c.from, { image: buf, caption: `🖼️ ${c.query}` }, { quoted: c.msg });
    } catch { await c.reply('❌ No pude descargar la imagen.'); }
});

cmd(['insta', 'ig', 'tiktok', 'tt', 'fb', 'twitter', 'dl'], async c => {
    if (!/^https?:\/\//i.test(c.query)) return c.reply('⚠️ Uso: /insta <link>');
    await c.reply('⬇️ Descargando...');
    const base = tmpBase();
    try {
        const file = await download(['--max-filesize', '60M', c.query.split(/\s+/)[0]], base);
        const ext = path.extname(file).slice(1).toLowerCase();
        const buf = fs.readFileSync(file);
        let content;
        if (['mp4', 'mov', 'webm', 'mkv'].includes(ext)) content = { video: buf };
        else if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) content = { image: buf };
        else content = { document: buf, fileName: path.basename(file), mimetype: 'application/octet-stream' };
        await c.sock.sendMessage(c.from, content, { quoted: c.msg });
    } catch (e) { await c.reply('❌ Error al descargar.'); }
    finally { cleanup(base); }
});

// ---------- EMOCIONES ----------
for (const [name, withT, solo, api] of EMOTIONS) {
    cmd(name, async c => {
        const mentions = [c.senderJid, ...c.targets];
        const caption = c.targets.length ? `✨ ${tag(c.senderJid)} ${withT} ${tag(c.targets[0])}` : `✨ ${tag(c.senderJid)} ${solo}`;
        await sendGif(c, api || name, caption, mentions);
    });
}

// ---------- POKÉMON & TRANSFORMACIONES ----------
cmd('starter', async c => {
    const p = P(c.sender);
    if (p.pokes.length) return c.reply('❌ Ya tienes Pokémon iniciales en tu equipo.');
    
    const starters = ['pikachu', 'bulbasaur', 'mewtwo'];
    const chosen = pick(starters);
    
    try {
        const d = await getPoke(chosen);
        p.pokes.push({ name: d.name, level: 25 });
        save();
        await c.sock.sendMessage(c.from, { image: { url: d.img }, caption: `🎉 ¡Recibiste a tu Pokémon inicial: *${cap(d.name)}* (Nv. 25)!\nTipo: ${d.types.join('/')}` }, { quoted: c.m });
    } catch {
        c.reply('❌ Ocurrió un error al entregar tu Pokémon inicial.');
    }
});

cmd('pstart', async c => {
    const p = P(c.sender);
    if (p.pokes.length) return c.reply('❌ Ya tienes Pokémon. Usa /equipo.');
    if (!c.query) return c.reply('⚠️ Uso: /pstart pikachu');
    try {
        const d = await getPoke(c.query);
        p.pokes.push({ name: d.name, level: 25 });
        save();
        await c.sock.sendMessage(c.from, { image: { url: d.img }, caption: `🎉 ¡Tu compañero es *${cap(d.name)}* (Nv. 25)!\nTipo: ${d.types.join('/')}` }, { quoted: c.m });
    } catch { await c.reply('❌ Ese Pokémon no existe en la PokéAPI.'); }
});

cmd('pinfo', async c => {
    if (!c.query) return c.reply('⚠️ Uso: /pinfo pikachu');
    try {
        const d = await getPoke(c.query), b = d.base;
        await c.sock.sendMessage(c.from, { image: { url: d.img }, caption: `*${cap(d.name)}* #${d.id}\nTipo: ${d.types.join('/')}\nPS ${b.hp} · ATK ${b.attack} · DEF ${b.defense}\nSP.ATK ${b['special-attack']} · SP.DEF ${b['special-defense']} · VEL ${b.speed}` }, { quoted: c.m });
    } catch { await c.reply('❌ Pokémon no encontrado.'); }
});

cmd(['pequipo', 'equipo'], c => {
    const p = P(c.sender);
    if (!p.pokes.length) return c.reply('❌ No tienes Pokémon aún. Usa /starter o /pstart <nombre>.');
    
    let listText = `🎒 *TU POKÉDEX COMPLETA GUARDADA (${p.pokes.length} POKÉMON)* :\n\n`;
    p.pokes.forEach((x, i) => {
        const activeStar = (i === p.active) ? '⭐ ' : '▫️ ';
        listText += `${activeStar}*${i + 1}. ${cap(x.name)}* (Nv. ${x.level})\n`;
    });

    listText += `\n📌 Cambia de Pokémon activo con: */pelegir <número>*`;
    c.reply(listText);
});

cmd('pelegir', c => {
    const p = P(c.sender), n = parseInt(c.args[0]) - 1;
    if (!p.pokes[n]) return c.reply('⚠️ Uso: /pelegir <número> (mira /equipo)');
    p.active = n; 
    save();
    c.reply(`⭐ Ahora usas a *${cap(p.pokes[n].name)}*.`);
});

cmd('pperfil', c => {
    const p = P(c.sender);
    c.reply(`👤 *Entrenador @${c.sender}*\n💰 ${p.money} monedas\n🏆 ${p.wins} victorias · 💀 ${p.losses} derrotas\n🐾 ${p.pokes.length} Pokémon guardados`, [c.senderJid]);
});

cmd('pcaramelo', c => {
    const p = P(c.sender), pk = p.pokes[p.active];
    if (!pk) return c.reply('❌ No tienes Pokémon activo.');
    if (p.money < 300) return c.reply(`❌ Necesitas 300 💰 monedas. Tienes: ${p.money} 💰.`);
    if (pk.level >= 100) return c.reply('❌ Ya está al nivel 100.');
    p.money -= 300; 
    pk.level = Math.min(100, pk.level + 5); 
    save();
    c.reply(`🍬 *${cap(pk.name)}* subió a Nivel ${pk.level}.`);
});

cmd('atrapar', async c => {
    const w = wilds.get(c.from);
    if (!w) return c.reply('❌ No hay Pokémon salvaje disponible en este momento.');
    w.tries++;
    if (Math.random() < 0.6) {
        wilds.delete(c.from);
        P(c.sender).pokes.push({ name: w.name, level: w.level }); 
        save();
        return c.reply(`🎉 ¡@${c.sender} atrapó a *${cap(w.name)}* (Nv. ${w.level})!`, [c.senderJid]);
    }
    if (w.tries >= 6) { wilds.delete(c.from); return c.reply(`💨 *${cap(w.name)}* escapó...`); }
    c.reply(`❌ ¡Se escapó de la Poké Ball! (${w.tries}/6 intentos)`);
});

cmd('pcombatir', { group: true }, async c => {
    const t = c.targets[0];
    if (!t) return c.reply('⚠️ Uso: /pcombatir @usuario');
    if (norm(t) === c.sender) return c.reply('❌ No puedes retarte a ti mismo.');
    if (battles.has(c.from)) return c.reply('❌ Ya hay un combate en este grupo.');
    if (!P(c.sender).pokes.length || !P(norm(t)).pokes.length) return c.reply('❌ Ambos necesitan Pokémon (/pstart).');
    challenges.set(c.from, { from: c.sender, to: norm(t), fromJid: c.senderJid, toJid: t, t: Date.now() });
    c.reply(`⚔️ ${tag(c.senderJid)} reta a ${tag(t)}.\n${tag(t)}, usa */paceptar* en los próximos 2 minutos.`, [c.senderJid, t]);
});

cmd('paceptar', { group: true }, async c => {
    const ch = challenges.get(c.from);
    if (!ch || Date.now() - ch.t > 120000 || ch.to !== c.sender) return c.reply('❌ No tienes ningún reto pendiente.');
    challenges.delete(c.from);
    const p1 = P(ch.from), p2 = P(ch.to);
    const f1 = await makeFighter(p1.pokes[p1.active], ch.fromJid, ch.from);
    const f2 = await makeFighter(p2.pokes[p2.active], ch.toJid, ch.to);
    battles.set(c.from, { f: { [ch.from]: f1, [ch.to]: f2 }, turn: ch.from });
    c.reply(`⚔️ ¡Combate iniciado entre @${ch.from} y @${ch.to}!\n\n${f1.name} (Nv.${f1.level}) HP: ${hpBar(f1.hp, f1.maxHp)}\nVS\n${f2.name} (Nv.${f2.level}) HP: ${hpBar(f2.hp, f2.maxHp)}\n\nTurno de @${ch.from}. Usa /pm <1-4> para atacar.`, [ch.fromJid, ch.toJid]);
});

cmd('pm', { group: true }, async c => {
    const bt = battles.get(c.from);
    if (!bt) return c.reply('❌ No hay ningún combate activo en este grupo.');
    if (bt.turn !== c.sender) return c.reply(`⏳ No es tu turno. Le toca a @${bt.turn}.`, [bt.f[bt.turn].jid]);
    const n = parseInt(c.args[0]) - 1;
    const atkObj = bt.f[bt.sender];
    const defKey = Object.keys(bt.f).find(x => x !== c.sender);
    const defObj = bt.f[defKey];
    if (n < 0 || n >= atkObj.moves.length) return c.reply('⚠️ Usa /pm <1-4> para elegir tu ataque.');

    const mv = atkObj.moves[n];
    const res = doAttack(atkObj, defObj, mv);
    let msg = `⚔️ *${atkObj.name}* usó *${moveName(atkObj, mv)}*.\n`;
    if (res.miss) msg += '💨 ¡El ataque falló!\n';
    else {
        defObj.hp = Math.max(0, defObj.hp - res.dmg);
        if (res.eff > 1) msg += '🔥 ¡Es supereficaz!\n';
        else if (res.eff < 1 && res.eff > 0) msg += '❄️ No es muy eficaz...\n';
        else if (res.eff === 0) msg += '🛡️ ¡No le afecta!\n';
        if (res.crit) msg += '💥 ¡Golpe crítico!\n';
        msg += `-${res.dmg} HP\n\n`;
    }

    msg += `${atkObj.name}: ${hpBar(atkObj.hp, atkObj.maxHp)}\n${defObj.name}: ${hpBar(defObj.hp, defObj.maxHp)}`;
    await c.reply(msg, [atkObj.jid, defObj.jid]);

    if (defObj.hp <= 0) return endBattle(c, c.from, c.sender, defKey, `💀 ¡${defObj.name} debilitado!`);
    bt.turn = defKey;
});

cmd('pmega', { group: true }, async c => {
    const bt = battles.get(c.from);
    if (!bt || bt.turn !== c.sender) return c.reply('❌ No estás en combate activo.');
    const f = bt.f[c.sender];
    if (f.mega) return c.reply('❌ Ya usaste Megaevolución.');
    await applyMega(f);
    c.reply(`✨ ¡*${f.name}* ha Megaevolucionado!`);
});

cmd('pdyna', { group: true }, async c => {
    const bt = battles.get(c.from);
    if (!bt || bt.turn !== c.sender) return c.reply('❌ No estás en combate activo.');
    const f = bt.f[c.sender];
    if (f.dynaUsed) return c.reply('❌ Ya usaste Dinamax.');
    applyDyna(f);
    c.reply(`🔴 ¡*${f.name}* se ha Dinamaxizado!`);
});

cmd('pgiganta', { group: true }, async c => {
    const bt = battles.get(c.from);
    if (!bt || bt.turn !== c.sender) return c.reply('❌ No estás en combate activo.');
    const f = bt.f[c.sender];
    if (f.giga) return c.reply('❌ Ya usaste Gigantamax.');
    applyGiga(f);
    c.reply(`🌀 ¡*${f.name}* adoptó su forma Gigantamax!`);
});

cmd('ptera', { group: true }, async c => {
    const bt = battles.get(c.from);
    if (!bt || bt.turn !== c.sender) return c.reply('❌ No estás en combate activo.');
    const f = bt.f[c.sender];
    if (f.tera) return c.reply('❌ Ya usaste la Teracristalización.');
    applyTera(f);
    c.reply(`💎 ¡*${f.name}* se ha Teracristalizado!`);
});

// ---------- JUEGOS ----------
cmd('dado', c => c.reply(`🎲 Resultado del dado: *${1 + rand(6)}*`));
cmd('moneda', c => c.reply(`🪙 Cayó: *${rand(2) === 0 ? 'Cara' : 'Cruz'}*`));
cmd('ppt', c => {
    const u = (c.args[0] || '').toLowerCase();
    const opts = ['piedra', 'papel', 'tijera'];
    if (!opts.includes(u)) return c.reply('⚠️ Uso: /ppt <piedra|papel|tijera>');
    const b = pick(opts);
    const win = (u === 'piedra' && b === 'tijera') || (u === 'papel' && b === 'piedra') || (u === 'tijera' && b === 'papel');
    const tie = u === b;
    c.reply(`🤖 Elegí *${b}*.\n${tie ? '🤝 ¡Empate!' : win ? '🎉 ¡Ganaste!' : '😢 ¡Perdiste!'}`);
});
cmd('8ball', c => {
    if (!c.query) return c.reply('⚠️ Uso: /8ball <pregunta>');
    const r = ['Sí, definitivamente.', 'No lo creo.', 'Es muy probable.', 'Mis fuentes dicen que no.', 'Pregunta más tarde.', 'Absolutamente sí.'];
    c.reply(`🔮 ${pick(r)}`);
});
cmd('ship', c => {
    if (c.targets.length < 2) return c.reply('⚠️ Menciona a dos usuarios: /ship @u1 @u2');
    c.reply(`❤️ El porcentaje de compatibilidad entre ${tag(c.targets[0])} y ${tag(c.targets[1])} es del *${rand(101)}%* 💕`, c.targets);
});
cmd('ruleta', c => c.reply(rand(6) === 0 ? '💥 ¡Bang! Perdiste.' : '😎 ¡Click! Te salvaste.'));

// ---------- GRUPO & ADMINS ----------
cmd(['info', 'infogrupo'], { group: true }, async c => {
    const meta = await c.sock.groupMetadata(c.from);
    c.reply(`👥 *GRUPO: ${meta.subject}*\n📝 Descripción: ${meta.desc || 'Sin descripción'}\n👤 Participantes: ${meta.participants.length}`);
});
cmd('admins', { group: true }, async c => {
    const meta = await c.sock.groupMetadata(c.from);
    const admins = meta.participants.filter(p => p.admin).map(p => '@' + norm(p.id));
    c.reply(`🛡️ *Administradores:*\n${admins.join('\n')}`, admins.map(x => x.replace('@', '') + '@s.whatsapp.net'));
});
cmd('link', { group: true, botAdmin: true }, async c => {
    try {
        const code = await c.sock.groupInviteCode(c.from);
        c.reply(`🔗 https://chat.whatsapp.com/${code}`);
    } catch { c.reply('❌ No pude obtener el enlace.'); }
});
cmd('tagall', { group: true, admin: true }, async c => {
    const meta = await c.sock.groupMetadata(c.from);
    const mentions = meta.participants.map(p => p.id);
    const text = meta.participants.map(p => '@' + norm(p.id)).join(' ');
    c.sock.sendMessage(c.from, { text: `📢 *AVISO GENERAL*\n${c.query || ''}\n\n${text}`, mentions }, { quoted: c.m });
});
cmd('hidetag', { group: true, admin: true }, async c => {
    const meta = await c.sock.groupMetadata(c.from);
    const mentions = meta.participants.map(p => p.id);
    c.sock.sendMessage(c.from, { text: c.query || '📢 Mensaje importante', mentions });
});

cmd('kick', { group: true, admin: true, botAdmin: true }, async c => {
    const t = c.targets[0];
    if (!t) return c.reply('⚠️ Menciona a alguien: /kick @usuario');
    await c.sock.groupParticipantsUpdate(c.from, [t], 'remove');
    c.reply('👢 Usuario expulsado.');
});
cmd('add', { group: true, admin: true, botAdmin: true }, async c => {
    if (!c.args[0]) return c.reply('⚠️ Uso: /add 54911...');
    try {
        await c.sock.groupParticipantsUpdate(c.from, [c.args[0] + '@s.whatsapp.net'], 'add');
        c.reply('➕ Usuario añadido.');
    } catch { c.reply('❌ No se pudo añadir.'); }
});
cmd(['promote', 'daradmin'], { group: true, admin: true, botAdmin: true }, async c => {
    const t = c.targets[0];
    if (!t) return c.reply('⚠️ Menciona a alguien.');
    await c.sock.groupParticipantsUpdate(c.from, [t], 'promote');
    c.reply('⭐ ¡Usuario promovido a administrador!');
});
cmd(['demote', 'quitaradmin'], { group: true, admin: true, botAdmin: true }, async c => {
    const t = c.targets[0];
    if (!t) return c.reply('⚠️ Menciona a alguien.');
    await c.sock.groupParticipantsUpdate(c.from, [t], 'demote');
    c.reply('📉 Administrador degradado a miembro.');
});
cmd('abrir', { group: true, admin: true, botAdmin: true }, async c => {
    await c.sock.groupSettingUpdate(c.from, 'not_announcement');
    c.reply('🔓 Grupo abierto. Todos pueden escribir.');
});
cmd('cerrar', { group: true, admin: true, botAdmin: true }, async c => {
    await c.sock.groupSettingUpdate(c.from, 'announcement');
    c.reply('🔒 Grupo cerrado. Solo admins pueden escribir.');
});
cmd('del', { group: true }, async c => {
    const q = c.m.message?.extendedTextMessage?.contextInfo;
    if (!q) return c.reply('⚠️ Responde al mensaje que deseas borrar.');
    await c.sock.sendMessage(c.from, { delete: { remoteJid: c.from, fromMe: false, id: q.stanzaId, participant: q.participant } });
});

// ----------------------- CONEXIÓN Y EVENTOS (START BOT) -----------------------
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'session_' + CONFIG.sessionName));

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ['Mac OS', 'Chrome', '14.4.1']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('\n📱 Escanea este código QR con WhatsApp:\n');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('🔴 Conexión cerrada. ¿Reconectando?:', shouldReconnect);
            if (shouldReconnect) {
                startBot();
            }
        } else if (connection === 'open') {
            console.log('✅ ¡Bot conectado con éxito a WhatsApp!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        
        for (const m of messages) {
            if (!m.message) continue;
            
            const from = m.key.remoteJid;
            const text = m.message.conversation || m.message.extendedTextMessage?.text || '';
            const sender = norm(m.key.participant || m.key.remoteJid);
            const senderJid = m.key.participant || m.key.remoteJid;
            const isGroup = from.endsWith('@g.us');

            await maybeSpawn(sock, from, text, sender);

            if (!text.startsWith(CONFIG.prefix)) continue;

            const args = text.slice(CONFIG.prefix.length).trim().split(/\s+/);
            const commandName = args.shift().toLowerCase();
            const query = args.join(' ');

            const cmdObj = commands.get(commandName);
            if (!cmdObj) continue;

            let isAdmin = false;
            let botAdmin = false;
            let meta = null;

            if (isGroup) {
                try {
                    meta = await sock.groupMetadata(from);
                    const participant = meta.participants.find(p => norm(p.id) === sender);
                    isAdmin = Boolean(participant?.admin) || m.key.fromMe;
                    
                    // Détection corrigée de l'admin pour le bot
                    const botIdNorm = norm(sock.user?.id);
                    const botParticipant = meta.participants.find(p => norm(p.id) === botIdNorm);
                    botAdmin = Boolean(botParticipant?.admin);
                } catch {}
            }

            if (cmdObj.group && !isGroup) return sock.sendMessage(from, { text: '❌ Solo en grupos.' }, { quoted: m });
            if (cmdObj.admin && !isAdmin) return sock.sendMessage(from, { text: '❌ Solo administradores.' }, { quoted: m });
            if (cmdObj.botAdmin && !botAdmin) return sock.sendMessage(from, { text: '❌ El bot debe ser admin.' }, { quoted: m });

            const targets = [];
            const ctxInfo = m.message.extendedTextMessage?.contextInfo;
            if (ctxInfo?.mentionedJid) targets.push(...ctxInfo.mentionedJid);
            if (ctxInfo?.participant) targets.push(ctxInfo.participant);

            const reply = (txt, mentions = []) => sock.sendMessage(from, { text: txt, mentions }, { quoted: m });

            const c = {
                sock,
                m,
                from,
                isGroup,
                sender,
                senderJid,
                senderIds: [senderJid],
                args,
                query,
                targets: [...new Set(targets)],
                meta,
                reply
            };

            try {
                await cmdObj.fn(c);
            } catch (e) {
                console.log(`Error en /${commandName}:`, e);
                reply('❌ Error al ejecutar el comando.');
            }
        }
    });
}

startBot();
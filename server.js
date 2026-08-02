'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const MAX_BODY = 32 * 1024;
const rate = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8'
};

const WHATSAPP = 'https://wa.me/393477050250?text=';

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'"
  });
  res.end(body);
}

function clientId(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
}

function allowed(req) {
  const id = clientId(req), now = Date.now(), windowMs = 60_000, max = 30;
  const item = rate.get(id) || { start: now, count: 0 };
  if (now - item.start > windowMs) { item.start = now; item.count = 0; }
  item.count += 1; rate.set(id, item);
  return item.count <= max;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0, chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) { reject(new Error('BODY_TOO_LARGE')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9€+\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasAny(text, words) { return words.some(word => text.includes(word)); }

function answer(message) {
  const q = normalize(message);

  if (!q) return 'Scrivi una domanda sul servizio Wedding Tattoo Experience.';

  if (hasAny(q, ['ciao', 'salve', 'buongiorno', 'buonasera', 'hey'])) {
    return 'Ciao! Posso aiutarti con prezzi, pacchetti, funzionamento, sicurezza, aftercare e contatti. Per verificare una data o ricevere un preventivo definitivo, ti metto subito in contatto con lo staff.';
  }

  if (hasAny(q, ['bronze', '790'])) {
    return 'Il pacchetto Bronze costa 790 € + IVA. Comprende allestimento base, roll-up personalizzato, flash selezionati, 1 artista tatuatore, kit aftercare basic e assistenza dedicata. Dettagli finali e disponibilità vanno confermati con lo staff.';
  }
  if (hasAny(q, ['silver', '1090', '1.090'])) {
    return 'Il pacchetto Silver costa 1.090 € + IVA. Comprende allestimento completo, roll-up e fondale, flash premium, 2 artisti tatuatori, kit aftercare premium, assistenza dedicata e welcome sign personalizzato.';
  }
  if (hasAny(q, ['gold', '1690', '1.690'])) {
    return 'Il pacchetto Gold costa 1.690 € + IVA. È l’esperienza più completa: allestimento Deluxe, roll-up, fondale e luci, flash esclusivi, 2 artisti senior, kit aftercare premium, welcome sign personalizzato, servizio foto dedicato e assistenza prioritaria.';
  }
  if (hasAny(q, ['prezzo', 'prezzi', 'quanto costa', 'costo', 'pacchetti', 'offerta'])) {
    return 'Sono disponibili tre pacchetti: Bronze 790 € + IVA, Silver 1.090 € + IVA e Gold 1.690 € + IVA. Ogni proposta è personalizzabile; il preventivo definitivo viene confermato dallo staff.';
  }

  if (hasAny(q, ['come funziona', 'funzionamento', 'organizzate', 'svolge', 'servizio'])) {
    return 'Il percorso è semplice: primo contatto per capire evento e spazi, definizione del pacchetto, allestimento del corner durante il matrimonio e consegna del kit aftercare a ogni ospite tatuato. Il team gestisce tutto con discrezione e professionalità.';
  }
  if (hasAny(q, ['comprende', 'incluso', 'inclusi', 'cosa include'])) {
    return 'Il servizio può comprendere allestimento, roll-up, fondale, selezione flash, uno o più tatuatori, kit aftercare e assistenza. La dotazione precisa dipende dal pacchetto scelto.';
  }
  if (hasAny(q, ['quanto dura', 'tempo', 'minuti', 'veloce'])) {
    return 'I tatuaggi proposti sono piccoli e rapidi. In genere richiedono circa 5–15 minuti, ma il tempo effettivo dipende dal disegno e dalla zona scelta.';
  }
  if (hasAny(q, ['quanti tatuaggi', 'numero tatuaggi', 'quante persone', 'quanti ospiti'])) {
    return 'Il numero di tatuaggi realizzabili dipende dalla durata dell’evento, dai disegni scelti e dal numero di artisti presenti. Per una stima attendibile servono data, orari e numero indicativo di ospiti interessati.';
  }

  if (hasAny(q, ['maggiorenne', 'maggiorenni', '18', 'eta', 'documento', 'minorenne'])) {
    return 'Possono tatuarsi esclusivamente persone maggiorenni, con documento di identità valido. Non vengono eseguiti tatuaggi sui minorenni.';
  }
  if (hasAny(q, ['dove tatuate', 'zone', 'mani', 'dita', 'collo', 'viso', 'testa', 'fineline'])) {
    return 'Per motivi estetici e professionali non vengono tatuati mani, dita, collo, viso o testa. Il servizio non propone fineline; lo staff aiuta a scegliere una zona adatta e sicura.';
  }
  if (hasAny(q, ['sicuro', 'sicurezza', 'igiene', 'sterile', 'sterilizzazione', 'monouso', 'normative'])) {
    return 'Sì. Vengono utilizzati materiali monouso e certificati, barriere protettive e procedure igieniche professionali. Le superfici e le attrezzature sono preparate e sanificate secondo le procedure previste.';
  }
  if (hasAny(q, ['male', 'dolore', 'doloroso'])) {
    return 'Il dolore è soggettivo, ma i flash sono piccoli e veloci e risultano generalmente ben tollerati. Per dubbi sanitari specifici è sempre meglio confrontarsi con un medico e con lo staff.';
  }
  if (hasAny(q, ['aftercare', 'cura', 'guarigione', 'crema', 'lavare'])) {
    return 'Ogni tatuaggio include indicazioni di cura e kit aftercare. In generale va lavato delicatamente, idratato con il prodotto indicato, protetto da sole, mare e piscina durante la guarigione e non va grattato.';
  }

  if (hasAny(q, ['data', 'disponibile', 'disponibilita', 'prenotare', 'prenotazione', 'preventivo'])) {
    return 'Per verificare la disponibilità o ricevere un preventivo servono: data dell’evento, località, orari indicativi e numero stimato di ospiti interessati. Invia queste informazioni su WhatsApp al 347 7050250.';
  }
  if (hasAny(q, ['trasferta', 'fuori', 'distanza', 'localita', 'dove venite'])) {
    return 'Le trasferte e le condizioni logistiche vengono valutate caso per caso. Scrivi allo staff indicando località, data e orari dell’evento per ricevere una conferma precisa.';
  }
  if (hasAny(q, ['personalizzato', 'personalizzare', 'disegno mio', 'idea personale', 'flash'])) {
    return 'Sono disponibili numerosi flash piccoli, eleganti e adatti all’evento. Eventuali richieste personalizzate devono essere concordate prima con lo staff e valutate in base a dimensione, stile e tempi.';
  }

  if (hasAny(q, ['whatsapp', 'telefono', 'contatto', 'chiamare', 'instagram', 'sito', 'indirizzo', 'dove siete'])) {
    return 'Puoi contattarci al telefono 011 232456 o su WhatsApp al 347 7050250. Instagram: @tattoo.beautycondove. Sito: www.tattoobeautysaloon.it. Siamo in Via Torino 1A, 10055 Condove (TO).';
  }

  if (hasAny(q, ['grazie', 'perfetto', 'ok', 'va bene'])) {
    return 'Con piacere! Per disponibilità, preventivo definitivo o richieste personalizzate puoi scrivere direttamente allo staff su WhatsApp al 347 7050250.';
  }

  return 'Posso rispondere a domande su prezzi, pacchetti, funzionamento, tempi, sicurezza, zone tatuabili e aftercare. Per questa richiesta specifica è meglio parlare direttamente con lo staff su WhatsApp al 347 7050250.';
}

async function handleChat(req, res) {
  if (!allowed(req)) return json(res, 429, { error: 'Troppe richieste. Riprova tra un minuto.' });
  let payload;
  try { payload = JSON.parse(await readBody(req)); }
  catch (e) { return json(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { error: 'Richiesta non valida.' }); }
  const message = typeof payload.message === 'string' ? payload.message.trim().slice(0, 600) : '';
  if (!message) return json(res, 400, { error: 'Scrivi un messaggio.' });
  return json(res, 200, { reply: answer(message), mode: 'guided' });
}

function serveFile(req, res) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400); return res.end('Bad Request'); }
  if (pathname === '/') pathname = '/index.html';
  const file = path.resolve(ROOT, '.' + pathname);
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not Found'); }
    const ext = path.extname(file).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
    };
    headers['Cache-Control'] = ext === '.html' ? 'no-cache' : 'public, max-age=604800, immutable';
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') return json(res, 200, { ok: true, chatConfigured: true, mode: 'guided-no-api' });
  if (req.method === 'POST' && req.url === '/api/chat') return handleChat(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end('Method Not Allowed'); }
  serveFile(req, res);
});

server.listen(PORT, '0.0.0.0', () => console.log(`Wedding Book guided assistant running on port ${PORT}`));

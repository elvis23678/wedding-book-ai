'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini';
const MAX_BODY = 32 * 1024;
const rate = new Map();

const FACTS = `
Sei l'assistente virtuale ufficiale di Wedding Tattoo Experience by Tattoo Beauty Saloon.
Rispondi sempre in italiano, in modo elegante, chiaro e breve. Non inventare mai disponibilità, promesse, tempi, dettagli contrattuali o condizioni non elencate.

INFORMAZIONI CERTE:
- Servizio tattoo professionale durante matrimoni ed eventi.
- Il servizio comprende allestimento, roll-up, fondale, flash disponibili, kit aftercare e assistenza.
- Pacchetti: Bronze 790 € + IVA; Silver 1.090 € + IVA; Gold 1.690 € + IVA. I dettagli finali e le personalizzazioni vanno confermati dallo staff.
- Si tatuano esclusivamente persone maggiorenni con documento valido.
- Non si tatuano mani, dita, collo, viso o testa. Non viene proposto fineline.
- Si utilizzano materiali monouso e procedure igieniche professionali.
- Ogni tatuaggio include indicazioni e kit aftercare.
- Per disponibilità della data, preventivo definitivo, numero di tatuaggi eseguibili o richieste personalizzate, invita a contattare direttamente lo staff.

CONTATTI:
Tattoo Beauty Saloon, Via Torino 1A, 10055 Condove (TO).
Telefono: 011 232456.
WhatsApp: 347 7050250.
Instagram: @tattoo.beautycondove.
Sito: www.tattoobeautysaloon.it.

REGOLE:
- Non presentarti come ChatGPT: sei “Assistente Wedding Tattoo Experience”.
- Non fornire diagnosi o consigli medici; per dubbi sanitari invita a rivolgersi a un medico e allo staff.
- Se la richiesta riguarda una data o un preventivo, chiedi data, località e numero indicativo di invitati interessati, poi invita a inviare tutto su WhatsApp.
- Non raccogliere dati sensibili. Non chiedere documenti in chat.
- Concludi le risposte commerciali con un invito discreto a WhatsApp quando utile.
`;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8'
};

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
  const id = clientId(req), now = Date.now(), windowMs = 60_000, max = 12;
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

function extractText(data) {
  if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
  const parts = [];
  for (const item of data.output || []) {
    for (const c of item.content || []) {
      if ((c.type === 'output_text' || c.type === 'text') && c.text) parts.push(c.text);
    }
  }
  return parts.join('\n').trim();
}

async function handleChat(req, res) {
  if (!allowed(req)) return json(res, 429, { error: 'Troppe richieste. Riprova tra un minuto.' });
  if (!OPENAI_API_KEY) return json(res, 503, { error: 'La chat AI non è ancora configurata.' });
  let payload;
  try { payload = JSON.parse(await readBody(req)); }
  catch (e) { return json(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { error: 'Richiesta non valida.' }); }
  const message = typeof payload.message === 'string' ? payload.message.trim().slice(0, 600) : '';
  if (!message) return json(res, 400, { error: 'Scrivi un messaggio.' });
  const history = Array.isArray(payload.history) ? payload.history.slice(-8).map(x => ({
    role: x && x.role === 'assistant' ? 'assistant' : 'user',
    content: String(x && x.content || '').slice(0, 800)
  })) : [];

  try {
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        instructions: FACTS,
        input: [...history, { role: 'user', content: message }],
        max_output_tokens: 380,
        store: false
      }),
      signal: AbortSignal.timeout(25_000)
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('OpenAI error', r.status, data && data.error && data.error.message);
      return json(res, 502, { error: 'Assistente momentaneamente non disponibile.' });
    }
    const reply = extractText(data) || 'Questa richiesta necessita di una conferma del nostro staff. Scrivici su WhatsApp al 347 7050250.';
    return json(res, 200, { reply });
  } catch (e) {
    console.error('Chat request failed:', e.message);
    return json(res, 502, { error: 'Assistente momentaneamente non disponibile.' });
  }
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
  if (req.method === 'GET' && req.url === '/health') return json(res, 200, { ok: true, chatConfigured: Boolean(OPENAI_API_KEY) });
  if (req.method === 'POST' && req.url === '/api/chat') return handleChat(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end('Method Not Allowed'); }
  serveFile(req, res);
});

server.listen(PORT, '0.0.0.0', () => console.log(`Wedding Book running on port ${PORT}`));

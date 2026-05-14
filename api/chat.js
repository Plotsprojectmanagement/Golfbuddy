// Vercel serverless function — proxy to Anthropic API
// POST /api/chat  body: { messages: [{role, content}, ...] }
// content may be a string OR an array of blocks ({type:"text"|"image", ...})
// Returns: { reply: "..." }
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
let SYSTEM_PROMPT;
try {
  SYSTEM_PROMPT = readFileSync(join(__dirname, 'system-prompt.txt'), 'utf8');
} catch (e) {
  SYSTEM_PROMPT = 'Je bent een Nederlandse golfregel-expert. Help de speler met de Rules of Golf 2023 (NGF). Geef alle relevante opties met strafslagen, citeer regelnummers, adviseer de beste optie. Antwoord beknopt en in het Nederlands.';
  console.error('Could not load system-prompt.txt, using fallback:', e.message);
}

const DEFAULT_ALLOWED_ORIGINS = [
  'https://regelcaddy.app',
  'https://www.regelcaddy.app',
  'https://golfbuddy-seven.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173',
  'capacitor://localhost',
  'ionic://localhost',
];

const DAILY_LIMIT = Number(process.env.RATE_LIMIT_PER_DAY || 50);

function getAllowedOrigins() {
  if (process.env.ALLOWED_ORIGINS) {
    return process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
  }
  return DEFAULT_ALLOWED_ORIGINS;
}

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return xff.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

async function checkRateLimit(ip) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return { allowed: true, count: 0, limit: DAILY_LIMIT, disabled: true };

  const today = new Date().toISOString().slice(0, 10);
  const key = `rl:${ip}:${today}`;

  try {
    const res = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify([
        ['INCR', key],
        ['EXPIRE', key, 90000]
      ])
    });
    if (!res.ok) {
      console.error('Upstash error:', res.status, await res.text());
      return { allowed: true, count: 0, limit: DAILY_LIMIT, disabled: true };
    }
    const data = await res.json();
    const count = Number(data[0]?.result || 0);
    return { allowed: count <= DAILY_LIMIT, count, limit: DAILY_LIMIT };
  } catch (err) {
    console.error('Rate-limit check failed:', err);
    return { allowed: true, count: 0, limit: DAILY_LIMIT, disabled: true };
  }
}

function sanitizeBlock(block) {
  if (!block || typeof block !== 'object') return null;
  if (block.type === 'text' && typeof block.text === 'string') {
    return { type: 'text', text: block.text.slice(0, 8000) };
  }
  if (block.type === 'image' && block.source && block.source.type === 'base64') {
    const mt = block.source.media_type;
    const data = block.source.data;
    const okMt = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mt);
    if (okMt && typeof data === 'string' && data.length < 7_000_000) {
      return { type: 'image', source: { type: 'base64', media_type: mt, data } };
    }
  }
  return null;
}

function sanitizeMessage(m) {
  if (!m || (m.role !== 'user' && m.role !== 'assistant')) return null;
  if (typeof m.content === 'string') {
    return { role: m.role, content: m.content.slice(0, 8000) };
  }
  if (Array.isArray(m.content)) {
    const blocks = m.content.map(sanitizeBlock).filter(Boolean);
    if (blocks.length === 0) return null;
    return { role: m.role, content: blocks };
  }
  return null;
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const allowedOrigins = getAllowedOrigins();
  const originAllowed = allowedOrigins.includes(origin) || origin === '';

  if (originAllowed && origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-App-Token');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!originAllowed) {
    console.warn('Blocked origin:', origin);
    return res.status(403).json({ error: 'Origin niet toegestaan' });
  }

  const expectedToken = process.env.APP_TOKEN;
  if (expectedToken) {
    const sentToken = req.headers['x-app-token'];
    if (sentToken !== expectedToken) {
      console.warn('Bad/missing X-App-Token');
      return res.status(403).json({ error: 'Onjuiste app-token' });
    }
  }

  const ip = getClientIp(req);
  const rl = await checkRateLimit(ip);
  res.setHeader('X-RateLimit-Limit', String(rl.limit));
  res.setHeader('X-RateLimit-Used', String(rl.count));
  if (!rl.allowed) {
    return res.status(429).json({
      error: `Je hebt je daglimiet van ${rl.limit} vragen bereikt. Probeer het morgen weer.`
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY niet ingesteld op de server.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch { return res.status(400).json({ error: 'Ongeldige JSON.' }); }
  }

  const messages = Array.isArray(body && body.messages) ? body.messages : null;
  if (!messages || messages.length === 0) {
    return res.status(400).json({ error: 'Geen berichten meegegeven.' });
  }

  const cleanMessages = messages.map(sanitizeMessage).filter(Boolean).slice(-30);

  if (cleanMessages.length === 0 || cleanMessages[cleanMessages.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'Laatste bericht moet van de gebruiker zijn.' });
  }

  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: cleanMessages
      })
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error('Anthropic API error:', anthropicRes.status, errText);
      return res.status(502).json({ error: 'Anthropic API fout (' + anthropicRes.status + ')' });
    }

    const data = await anthropicRes.json();
    const reply = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();

    return res.status(200).json({ reply: reply || '(leeg antwoord)' });
  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: 'Server-fout: ' + err.message });
  }
}

export const config = { api: { bodyParser: { sizeLimit: '6mb' } } };

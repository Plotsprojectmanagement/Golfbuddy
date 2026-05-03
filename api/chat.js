// Vercel serverless function — proxy to Anthropic API
// POST /api/chat  body: { messages: [{role, content}, ...] }
// Returns: { reply: "..." }
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Load system prompt from sibling file at cold-start
const __dirname = dirname(fileURLToPath(import.meta.url));
let SYSTEM_PROMPT;
try {
  SYSTEM_PROMPT = readFileSync(join(__dirname, 'system-prompt.txt'), 'utf8');
} catch (e) {
  SYSTEM_PROMPT = 'Je bent een Nederlandse golfregel-expert. Help de speler met de Rules of Golf 2023 (NGF). Geef alle relevante opties met strafslagen, citeer regelnummers, adviseer de beste optie. Antwoord beknopt en in het Nederlands.';
  console.error('Could not load system-prompt.txt, using fallback:', e.message);
}

export default async function handler(req, res) {
  // CORS — handy if testing from other origins
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

  // Filter to valid roles, trim oversize content, keep last 30 turns
  const cleanMessages = messages
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content.slice(0, 8000) }))
    .slice(-30);

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

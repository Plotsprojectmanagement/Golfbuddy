# Golfregels Caddie

Mobielvriendelijke chatbot die je tijdens een ronde golf helpt om de Rules of Golf 2023 (NGF, Nederlandse vertaling) toe te passen op jouw situatie. De bot geeft alle geldige opties, citeert regelnummers, en adviseert de procedure die jou maximaal bevoordeelt.

## Wat zit erin

```
golfregels-app/
├── index.html              ← Mobiele chat-UI (groen, PWA-ready)
├── manifest.webmanifest    ← Voor "Add to Home Screen"
├── sw.js                   ← Service worker (offline app-shell)
├── icon-192.png            ← App-icoon
├── icon-512.png            ← App-icoon hi-res
├── api/
│   ├── chat.js             ← Vercel serverless function → Anthropic API
│   └── system-prompt.txt   ← De systeemprompt (hier aanpassen!)
├── system-prompt.md        ← Markdown-kopie ter referentie/leesbaarheid
├── package.json
├── vercel.json             ← Bevat includeFiles config voor de prompt
├── .env.example
└── .gitignore
```

## Snel deployen op Vercel

### Vereisten
- Een Anthropic API-key (https://console.anthropic.com → Settings → API Keys)
- Een gratis Vercel-account (https://vercel.com)
- Node.js 18+ lokaal (alleen nodig voor `vercel dev`)

### Optie A — Via de Vercel CLI (snelste)

```bash
# 1. Installeer Vercel CLI globaal
npm i -g vercel

# 2. Ga naar de projectmap
cd golfregels-app

# 3. Eerste keer: link het project en log in
vercel login
vercel link

# 4. Zet je API-key als secret
vercel env add ANTHROPIC_API_KEY
# → Plak je key, kies "Production, Preview, Development"

# 5. Deploy naar productie
vercel --prod
```

Na de deploy krijg je een URL als `https://golfregels-caddie-xyz.vercel.app`. Open die op je telefoon en je bent klaar.

### Optie B — Via de Vercel-website (geen CLI)

1. Push deze map naar een nieuwe GitHub-repo (privé mag).
2. Ga naar https://vercel.com/new en importeer de repo.
3. Bij **Environment Variables** voeg toe: `ANTHROPIC_API_KEY` = jouw key.
4. Klik **Deploy**.

## App op je telefoon zetten (PWA)

Open de URL in **Safari** (iPhone) of **Chrome** (Android) en tik op "Delen → Voeg toe aan beginscherm". De app verschijnt dan als een echt icoon, opent fullscreen, en de UI laadt zonder vertraging — handig op de baan met wisselende verbinding.

## Lokaal testen

```bash
cp .env.example .env.local
# vul ANTHROPIC_API_KEY in

npm i -g vercel    # eenmalig
vercel dev         # opent http://localhost:3000
```

## De systeemprompt aanpassen

De systeemprompt staat in `api/system-prompt.txt`. De serverless functie laadt dit bestand bij cold-start. Aanpassen?

1. Bewerk `api/system-prompt.txt` (gewone tekst, geen code).
2. Re-deploy: `vercel --prod`.

`vercel.json` zorgt via `functions.includeFiles` dat het tekstbestand mee wordt gebundeld in de Vercel-functie. Vergeet die config niet als je het bestand verplaatst.

Tips:
- Voeg lokale baan-regels toe (bijv. NGF Lokale Regel E-5 op jouw thuisclub).
- Wil je een PDF van de officiële NGF-regels meenemen? Knip de tekst, voeg toe aan de systeemprompt of upload als RAG-document via de Anthropic Files API (vereist iets meer code).
- Pas de toon of het advies-stijl aan naar wens.

## Model wisselen

Default model is `claude-sonnet-4-6`. Wil je goedkoper/sneller? Zet in Vercel env-vars:

```
ANTHROPIC_MODEL=claude-haiku-4-5-20251001
```

Of juist meer redeneerkracht: `claude-opus-4-6`.

## Kosten-indicatie

Per gespreksronde gebruikt de app rond de 1500–2500 input-tokens (systeemprompt + geschiedenis) en 200–600 output-tokens. Met Sonnet 4.6 is dat ongeveer **€0,01–€0,03 per vraag**. Met Haiku 4.5 ongeveer **€0,003 per vraag**.

## Belangrijk

De app is **informatief**. Tijdens een wedstrijd ben je zelf verantwoordelijk voor de juiste procedure. Bij twi
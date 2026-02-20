# Frontend

Built with Vanilla JS, HTML, CSS. No framework — intentional for hackathon speed.
See `docs/frontend-design.md` for full design.

## Structure

```
frontend/
├── index.html        ← Single HTML shell, scripts loaded at bottom
├── app.js            ← Entry point, global state, page routing
├── pages/            ← Full-page views (home, game, results)
├── components/       ← Reusable UI pieces (map, audio player, clue card)
├── styles/           ← CSS files
└── utils/
    ├── api.js        ← All backend fetch calls
    ├── geo.js        ← Geolocation wrappers
    └── audio.js      ← Web Audio API wrapper (positional sound)
```

## Dev Server

```
npx serve .
# or just open index.html directly in Chrome
```

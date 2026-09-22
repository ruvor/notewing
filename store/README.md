# Release kit — Notewing 1.0.0

`npm run package` builds and writes `release/notewing-web-1.0.0.zip`. Screenshots and GIF:
`npm run media`; link preview images: `npm run promo`; icons: `npm run icons`.

| File | What |
|---|---|
| `../release/notewing-web-1.0.0.zip` | The built app for self-hosting (GitHub Release asset) |
| [github-release-v1.0.0.md](github-release-v1.0.0.md) | GitHub Release text |
| `social-preview.png` | GitHub *Settings → Social preview* (1280×640) |
| `../public/og.png` | Link preview image served with the app |
| `../docs/screenshots/{en,ru}/` | Screenshots 1280×800 (06-phone is 390×780 @2x) |

## GitHub repository settings

- **Description:** Markdown notes in your own GitHub repository. No server, works offline. The continuation of BatNoter.
- **Website:** https://perruer.github.io/notewing/
- **Topics:** `notes`, `note-taking`, `markdown`, `markdown-editor`, `github`, `pwa`, `offline-first`, `batnoter`, `codemirror`, `preact`
- **Pages:** *Settings → Pages → Source:* **GitHub Actions** (the workflow `.github/workflows/pages.yml` deploys on every push to `main`)
- **Sponsorships:** tick *Settings → General → Features → Sponsorships* (FUNDING.yml)
- **Social preview:** upload `store/social-preview.png`

## Checklist

1. [ ] `npm ci && npm test && npm run test:e2e && npm run package`
2. [ ] Create `github.com/Perruer/notewing`, push `main` and tag `v1.0.0`
3. [ ] Enable Pages (GitHub Actions), wait for the deploy, open https://perruer.github.io/notewing/
4. [ ] Live check on the deployed site with a test repository (`test/e2e/live.mjs` runs the same flows locally)
5. [ ] GitHub Release `v1.0.0` with `notewing-web-1.0.0.zip`
6. [ ] Repository description, website, topics, social preview, Sponsorships

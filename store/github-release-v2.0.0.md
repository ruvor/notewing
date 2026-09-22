<!--
GitHub Release
  Tag:    v2.0.0
  Title:  Notewing 2.0.0 — Markdown notes in your GitHub, no server
  Assets: release/notewing-web-2.0.0.zip
Body below the line.
-->

**Notewing** is a notes app that keeps every note as a Markdown file in your own GitHub repository. It runs entirely in the browser and talks to `api.github.com` directly: there is no Notewing server and no account to create. It works offline and can be installed as an app.

This is the first release of Notewing (the version continues BatNoter 1.x), a rewrite of [BatNoter](https://github.com/batnoter/batnoter), whose server (batnoter.com) has been offline since 2022. **Existing BatNoter repositories work as is.**

![Notewing demo](https://raw.githubusercontent.com/Perruer/notewing/main/docs/demo.gif)

## Open it

- **Web app:** https://perruer.github.io/notewing/ (press *Try the demo* to look around without a token)
- **Install as an app:** the install icon in the Chrome / Edge address bar, *Add to Home Screen* on Android and iPhone
- **Self-host:** download **`notewing-web-2.0.0.zip`** below and put the `notewing` folder on any static host (HTTPS). No server-side code or configuration.

To connect your notes you need a repository and a [fine-grained token](https://github.com/settings/personal-access-tokens/new?name=Notewing&contents=write) with *Contents: Read and write* for that one repository. Step by step: [README → Get started](https://github.com/Perruer/notewing#get-started).

## Highlights

- Plain `.md` files in a repository you own; every save is a commit
- Offline: edits are stored in the browser and pushed later; conflicts keep both versions
- Instant full-text search (Ctrl+K)
- Paste or drop screenshots, stored in the repository and shown even from private repos
- Editor, split view or preview; tick tasks in the preview; syntax highlighting
- Version history with restore; drag and drop; rename and move notes and folders
- Focus mode, dark theme, English / Russian / Chinese interface
- No analytics, no tracking; notes are sanitised and the page has a strict CSP

Full list: [CHANGELOG.md](https://github.com/Perruer/notewing/blob/main/CHANGELOG.md)

## Support the project

Notewing is free and has no ads. If it is useful to you, you can support it on **[Boosty](https://boosty.to/mikio_kuroki/donate)** or with crypto (TRON, Ethereum/EVM, TON). The addresses are in the [README](https://github.com/Perruer/notewing#support-the-project).

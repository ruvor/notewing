# Privacy

Notewing has no server and collects nothing.

- **Where the app runs.** Notewing is a set of static files (HTML, JavaScript, CSS). The official
  copy is served by GitHub Pages from https://perruer.github.io/notewing/. After it is loaded, the app
  runs entirely in your browser.
- **Where your data goes.** The app sends requests only to `api.github.com`, with your token, to
  read and write the repository you chose. Nothing is sent to the Notewing author or anyone else.
  Images inside notes that point to other websites are loaded from those websites, like on any web
  page.
- **What is stored on your device.** The token and the repository name (in `localStorage`, or in
  `sessionStorage` if you untick *Remember on this device*), your settings, a copy of the notes and
  queued changes (in IndexedDB), and the app files for offline use (service worker cache).
  *Settings → Disconnect* removes the token and the local copy of the notes.
- **What is not collected.** No analytics, no telemetry, no cookies, no advertising, no crash reports.
- **GitHub.** Your notes are stored by GitHub under GitHub's own terms and privacy statement.
  GitHub Pages may log the IP addresses of visitors who load the app files.
- **Demo mode** keeps the sample notes in the page's memory; it makes no network requests at all.

Questions: https://github.com/Perruer/notewing/issues

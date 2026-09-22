# Changelog

## 2.0.0 — 2026-09-22

First release of Notewing (2.0.0 continues the version numbers of BatNoter 1.x), a rewrite of [BatNoter](https://github.com/batnoter/batnoter) that no
longer needs the BatNoter server.

- Runs in the browser and talks to the GitHub REST API directly; sign in with a fine-grained token
  limited to one repository
- Works with existing BatNoter repositories: any `.md` file in the repository is a note
- Offline: local copy in IndexedDB, changes queued offline and pushed later, service worker,
  installable PWA
- Sync: one commit per push through the Git Data API, remote changes merged file by file, both
  versions kept when a note was edited in two places, retry when the branch moves
- Editor (CodeMirror 6) with editor / split / preview modes, toolbar, shortcuts, syntax highlighting
- Full-text search (Ctrl+K), which can also create a note
- Paste or drop images; they are stored in `assets/` and shown in the preview, also from private
  repositories
- Task lists that can be ticked in the preview
- Version history of a note with restore
- Rename, move and delete notes and folders; drag and drop; undo for deletion
- Focus mode, light and dark themes, English, Russian and Simplified Chinese interface
- Demo mode with sample notes, no token needed
- Notes are sanitised with DOMPurify; strict Content Security Policy

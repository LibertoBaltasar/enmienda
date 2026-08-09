# Enmienda — Implementation Plan

> **For Hermes:** Execute tasks sequentially. Commit after each task. TDD throughout.

**Goal:** Build a Markdown editor with granular diff/merge for literary editing workflows — a "Git for writers" that doesn't require knowing Git.

**Architecture:** Tauri v2 desktop app (Rust backend + webview frontend). Frontend uses CodeMirror 6 for editing with Yjs CRDT for local-first version history and diff tracking. The core innovation: paragraph-level diff visualization and selective merge (accept/reject individual paragraph changes between versions).

**Tech Stack:** Tauri v2, TypeScript, Vite, CodeMirror 6, Yjs (CRDT), y-codemirror

---

## Phase 1: Project Scaffold

### Task 1.1: Initialize Vite + TypeScript frontend
- Create Vite project with vanilla-ts template
- Configure for Tauri (no server, static build)
- Verify `npm run build` works

### Task 1.2: Initialize Tauri v2 backend
- Add Tauri to the Vite project
- Configure tauri.conf.json (window size, title, permissions)
- Verify `cargo tauri dev` launches a blank window

### Task 1.3: Install core dependencies
- codemirror, @codemirror/lang-markdown, @codemirror/view, @codemirror/state
- yjs, y-codemirror.next
- Verify imports work

---

## Phase 2: Core Editor

### Task 2.1: Basic Markdown editor
- Single pane CodeMirror with Markdown syntax highlighting
- Dark theme, monospace font
- Line numbers, line wrapping

### Task 2.2: Yjs document integration
- Create Y.Doc on editor mount
- Bind CodeMirror to Yjs via y-codemirror
- Verify edits sync to Yjs document

### Task 2.3: Local persistence (IndexedDB)
- Persist Yjs document to IndexedDB via y-indexeddb
- Auto-save on every change
- Verify document survives page reload

---

## Phase 3: Version History

### Task 3.1: Snapshot system
- Take Yjs snapshots at user-defined checkpoints
- Store snapshot metadata (timestamp, label, word count)
- List snapshots in sidebar

### Task 3.2: Snapshot comparison (diff)
- Compute diff between current document and any snapshot
- Render diff using CodeMirror's merge view or custom approach
- Show additions (green), deletions (red), unchanged (dim)

---

## Phase 4: Granular Merge (the killer feature)

### Task 4.1: Paragraph-level diff
- Parse document into paragraphs (split on double newline)
- Compute paragraph-by-paragraph diff using diff_match_patch or similar
- Show each paragraph as a "card" with visual change indicators

### Task 4.2: Selective accept/reject
- Each changed paragraph shows [Accept] [Reject] buttons
- Accept = apply that paragraph's changes to current doc
- Reject = keep current version for that paragraph
- Changes apply individually, not all-or-nothing

### Task 4.3: Merge UI
- Side-by-side view: left = current, right = snapshot version
- Changed paragraphs highlighted with background color
- Accept/reject controls per paragraph
- "Accept all" / "Reject all" global buttons

---

## Phase 5: Polish & Export

### Task 5.1: File system integration
- Open .md files from disk
- Save current document to disk
- "Save as" with file picker
- Auto-detect external changes

### Task 5.2: Export formats
- Export document as .md
- Export diff as .md with highlights
- Export merge result as clean .md

### Task 5.3: UI polish
- Keyboard shortcuts (Ctrl+S save, Ctrl+Z undo via Yjs)
- Status bar (word count, last saved, snapshot count)
- Dark/light theme toggle
- Spanish UI (menús en español)

---

## Verification

After Phase 4, the app should:
1. Open and edit Markdown files ✓
2. Create named snapshots at any point ✓
3. Compare current version against any snapshot ✓
4. Show paragraph-level diffs with accept/reject ✓
5. Persist everything locally, no server needed ✓

**MVP complete.** Then we test with real editorial workflows.

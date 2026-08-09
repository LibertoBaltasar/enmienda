/**
 * editor.ts — Core editor with CodeMirror 6 + Yjs CRDT
 *
 * Architecture:
 *   Y.Doc (in-memory CRDT) ←→ y-indexeddb (persistence)
 *        ↕ (y-codemirror binding)
 *   CodeMirror 6 (UI)
 */

import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import * as Y from 'yjs';
import { yCollab } from 'y-codemirror.next';
import { IndexeddbPersistence } from 'y-indexeddb';

// ── Types ──────────────────────────────────────────────

export interface SnapshotMeta {
  id: string;
  label: string;
  timestamp: number;
  wordCount: number;
}

// ── State ──────────────────────────────────────────────

let editorView: EditorView | null = null;
let ydoc: Y.Doc | null = null;
let ytext: Y.Text | null = null;
let indexeddbProvider: IndexeddbPersistence | null = null;
let snapshots: SnapshotMeta[] = [];
let currentDocName = 'Sin título.md';

// ── Public API ─────────────────────────────────────────

/** Initialize editor in the given container element */
export function initEditor(container: HTMLElement): EditorView {
  // Create Yjs document
  ydoc = new Y.Doc();
  ytext = ydoc.getText('content');

  // Persist to IndexedDB
  indexeddbProvider = new IndexeddbPersistence('enmienda-doc', ydoc);
  indexeddbProvider.on('synced', () => {
    console.log('✅ Documento cargado desde IndexedDB');
    updateWordCount();
  });

  // Create CodeMirror with Yjs binding
  const state = EditorState.create({
    doc: ytext.toString(),
    extensions: [
      basicSetup,
      markdown(),
      oneDark,
      keymap.of([indentWithTab]),
      yCollab(ytext, null), // null = no awareness (single user for now)
      EditorView.updateListener.of(() => {
        updateWordCount();
      }),
    ],
  });

  editorView = new EditorView({
    state,
    parent: container,
  });

  // Load saved snapshots
  loadSnapshots();

  return editorView;
}

/** Get current document content as string */
export function getContent(): string {
  return ytext?.toString() ?? '';
}

/** Get current word count */
export function getWordCount(): number {
  const text = getContent().trim();
  if (!text) return 0;
  return text.split(/\s+/).length;
}

/** Get current document name */
export function getDocName(): string {
  return currentDocName;
}

/** Set document name */
export function setDocName(name: string): void {
  currentDocName = name;
}

// ── Snapshots ──────────────────────────────────────────

/** Create a snapshot of the current document state */
export function createSnapshot(label?: string): SnapshotMeta {
  if (!ydoc) throw new Error('Editor not initialized');

  const content = getContent();
  const snapshot: SnapshotMeta = {
    id: crypto.randomUUID(),
    label: label || `Instantánea ${snapshots.length + 1}`,
    timestamp: Date.now(),
    wordCount: getWordCount(),
  };

  // Store snapshot content in localStorage (keyed by id)
  localStorage.setItem(`snap:${snapshot.id}:content`, content);
  localStorage.setItem(`snap:${snapshot.id}:meta`, JSON.stringify(snapshot));

  snapshots.unshift(snapshot);
  saveSnapshotsList();

  return snapshot;
}

/** Get all snapshots (sorted newest first) */
export function getSnapshots(): SnapshotMeta[] {
  return [...snapshots];
}

/** Get a specific snapshot's content */
export function getSnapshotContent(snapshotId: string): string | null {
  return localStorage.getItem(`snap:${snapshotId}:content`);
}

/** Get a specific snapshot's metadata */
export function getSnapshotMeta(snapshotId: string): SnapshotMeta | null {
  const raw = localStorage.getItem(`snap:${snapshotId}:meta`);
  return raw ? JSON.parse(raw) : null;
}

/** Delete a snapshot */
export function deleteSnapshot(snapshotId: string): void {
  localStorage.removeItem(`snap:${snapshotId}:content`);
  localStorage.removeItem(`snap:${snapshotId}:meta`);
  snapshots = snapshots.filter(s => s.id !== snapshotId);
  saveSnapshotsList();
}

/** Replace entire document content (used for restore and merge) */
export function replaceContent(newContent: string): void {
  if (!ydoc) return;
  ydoc.transact(() => {
    ytext!.delete(0, ytext!.length);
    ytext!.insert(0, newContent);
  });
}

/** Apply a paragraph-level diff acceptance: replace one paragraph */
export function applyParagraphChange(
  paragraphIndex: number,
  newText: string,
  _originalText: string
): void {
  if (!ydoc || !ytext) return;

  const currentText = ytext.toString();
  const paragraphs = currentText.split(/\n\n+/);

  if (paragraphIndex >= paragraphs.length) {
    // Append new paragraph
    const newContent = currentText + (currentText ? '\n\n' : '') + newText;
    replaceContent(newContent);
    return;
  }

  // Replace the specific paragraph
  const oldParagraph = paragraphs[paragraphIndex];
  const startIndex = currentText.indexOf(oldParagraph);
  if (startIndex === -1) return;

  ydoc.transact(() => {
    ytext!.delete(startIndex, oldParagraph.length);
    ytext!.insert(startIndex, newText);
  });
}

// ── Private helpers ────────────────────────────────────

function updateWordCount(): void {
  const el = document.getElementById('word-count');
  if (el) {
    el.textContent = `${getWordCount()} palabras`;
  }
}

function loadSnapshots(): void {
  try {
    const raw = localStorage.getItem('snapshots-list');
    if (raw) {
      snapshots = JSON.parse(raw);
    }
  } catch {
    snapshots = [];
  }
}

function saveSnapshotsList(): void {
  localStorage.setItem('snapshots-list', JSON.stringify(snapshots));
}

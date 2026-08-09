/**
 * main.ts — App entry point
 *
 * Wires together:
 *   - Editor initialization
 *   - Toolbar buttons (snapshot, history)
 *   - Sidebar (snapshot list)
 *   - Merge panel (paragraph-level diff view with accept/reject)
 */

import {
  initEditor,
  createSnapshot,
  getSnapshots,
  getSnapshotContent,
  deleteSnapshot,
  getContent,
  replaceContent,
  applyParagraphChange,
  setDocName,
} from './editor';

// Tauri file system (only available in Tauri, not browser dev)
let tauriDialog: any = null;
let tauriFs: any = null;
async function loadTauriPlugins() {
  try {
    tauriDialog = await import('@tauri-apps/plugin-dialog');
    tauriFs = await import('@tauri-apps/plugin-fs');
    return true;
  } catch {
    console.log('⚠️ Tauri plugins no disponibles (modo navegador)');
    return false;
  }
}

// ── Diff types ─────────────────────────────────────────

type DiffOp = 'unchanged' | 'added' | 'deleted' | 'modified';

interface ParagraphDiff {
  op: DiffOp;
  text: string;
  snapshotText?: string;
  paragraphIndex: number;
  oldText?: string;
}

// ── State ──────────────────────────────────────────────

let currentMergeSnapshotId: string | null = null;
let currentMergeDiffs: ParagraphDiff[] = [];

// ── Init ───────────────────────────────────────────────

async function main(): Promise<void> {
  const container = document.getElementById('editor-container');
  if (!container) throw new Error('No se encontró #editor-container');

  // Try to load Tauri plugins (file dialogs, fs)
  await loadTauriPlugins();

  initEditor(container);

  // Toolbar
  document.getElementById('btn-open')?.addEventListener('click', handleOpen);
  document.getElementById('btn-save')?.addEventListener('click', handleSave);
  document.getElementById('btn-snapshot')?.addEventListener('click', handleSnapshot);
  document.getElementById('btn-history')?.addEventListener('click', toggleSidebar);
  document.getElementById('btn-close-sidebar')?.addEventListener('click', closeSidebar);

  // Merge panel
  document.getElementById('btn-accept-all')?.addEventListener('click', handleAcceptAll);
  document.getElementById('btn-reject-all')?.addEventListener('click', closeMergePanel);
  document.getElementById('btn-close-merge')?.addEventListener('click', closeMergePanel);

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.shiftKey && e.key === 'S') {
      // Ctrl+Shift+S → snapshot
      e.preventDefault();
      handleSnapshot();
    } else if (mod && e.key === 's') {
      // Ctrl+S → save file
      e.preventDefault();
      handleSave();
    } else if (mod && e.key === 'o') {
      // Ctrl+O → open file
      e.preventDefault();
      handleOpen();
    }
  });

  renderSnapshotList();
}

// ── File system handlers ───────────────────────────────

let currentFilePath: string | null = null;

async function handleOpen(): Promise<void> {
  if (!tauriDialog) {
    alert('Abrir archivos solo funciona en la app de escritorio (Tauri).');
    return;
  }

  try {
    const selected = await tauriDialog.open({
      multiple: false,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });

    if (!selected) return; // User cancelled

    const filePath = typeof selected === 'string' ? selected : selected.path;
    const content = await tauriFs.readTextFile(filePath);

    // Create snapshot before loading new file
    if (getContent().trim()) {
      createSnapshot('Auto: antes de abrir archivo');
    }

    replaceContent(content);
    currentFilePath = filePath;

    // Update doc name in toolbar
    const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || 'Sin título.md';
    setDocName(fileName);
    const el = document.getElementById('doc-name');
    if (el) el.textContent = fileName;

    renderSnapshotList();
  } catch (err: any) {
    alert(`Error al abrir archivo: ${err}`);
  }
}

async function handleSave(): Promise<void> {
  if (!tauriFs) {
    alert('Guardar archivos solo funciona en la app de escritorio (Tauri).');
    return;
  }

  try {
    if (!currentFilePath) {
      // No file open yet → show save dialog
      if (!tauriDialog) return;
      const selected = await tauriDialog.save({
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (!selected) return;
      currentFilePath = selected;
    }

    // currentFilePath is guaranteed non-null here
    const savePath = currentFilePath!;
    await tauriFs.writeTextFile(savePath, getContent());

    // Update doc name
    const fileName = savePath.split('/').pop() || savePath.split('\\').pop() || 'Sin título.md';
    setDocName(fileName);
    const el = document.getElementById('doc-name');
    if (el) el.textContent = fileName;

    flashButton('btn-save');
  } catch (err: any) {
    alert(`Error al guardar: ${err}`);
  }
}

// ── Snapshot handlers ──────────────────────────────────

function handleSnapshot(): void {
  const label = prompt('Etiqueta para la instantánea (opcional):');
  createSnapshot(label || undefined);
  renderSnapshotList();
  flashButton('btn-snapshot');
}

// ── Sidebar ────────────────────────────────────────────

function toggleSidebar(): void {
  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    sidebar.classList.toggle('hidden');
    if (!sidebar.classList.contains('hidden')) renderSnapshotList();
  }
}

function closeSidebar(): void {
  document.getElementById('sidebar')?.classList.add('hidden');
}

function renderSnapshotList(): void {
  const list = document.getElementById('snapshot-list');
  if (!list) return;

  const snapshots = getSnapshots();

  if (snapshots.length === 0) {
    list.innerHTML =
      '<p class="empty-state">Sin instantáneas todavía.<br>Crea una con 📸 o Ctrl+S</p>';
    return;
  }

  list.innerHTML = snapshots
    .map(
      (snap) => `
    <div class="snapshot-card" data-id="${snap.id}">
      <div class="snap-time">${formatTime(snap.timestamp)}</div>
      <div class="snap-label">${escapeHtml(snap.label)}</div>
      <div class="snap-words">${snap.wordCount} palabras</div>
      <div class="snap-actions">
        <button class="btn-compare" data-id="${snap.id}">🔍 Comparar</button>
        <button class="btn-restore" data-id="${snap.id}">↩ Restaurar</button>
        <button class="btn-delete-snap" data-id="${snap.id}">🗑</button>
      </div>
    </div>`
    )
    .join('');

  // Compare button
  list.querySelectorAll('.btn-compare').forEach((btn) =>
    btn.addEventListener('click', () => compareWithSnapshot((btn as HTMLElement).dataset.id!))
  );

  // Restore button
  list.querySelectorAll('.btn-restore').forEach((btn) =>
    btn.addEventListener('click', () => {
      const id = (btn as HTMLElement).dataset.id!;
      if (confirm('¿Restaurar esta versión? El contenido actual se reemplazará.')) {
        const content = getSnapshotContent(id);
        if (content) {
          // Create snapshot of current state before restoring
          createSnapshot('Auto: antes de restaurar');
          replaceContent(content);
          renderSnapshotList();
          closeSidebar();
        }
      }
    })
  );

  // Delete button
  list.querySelectorAll('.btn-delete-snap').forEach((btn) =>
    btn.addEventListener('click', () => {
      const id = (btn as HTMLElement).dataset.id!;
      if (confirm('¿Eliminar esta instantánea?')) {
        deleteSnapshot(id);
        renderSnapshotList();
      }
    })
  );
}

// ── Merge panel ────────────────────────────────────────

function compareWithSnapshot(snapshotId: string): void {
  const current = getContent();
  const snapshotContent = getSnapshotContent(snapshotId);
  const meta = getSnapshots().find((s) => s.id === snapshotId);

  if (!snapshotContent) {
    alert('No se encontró el contenido de la instantánea.');
    return;
  }

  currentMergeSnapshotId = snapshotId;
  currentMergeDiffs = computeParagraphDiff(snapshotContent, current);

  // Update merge label
  const label = document.getElementById('merge-label');
  if (label && meta) {
    label.textContent = `${meta.label} (${formatTime(meta.timestamp)})`;
  }

  renderMergeDiffs();
  document.getElementById('merge-panel')?.classList.remove('hidden');
}

function renderMergeDiffs(): void {
  const content = document.getElementById('merge-content');
  if (!content) return;

  content.innerHTML = currentMergeDiffs
    .map(
      (d, i) => `
    <div class="merge-paragraph ${d.op}" data-index="${i}">
      <div class="merge-para-text">${escapeHtml(d.text)}</div>
      ${
        d.op !== 'unchanged'
          ? `
      <div class="merge-para-actions">
        <button class="btn-accept" data-index="${i}">✓ Aceptar</button>
        <button class="btn-reject" data-index="${i}">✗ Rechazar</button>
      </div>`
          : ''
      }
    </div>`
    )
    .join('');

  // Accept button — apply this paragraph's change
  content.querySelectorAll('.btn-accept').forEach((btn) =>
    btn.addEventListener('click', () => {
      const idx = parseInt((btn as HTMLElement).dataset.index!);
      const diff = currentMergeDiffs[idx];
      if (!diff) return;

      if (diff.op === 'added') {
        // Insert new paragraph at position
        appendParagraph(diff.text);
      } else if (diff.op === 'modified' || diff.op === 'deleted') {
        // Replace paragraph
        applyParagraphChange(diff.paragraphIndex, diff.text, diff.oldText || '');
      }

      // Remove this diff from the list
      currentMergeDiffs[idx] = { ...diff, op: 'unchanged' };
      renderMergeDiffs();
    })
  );

  // Reject button — keep current version for this paragraph
  content.querySelectorAll('.btn-reject').forEach((btn) =>
    btn.addEventListener('click', () => {
      const idx = parseInt((btn as HTMLElement).dataset.index!);
      if (currentMergeDiffs[idx]) {
        currentMergeDiffs[idx] = { ...currentMergeDiffs[idx], op: 'unchanged' };
      }
      renderMergeDiffs();
    })
  );
}

function closeMergePanel(): void {
  document.getElementById('merge-panel')?.classList.add('hidden');
  currentMergeSnapshotId = null;
  currentMergeDiffs = [];
}

function handleAcceptAll(): void {
  if (!currentMergeSnapshotId) return;
  const snapshotContent = getSnapshotContent(currentMergeSnapshotId);
  if (snapshotContent) {
    createSnapshot('Auto: antes de aceptar todo');
    replaceContent(snapshotContent);
    renderSnapshotList();
  }
  closeMergePanel();
}

// ── Paragraph-level diff ───────────────────────────────

function computeParagraphDiff(oldText: string, newText: string): ParagraphDiff[] {
  const oldParas = splitParagraphs(oldText);
  const newParas = splitParagraphs(newText);
  const results: ParagraphDiff[] = [];
  const maxLen = Math.max(oldParas.length, newParas.length);

  for (let i = 0; i < maxLen; i++) {
    const oldP = oldParas[i];
    const newP = newParas[i];

    if (oldP === undefined && newP !== undefined) {
      results.push({ op: 'added', text: newP, paragraphIndex: i });
    } else if (newP === undefined && oldP !== undefined) {
      results.push({ op: 'deleted', text: oldP, paragraphIndex: i, oldText: oldP });
    } else if (oldP === newP) {
      results.push({ op: 'unchanged', text: oldP, paragraphIndex: i });
    } else {
      results.push({
        op: 'modified',
        text: newP,
        snapshotText: oldP,
        paragraphIndex: i,
        oldText: oldP,
      });
    }
  }

  return results;
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function appendParagraph(text: string): void {
  const current = getContent();
  const newContent = current + (current ? '\n\n' : '') + text;
  replaceContent(newContent);
}

// ── Helpers ────────────────────────────────────────────

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function flashButton(id: string): void {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.style.transition = 'background 0.15s';
  btn.style.background = 'rgba(233, 69, 96, 0.2)';
  setTimeout(() => {
    btn.style.background = '';
  }, 300);
}

// ── Boot ───────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', main);

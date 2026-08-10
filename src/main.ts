/**
 * main.ts — App entry point (v0.2)
 *
 * Features:
 *   - Code editor (CodeMirror) / Folio view toggle
 *   - Snapshot system with version graph (parent-child DAG)
 *   - Paragraph-level diff & merge
 *   - File open/save via Tauri
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
  setSnapshotParent,
} from './editor';
import { renderFolio } from './folio';

// ── Tauri plugins (lazy) ───────────────────────────────

let tauriDialog: any = null;
let tauriFs: any = null;
async function loadTauriPlugins() {
  try {
    tauriDialog = await import('@tauri-apps/plugin-dialog');
    tauriFs = await import('@tauri-apps/plugin-fs');
  } catch { /* browser mode */ }
}

// ── Diff types ─────────────────────────────────────────
type DiffOp = 'unchanged' | 'added' | 'deleted' | 'modified';
interface ParagraphDiff { op: DiffOp; text: string; snapshotText?: string; paragraphIndex: number; oldText?: string; }

// ── State ──────────────────────────────────────────────
let currentMergeSnapshotId: string | null = null;
let currentMergeDiffs: ParagraphDiff[] = [];
let currentFilePath: string | null = null;
let isFolioMode = false;

// ── Init ───────────────────────────────────────────────

async function main(): Promise<void> {
  const container = document.getElementById('editor-container');
  if (!container) throw new Error('No se encontró #editor-container');

  await loadTauriPlugins();
  initEditor(container);

  // Toolbar buttons
  document.getElementById('btn-open')?.addEventListener('click', handleOpen);
  document.getElementById('btn-save')?.addEventListener('click', handleSave);
  document.getElementById('btn-folio')?.addEventListener('click', toggleFolio);
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
    if (mod && e.shiftKey && e.key === 'S') { e.preventDefault(); handleSnapshot(); }
    else if (mod && e.key === 's') { e.preventDefault(); handleSave(); }
    else if (mod && e.key === 'o') { e.preventDefault(); handleOpen(); }
    else if (mod && e.key === 'f') { e.preventDefault(); toggleFolio(); }
  });

  renderSnapshotList();
  renderVersionGraph();
}

// ── Folio toggle ───────────────────────────────────────

function toggleFolio(): void {
  isFolioMode = !isFolioMode;
  const editorEl = document.getElementById('editor-container')!;
  const folioEl = document.getElementById('folio-view')!;
  const btn = document.getElementById('btn-folio')!;

  if (isFolioMode) {
    editorEl.classList.add('hidden');
    folioEl.classList.remove('hidden');
    btn.classList.add('active');
    btn.textContent = '📝 Código';
    renderFolioView();
  } else {
    editorEl.classList.remove('hidden');
    folioEl.classList.add('hidden');
    btn.classList.remove('active');
    btn.textContent = '📄 Folio';
  }
}

function renderFolioView(): void {
  const el = document.getElementById('folio-view');
  if (!el) return;
  const pages = renderFolio(getContent());
  el.innerHTML = pages.join('');
}

// ── Version graph ──────────────────────────────────────

function renderVersionGraph(): void {
  const el = document.getElementById('version-graph');
  if (!el) return;

  const snaps = getSnapshots();
  if (snaps.length < 2) {
    el.innerHTML = '<p class="empty-state">Grafo de versiones<br>(mínimo 2 instantáneas)</p>';
    return;
  }

  // Build SVG graph (vertical timeline with branches)
  const sorted = [...snaps].sort((a, b) => b.timestamp - a.timestamp);
  const nodeH = 32;
  const padding = 20;
  const width = 260;
  const height = sorted.length * nodeH + 30;

  let svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;

  // Find roots (no parent)
  const parentMap = new Map<string, number>(); // id → y position
  let branchX = 10;

  // Build layers
  // Render oldest first (top), newest last (bottom)
  const reversed = [...sorted].reverse();

  reversed.forEach((snap, i) => {
    const nodeY = padding + i * nodeH + nodeH / 2;
    const x = snap.parentId ? branchX + 30 : branchX;
    parentMap.set(snap.id, nodeY);

    // Draw edge to parent
    if (snap.parentId && parentMap.has(snap.parentId)) {
      const parentY = parentMap.get(snap.parentId)!;
      const midX = x - 15;
      svg += `<path class="graph-edge" d="M${x},${nodeY} L${midX},${nodeY} L${midX},${parentY} L${10},${parentY}"/>`;
    }

    // Draw node
    const color = i === reversed.length - 1 ? 'var(--accent)' : 'var(--green)';
    svg += `<g class="graph-node" data-id="${snap.id}">`;
    svg += `<circle cx="${x}" cy="${nodeY}" r="7" fill="${color}" stroke="var(--border)" stroke-width="1"/>`;
    svg += `<text x="${x + 14}" y="${nodeY + 4}" fill="var(--text)">${escapeXml(snap.label)}</text>`;
    svg += '</g>';
  });

  svg += '</svg>';
  el.innerHTML = svg;

  // Click handlers
  el.querySelectorAll('.graph-node').forEach((node) => {
    node.addEventListener('click', () => {
      const id = (node as HTMLElement).dataset.id!;
      compareWithSnapshot(id);
    });
  });
}

// ── Snapshot handlers ──────────────────────────────────

function handleSnapshot(): void {
  const label = prompt('Etiqueta para la instantánea (opcional):');
  createSnapshot(label || undefined);
  renderSnapshotList();
  renderVersionGraph();
  flashButton('btn-snapshot');
}

// ── Sidebar ────────────────────────────────────────────

function toggleSidebar(): void {
  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    sidebar.classList.toggle('hidden');
    if (!sidebar.classList.contains('hidden')) {
      renderSnapshotList();
      renderVersionGraph();
    }
  }
}

function closeSidebar(): void { document.getElementById('sidebar')?.classList.add('hidden'); }

function renderSnapshotList(): void {
  const list = document.getElementById('snapshot-list');
  if (!list) return;
  const snapshots = getSnapshots();
  if (snapshots.length === 0) {
    list.innerHTML = '<p class="empty-state">Sin instantáneas todavía.<br>Crea una con 📸 o Ctrl+Shift+S</p>';
    return;
  }
  list.innerHTML = snapshots.map((snap) => `
    <div class="snapshot-card">
      <div class="snap-time">${formatTime(snap.timestamp)}</div>
      <div class="snap-label">${escapeHtml(snap.label)}</div>
      <div class="snap-words">${snap.wordCount} palabras</div>
      <div class="snap-actions">
        <button class="btn-compare" data-id="${snap.id}">🔍 Comparar</button>
        <button class="btn-restore" data-id="${snap.id}">↩ Restaurar</button>
        <button class="btn-delete-snap" data-id="${snap.id}">🗑</button>
      </div>
    </div>`).join('');

  list.querySelectorAll('.btn-compare').forEach((btn) =>
    btn.addEventListener('click', () => compareWithSnapshot((btn as HTMLElement).dataset.id!)));
  list.querySelectorAll('.btn-restore').forEach((btn) =>
    btn.addEventListener('click', () => {
      const id = (btn as HTMLElement).dataset.id!;
      if (confirm('¿Restaurar esta versión? Se creará una instantánea de seguridad.')) {
        const content = getSnapshotContent(id);
        if (content) {
          createSnapshot('Auto: antes de restaurar');
          replaceContent(content);
          setSnapshotParent(id); // branch from restored snapshot
          renderSnapshotList();
          renderVersionGraph();
          closeSidebar();
          if (isFolioMode) renderFolioView();
        }
      }
    }));
  list.querySelectorAll('.btn-delete-snap').forEach((btn) =>
    btn.addEventListener('click', () => {
      if (confirm('¿Eliminar esta instantánea?')) {
        deleteSnapshot((btn as HTMLElement).dataset.id!);
        renderSnapshotList();
        renderVersionGraph();
      }
    }));
}

// ── Merge panel ────────────────────────────────────────

function compareWithSnapshot(snapshotId: string): void {
  const current = getContent();
  const snapshot = getSnapshotContent(snapshotId);
  const meta = getSnapshots().find(s => s.id === snapshotId);
  if (!snapshot) { alert('No se encontró el contenido.'); return; }
  currentMergeSnapshotId = snapshotId;
  currentMergeDiffs = computeParagraphDiff(snapshot, current);
  const label = document.getElementById('merge-label');
  if (label && meta) label.textContent = `${meta.label} (${formatTime(meta.timestamp)})`;
  renderMergeDiffs();
  document.getElementById('merge-panel')?.classList.remove('hidden');
}

function renderMergeDiffs(): void {
  const content = document.getElementById('merge-content');
  if (!content) return;
  content.innerHTML = currentMergeDiffs.map((d, i) => `
    <div class="merge-paragraph ${d.op}" data-index="${i}">
      <div class="merge-para-text">${escapeHtml(d.text)}</div>
      ${d.op !== 'unchanged' ? `
      <div class="merge-para-actions">
        <button class="btn-accept" data-index="${i}">✓ Aceptar</button>
        <button class="btn-reject" data-index="${i}">✗ Rechazar</button>
      </div>` : ''}
    </div>`).join('');

  content.querySelectorAll('.btn-accept').forEach((btn) =>
    btn.addEventListener('click', () => {
      const idx = parseInt((btn as HTMLElement).dataset.index!);
      const diff = currentMergeDiffs[idx];
      if (!diff) return;
      if (diff.op === 'added') appendParagraph(diff.text);
      else if (diff.op === 'modified' || diff.op === 'deleted')
        applyParagraphChange(diff.paragraphIndex, diff.text, diff.oldText || '');
      currentMergeDiffs[idx] = { ...diff, op: 'unchanged' };
      renderMergeDiffs();
      if (isFolioMode) renderFolioView();
    }));
  content.querySelectorAll('.btn-reject').forEach((btn) =>
    btn.addEventListener('click', () => {
      const idx = parseInt((btn as HTMLElement).dataset.index!);
      currentMergeDiffs[idx] = { ...currentMergeDiffs[idx], op: 'unchanged' };
      renderMergeDiffs();
    }));
}

function closeMergePanel() { document.getElementById('merge-panel')?.classList.add('hidden'); }
function handleAcceptAll() {
  if (currentMergeSnapshotId) {
    const content = getSnapshotContent(currentMergeSnapshotId);
    if (content) { createSnapshot('Auto: antes de aceptar todo'); replaceContent(content); renderSnapshotList(); renderVersionGraph(); }
  }
  closeMergePanel();
}

// ── File system ────────────────────────────────────────

async function handleOpen() {
  if (!tauriDialog) return alert('Solo disponible en la app de escritorio.');
  try {
    const selected = await tauriDialog.open({ multiple: false, filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (!selected) return;
    const path = typeof selected === 'string' ? selected : selected.path;
    const content = await tauriFs.readTextFile(path);
    if (getContent().trim()) createSnapshot('Auto: antes de abrir');
    replaceContent(content);
    currentFilePath = path;
    const name = path.split('/').pop() || path.split('\\').pop() || 'Sin título.md';
    setDocName(name);
    const el = document.getElementById('doc-name'); if (el) el.textContent = name;
    renderSnapshotList(); renderVersionGraph();
    if (isFolioMode) renderFolioView();
  } catch (e: any) { alert(`Error: ${e}`); }
}

async function handleSave() {
  if (!tauriFs) return alert('Solo disponible en la app de escritorio.');
  try {
    if (!currentFilePath) {
      if (!tauriDialog) return;
      const selected = await tauriDialog.save({ filters: [{ name: 'Markdown', extensions: ['md'] }] });
      if (!selected) return;
      currentFilePath = selected;
    }
    await tauriFs.writeTextFile(currentFilePath!, getContent());
    const name = currentFilePath!.split('/').pop() || currentFilePath!.split('\\').pop() || 'Sin título.md';
    setDocName(name);
    const el = document.getElementById('doc-name'); if (el) el.textContent = name;
    flashButton('btn-save');
  } catch (e: any) { alert(`Error: ${e}`); }
}

// ── Paragraph diff ─────────────────────────────────────

function computeParagraphDiff(oldText: string, newText: string): ParagraphDiff[] {
  const oldP = splitParas(oldText), newP = splitParas(newText);
  const result: ParagraphDiff[] = [];
  for (let i = 0; i < Math.max(oldP.length, newP.length); i++) {
    const o = oldP[i], n = newP[i];
    if (o === undefined && n !== undefined) result.push({ op: 'added', text: n, paragraphIndex: i });
    else if (n === undefined && o !== undefined) result.push({ op: 'deleted', text: o, paragraphIndex: i, oldText: o });
    else if (o === n) result.push({ op: 'unchanged', text: o!, paragraphIndex: i });
    else result.push({ op: 'modified', text: n!, snapshotText: o, paragraphIndex: i, oldText: o });
  }
  return result;
}
function splitParas(t: string): string[] { return t.split(/\n\n+/).map(p => p.trim()).filter(p => p); }
function appendParagraph(text: string) { const c = getContent(); replaceContent(c + (c ? '\n\n' : '') + text); }

// ── Helpers ────────────────────────────────────────────

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function escapeHtml(s: string): string { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function escapeXml(s: string): string { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function flashButton(id: string) {
  const b = document.getElementById(id); if (!b) return;
  b.style.background = 'rgba(233, 69, 96, 0.2)'; setTimeout(() => b.style.background = '', 300);
}

document.addEventListener('DOMContentLoaded', main);
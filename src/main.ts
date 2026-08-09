/**
 * main.ts — App entry point
 *
 * Wires together:
 *   - Editor initialization
 *   - Toolbar buttons (snapshot, history)
 *   - Sidebar (snapshot list)
 *   - Merge panel (diff view)
 */

import {
  initEditor,
  createSnapshot,
  getSnapshots,
  getSnapshotContent,
  deleteSnapshot,
  getContent,
} from './editor';

// ── Diff types ─────────────────────────────────────────

type DiffOp = 'unchanged' | 'added' | 'deleted' | 'modified';

interface ParagraphDiff {
  op: DiffOp;
  text: string;
  snapshotText?: string;
}

// ── State ──────────────────────────────────────────────

let currentMergeSnapshotId: string | null = null;

// ── Init ───────────────────────────────────────────────

function main(): void {
  const container = document.getElementById('editor-container');
  if (!container) {
    throw new Error('No se encontró #editor-container');
  }

  initEditor(container);

  // Toolbar buttons
  document.getElementById('btn-snapshot')?.addEventListener('click', handleSnapshot);
  document.getElementById('btn-history')?.addEventListener('click', toggleSidebar);
  document.getElementById('btn-close-sidebar')?.addEventListener('click', closeSidebar);

  // Merge panel buttons
  document.getElementById('btn-accept-all')?.addEventListener('click', handleAcceptAll);
  document.getElementById('btn-reject-all')?.addEventListener('click', closeMergePanel);
  document.getElementById('btn-close-merge')?.addEventListener('click', closeMergePanel);

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      handleSnapshot();
    }
  });

  renderSnapshotList();
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
    if (!sidebar.classList.contains('hidden')) {
      renderSnapshotList();
    }
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

  // Attach event listeners
  list.querySelectorAll('.btn-compare').forEach((btn) => {
    btn.addEventListener('click', () => compareWithSnapshot((btn as HTMLElement).dataset.id!));
  });

  list.querySelectorAll('.btn-restore').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (confirm('¿Restaurar esta versión? El contenido actual se reemplazará.')) {
        // TODO: restore snapshot content to editor
        const id = (btn as HTMLElement).dataset.id!;
        const content = getSnapshotContent(id);
        if (content) {
          // Replace editor content
          const cm = document.querySelector('.cm-content');
          if (cm) {
            // Trigger Yjs transaction to replace content
            import('./editor').then(() => {
              // For now, use a simple approach
              document.dispatchEvent(
                new CustomEvent('enmienda:restore', { detail: { content, snapshotId: id } })
              );
            });
          }
        }
      }
    });
  });

  list.querySelectorAll('.btn-delete-snap').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = (btn as HTMLElement).dataset.id!;
      if (confirm('¿Eliminar esta instantánea?')) {
        deleteSnapshot(id);
        renderSnapshotList();
      }
    });
  });
}

// ── Merge panel ────────────────────────────────────────

function compareWithSnapshot(snapshotId: string): void {
  const current = getContent();
  const snapshot = getSnapshotContent(snapshotId);
  const meta = getSnapshots().find((s) => s.id === snapshotId);

  if (!snapshot) {
    alert('No se encontró el contenido de la instantánea.');
    return;
  }

  currentMergeSnapshotId = snapshotId;
  const diffs = computeParagraphDiff(snapshot, current);

  // Update merge label
  const label = document.getElementById('merge-label');
  if (label && meta) {
    label.textContent = `${meta.label} (${formatTime(meta.timestamp)})`;
  }

  // Render diffs
  const content = document.getElementById('merge-content');
  if (!content) return;

  content.innerHTML = diffs
    .map(
      (d, i) => `
    <div class="merge-paragraph ${d.op}" data-index="${i}">
      ${escapeHtml(d.text)}
      ${
        d.op !== 'unchanged'
          ? `
      <div class="merge-para-actions">
        <button class="btn-accept" data-index="${i}">✓ Aceptar</button>
        ${
          d.op === 'added'
            ? ''
            : '<button class="btn-reject" data-index="' + i + '">✗ Rechazar</button>'
        }
      </div>`
          : ''
      }
    </div>`
    )
    .join('');

  // Attach listeners
  content.querySelectorAll('.btn-accept').forEach((btn) => {
    btn.addEventListener('click', () => acceptParagraph(parseInt((btn as HTMLElement).dataset.index!)));
  });

  content.querySelectorAll('.btn-reject').forEach((btn) => {
    btn.addEventListener('click', () => rejectParagraph(parseInt((btn as HTMLElement).dataset.index!)));
  });

  // Show panel
  document.getElementById('merge-panel')?.classList.remove('hidden');
}

function closeMergePanel(): void {
  document.getElementById('merge-panel')?.classList.add('hidden');
  currentMergeSnapshotId = null;
}

function handleAcceptAll(): void {
  if (!currentMergeSnapshotId) return;
  const snapshot = getSnapshotContent(currentMergeSnapshotId);
  if (snapshot) {
    // Accept all = restore the snapshot content
    document.dispatchEvent(
      new CustomEvent('enmienda:restore', {
        detail: { content: snapshot, snapshotId: currentMergeSnapshotId },
      })
    );
  }
  closeMergePanel();
}

// ── Paragraph-level diff ───────────────────────────────

function computeParagraphDiff(oldText: string, newText: string): ParagraphDiff[] {
  const oldParas = splitParagraphs(oldText);
  const newParas = splitParagraphs(newText);
  const results: ParagraphDiff[] = [];

  // Simple line-by-line diff (LCS-based would be better, but this works for now)
  const maxLen = Math.max(oldParas.length, newParas.length);

  for (let i = 0; i < maxLen; i++) {
    const oldP = oldParas[i];
    const newP = newParas[i];

    if (oldP === undefined && newP !== undefined) {
      results.push({ op: 'added', text: newP });
    } else if (newP === undefined && oldP !== undefined) {
      results.push({ op: 'deleted', text: oldP });
    } else if (oldP === newP) {
      results.push({ op: 'unchanged', text: oldP });
    } else {
      results.push({ op: 'modified', text: newP, snapshotText: oldP });
    }
  }

  return results;
}

function splitParagraphs(text: string): string[] {
  // Split on double newlines (Markdown paragraph boundary)
  return text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

// ── Merge accept/reject ────────────────────────────────

function acceptParagraph(_index: number): void {
  // TODO: Apply accepted paragraph to current document
  // For MVP, we'll implement full paragraph merge later
  flashMergeParagraph(_index, 'accepted');
}

function rejectParagraph(_index: number): void {
  flashMergeParagraph(_index, 'rejected');
}

function flashMergeParagraph(index: number, action: 'accepted' | 'rejected'): void {
  const el = document.querySelector(`.merge-paragraph[data-index="${index}"]`);
  if (!el) return;
  const color = action === 'accepted' ? 'var(--green)' : 'var(--red)';
  (el as HTMLElement).style.transition = 'opacity 0.3s';
  (el as HTMLElement).style.borderLeftColor = color;
  setTimeout(() => {
    (el as HTMLElement).style.opacity = '0.3';
  }, 100);
}

// ── Helpers ────────────────────────────────────────────

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString('es-ES', {
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

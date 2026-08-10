/**
 * folio.ts — Paginated Markdown preview (book-like folio view)
 */

import { marked } from 'marked';

const MAX_LINES_PER_PAGE = 40;

// ── Public API ─────────────────────────────────────────

/** Render Markdown as paginated HTML pages */
export function renderFolio(markdown: string): string[] {
  const blocks = splitBlocks(markdown);
  const pages: string[] = [];
  let currentLines = 0;
  let currentHtml = '';

  for (const block of blocks) {
    const html = marked.parse(block.raw, { breaks: true }) as string;
    const lines = block.lines;

    if (currentLines + lines > MAX_LINES_PER_PAGE && currentHtml) {
      pages.push(wrapPage(currentHtml, pages.length + 1));
      currentHtml = html;
      currentLines = lines;
    } else {
      currentHtml += (currentHtml ? '\n' : '') + html;
      currentLines += lines;
    }
  }

  if (currentHtml) {
    pages.push(wrapPage(currentHtml, pages.length + 1));
  }

  return pages.length > 0 ? pages : [wrapPage('<p>&nbsp;</p>', 1)];
}

// ── Block parsing ──────────────────────────────────────

interface Block {
  raw: string;
  lines: number;
}

function splitBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }
    if (/^#{1,6}\s/.test(line)) { blocks.push({ raw: line, lines: 3 }); i++; continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) { blocks.push({ raw: line, lines: 2 }); i++; continue; }

    // Code fence
    if (line.trim().startsWith('```')) {
      const buf = [line]; i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) { buf.push(lines[i]); i++; }
      if (i < lines.length) buf.push(lines[i]); i++;
      blocks.push({ raw: buf.join('\n'), lines: buf.length + 3 });
      continue;
    }

    // List
    if (/^[\s]*[-*+]\s/.test(line) || /^[\s]*\d+\.\s/.test(line)) {
      const buf = [];
      while (i < lines.length && (/^[\s]*[-*+]\s/.test(lines[i]) || /^[\s]*\d+\.\s/.test(lines[i]) || (!lines[i].trim() && i + 1 < lines.length && (/^[\s]*[-*+]\s/.test(lines[i + 1]) || /^[\s]*\d+\.\s/.test(lines[i + 1]))))) {
        buf.push(lines[i]); i++;
      }
      blocks.push({ raw: buf.join('\n'), lines: buf.length + 2 });
      continue;
    }

    // Table
    if (line.trim().startsWith('|')) {
      const buf = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { buf.push(lines[i]); i++; }
      blocks.push({ raw: buf.join('\n'), lines: buf.length + 3 });
      continue;
    }

    // Paragraph
    const buf = [];
    while (i < lines.length && lines[i].trim() && !lines[i].trim().startsWith('```') && !/^#{1,6}\s/.test(lines[i]) && !/^[\s]*[-*+]\s/.test(lines[i]) && !/^[\s]*\d+\.\s/.test(lines[i]) && !/^(-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim()) && !lines[i].trim().startsWith('|')) {
      buf.push(lines[i]); i++;
    }
    blocks.push({ raw: buf.join('\n'), lines: Math.ceil(buf.join(' ').length / 80) + 2 });
  }

  return blocks;
}

// ── Helpers ────────────────────────────────────────────

function wrapPage(bodyHtml: string, num: number): string {
  return `<div class="folio-page"><div class="folio-body">${bodyHtml}</div><div class="folio-page-num">— ${num} —</div></div>`;
}
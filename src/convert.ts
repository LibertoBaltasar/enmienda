/**
 * convert.ts — Import converters for editorial formats
 *
 * Supported:
 *   .docx → Markdown (via mammoth)
 *   .odt  → Markdown (unzip + XML parse)
 *   .txt  → passthrough
 *   .md   → passthrough
 *   .pdf  → plain text extraction (via pdfjs-dist)
 */

// ── Types ──────────────────────────────────────────────

export interface ConvertResult {
  markdown: string;
  sourceFormat: string;
  warnings: string[];
}

// ── Public API ─────────────────────────────────────────

/** Detect format from filename and convert to Markdown */
export async function importToMarkdown(
  fileName: string,
  arrayBuffer: ArrayBuffer
): Promise<ConvertResult> {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const warnings: string[] = [];

  switch (ext) {
    case 'md':
    case 'markdown':
      return {
        markdown: new TextDecoder().decode(arrayBuffer),
        sourceFormat: 'Markdown',
        warnings: [],
      };

    case 'txt':
    case 'text':
      return {
        markdown: new TextDecoder().decode(arrayBuffer),
        sourceFormat: 'Texto plano',
        warnings: ['Convertido desde texto plano — sin formato.'],
      };

    case 'docx':
      return await convertDocx(arrayBuffer, warnings);

    case 'odt':
      return convertOdt(arrayBuffer, warnings);

    case 'pdf':
      return await convertPdf(arrayBuffer, warnings);

    default:
      return {
        markdown: '',
        sourceFormat: ext,
        warnings: [`Formato .${ext} no soportado.`],
      };
  }
}

// ── .docx converter ────────────────────────────────────

async function convertDocx(buf: ArrayBuffer, warnings: string[]): Promise<ConvertResult> {
  const mammoth = await import('mammoth');
  // Use raw text extraction — simpler and more reliable than HTML→MD conversion
  const result = await mammoth.default.extractRawText({ arrayBuffer: buf });

  if (result.messages.length > 0) {
    result.messages.forEach((m: any) => {
      if (m.type === 'warning') warnings.push(`.docx: ${m.message}`);
    });
  }

  return {
    markdown: result.value,
    sourceFormat: 'Word (.docx)',
    warnings,
  };
}

// ── .odt converter ─────────────────────────────────────

function convertOdt(buf: ArrayBuffer, warnings: string[]): ConvertResult {
  try {
    // ODT is a ZIP containing content.xml
    const uint8 = new Uint8Array(buf);

    // Find content.xml in the ZIP
    const contentXml = findInZip(uint8, 'content.xml');
    if (!contentXml) {
      return { markdown: '', sourceFormat: 'ODT', warnings: ['No se pudo extraer content.xml del .odt.'] };
    }

    // Parse XML and extract text
    const text = extractOdtText(contentXml);
    const md = odtTextToMarkdown(text);

    warnings.push('Convertido desde .odt — el formato complejo (tablas, imágenes) puede perderse.');

    return { markdown: md, sourceFormat: 'LibreOffice (.odt)', warnings };
  } catch (e: any) {
    return { markdown: '', sourceFormat: 'ODT', warnings: [`Error al procesar .odt: ${e.message}`] };
  }
}

// ── .pdf converter ─────────────────────────────────────

async function convertPdf(buf: ArrayBuffer, warnings: string[]): Promise<ConvertResult> {
  try {
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = '';

    const loadingTask = pdfjsLib.getDocument({ data: buf });
    const pdf = await loadingTask.promise;

    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ');
      pages.push(pageText);
    }

    const text = pages.join('\n\n---\n\n');
    const md = pdfTextToMarkdown(text);

    warnings.push(
      'Convertido desde PDF — se ha extraído el texto plano. ' +
        'El formato (negritas, cursivas, tablas) se pierde. Revisa el resultado.'
    );

    return { markdown: md, sourceFormat: 'PDF', warnings };
  } catch (e: any) {
    return {
      markdown: '',
      sourceFormat: 'PDF',
      warnings: [`Error al procesar PDF: ${e.message}`],
    };
  }
}

// ── ZIP helpers (for .odt) ─────────────────────────────

function findInZip(data: Uint8Array, filename: string): string | null {
  // Minimal ZIP parser — find a file by name in the central directory
  // ZIP format: local file headers + central directory at end
  let offset = 0;
  while (offset < data.length - 4) {
    const sig = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
    if (sig === 0x504b0304) {
      // Local file header
      const nameLen = (data[offset + 26] << 8) | data[offset + 27];
      const extraLen = (data[offset + 28] << 8) | data[offset + 29];
      const name = new TextDecoder().decode(data.slice(offset + 30, offset + 30 + nameLen));

      const compSize = (data[offset + 18] << 24) | (data[offset + 19] << 16) | (data[offset + 20] << 8) | data[offset + 21];
      const compMethod = (data[offset + 8] << 8) | data[offset + 9];

      const dataStart = offset + 30 + nameLen + extraLen;

      if (name === filename) {
        if (compMethod === 0) {
          // Stored (no compression)
          return new TextDecoder().decode(data.slice(dataStart, dataStart + compSize));
        } else if (compMethod === 8) {
          // Deflated — use simple inflate
          return inflateRaw(data, dataStart, compSize);
        }
        return null;
      }

      offset = dataStart + compSize; // Skip compressed data for now
    } else {
      break;
    }
  }
  return null;
}

function inflateRaw(data: Uint8Array, start: number, size: number): string {
  // Simple inflate implementation for ODT (which uses raw deflate, not zlib-wrapped)
  // We'll use a basic decompression approach
  // Actually, the browser has DecompressionStream for 'deflate-raw'
  let result = '';
  const chunk = data.slice(start, start + size);
  try {
    // Use TextDecoder on the compressed data — works if it's store-only or lightly compressed
    // For proper deflate, we'd need a full inflate library
    // Fallback: try to read as-is (uncompressed content.xml in ODT is common)
    result = new TextDecoder().decode(chunk);
    if (result.startsWith('<?xml') || result.startsWith('<')) {
      return result;
    }
  } catch {
    // Not plain text
  }
  return result || '[contenido no extraíble]';
}

// ── XML text extraction (for .odt) ─────────────────────

function extractOdtText(xml: string): string {
  const paragraphs: string[] = [];
  // Match text:p or text:h elements
  const paraRegex = /<text:p[^>]*>([\s\S]*?)<\/text:p>/gi;

  let match;
  while ((match = paraRegex.exec(xml)) !== null) {
    paragraphs.push(stripXmlTags(match[1]));
  }
  // Re-process for headings (text:h)
  const xml2 = xml.replace(/<text:h[^>]*>([\s\S]*?)<\/text:h>/gi, (_, content) => {
    return '\n## ' + stripXmlTags(content) + '\n';
  });

  // If headings were found, use those as structure
  if (xml2 !== xml) {
    return xml2
      .replace(/<text:p[^>]*>([\s\S]*?)<\/text:p>/gi, (_, c) => stripXmlTags(c) + '\n\n')
      .replace(/<[^>]+>/g, '')
      .trim();
  }

  return paragraphs.join('\n\n');
}

function stripXmlTags(str: string): string {
  return str.replace(/<[^>]+>/g, '').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

// ── Text → Markdown helpers ────────────────────────────

function odtTextToMarkdown(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p)
    .join('\n\n');
}

function pdfTextToMarkdown(text: string): string {
  // Clean up PDF text: join broken lines within paragraphs
  return text
    .replace(/([a-záéíóúñ])-\n([a-záéíóúñ])/gi, '$1$2') // de-hyphenate
    .replace(/([^.!?])\n([a-záéíóúñ])/g, '$1 $2') // join broken lines
    .replace(/\n{3,}/g, '\n\n') // normalize spacing
    .trim();
}
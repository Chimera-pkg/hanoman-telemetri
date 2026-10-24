import JSZip from 'jszip';
import type { Attachment } from '../types';

export const MAX_ATTACHMENTS = 4;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_DOC_BYTES = 6 * 1024 * 1024;
const MAX_DOC_CHARS = 180_000;
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|ya?ml|toml|ini|log|xml|html?|css|js|jsx|ts|tsx|py|rs|go|java|sql|sh|env)$/i;

function stripXml(xml: string): string {
  const withBreaks = xml
    .replace(/<w:p[ >][\s\S]*?<\/w:p>/g, m => `${m}\n`)
    .replace(/<\/a:p>/g, '\n')
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>/g, '\n');
  return withBreaks
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function officeText(file: File): Promise<string> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  if (file.name.toLowerCase().endsWith('.docx')) {
    const part = zip.file('word/document.xml');
    if (!part) throw new Error(`${file.name}: bukan DOCX yang valid.`);
    return stripXml(await part.async('string'));
  }
  const slides = Object.keys(zip.files)
    .filter(p => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  if (!slides.length) throw new Error(`${file.name}: bukan PPTX yang valid.`);
  const out: string[] = [];
  for (let i = 0; i < slides.length; i += 1) {
    const part = zip.file(slides[i]);
    if (!part) continue;
    const xml = await part.async('string');
    const lines = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(m => stripXml(m[1]));
    if (lines.length) out.push(`[Slide ${i + 1}]\n${lines.join('\n')}`);
  }
  return out.join('\n\n');
}

/** Converts a picked file into the wire format the Rust backend accepts. */
export async function toAttachment(file: File): Promise<Attachment> {
  if (file.type.startsWith('image/')) {
    if (file.size > MAX_IMAGE_BYTES) throw new Error(`${file.name} melebihi batas 8 MB untuk gambar.`);
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error(`${file.name} tidak bisa dibaca.`));
      reader.readAsDataURL(file);
    });
    return { kind: 'image', name: file.name, mime: file.type || 'image/png', data };
  }
  if (file.size > MAX_DOC_BYTES) throw new Error(`${file.name} melebihi batas 6 MB untuk dokumen.`);
  let text: string;
  if (/\.(docx|pptx)$/i.test(file.name)) text = await officeText(file);
  else if (TEXT_EXT.test(file.name) || file.type.startsWith('text/') || file.type === 'application/json') text = await file.text();
  else if (file.type === 'application/pdf') throw new Error('PDF belum didukung — tempel teksnya atau konversi ke DOCX/TXT.');
  else throw new Error(`${file.name}: format tidak didukung (gambar, teks, DOCX, PPTX).`);
  const trimmed = text.trim();
  if (!trimmed) throw new Error(`${file.name} tidak berisi teks yang bisa dibaca.`);
  return { kind: 'document', name: file.name, mime: file.type || 'text/plain', data: trimmed.slice(0, MAX_DOC_CHARS) };
}

import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  type RGB,
} from 'pdf-lib';

/**
 * A small A4 canvas on top of pdf-lib.
 *
 * The point of this layer is that document renderers (quote now, invoice and
 * receipt later) describe *what* to draw in points, line by line, while this
 * module worries about pages, wrapping, page breaks and the print-safe palette.
 *
 * Print rules that matter for a contractor's paperwork:
 *  - the page stays light (white paper, dark ink) so it reads on a mono printer
 *  - headings are dark and bold, orange is used only for accent rules and the
 *    document title, never behind a number a customer has to read
 *  - nothing relies on colour alone: totals are also bold and rule-separated
 */
export const PAGE = { width: 595.28, height: 841.89 } as const;
export const MARGIN = { top: 46, right: 44, bottom: 54, left: 44 } as const;

export const COLORS = {
  ink: rgb(0.09, 0.1, 0.12),
  body: rgb(0.2, 0.22, 0.26),
  muted: rgb(0.44, 0.46, 0.5),
  faint: rgb(0.62, 0.63, 0.66),
  rule: rgb(0.85, 0.86, 0.88),
  panel: rgb(0.965, 0.965, 0.97),
  ember: rgb(0.85, 0.42, 0.09),
  emberSoft: rgb(0.99, 0.94, 0.89),
  success: rgb(0.13, 0.47, 0.29),
  successSoft: rgb(0.92, 0.97, 0.93),
} as const;

/**
 * The base-14 fonts use WinAnsi (cp1252) encoding, which covers everything a
 * South African contractor's paperwork needs — but not emoji, CJK or the odd
 * character pasted in from a spreadsheet. Rather than let one stray glyph fail
 * the whole document, unsupported characters are transliterated or dropped.
 */
const CP1252_EXTRA = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160,
  0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

const REPLACEMENTS: Array<[RegExp, string]> = [
  [/[\u2018\u2019\u201b\u2032]/g, "'"],
  [/[\u201c\u201d\u201f\u2033]/g, '"'],
  [/[\u2013\u2014\u2212]/g, '-'],
  [/\u2026/g, '...'],
  [/[\u00a0\u2007\u202f]/g, ' '],
  [/[\u2022\u25cf]/g, '-'],
  [/\u20ac/g, 'EUR '],
];

export function sanitiseForPdf(value: string): string {
  let text = String(value ?? '');
  for (const [pattern, replacement] of REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }

  let out = '';
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    const encodable =
      (code >= 0x20 && code <= 0x7e) ||
      (code >= 0xa0 && code <= 0xff) ||
      CP1252_EXTRA.has(code) ||
      code === 0x0a ||
      code === 0x09;
    out += encodable ? character : '';
  }

  return out;
}

export type TextOptions = {
  size?: number;
  bold?: boolean;
  color?: RGB;
  lineHeight?: number;
  align?: 'left' | 'right' | 'center';
  /** Wrapping width in points; when omitted the text is drawn on one line. */
  maxWidth?: number;
  /** Cap the number of lines (the last one is ellipsised). */
  maxLines?: number;
};

export type EmbeddedImage = {
  ref: PDFImage;
  width: number;
  height: number;
};

export type DocumentMeta = {
  title: string;
  author: string;
  subject?: string;
  creator?: string;
  keywords?: string[];
};

export function wrapText(
font: PDFFont,
value: string,
options: { maxWidth: number; size?: number; maxLines?: number }
): string[] {
  const size = options.size ?? 10;
  const maxWidth = options.maxWidth;
  const lines: string[] = [];
  const text = sanitiseForPdf(value);

  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }

    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
        continue;
      }

      if (current) lines.push(current);

      // A single word longer than the column is hard-split, so nothing
      // silently disappears off the edge of the page.
      if (font.widthOfTextAtSize(word, size) > maxWidth) {
        let chunk = '';
        for (const character of word) {
          if (font.widthOfTextAtSize(chunk + character, size) > maxWidth) {
            lines.push(chunk);
            chunk = character;
          } else {
            chunk += character;
          }
        }
        current = chunk;
      } else {
        current = word;
      }
    }

    if (current) lines.push(current);
  }

  if (options.maxLines && lines.length > options.maxLines) {
    const kept = lines.slice(0, options.maxLines);
    const lastIndex = kept.length - 1;
    const last = kept[lastIndex] ?? '';
    kept[lastIndex] = `${last.replace(/[\s.]+$/, '')}…`;
    return kept;
  }

  return lines;
}

export class PdfCanvas {
  private readonly doc: PDFDocument;
  private readonly regular: PDFFont;
  private readonly boldFont: PDFFont;
  private page: PDFPage;
  private cursorY: number;
  private pageCount = 1;

  private constructor(doc: PDFDocument, regular: PDFFont, boldFont: PDFFont) {
    this.doc = doc;
    this.regular = regular;
    this.boldFont = boldFont;
    this.page = doc.addPage([PAGE.width, PAGE.height]);
    this.cursorY = PAGE.height - MARGIN.top;
  }

  static async create(meta: DocumentMeta): Promise<PdfCanvas> {
    const doc = await PDFDocument.create();
    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

    doc.setTitle(meta.title);
    doc.setAuthor(meta.author);
    doc.setCreator(meta.creator ?? 'Contractors Guild');
    doc.setProducer('Contractors Guild');
    if (meta.subject) doc.setSubject(meta.subject);
    if (meta.keywords) doc.setKeywords(meta.keywords);

    return new PdfCanvas(doc, regular, boldFont);
  }

  get contentWidth(): number {
    return PAGE.width - MARGIN.left - MARGIN.right;
  }

  get left(): number {
    return MARGIN.left;
  }

  get right(): number {
    return PAGE.width - MARGIN.right;
  }

  get y(): number {
    return this.cursorY;
  }

  /** Remaining vertical space before the bottom margin. */
  get remainingHeight(): number {
    return this.cursorY - MARGIN.bottom;
  }

  moveDown(points: number): void {
    this.cursorY -= points;
  }

  setY(value: number): void {
    this.cursorY = value;
  }

  font(bold = false): PDFFont {
    return bold ? this.boldFont : this.regular;
  }

  measure(text: string, options: TextOptions = {}): number {
    return this.font(options.bold).widthOfTextAtSize(sanitiseForPdf(text), options.size ?? 10);
  }

  /** Break text into lines that fit `maxWidth`, honouring explicit newlines. */
  wrap(value: string, options: TextOptions = {}): string[] {
    return wrapText(this.font(options.bold), value, {
      maxWidth: options.maxWidth ?? this.contentWidth,
      size: options.size ?? 10,
      maxLines: options.maxLines,
    });
  }

  /** Draw a single line of text at the cursor, without advancing. */
  textAt(
    text: string,
    x: number,
    y: number,
    options: TextOptions = {}
  ): void {
    const size = options.size ?? 10;
    const font = this.font(options.bold);
    const safe = sanitiseForPdf(text);
    let drawX = x;

    if (options.align === 'right') drawX = x - font.widthOfTextAtSize(safe, size);
    if (options.align === 'center') drawX = x - font.widthOfTextAtSize(safe, size) / 2;

    this.page.drawText(safe, {
      x: drawX,
      y,
      size,
      font,
      color: options.color ?? COLORS.body,
    });
  }

  /** Draw wrapped text at the cursor and advance past it. */
  text(text: string, options: TextOptions & { x?: number; width?: number } = {}): void {
    const size = options.size ?? 10;
    const lineHeight = options.lineHeight ?? size * 1.35;
    const from = options.x ?? this.left;
    const to = options.width ? options.x ?? this.left + options.width : this.right;
    const maxWidth = options.maxWidth ?? Math.max(20, to - from);
    const lines = this.wrap(text, { ...options, maxWidth });

    for (const line of lines) {
      this.textAt(line, options.align === 'right' ? to : from, this.cursorY, {
        ...options,
        align: options.align === 'right' ? 'right' : (options.align ?? 'left'),
        maxWidth,
      });
      this.cursorY -= lineHeight;
    }
  }

  /** Move to a new page when `needed` points would not fit. */
  ensureSpace(needed: number): void {
    if (this.remainingHeight - needed < 0) {
      this.newPage();
    }
  }

  newPage(): void {
    this.page = this.doc.addPage([PAGE.width, PAGE.height]);
    this.pageCount += 1;
    this.cursorY = PAGE.height - MARGIN.top;
  }

  rule(options: { color?: RGB; thickness?: number; y?: number; x?: number; width?: number } = {}): void {
    const y = options.y ?? this.cursorY;
    this.page.drawLine({
      start: { x: options.x ?? this.left, y },
      end: { x: (options.x ?? this.left) + (options.width ?? this.contentWidth), y },
      thickness: options.thickness ?? 0.75,
      color: options.color ?? COLORS.rule,
    });
  }

  rect(options: {
    x: number;
    y: number;
    width: number;
    height: number;
    color: RGB;
    opacity?: number;
  }): void {
    this.page.drawRectangle({
      x: options.x,
      y: options.y,
      width: options.width,
      height: options.height,
      color: options.color,
      opacity: options.opacity ?? 1,
    });
  }

  /**
   * Embed a business logo. Only PNG and JPEG are supported: those are the two
   * formats pdf-lib can place, and they are the two the upload form accepts for
   * a document. Anything else is skipped, so a WebP logo never breaks a quote.
   */
  async embedImage(data: Buffer, type: 'png' | 'jpg'): Promise<EmbeddedImage | null> {
    try {
      const ref = type === 'png' ? await this.doc.embedPng(data) : await this.doc.embedJpg(data);
      return { ref, width: ref.width, height: ref.height };
    } catch {
      return null;
    }
  }

  /** Place an embedded image, scaled to fit a box, top-aligned inside it. */
  drawImage(
    image: EmbeddedImage,
    options: { x: number; y: number; maxWidth: number; maxHeight: number }
  ): void {
    const scale = Math.min(options.maxWidth / image.width, options.maxHeight / image.height, 1);
    const width = image.width * scale;
    const height = image.height * scale;

    this.page.drawImage(image.ref, {
      x: options.x,
      y: options.y + options.maxHeight - height,
      width,
      height,
    });
  }

  async render(meta: { footer?: (canvas: PdfCanvas, pageNumber: number, total: number) => void } = {}): Promise<Uint8Array> {
    if (meta.footer) {
      const total = this.pageCount;
      const pages = this.doc.getPages();
      for (const [index, page] of pages.entries()) {
        // Draw the footer with the page as the active page.
        this.page = page;
        this.cursorY = MARGIN.bottom;
        meta.footer(this, index + 1, total);
      }
    }

    return this.doc.save();
  }
}

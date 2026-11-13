import { inflateSync } from 'node:zlib';

/**
 * Minimal PDF content-stream reader for assertions.
 *
 * The document engine (pdf-lib) compresses content streams with Flate and writes
 * text as hex strings inside `... Tj` operators, so a test cannot simply search
 * the bytes. These helpers inflate every stream they can find and decode the
 * text runs, which is enough to assert what the document says and where it sits
 * without pulling in a full PDF parser.
 */

export type TextRun = {
  page: number;
  text: string;
  x: number;
  y: number;
};

/** Inflate every Flate stream in the file (non-Flate streams are skipped). */
export function readPdfStreams(bytes: Uint8Array): string[] {
  const buffer = Buffer.from(bytes);
  const streams: string[] = [];
  let index = 0;

  while (index < buffer.length) {
    const start = buffer.indexOf('stream', index);
    if (start === -1) break;
    // `endstream` contains `stream`, so be explicit about the keyword.
    const isKeyword = buffer[start - 1] === 0x0a || buffer[start - 1] === 0x0d;
    if (!isKeyword) {
      index = start + 6;
      continue;
    }

    let dataStart = start + 6;
    if (buffer[dataStart] === 0x0d) dataStart += 1;
    if (buffer[dataStart] === 0x0a) dataStart += 1;

    const end = buffer.indexOf('endstream', dataStart);
    if (end === -1) break;

    const raw = buffer.subarray(dataStart, end);
    try {
      streams.push(inflateSync(raw).toString('latin1'));
    } catch {
      // Not a Flate stream (fonts, images): ignore it.
    }
    index = end + 9;
  }

  return streams;
}

const TEXT_RUN = /1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm\s*<([0-9a-fA-F]+)> Tj/g;

function hexToText(hex: string): string {
  let out = '';
  for (let i = 0; i + 1 < hex.length; i += 2) {
    out += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16));
  }
  return out;
}

/** Every text run in the document, in file order, tagged with a stream index. */
export function pdfTextRuns(bytes: Uint8Array): TextRun[] {
  const runs: TextRun[] = [];
  readPdfStreams(bytes).forEach((content, page) => {
    for (const match of content.matchAll(TEXT_RUN)) {
      runs.push({
        page,
        x: Number(match[1]),
        y: Number(match[2]),
        text: hexToText(match[3] ?? ''),
      });
    }
  });
  return runs;
}

/** The document's text, runs joined in order. */
export function pdfText(bytes: Uint8Array): string {
  return pdfTextRuns(bytes)
    .map((run) => run.text)
    .join('');
}

/** Text runs joined with a separator, for readable assertions. */
export function pdfTextJoined(bytes: Uint8Array, separator = ' | '): string {
  return pdfTextRuns(bytes)
    .map((run) => run.text)
    .join(separator);
}

/** Page count, taken from the "Page n of N" footers the renderer writes. */
export function pdfPageCount(bytes: Uint8Array): number {
  const footers = pdfTextRuns(bytes).filter((run) => /^Page \d+ of \d+$/.test(run.text));
  if (footers.length === 0) return 0;
  const match = /of (\d+)$/.exec(footers[0]?.text ?? '');
  return Number(match?.[1] ?? 0);
}

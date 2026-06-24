import { readFile } from "node:fs/promises";
import { join } from "node:path";
import PDFDocument from "pdfkit";

/**
 * Company-letterhead PDF for Eco's `document_create` tool.
 *
 * Design mirrors the branded email shell (@/lib/branded-email):
 * - Dark band (#0A1A2F) across the top with the white logo PNG
 *   (fetched from the live site, falling back to public/logo-white.png,
 *   falling back to a typeset wordmark).
 * - "Earthen Calm" palette: #0A1A2F ink, #4A5568 muted, #D1D9E0 hairlines.
 * - EMBEDDED fonts (src/assets/fonts, OFL-licensed ParaType faces, full
 *   Latin + Cyrillic coverage — Russian renders natively):
 *   · PT Sans (regular/bold) for the letter-spaced uppercase headings and
 *     captions (clean sans in the spirit of the site's Tenor Sans),
 *   · PT Serif for body text (the elegant serif voice of the brand).
 *   The PDFDocument is created with `font: null` so pdfkit never touches
 *   its built-in AFM fonts — only the embedded TTFs ship to serverless
 *   (see outputFileTracingIncludes in next.config.ts).
 *
 * Body text is "markdownish": blank lines split paragraphs, `# `/`## ` lines
 * become headings, `- `/`* ` lines become bullets. Everything else renders
 * as body paragraphs.
 *
 * `unsupportedCharsStripped` flags when characters OUTSIDE the embedded
 * fonts' repertoire (emoji, CJK, …) had to be removed so the tool can warn.
 */

const LOGO_URL = "https://eliteecocarwash.com/assets/logo-white.png";
const BRAND_NAME = "VICTORIA VASILYEVA — HOLISTIC BEAUTY";
const FOOTER_TEXT =
  "eliteecocarwash.com  ·  info@eliteecocarwash.com";

const INK = "#0A1A2F";
const MUTED = "#4A5568";
const HAIRLINE = "#D1D9E0";
const BAND = "#0A1A2F";

const PAGE_MARGIN = 64;
const BAND_HEIGHT = 110;

/**
 * Disable OpenType ligatures on EVERY `.text()` call.
 *
 * WHY (empirically proven): pdfkit/fontkit ALWAYS plans the `liga`/`clig`
 * features for embedded TTFs, so words like "profit" and "confirmed" come out
 * with an "fi" glyph substituted for the "f"+"i" pair — which the PT fonts
 * render as a single ligature glyph that screen-readers / copy-paste mangle
 * and that visually drops the dotted i. Passing `features: []` does NOT help:
 * the array form is an ADD list, not a disable list. The OBJECT form below
 * explicitly turns the ligature features OFF.
 *
 * We disable ONLY the ligature families (liga/clig/dlig/hlig). kern/ccmp/
 * mark/mkmk are deliberately left on — Cyrillic shaping and mark positioning
 * need them, and they never produce the fi-ligature artifact.
 */
// fontkit accepts an OBJECT map of feature→boolean at runtime (PDFKit forwards
// `features` straight to `font.layout(text, features)`), but @types/pdfkit only
// types the ADD-array form — hence the cast. The object form is the ONLY one
// that disables a default-on feature; the array form can only add features.
const NO_LIGATURES = {
  liga: false,
  clig: false,
  dlig: false,
  hlig: false,
} as unknown as PDFKit.Mixins.TextOptions["features"];

export interface LetterheadDocumentInput {
  title: string;
  /** Markdownish body (see module docs). */
  body: string;
  /** Optional "To: ..." recipient line. */
  recipient?: string;
  /** Injectable for tests. */
  now?: Date;
}

export interface LetterheadDocumentResult {
  pdf: Buffer;
  /** True when characters outside the embedded fonts' coverage were stripped. */
  unsupportedCharsStripped: boolean;
}

/**
 * Keep characters the embedded PT fonts can render: Latin (ASCII, Latin-1,
 * Latin Extended-A), full Cyrillic, and the typographic punctuation the
 * fonts cover (dashes, curly quotes, «guillemets», №, ₽, €, ellipsis, ·).
 * Anything else (emoji, CJK, …) is dropped and flagged via `onStrip` —
 * per-render closure, no shared module state.
 */
function makeSanitizer(onStrip: () => void): (text: string) => string {
  return (text: string): string => {
    const safe = text
      .replace(/[\u00a0\u202f]/g, " ") // NBSP / narrow NBSP → plain space
      .replace(/[\u2019\u02bc]/g, "\u2019") // apostrophe variants → right single quote
      // Outside the embedded fonts' repertoire → drop (and flag below).
      .replace(
        /[^\x20-\x7E\n\t\u00a1-\u00ff\u0100-\u017f\u0400-\u04ff\u2013\u2014\u2018\u2019\u201a\u201c\u201d\u201e\u00ab\u00bb\u2026\u00b7\u2116\u20ac\u20bd]/g,
        ""
      );
    if (safe.replace(/\s/g, "").length < text.replace(/\s/g, "").length) {
      onStrip();
    }
    return safe;
  };
}

// --- Embedded fonts -----------------------------------------------------------

const FONT_DIR = join(process.cwd(), "src", "assets", "fonts");
const FONT_FILES = {
  Sans: "PT_Sans-Web-Regular.ttf",
  "Sans-Bold": "PT_Sans-Web-Bold.ttf",
  Serif: "PT_Serif-Web-Regular.ttf",
} as const;
type FontName = keyof typeof FONT_FILES;

/** Font bytes survive across warm invocations — read once per process. */
let fontCache: Record<FontName, Buffer> | null = null;

async function loadFonts(): Promise<Record<FontName, Buffer>> {
  if (fontCache) return fontCache;
  const entries = await Promise.all(
    (Object.keys(FONT_FILES) as FontName[]).map(async (name) => {
      const buf = await readFile(join(FONT_DIR, FONT_FILES[name]));
      return [name, buf] as const;
    })
  );
  fontCache = Object.fromEntries(entries) as Record<FontName, Buffer>;
  return fontCache;
}

async function loadLogo(): Promise<Buffer | null> {
  try {
    const res = await fetch(LOGO_URL, { signal: AbortSignal.timeout(8_000) });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
  } catch {
    // fall through to the local copy
  }
  try {
    return await readFile(join(process.cwd(), "public", "logo-white.png"));
  } catch {
    return null;
  }
}

export async function renderLetterheadPdf(
  input: LetterheadDocumentInput
): Promise<LetterheadDocumentResult> {
  let strippedChars = false;
  const sanitize = makeSanitizer(() => {
    strippedChars = true;
  });

  const [logo, fonts] = await Promise.all([loadLogo(), loadFonts()]);
  const now = input.now ?? new Date();
  const dateLine = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Cairo",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);

  const doc = new PDFDocument({
    size: "A4",
    margins: {
      top: BAND_HEIGHT + 56,
      bottom: 96,
      left: PAGE_MARGIN,
      right: PAGE_MARGIN,
    },
    // `null` skips pdfkit's built-in Helvetica (AFM) entirely — we only ever
    // use the embedded TTFs registered below. (Types say string; runtime
    // accepts null by design: initFonts(defaultFont) no-ops on falsy.)
    font: null as unknown as string,
    info: { Title: input.title, Author: "Elite Eco Car Wash" },
  });
  doc.registerFont("Sans", fonts.Sans);
  doc.registerFont("Sans-Bold", fonts["Sans-Bold"]);
  doc.registerFont("Serif", fonts.Serif);

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    doc.on("end", () => resolve(Buffer.concat(chunks)))
  );

  const pageWidth = doc.page.width;
  const contentWidth = pageWidth - PAGE_MARGIN * 2;

  const drawBandAndFooter = () => {
    // Decoration must never disturb the text flow: pdfkit auto-paginates any
    // text drawn past the bottom margin, so we lift the margin while drawing
    // the footer and restore the cursor afterwards.
    const savedX = doc.x;
    const savedY = doc.y;
    const savedBottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    // Dark band with the white logo (760×387 PNG — fit by HEIGHT so it can
    // never overflow the band).
    doc.save();
    doc.rect(0, 0, pageWidth, BAND_HEIGHT).fill(BAND);
    if (logo) {
      const boxWidth = 240;
      const boxHeight = 82;
      doc.image(logo, (pageWidth - boxWidth) / 2, (BAND_HEIGHT - boxHeight) / 2, {
        fit: [boxWidth, boxHeight],
        align: "center",
        valign: "center",
      });
    } else {
      doc
        .font("Sans")
        .fontSize(13)
        .fillColor("#FFFFFF")
        .text(BRAND_NAME, PAGE_MARGIN, BAND_HEIGHT / 2 - 8, {
          width: contentWidth,
          align: "center",
          characterSpacing: 2,
          features: NO_LIGATURES,
        });
    }
    // Footer hairline + contacts.
    const footerY = doc.page.height - 64;
    doc
      .moveTo(PAGE_MARGIN, footerY)
      .lineTo(pageWidth - PAGE_MARGIN, footerY)
      .lineWidth(0.5)
      .strokeColor(HAIRLINE)
      .stroke();
    doc
      .font("Sans")
      .fontSize(9)
      .fillColor(MUTED)
      .text(FOOTER_TEXT, PAGE_MARGIN, footerY + 12, {
        width: contentWidth,
        align: "center",
        characterSpacing: 0.5,
        features: NO_LIGATURES,
      });
    doc.restore();

    doc.page.margins.bottom = savedBottomMargin;
    doc.x = savedX;
    doc.y = savedY;
  };

  drawBandAndFooter();
  doc.on("pageAdded", drawBandAndFooter);

  // --- Letter head matter -------------------------------------------------
  doc
    .font("Sans")
    .fontSize(9)
    .fillColor(MUTED)
    .text(sanitize(BRAND_NAME), PAGE_MARGIN, BAND_HEIGHT + 40, {
      width: contentWidth,
      characterSpacing: 2.2,
      features: NO_LIGATURES,
    });
  doc.moveDown(0.6);
  doc
    .font("Sans")
    .fontSize(20)
    .fillColor(INK)
    .text(sanitize(input.title).toUpperCase(), {
      width: contentWidth,
      characterSpacing: 1.6,
      lineGap: 4,
      features: NO_LIGATURES,
    });
  doc.moveDown(0.5);
  doc.font("Sans").fontSize(10).fillColor(MUTED);
  doc.text(sanitize(dateLine), { width: contentWidth, features: NO_LIGATURES });
  if (input.recipient) {
    doc.text(sanitize(`To: ${input.recipient}`), {
      width: contentWidth,
      features: NO_LIGATURES,
    });
  }
  doc.moveDown(0.4);
  const ruleY = doc.y;
  doc
    .moveTo(PAGE_MARGIN, ruleY)
    .lineTo(PAGE_MARGIN + contentWidth, ruleY)
    .lineWidth(0.5)
    .strokeColor(HAIRLINE)
    .stroke();
  doc.moveDown(1.2);

  // --- Markdownish body -------------------------------------------------------
  const paragraphs = sanitize(input.body).split(/\n{2,}/);
  for (const para of paragraphs) {
    const lines = para.split("\n").filter((l) => l.trim().length > 0);
    for (const line of lines) {
      const trimmed = line.trim();
      const heading = /^#{1,3}\s+(.*)$/.exec(trimmed);
      const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
      if (heading) {
        doc.moveDown(0.6);
        doc
          .font("Sans-Bold")
          .fontSize(12)
          .fillColor(INK)
          .text(heading[1].toUpperCase(), {
            width: contentWidth,
            characterSpacing: 1.4,
            lineGap: 3,
            features: NO_LIGATURES,
          });
        doc.moveDown(0.2);
      } else if (bullet) {
        doc
          .font("Serif")
          .fontSize(11.5)
          .fillColor(INK)
          .text(`·  ${bullet[1]}`, {
            width: contentWidth - 14,
            indent: 14,
            lineGap: 4,
            features: NO_LIGATURES,
          });
      } else {
        doc
          .font("Serif")
          .fontSize(11.5)
          .fillColor(INK)
          .text(trimmed, {
            width: contentWidth,
            lineGap: 5,
            features: NO_LIGATURES,
          });
      }
    }
    doc.moveDown(0.8);
  }

  // --- Signature ---------------------------------------------------------------
  doc.moveDown(0.6);
  doc
    .font("Serif")
    .fontSize(11.5)
    .fillColor(INK)
    .text("Warmly,", { width: contentWidth, features: NO_LIGATURES });
  doc.moveDown(0.2);
  doc
    .font("Sans")
    .fontSize(10)
    .fillColor(MUTED)
    .text("VICTORIA VASILYEVA", {
      width: contentWidth,
      characterSpacing: 1.8,
      features: NO_LIGATURES,
    });

  doc.end();
  const pdf = await done;
  return { pdf, unsupportedCharsStripped: strippedChars };
}

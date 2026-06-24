/**
 * Shared branded HTML email shell — Elite Eco Car Wash brand on EVERY email.
 *
 * Layout (matches the buyer-confirmation email that defined the pattern):
 * - Dark band header (#0A1A2F — deep blue) with the white logo, table-based so
 *   it renders in Outlook/Gmail (bgcolor attribute + inline styles, no external CSS).
 * - Blue/silver palette: #F8FAFC canvas, #FFFFFF card, #D1D9E0 hairlines,
 *   #0A1A2F ink, #4A5568 muted, Georgia serif.
 * - Card with the brand kicker line + heading, then template-specific content.
 *
 * Builders pass in already-safe HTML (escape data with `escapeHtml`).
 * Text parts stay plain — this module only owns the HTML shell.
 */

const LOGO_URL = "https://eliteecocarwash.com/assets/logo-white.png";
const BRAND_NAME = "Elite Eco Car Wash";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface BrandedEmailOptions {
  /** Card heading (plain text — escaped here). */
  heading: string;
  /** Template-specific inner HTML (already escaped by the builder). */
  contentHtml: string;
  /** Optional small print rendered under the card (already escaped). */
  belowCardHtml?: string;
}

/** Full HTML document: dark logo band + blue/silver card around the content. */
export function brandedEmailHtml(options: BrandedEmailOptions): string {
  const { heading, contentHtml, belowCardHtml } = options;
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background-color:#F8FAFC;font-family:Georgia,'Times New Roman',serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;width:100%;">
      <tr>
        <td align="center" bgcolor="#0A1A2F" style="background-color:#0A1A2F;padding:24px;border-radius:16px 16px 0 0;">
          <img src="${LOGO_URL}" width="220" alt="Elite Eco Car Wash" style="display:block;width:220px;max-width:100%;height:auto;border:0;margin:0 auto;" />
        </td>
      </tr>
    </table>
    <div style="background-color:#FFFFFF;border:1px solid #D1D9E0;border-top:0;border-radius:0 0 16px 16px;padding:32px;">
      <p style="margin:0 0 4px;color:#4A5568;font-size:12px;text-transform:uppercase;letter-spacing:0.2em;">${BRAND_NAME}</p>
      <h1 style="margin:0 0 24px;color:#0A1A2F;font-size:26px;font-weight:normal;">${escapeHtml(heading)}</h1>
      ${contentHtml}
    </div>${
      belowCardHtml
        ? `\n    <p style="margin:16px 8px 0;color:#4A5568;font-size:12px;">${belowCardHtml}</p>`
        : ""
    }
  </div>
</body>
</html>`;
}
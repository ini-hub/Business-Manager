/**
 * Regenerates the icon set and the default share image from code, so they are committed files
 * (never generated at request time). Run: npx tsx scripts/generate-brand-assets.ts
 *
 * Source of truth is the "Icon set" board: a white K glyph on brand blue #216AC7, no text,
 * gradients or shadows inside the icon. The share image is rendered with Instrument Sans.
 */
import { Resvg } from "@resvg/resvg-js";
import { execFileSync } from "child_process";
import { mkdirSync, statSync, unlinkSync, writeFileSync } from "fs";
import path from "path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PUBLIC = path.join(ROOT, "client/public");
const FONTS = path.join(import.meta.dirname, "brand-assets/fonts");
const BLUE = "#216AC7";

// The glyph lives in a 100-unit box; stroke caps are round.
const GLYPH_PATHS = `<path d="M36 29V71M68 28L40 50L66 71" fill="none" stroke="#FFFFFF" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/>`;

const iconSvg = (radius: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="${radius}" fill="${BLUE}"/>${GLYPH_PATHS}</svg>`;

// Full-bleed blue; the glyph is scaled down so it sits well inside the central 80% safe circle.
const maskableSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${BLUE}"/><g transform="translate(50 50) scale(0.86) translate(-50 -50)">${GLYPH_PATHS}</g></svg>`;

const monochromeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M36 29V71M68 28L40 50L66 71" fill="none" stroke="#000000" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const png = (svg: string, size: number, options: Record<string, unknown> = {}) =>
  new Resvg(svg, { fitTo: { mode: "width", value: size }, ...options }).render().asPng();

function ico(images: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size, 0);
    e.writeUInt8(size, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

const out = (name: string, data: string | Buffer) => writeFileSync(path.join(PUBLIC, name), data);

// ── Icons ───────────────────────────────────────────────────────────────────
out("icon.svg", iconSvg(22));
out("icon-mono.svg", monochromeSvg);
out("favicon.ico", ico([16, 32].map((size) => ({ size, data: png(iconSvg(22), size) }))));
// iOS applies its own corner mask, so the touch icon is full-bleed with no transparency.
out("apple-touch-icon.png", png(maskableSvg.replace("scale(0.86)", "scale(1)"), 180));
out("icon-192.png", png(iconSvg(22), 192));
out("icon-512.png", png(iconSvg(22), 512));
out("icon-maskable-512.png", png(maskableSvg, 512));

// ── Default share image (1200 x 630) ───────────────────────────────────────
const font = { fontFiles: [path.join(FONTS, "InstrumentSans-Medium.ttf"), path.join(FONTS, "InstrumentSans-Bold.ttf")], loadSystemFonts: false, defaultFontFamily: "Instrument Sans" };

const pill = (x: number, w: number, label: string, primary = false) => `
  <rect x="${x}" y="518" width="${w}" height="48" rx="24" fill="${primary ? BLUE : "none"}" ${primary ? "" : 'stroke="#2C3A4B"'}/>
  <text x="${x + w / 2}" y="548" text-anchor="middle" font-size="20" font-weight="${primary ? 700 : 500}" fill="#FFFFFF">${label}</text>`;

const bar = (x: number, y: number, w: number, fill = "#E6EAF0") => `<rect x="${x}" y="${y}" width="${w}" height="12" rx="6" fill="${fill}"/>`;

// Labels only, no figures: the card must not show invented numbers.
const shareSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" font-family="Instrument Sans">
  <rect width="1200" height="630" fill="#141F2C"/>
  <g transform="translate(72 64) scale(0.48)">${iconSvg(22).replace(/<svg[^>]*>|<\/svg>/g, "")}</g>
  <text x="132" y="100" font-size="30" font-weight="700" fill="#FFFFFF">Kowope</text>
  <g font-size="68" font-weight="700" fill="#FFFFFF" letter-spacing="-2">
    <text x="72" y="206">Run your whole</text><text x="72" y="276">business from your</text><text x="72" y="346">phone.</text>
  </g>
  <g font-size="24" font-weight="500" fill="#C9D3DF">
    <text x="72" y="398">Sales, stock, customers, staff and bookings.</text><text x="72" y="432">Built for Nigerian SMEs.</text>
  </g>
  ${pill(72, 138, "Start free", true)}${pill(222, 152, "Works offline")}${pill(386, 162, "Priced in Naira")}
  <rect x="780" y="72" width="300" height="640" rx="44" fill="#0B121B"/>
  <rect x="790" y="82" width="280" height="620" rx="36" fill="#F3F5F9"/>
  <rect x="790" y="82" width="280" height="86" rx="36" fill="#FFFFFF"/><rect x="790" y="130" width="280" height="38" fill="#FFFFFF"/>
  <text x="807" y="124" font-size="13" fill="#5B6674">Today</text>
  <text x="807" y="150" font-size="18" font-weight="700" fill="#141F2C">Good evening</text>
  <rect x="803" y="178" width="254" height="78" rx="14" fill="#141F2C"/>
  <text x="819" y="206" font-size="13" fill="#C9D3DF">Sales today</text>${bar(819, 222, 110, "#3A4A5E")}
  <rect x="803" y="268" width="122" height="78" rx="14" fill="#FFFFFF"/><text x="817" y="296" font-size="12" fill="#5B6674">Bookings</text>${bar(817, 312, 70)}
  <rect x="935" y="268" width="122" height="78" rx="14" fill="#FFFFFF"/><text x="949" y="296" font-size="12" fill="#5B6674">Credit due</text>${bar(949, 312, 70)}
  <rect x="803" y="358" width="254" height="140" rx="14" fill="#FFFFFF"/>
  ${[382, 418, 454].map((y) => `${bar(819, y, 120)}${bar(1000, y, 40)}`).join("")}
</svg>`;

const tmpPng = path.join(PUBLIC, "og/.og-home.tmp.png");
mkdirSync(path.join(PUBLIC, "og"), { recursive: true });
writeFileSync(tmpPng, new Resvg(shareSvg, { font }).render().asPng());
// sips ships with macOS; any PNG -> JPG converter works here.
execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "82", tmpPng, "--out", path.join(PUBLIC, "og/og-home.jpg")], { stdio: "ignore" });
unlinkSync(tmpPng);

const kb = Math.round(statSync(path.join(PUBLIC, "og/og-home.jpg")).size / 1024);
console.log(`og-home.jpg ${kb} KB`);

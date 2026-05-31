import { Request, Response } from "express";

let cachedPng: Buffer | null = null;

function buildSvg(): string {
  const W = 1200;
  const H = 630;

  // & must be &amp; in SVG (XML)
  const features = ["POS &amp; Checkout", "Inventory", "Staff &amp; Payroll", "Customer Credit", "Bookings", "Analytics"];

  const featurePills = features.map((label, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = 640 + col * 185;
    const y = 320 + row * 52;
    const w = 170;
    return `
      <rect x="${x}" y="${y}" width="${w}" height="36" rx="8"
        fill="rgba(17,105,199,0.15)" stroke="rgba(17,105,199,0.35)" stroke-width="1"/>
      <text x="${x + w / 2}" y="${y + 23}" text-anchor="middle"
        font-family="Inter,system-ui,sans-serif" font-size="13" font-weight="600"
        fill="rgba(180,210,255,0.85)">${label}</text>`;
  }).join("");

  const bars = [
    { h: 80, x: 660 }, { h: 120, x: 700 }, { h: 60, x: 740 },
    { h: 150, x: 780 }, { h: 100, x: 820 }, { h: 130, x: 860 }, { h: 90, x: 900 },
  ].map(({ h, x }) =>
    `<rect x="${x}" y="${240 - h}" width="28" height="${h}" rx="4" fill="rgba(17,105,199,0.5)"/>`
  ).join("");

  const statCards = [
    { label: "Transactions", value: "47", x: 615 },
    { label: "New Customers", value: "12", x: 786 },
    { label: "Bookings Open", value: "8", x: 957 },
  ].map(({ label, value, x }) => `
    <rect x="${x}" y="295" width="155" height="72" rx="10"
      fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>
    <text x="${x + 16}" y="321"
      font-family="Inter,system-ui,sans-serif" font-size="11"
      fill="rgba(255,255,255,0.42)">${label}</text>
    <text x="${x + 16}" y="350"
      font-family="Inter,system-ui,sans-serif" font-size="24" font-weight="900"
      fill="white">${value}</text>`
  ).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox">
      <stop offset="0%" stop-color="#0a1219"/>
      <stop offset="100%" stop-color="#0d1e35"/>
    </linearGradient>
    <radialGradient id="glow1" cx="30%" cy="50%" r="60%">
      <stop offset="0%" stop-color="#1169C7" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#1169C7" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="logoBg" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox">
      <stop offset="0%" stop-color="#2a8ae8"/>
      <stop offset="100%" stop-color="#0d52a8"/>
    </linearGradient>
    <linearGradient id="ctaBg" x1="0" y1="0" x2="1" y2="0" gradientUnits="objectBoundingBox">
      <stop offset="0%" stop-color="#1169C7"/>
      <stop offset="100%" stop-color="#1a7ae0"/>
    </linearGradient>
    <clipPath id="chartClip">
      <rect x="640" y="80" width="440" height="220" rx="12"/>
    </clipPath>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow1)"/>
  <line x1="580" y1="80" x2="580" y2="550" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>

  <!-- Logo -->
  <rect x="80" y="100" width="72" height="72" rx="18" fill="url(#logoBg)"/>
  <text x="116" y="153" text-anchor="middle"
    font-family="Inter,system-ui,sans-serif" font-size="40" font-weight="900" fill="white">K</text>

  <!-- Brand name -->
  <text x="80" y="238"
    font-family="Inter,system-ui,sans-serif" font-size="76" font-weight="900" fill="white">Ko</text>
  <text x="205" y="238"
    font-family="Inter,system-ui,sans-serif" font-size="76" font-weight="900" fill="#4d9fff">wope</text>

  <!-- System descriptor -->
  <rect x="80" y="254" width="325" height="34" rx="8"
    fill="rgba(17,105,199,0.20)" stroke="rgba(17,105,199,0.40)" stroke-width="1"/>
  <text x="242" y="277" text-anchor="middle"
    font-family="Inter,system-ui,sans-serif" font-size="13" font-weight="700"
    fill="rgba(180,210,255,0.90)">BUSINESS MANAGEMENT SYSTEM</text>

  <!-- Taglines -->
  <text x="80" y="348"
    font-family="Inter,system-ui,sans-serif" font-size="29" font-weight="700"
    fill="rgba(255,255,255,0.92)">Gather every sale.</text>
  <text x="80" y="386"
    font-family="Inter,system-ui,sans-serif" font-size="29" font-weight="700"
    fill="rgba(255,255,255,0.92)">Every customer. Every naira.</text>

  <!-- Yoruba -->
  <text x="80" y="430"
    font-family="Inter,system-ui,sans-serif" font-size="15" font-weight="600"
    fill="rgba(251,191,36,0.82)">Ko gbogbo owo &#8212; complete.</text>

  <!-- CTA -->
  <rect x="80" y="472" width="210" height="46" rx="10" fill="url(#ctaBg)"/>
  <text x="185" y="502" text-anchor="middle"
    font-family="Inter,system-ui,sans-serif" font-size="15" font-weight="800"
    fill="white">Get started free</text>

  <!-- URL -->
  <text x="80" y="576"
    font-family="Inter,system-ui,sans-serif" font-size="13"
    fill="rgba(255,255,255,0.28)">kowope.app</text>

  <!-- Chart card -->
  <rect x="615" y="75" width="515" height="205" rx="14"
    fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
  <text x="635" y="112"
    font-family="Inter,system-ui,sans-serif" font-size="11" font-weight="600"
    letter-spacing="0.08em" fill="rgba(255,255,255,0.40)">TODAY&#39;S REVENUE</text>
  <text x="635" y="148"
    font-family="Inter,system-ui,sans-serif" font-size="30" font-weight="900"
    fill="white">284,500</text>
  <rect x="755" y="127" width="52" height="22" rx="6" fill="rgba(74,222,128,0.15)"/>
  <text x="781" y="143" text-anchor="middle"
    font-family="Inter,system-ui,sans-serif" font-size="12" font-weight="700"
    fill="#4ade80">+12%</text>

  <g clip-path="url(#chartClip)">${bars}</g>
  ${statCards}
  ${featurePills}

  <!-- Bottom accent -->
  <rect x="0" y="${H - 3}" width="${W}" height="3" fill="url(#ctaBg)"/>
</svg>`;
}

export async function serveOgImage(_req: Request, res: Response): Promise<void> {
  try {
    if (!cachedPng) {
      const { Resvg } = await import("@resvg/resvg-js");
      const resvg = new Resvg(buildSvg(), {
        fitTo: { mode: "width" as const, value: 1200 },
        font: { loadSystemFonts: true },
      });
      cachedPng = Buffer.from(resvg.render().asPng());
    }
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    res.end(cachedPng);
  } catch (err) {
    console.error("[OG Image] Generation failed:", err);
    res.status(500).send("Image generation failed");
  }
}

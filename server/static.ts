import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { canonicalRedirects, renderDocument, siteConfigFromEnv } from "./seo";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  const site = siteConfigFromEnv();
  const template = fs.readFileSync(path.resolve(distPath, "index.html"), "utf8");

  app.use(canonicalRedirects(site));

  // index: false so "/" falls through to the SEO-rendering handler below instead of the raw template.
  app.use(express.static(distPath, { index: false }));

  // The SPA shell, with the route's metadata already in the HTML: social and search crawlers do not
  // run JavaScript. Unknown routes answer 404; app and token screens answer 200 with noindex.
  app.use("*", (req, res) => {
    const pathname = req.originalUrl.split("?")[0];
    // A missing file (/og/old.jpg, /favicon.ico) is a 404, not an HTML page.
    if (path.extname(pathname)) return res.status(404).type("text/plain").send("Not found");

    const doc = renderDocument(template, pathname, site);
    if (doc.noindexHeader) res.setHeader("X-Robots-Tag", "noindex");
    res.status(doc.status).type("html").setHeader("Cache-Control", "no-cache");
    res.send(doc.html);
  });
}

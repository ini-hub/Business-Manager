import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, writeFile } from "fs/promises";
import { renderRobotsTxt, renderSitemap } from "../shared/seo/head";
import { siteConfigFromEnv } from "../server/seo";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@neondatabase/serverless",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "jsonwebtoken",
  "ws",
  "zod",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  // Crawl files are generated from shared/seo/pages.ts so the sitemap can only ever list indexable routes.
  const site = siteConfigFromEnv();
  await writeFile("dist/public/robots.txt", renderRobotsTxt(site));
  await writeFile("dist/public/sitemap.xml", renderSitemap(site, new Date().toISOString().slice(0, 10)));

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});

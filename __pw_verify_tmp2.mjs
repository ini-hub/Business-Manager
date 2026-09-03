import { chromium } from "playwright-core";
import fs from "fs";

const cookieVal = fs.readFileSync("/tmp/qa_cookies.txt", "utf8")
  .split("\n").find(l => l.includes("jwt_token"))
  .split("\t").pop().trim();

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.addCookies([{
  name: "jwt_token",
  value: cookieVal,
  domain: "localhost",
  path: "/",
  httpOnly: true,
  sameSite: "Lax",
}]);
const page = await context.newPage();
const errors = [];
page.on("console", msg => { if (msg.type() === "error") errors.push(msg.text()); });
page.on("pageerror", err => errors.push("pageerror: " + err.message));

// 1. /settings/store-settings - tab nav scroller
await page.goto("http://localhost:5001/settings/store-settings", { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
await page.screenshot({ path: "/tmp/qa_1_store_settings.png", fullPage: true });
console.log("URL after nav:", page.url());
console.log("BODY SNIPPET:", (await page.locator("body").innerText()).slice(0, 500));

// 2. click Promotions tab
await page.click("text=Promotions");
await page.waitForURL("**/settings/promotions", { timeout: 15000 });
console.log(JSON.stringify({consoleErrors: errors}, null, 2)); await browser.close();

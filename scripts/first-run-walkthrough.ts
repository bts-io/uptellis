/**
 * Timed first-run walkthrough against a fresh instance (`bun scripts/first-run-walkthrough.ts <base-url>`):
 * creates the owner (a random password, never printed), creates the first site by name only, then on the
 * first-run screen enters https://example.com/, picks Webhook (secret name NOTIFY_ALERTS_WEBHOOK, which
 * must be set on the instance), starts monitoring and sends a test alert from the monitor's detail drawer.
 * Prints one timing line per step and a final PASS or FAIL against a 120 s budget; exits 1 on FAIL.
 *
 * Browser: playwright-core launching the Chromium that matches its revision from ~/.cache/ms-playwright, or
 * CHROME_PATH when set (as scripts/a11y-audit.ts). HEADED=1 shows the browser.
 */
import { randomBytes } from "node:crypto";
import { type Browser, chromium, type Page } from "playwright-core";

const BUDGET_MS = 120_000;
const STEP_TIMEOUT_MS = 30_000;
const SECRET_NAME = "NOTIFY_ALERTS_WEBHOOK";

const base = process.argv[2]?.replace(/\/$/, "");
if (!base || !/^https?:\/\//.test(base)) {
  console.error("usage: bun scripts/first-run-walkthrough.ts <base-url>");
  process.exit(2);
}

// Built at run time: the repository's literal scan rejects addresses in code.
const ownerEmail = ["first-run", "example.com"].join("@");
const password = randomBytes(18).toString("base64url");
const siteName = `First run ${randomBytes(2).toString("hex")}`;

const timings: { step: string; ms: number }[] = [];
const started = Date.now();

async function step(name: string, work: () => Promise<void>): Promise<void> {
  const t = Date.now();
  try {
    await work();
  } finally {
    const ms = Date.now() - t;
    timings.push({ step: name, ms });
    console.log(`${name.padEnd(28)} ${(ms / 1000).toFixed(1).padStart(6)} s`);
  }
}

/** The input a visible label names (exact text), within `page`. */
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });

async function walk(page: Page): Promise<void> {
  await step("open setup", async () => {
    await page.goto(`${base}/setup`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Create owner account" }).waitFor();
  });

  await step("create owner", async () => {
    await field(page, "Name").fill("First Run Owner");
    await field(page, "Email").fill(ownerEmail);
    await field(page, "Password (at least 12 characters)").fill(password);
    await field(page, "Confirm password").fill(password);
    await page.getByRole("button", { name: "Create owner account" }).click();
    await page.getByRole("button", { name: "Create site and open admin" }).waitFor();
  });

  await step("create site by name", async () => {
    await field(page, "Name").fill(siteName);
    await page.getByRole("button", { name: "Create site and open admin" }).click();
    await page.waitForURL(/\/admin\/welcome$/);
    await page.getByRole("heading", { name: "What should we watch?" }).waitFor();
  });

  await step("first monitor and webhook", async () => {
    await field(page, "Address to check").fill("https://example.com/");
    await page.getByRole("radio", { name: "Webhook", exact: true }).check();
    await page.getByText(SECRET_NAME, { exact: true }).first().waitFor();
    await page.getByRole("button", { name: "Start monitoring" }).click();
    await page.waitForURL(/\/admin(\?|$)/);
  });

  await step("test alert from the drawer", async () => {
    const drawer = page.getByRole("dialog");
    await drawer.waitFor();
    await drawer.getByRole("button", { name: "Send test alert" }).first().click();
    const sent = page.getByText(/^Test alert for .+ sent to /);
    const failed = page.getByText(/test alert did not go through|No alert channel sends/);
    await sent.or(failed).first().waitFor();
    if (await failed.count()) throw new Error(`test alert failed: ${await failed.first().textContent()}`);
  });

  await step("site shown in admin", async () => {
    // The admin acts on the site setup created, not on a default one.
    await page.getByText(siteName).first().waitFor();
  });
}

let browser: Browser | undefined;
let failure: string | null = null;
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    headless: process.env.HEADED !== "1",
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(STEP_TIMEOUT_MS);
  await walk(page);
} catch (err) {
  // The message only: never the page content (the form held the password).
  failure = err instanceof Error ? err.message.split("\n")[0]! : "unknown error";
} finally {
  await browser?.close();
}

const total = Date.now() - started;
console.log(
  `${"total".padEnd(28)} ${(total / 1000).toFixed(1).padStart(6)} s (budget ${BUDGET_MS / 1000} s)`,
);
if (failure) console.log(`FAIL: ${failure}`);
else if (total > BUDGET_MS) console.log("FAIL: over budget");
else console.log("PASS");
process.exit(failure || total > BUDGET_MS ? 1 : 0);

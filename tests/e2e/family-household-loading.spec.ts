import { expect, test, type Page } from "@playwright/test";

const paths = ["members", "invitations", "readmissions", "folders/without-manager"];
const prefix = "/api/hestia/household/";
const deferred = () => { let resolve = () => {}; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
async function navigate(page: Page, name: string) { await page.getByRole("button", { name, exact: true }).filter({ visible: true }).first().click(); }
async function login(page: Page) {
  const secret = process.env.HESTIA_TEST_PASSWORD;
  if (!secret) throw new Error("Owned synthetic runner required");
  await page.goto("/");
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.getByLabel("Adresse e-mail", { exact: true }).fill("alex@hestia.invalid");
    await page.getByLabel("Mot de passe", { exact: true }).fill(secret);
    const response = page.waitForResponse(r => r.url().endsWith("/api/auth/sign-in/email"));
    await page.getByRole("button", { name: "Se connecter", exact: true }).click();
    if ((await response).status() !== 429) break;
    await page.waitForTimeout(10_100);
  }
  await expect(page.getByRole("heading", { name: "Dossiers", exact: true })).toBeVisible();
}
function body(path: string, label: string, nextOffset: number | null = null) {
  if (path === "members") return { members: [{ id: label, name: label, email: "member@example.invalid", role: "member", status: "active", membershipVersion: "1", allowedActions: { remove: false, readmit: false } }], nextOffset };
  if (path === "folders/without-manager") return { folders: [{ id: label, adminReference: label, creator: { id: "synthetic", name: "Synthétique" }, createdAt: "2026-01-01", vacantSince: "2026-01-02", readerCount: 1, canNominate: false }], nextOffset };
  return { invitations: [{ id: label, name: label, email: "invited@example.invalid", status: "pending", version: 1, expires_at: "2099-01-01", delivery: "sent" }], nextOffset };
}

test("Foyer charge les listes indépendantes ensemble et conserve toutes leurs pages", async ({ page }) => {
  await login(page);
  const gate = deferred(), arrived = new Set<string>(), seen = new Set<string>();
  await page.route("**/api/hestia/household/**", async route => {
    const url = new URL(route.request().url()), path = url.pathname.slice(prefix.length);
    if (!paths.includes(path)) return route.continue();
    const offset = Number(url.searchParams.get("offset"));
    seen.add(`${path}:${offset}`);
    if (!offset) { arrived.add(path); await gate.promise; }
    await route.fulfill({ json: body(path, `${path} page ${offset + 1}`, offset === 0 ? 1 : null) });
  });
  try {
    await navigate(page, "Foyer");
    // A slow members response must not prevent the other three lists starting.
    await expect.poll(() => arrived.size, { timeout: 3000 }).toBe(4);
    await expect(page.getByRole("tab", { name: "Membres", exact: true })).toHaveCount(0);
  } finally { gate.resolve(); }
  await expect(page.getByRole("tab", { name: "Membres", exact: true })).toBeVisible();
  for (const path of paths) for (const offset of [0, 1]) expect(seen.has(`${path}:${offset}`)).toBe(true);
  for (const label of ["members page 1", "members page 2", "folders/without-manager page 1", "folders/without-manager page 2"]) await expect(page.getByText(label, { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "En attente", exact: true }).click();
  for (const path of ["invitations", "readmissions"]) for (const offset of [1, 2]) await expect(page.getByText(`${path} page ${offset}`, { exact: true })).toBeVisible();
});

for (const status of [401, 403, 500]) test(`Foyer ignore les réponses tardives après refus ${status}`, async ({ page }) => {
  await login(page);
  const gate = deferred(), denied = deferred(), arrived = new Set<string>();
  let completed = 0;
  await page.route("**/api/hestia/household/**", async route => {
    const path = new URL(route.request().url()).pathname.slice(prefix.length);
    if (!paths.includes(path)) return route.continue();
    arrived.add(path);
    if (path === "members") { await denied.promise; await route.fulfill({ status, json: { error: { message: "Lecture indisponible" } } }); }
    else { await gate.promise; await route.fulfill({ json: body(path, "Réponse périmée") }); }
    completed++;
  });
  try {
    await navigate(page, "Foyer");
    await expect.poll(() => arrived.size).toBe(4);
    denied.resolve();
    if (status === 500) await expect(page.getByText("L’action n’a pas abouti.", { exact: true })).toBeVisible();
    else await expect(page.getByRole("heading", { name: "Connexion", exact: true })).toBeVisible();
  } finally { denied.resolve(); gate.resolve(); }
  await expect.poll(() => completed).toBe(4);
  await expect(page.getByText("Réponse périmée", { exact: true })).toHaveCount(0);
  if (status !== 500) await expect(page.getByRole("heading", { name: "Connexion", exact: true })).toBeVisible();
});

test("Foyer ne réutilise pas les réponses d'une ouverture abandonnée", async ({ page }) => {
  await login(page);
  const gate = deferred(), counts = new Map<string, number>();
  let oldCompleted = 0;
  await page.route("**/api/hestia/household/**", async route => {
    const path = new URL(route.request().url()).pathname.slice(prefix.length);
    if (!paths.includes(path)) return route.continue();
    const number = (counts.get(path) ?? 0) + 1; counts.set(path, number);
    if (number === 1) await gate.promise;
    await route.fulfill({ json: body(path, `${number === 1 ? "Ancien" : "Actuel"} ${path}`) });
    if (number === 1) oldCompleted++;
  });
  try {
    await navigate(page, "Foyer");
    await expect.poll(() => counts.size).toBe(4);
    await navigate(page, "Moi");
    await navigate(page, "Foyer");
    await expect(page.getByText("Actuel members", { exact: true })).toBeVisible();
  } finally { gate.resolve(); }
  await expect.poll(() => oldCompleted).toBe(4);
  await expect(page.getByText("Actuel members", { exact: true })).toBeVisible();
  await expect(page.getByText("Ancien members", { exact: true })).toHaveCount(0);
});

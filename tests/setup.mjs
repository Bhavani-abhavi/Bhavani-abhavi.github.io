/* Shared test setup: stub fetch so the browser modules load under node. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

globalThis.fetch = async (url) => {
  const name = String(url);
  const path = name.includes("claims.json")
    ? join(root, "evidence", "claims.json")
    : name.includes("sfd_backtest.json")
      ? join(root, "imw", "fixtures", "sfd_backtest.json")
      : null;
  if (!path) return { ok: false, status: 404, json: async () => ({}) };
  const body = readFileSync(path, "utf8");
  return { ok: true, status: 200, json: async () => JSON.parse(body) };
};

export { root };

import { test as setup } from "@playwright/test";
import { authFile, E2E_PASSWORD, WORLD } from "./fixtures";
import type { WorldUser } from "../server/scripts/e2e-world";

// Logs every seeded user in once and saves the session cookie, so specs start logged in.
for (const who of Object.keys(WORLD.users) as WorldUser[]) {
  setup(`log in ${who}`, async ({ request }) => {
    const res = await request.post("/api/auth/login", {
      data: { username: WORLD.users[who].username, password: E2E_PASSWORD },
    });
    if (!res.ok()) throw new Error(`login ${who}: ${res.status()} ${await res.text()}`);
    await request.storageState({ path: authFile(who) });
  });
}

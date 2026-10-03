import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { loadConfig } from "./config.js";
import type { Db } from "./db.js";
import { POLICY } from "./route.js";

interface Layer {
  route?: { path: string; methods: Record<string, boolean>; stack: Layer[] };
  handle?: ((...args: unknown[]) => unknown) & { stack?: Layer[]; [POLICY]?: unknown };
}

/** Every route layer in the app, including those inside mounted routers. */
function collectRoutes(stack: Layer[], out: NonNullable<Layer["route"]>[] = []) {
  for (const layer of stack) {
    if (layer.route) out.push(layer.route);
    else if (layer.handle?.stack) collectRoutes(layer.handle.stack, out);
  }
  return out;
}

describe("route policy coverage", () => {
  it("every registered route declares an access policy", () => {
    const app = createApp({
      config: loadConfig({ DATABASE_URL: "postgresql://unused/x", WEB_DIST: "." }),
      db: {} as Db, // never queried: the app is only built, not called
      logger: pino({ level: "silent" }),
      clock: () => new Date(),
    });
    const routes = collectRoutes((app as unknown as { router: { stack: Layer[] } }).router.stack);

    expect(routes.length).toBeGreaterThan(5);
    const unprotected = routes
      .filter((r) => !r.stack.some((l) => l.handle?.[POLICY] !== undefined))
      .map((r) => `${Object.keys(r.methods).join(",").toUpperCase()} ${r.path}`);
    expect(unprotected).toEqual([]);
  });
});

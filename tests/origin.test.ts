import { test } from "node:test";
import assert from "node:assert/strict";
import { sameOrigin } from "../src/lib/http";
test("Local origin aliases allow the delivered preview address without relaxing port or scheme checks", () => {
  const previous = process.env.CRM_APP_URL;
  delete process.env.CRM_APP_URL;
  const req = (origin?: string) =>
    new Request("http://localhost:3100/api/auth", {
      headers: origin ? { Origin: origin } : {},
    });
  try {
    for (const origin of [
      "http://localhost:3100",
      "http://127.0.0.1:3100",
      "http://[::1]:3100",
    ])
      assert.doesNotThrow(() => sameOrigin(req(origin)));
    for (const origin of [
      undefined,
      "null",
      "bad url",
      "http://127.0.0.1:3101",
      "https://127.0.0.1:3100",
      "https://evil.example",
      "http://localhost.evil.example:3100",
      "http://127.0.0.1:3100/path",
    ])
      assert.throws(() => sameOrigin(req(origin)), /origin is not allowed/);
    process.env.CRM_APP_URL = "https://crm.autoneural.in";
    assert.doesNotThrow(() => sameOrigin(req("https://crm.autoneural.in")));
    for (const origin of [
      "http://127.0.0.1:3100",
      "https://evil.example",
      "http://crm.autoneural.in",
    ])
      assert.throws(() => sameOrigin(req(origin)), /origin is not allowed/);
  } finally {
    if (previous === undefined) delete process.env.CRM_APP_URL;
    else process.env.CRM_APP_URL = previous;
  }
});

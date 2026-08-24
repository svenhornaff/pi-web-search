import { after, describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { safeFetch, readBoundedArrayBuffer, readBoundedText, MAX_RESPONSE_BYTES } from "../src/safe-fetch.ts";

const originalFetch = globalThis.fetch;

function stubFetch(handler: (input: string | URL | Request, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = handler as typeof fetch;
}

describe("safeFetch()", () => {
  test("follows an allowed redirect hop and returns the final response", async () => {
    const calls: string[] = [];
    stubFetch(async (input) => {
      const url = String(input);
      calls.push(url);
      if (url === "https://93.184.216.34/start") {
        return new Response(null, { status: 302, headers: { location: "https://93.184.216.34/final" } });
      }
      return new Response("ok", { status: 200 });
    });

    const response = await safeFetch("https://93.184.216.34/start");
    assert.equal(response.status, 200);
    assert.deepEqual(calls, [
      "https://93.184.216.34/start",
      "https://93.184.216.34/final",
    ]);
  });

  test("blocks a redirect hop that targets a private IP before it fires", async () => {
    stubFetch(async (input) => {
      const url = String(input);
      if (url === "https://93.184.216.34/start") {
        return new Response(null, { status: 302, headers: { location: "https://127.0.0.1/internal" } });
      }
      throw new Error("should not fetch the blocked hop");
    });

    await assert.rejects(() => safeFetch("https://93.184.216.34/start"), /Blocked network target/);
  });

  test("rejects an already-blocked initial URL without calling fetch", async () => {
    stubFetch(async () => {
      throw new Error("fetch should not be called for a blocked URL");
    });

    await assert.rejects(() => safeFetch("https://127.0.0.1/"), /Blocked network target/);
  });

  test("gives up after too many redirect hops", async () => {
    let hop = 0;
    stubFetch(async () => {
      hop += 1;
      return new Response(null, { status: 302, headers: { location: `https://93.184.216.34/hop-${hop}` } });
    });

    await assert.rejects(() => safeFetch("https://93.184.216.34/hop-0"), /Too many redirects/);
  });
});

describe("readBoundedArrayBuffer() / readBoundedText()", () => {
  test("rejects when Content-Length exceeds the cap", async () => {
    const response = new Response("small body", {
      status: 200,
      headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) },
    });
    await assert.rejects(() => readBoundedArrayBuffer(response), /too large/i);
  });

  test("rejects when the streamed body exceeds the cap even without an accurate Content-Length", async () => {
    const chunk = new Uint8Array(1024).fill(97);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.close();
      },
    });
    const response = new Response(stream);
    await assert.rejects(() => readBoundedArrayBuffer(response, 512), /exceeded/i);
  });

  test("reads bodies within the cap", async () => {
    const response = new Response("hello world");
    const text = await readBoundedText(response, 1024);
    assert.equal(text, "hello world");
  });
});

after(() => {
  globalThis.fetch = originalFetch;
});

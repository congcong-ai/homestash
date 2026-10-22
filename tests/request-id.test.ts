import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { z } from "zod";
import { createRequestId } from "../packages/api-client/src/index";

test("HTTP局域网缺少randomUUID时，安全随机数生成的请求ID符合协议且不重复", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  try {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) },
    });
    const ids = Array.from({ length: 100 }, createRequestId);
    for (const id of ids) assert.equal(z.uuidv4().parse(id), id);
    assert.equal(new Set(ids).size, ids.length);
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {},
    });
    assert.throws(createRequestId, /安全随机数/);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor);
    else Reflect.deleteProperty(globalThis, "crypto");
  }
  assert.equal(z.uuidv4().parse(createRequestId()).length, 36);
});

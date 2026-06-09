import test from "node:test";
import assert from "node:assert/strict";
import { getProcessedMessageInsertCount } from "../src/models/AuthWhatsapp/AuthWhatsapp.service.js";

test("processed-message insert count detects first insert", () => {
  assert.equal(getProcessedMessageInsertCount({ affectedRows: 1 }), 1);
  assert.equal(getProcessedMessageInsertCount(null, { affectedRows: 1 }), 1);
  assert.equal(getProcessedMessageInsertCount(1), 1);
});

test("processed-message insert count detects duplicate insert ignore", () => {
  assert.equal(getProcessedMessageInsertCount({ affectedRows: 0 }), 0);
  assert.equal(getProcessedMessageInsertCount(null, { affectedRows: 0 }), 0);
  assert.equal(getProcessedMessageInsertCount(0), 0);
});

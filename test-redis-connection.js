/**
 * Redis + BullMQ connection test for WhatNexus campaign queues.
 *
 * Run from backend/:
 *   node test-redis-connection.js
 *
 * Optionally inspect a tenant send queue and DLQ:
 *   $env:TEST_TENANT_ID="some_tenant_id"; node test-redis-connection.js
 */

import "dotenv/config";
import IORedis from "ioredis";
import { Queue } from "bullmq";

const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";

const redactRedisUrl = (value) => {
  try {
    const parsed = new URL(value);
    if (parsed.username) parsed.username = "<hidden>";
    if (parsed.password) parsed.password = "<hidden>";
    return parsed.toString();
  } catch {
    return "<invalid REDIS_URL>";
  }
};

console.log("Testing connection to:", redactRedisUrl(redisUrl));

const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

const queues = [];

const inspectQueue = async (queueName) => {
  const queue = new Queue(queueName, { connection });
  queues.push(queue);
  console.log(`campaign queue ${queueName}:`, await queue.getJobCounts());
};

try {
  const pong = await connection.ping();
  console.log("PING:", pong);

  const info = await connection.info("server");
  const redisVersion = info
    .split("\n")
    .find((line) => line.startsWith("redis_version"))
    ?.trim();
  console.log("Redis server:", redisVersion || "version unavailable");

  await inspectQueue("campaign-dispatch");

  const tenantId = String(process.env.TEST_TENANT_ID || "").trim();
  if (tenantId) {
    await inspectQueue(`campaignQueue-${tenantId}`);
    await inspectQueue(`campaignDLQ-${tenantId}`);
  } else {
    console.log(
      "Set TEST_TENANT_ID to also inspect a tenant send queue and DLQ.",
    );
  }

  console.log("Redis + BullMQ verified against the configured REDIS_URL.");
} catch (error) {
  console.error("Connection test failed:", error.stack || error.message);
  console.error(
    "Check backend/.env REDIS_URL, network reachability, authentication, TLS, and Redis availability.",
  );
  process.exitCode = 1;
} finally {
  await Promise.allSettled(queues.map((queue) => queue.close()));

  try {
    if (connection.status === "ready") {
      await connection.quit();
    } else {
      connection.disconnect();
    }
  } catch {
    connection.disconnect();
  }
}

var tester = require('greenlock-store-test');

const { RedisMemoryServer } = require('redis-memory-server');


async function bootstrapRedisForTesting() {
  const redisServer = new RedisMemoryServer();
  const host = await redisServer.getHost();
  const port = await redisServer.getPort();

  const redisUrl = `redis://${host}:${port}`;

  console.info("Redis URL: ", redisUrl);

  return {
    host,
    port,
    redisUrl,
    redisServer,
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startTester () {
  const {
    redisUrl,
    redisServer,
  } = await bootstrapRedisForTesting();

  var store = require('./index').create({
    redisUrl,
  });

  // All of these tests can pass locally, standalone without any ACME integration.
  try {
    console.info("Starting tests...");
    await tester.test(store)

    console.info("PASS");
  } catch (e) {
    console.error("FAIL", e);
  } finally {
    await store.redis.disconnect();
    await redisServer.stop();
    process.exit(1);
  }
}

startTester();

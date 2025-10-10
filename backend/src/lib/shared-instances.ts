import Redis from "ioredis";
import { drizzleDb, DrizzleDB, closePool } from "./db";
import { CacheControlService } from "@backend/modules/cache_control/service";

// Singleton instances
let redisClient: Redis | null = null;
let cacheService: CacheControlService | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    console.log('[shared] Creating new Redis client...');
    redisClient = new Redis({
      port: parseInt(process.env.REDIS_PORT || "6379"),
      host: process.env.REDIS_HOST,
      maxRetriesPerRequest: null,
    });
  }
  return redisClient;
}

export function getCacheControlService(): CacheControlService {
  if (!cacheService) {
    console.log('[shared] Creating new CacheControlService...');
    const redis = getRedisClient();
    cacheService = new CacheControlService(drizzleDb, redis);
  }
  return cacheService;
}

// Cleanup function for graceful shutdown
export async function cleanup(): Promise<void> {
  console.log('[shared] Starting cleanup...');

  if (redisClient) {
    console.log('[shared] Closing Redis connection...');
    await redisClient.quit();
    redisClient = null;
  }

  await closePool();

  cacheService = null;
  console.log('[shared] Cleanup complete');
}

export { drizzleDb };

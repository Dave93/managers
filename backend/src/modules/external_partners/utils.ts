import { externalPartners } from "backend/drizzle/schema";
import { InferSelectModel } from "drizzle-orm";
import { randomBytes } from 'crypto';
import Redis from "ioredis";

const CACHE_PREFIX = `${process.env.PROJECT_PREFIX}external_partner`;
const CACHE_SET_KEY = `${CACHE_PREFIX}:ids`;
const CACHE_EMAIL_PREFIX = `${CACHE_PREFIX}:email`;
const CACHE_TTL = 60 * 60 * 24; // 24 hours

// Helper functions for cache management
async function cachePartner(redis: any, partner: InferSelectModel<typeof externalPartners>) {
    const key = `${CACHE_PREFIX}:${partner.id}`;
    await redis.setex(key, CACHE_TTL, JSON.stringify(partner));
    await redis.sadd(CACHE_SET_KEY, partner.id);

    // Also cache by email if it exists
    if (partner.email) {
        const emailKey = `${CACHE_EMAIL_PREFIX}:${partner.email}`;
        await redis.setex(emailKey, CACHE_TTL, JSON.stringify(partner));
    }
}

async function invalidatePartnerCache(redis: Redis, partnerId: string, email?: string) {
    const key = `${CACHE_PREFIX}:${partnerId}`;
    await redis.del(key);
    await redis.srem(CACHE_SET_KEY, partnerId);

    // Also invalidate email cache if email is provided
    if (email) {
        const emailKey = `${CACHE_EMAIL_PREFIX}:${email}`;
        await redis.del(emailKey);
    }
}

async function getCachedPartner(redis: Redis, partnerId: string): Promise<InferSelectModel<typeof externalPartners> | null> {
    const key = `${CACHE_PREFIX}:${partnerId}`;
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
}

async function getCachedPartnerByEmail(redis: Redis, email: string): Promise<InferSelectModel<typeof externalPartners> | null> {
    const emailKey = `${CACHE_EMAIL_PREFIX}:${email}`;
    const data = await redis.get(emailKey);
    return data ? JSON.parse(data) : null;
}

async function getAllCachedPartners(redis: Redis): Promise<InferSelectModel<typeof externalPartners>[]> {
    const ids = await redis.smembers(CACHE_SET_KEY);
    if (!ids || ids.length === 0) return [];

    const partners = await Promise.all(
        ids.map((id: string) => getCachedPartner(redis, id))
    );

    return partners.filter((p): p is InferSelectModel<typeof externalPartners> => p !== null);
}

async function generateToken(redis: Redis, partner: InferSelectModel<typeof externalPartners>, ttl: number = CACHE_TTL) {
    const token = randomBytes(32).toString("base64url");
    await redis.setex(`${CACHE_PREFIX}:token:${token}`, ttl, JSON.stringify(partner));
    return token;
}

async function generateRefreshToken(redis: Redis, partner: InferSelectModel<typeof externalPartners>, ttl: number = CACHE_TTL) {
    const token = randomBytes(32).toString("base64url");
    await redis.setex(`${CACHE_PREFIX}:refresh_token:${token}`, ttl, JSON.stringify(partner));
    return token;
}

async function getCachedPartnerByRefreshToken(redis: Redis, refreshToken: string): Promise<InferSelectModel<typeof externalPartners> | null> {
    const refreshTokenKey = `${CACHE_PREFIX}:refresh_token:${refreshToken}`;
    const data = await redis.get(refreshTokenKey);
    return data ? JSON.parse(data) : null;
}

async function getCachedPartnerByAccessToken(redis: Redis, accessToken: string): Promise<InferSelectModel<typeof externalPartners> | null> {
    const accessTokenKey = `${CACHE_PREFIX}:token:${accessToken}`;
    const data = await redis.get(accessTokenKey);
    return data ? JSON.parse(data) : null;
}

export {
    cachePartner,
    invalidatePartnerCache,
    getCachedPartner,
    getCachedPartnerByEmail,
    getAllCachedPartners,
    generateToken,
    generateRefreshToken,
    getCachedPartnerByRefreshToken,
    getCachedPartnerByAccessToken,
};
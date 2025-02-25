import Redis from "ioredis";

class TokenManager {
    private static instance: TokenManager;
    private currentToken: string | null = null;
    private tokenExpireTime: number | null = null;
    private readonly TOKEN_LIFETIME = 30 * 60; // 30 minutes in seconds
    private readonly API_BASE_URL = "https://les-ailes-co-co.iiko.it/resto/api";
    private redis: Redis;

    private constructor() {
        const client = new Redis({
            port: 6379,
            host: process.env.REDIS_HOST,
            retryStrategy(times) {
                const delay = Math.min(times * 50, 2000);
                return delay;
            },
        });

        client.on('error', (err) => {
            console.error('Redis Client Error:', err);
        });

        this.redis = client;
    }

    public static getInstance(): TokenManager {
        if (!TokenManager.instance) {
            TokenManager.instance = new TokenManager();
        }
        return TokenManager.instance;
    }

    private async requestNewToken(): Promise<string> {

        if (!process.env.LOGIN || !process.env.PASS) {
            throw new Error('LOGIN and PASS environment variables must be set');
        }

        try {
            const response = await fetch(
                `${this.API_BASE_URL}/auth?login=${process.env.LOGIN}&pass=${process.env.PASS}`,
                {
                    method: "GET",
                }
            );

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to get token: ${response.status} ${response.statusText}. ${errorText}`);
            }

            const token = await response.text();
            if (!token || token.trim() === '') {
                throw new Error('Received empty token from server');
            }

            this.currentToken = token.trim();
            await this.redis.set("shahzod_iiko_token", this.currentToken, "EX", this.TOKEN_LIFETIME);

            return this.currentToken;
        } catch (error) {
            console.error('Failed to get token:', error);
            await this.invalidateToken();
            throw error;
        }
    }

    public async getToken(): Promise<string> {

        try {
            if (await this.isTokenValid()) {
                const token = await this.getCurrentToken();
                if (!token) {
                    return await this.requestNewToken();
                }
                return token;
            }
            return await this.requestNewToken();
        } catch (error) {
            await this.invalidateToken();
            throw error;
        } finally {
        }
    }

    private async isTokenValid(): Promise<boolean> {
        const token = await this.getCurrentToken();
        return token !== null;
    }

    public async logout(): Promise<void> {

        const token = await this.getCurrentToken();
        if (token) {
            try {
                const response = await fetch(
                    `${this.API_BASE_URL}/logout?key=${token}`,
                    {
                        method: "GET",
                    }
                );

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Failed to logout: ${response.status} ${response.statusText}. ${errorText}`);
                }
            } catch (error) {
                console.error('Error during logout:', error);
                throw error;
            } finally {
                await this.invalidateToken();
            }
        }
    }

    public async invalidateToken(): Promise<void> {
        await this.redis.del("shahzod_iiko_token");
    }

    public async getTokenExpireTime(): Promise<number | null> {
        return await this.redis.ttl("shahzod_iiko_token");
    }

    public async getCurrentToken(): Promise<string | null> {
        return await this.redis.get("shahzod_iiko_token");
    }
}

export default TokenManager;
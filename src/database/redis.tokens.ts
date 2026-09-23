/**
 * Injection token for the shared Redis client. Lives in its own module so the
 * realtime service (which consumes it) and the Cache/Redis module (which
 * provides it) never import each other cyclically.
 */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');
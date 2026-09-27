import { RedisThrottlerStorage } from '../../../src/database/redis-throttler.storage';

function buildStorage(opts: { totalHits?: number; fail?: boolean } = {}) {
  const { totalHits = 1, fail = false } = opts;
  let chain:
    | {
        incr: jest.Mock;
        expire: jest.Mock;
        exec: jest.Mock;
      }
    | undefined;
  const multi = jest.fn(() => {
    chain = {
      incr: jest.fn(() => chain),
      expire: jest.fn(() => chain),
      exec: jest.fn(() =>
        fail
          ? Promise.reject(new Error('EREDIS down'))
          : Promise.resolve([
              [null, totalHits],
              [null, 'OK'],
            ]),
      ),
    };
    return chain;
  });
  const storage = new RedisThrottlerStorage({ multi } as never);
  const lastKey = () => chain?.incr.mock.calls[0]?.[0] as string;
  const lastExpire = () => chain?.expire.mock.calls[0]?.[1] as number;
  return { storage, multi, lastKey, lastExpire };
}

describe('RedisThrottlerStorage', () => {
  it('floors a 60s millisecond ttl into a whole-second fixed window', async () => {
    const { storage, lastKey, lastExpire } = buildStorage();
    const result = await storage.increment('ip-1', 60_000, 120, 0, 'default');

    const nowSec = Math.floor(Date.now() / 1000);
    const bucketStart = Math.floor(nowSec / 60) * 60;
    expect(lastKey()).toBe(`throttle:default:ip-1:${bucketStart}`);
    expect(lastExpire()).toBe(90);
    expect(result.timeToExpire).toBeGreaterThanOrEqual(1);
    expect(result.timeToExpire).toBeLessThanOrEqual(60);
  });

  it('treats the old sub-bucket root throttlers (5s ttl) as seconds, not ~seconds', async () => {
    const { storage, lastKey, lastExpire } = buildStorage();
    await storage.increment('ip-2', 5_000, 30, 0, 'short');

    const nowSec = Math.floor(Date.now() / 1000);
    const bucketStart = Math.floor(nowSec / 5) * 5;
    expect(lastKey()).toBe(`throttle:short:ip-2:${bucketStart}`);
    expect(bucketStart % 5).toBe(0);
    expect(lastExpire()).toBe(35);
  });

  it('sub-second ttls floor to a 1s minimum window', async () => {
    const { storage, lastKey, lastExpire } = buildStorage();
    await storage.increment('ip-3', 500, 10, 0, 'default');

    const nowSec = Math.floor(Date.now() / 1000);
    expect(lastKey()).toBe(`throttle:default:ip-3:${nowSec}`);
    expect(lastExpire()).toBe(31);
  });

  it('blocks when hits exceed the limit within the window', async () => {
    const { storage } = buildStorage({ totalHits: 4 });
    const result = await storage.increment('ip-4', 60_000, 3, 30_000, 'default');
    expect(result.isBlocked).toBe(true);
    expect(result.totalHits).toBe(4);
    expect(result.timeToBlockExpire).toBeGreaterThan(0);
  });

  it('fails open (unlimited) when Redis is unreachable', async () => {
    const { storage } = buildStorage({ fail: true });
    const result = await storage.increment('ip-5', 60_000, 3, 30_000, 'default');
    expect(result.isBlocked).toBe(false);
    expect(result.totalHits).toBe(1);
    expect(result.timeToBlockExpire).toBe(0);
  });
});
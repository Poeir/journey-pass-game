import { describe, it, expect } from 'vitest';
import { deterministicPairId } from './pairId.js';

const DAY = '2026-05-11';

describe('deterministicPairId', () => {
  describe('TRIVIA — symmetric per UTC day', () => {
    it('produces the same id regardless of scanner/target order', () => {
      const a = deterministicPairId('E001', 'E002', 'TRIVIA', DAY);
      const b = deterministicPairId('E002', 'E001', 'TRIVIA', DAY);
      expect(a).toBe(b);
    });

    it('produces different ids for different employees on the same day', () => {
      const ab = deterministicPairId('E001', 'E002', 'TRIVIA', DAY);
      const ac = deterministicPairId('E001', 'E003', 'TRIVIA', DAY);
      expect(ab).not.toBe(ac);
    });

    it('rolls over on day change', () => {
      const today = deterministicPairId('E001', 'E002', 'TRIVIA', '2026-05-11');
      const tomorrow = deterministicPairId('E001', 'E002', 'TRIVIA', '2026-05-12');
      expect(today).not.toBe(tomorrow);
    });
  });

  describe('TEAMMATE — directional per UTC day', () => {
    it('produces DIFFERENT ids when scanner/target are swapped (directional)', () => {
      const a = deterministicPairId('E001', 'E002', 'TEAMMATE', DAY);
      const b = deterministicPairId('E002', 'E001', 'TEAMMATE', DAY);
      expect(a).not.toBe(b);
    });

    it('is stable for the same direction across calls', () => {
      const a1 = deterministicPairId('E001', 'E002', 'TEAMMATE', DAY);
      const a2 = deterministicPairId('E001', 'E002', 'TEAMMATE', DAY);
      expect(a1).toBe(a2);
    });
  });

  describe('Cross-kind isolation', () => {
    it('TRIVIA and TEAMMATE pair ids differ for same (A, B, day)', () => {
      const trivia = deterministicPairId('E001', 'E002', 'TRIVIA', DAY);
      const teammate = deterministicPairId('E001', 'E002', 'TEAMMATE', DAY);
      expect(trivia).not.toBe(teammate);
    });
  });

  describe('Output shape', () => {
    it('always returns a 16-character hex string', () => {
      const id = deterministicPairId('E001', 'E002', 'TRIVIA', DAY);
      expect(id).toMatch(/^[0-9a-f]{16}$/);
    });

    it('different inputs map to length-16 hex', () => {
      const inputs: Array<[string, string]> = [
        ['A', 'B'],
        ['EMP-0001', 'EMP-9999'],
        ['x', 'y'],
      ];
      for (const [s, t] of inputs) {
        expect(deterministicPairId(s, t, 'TRIVIA', DAY)).toMatch(/^[0-9a-f]{16}$/);
      }
    });
  });

  describe('Day bucket — UTC, not local', () => {
    it('uses the day string as-is — different day strings produce different ids', () => {
      // UTC midnight boundary: 23:59 vs 00:01 next day. The caller passes the
      // day bucket directly here, so we just verify the contract that a day
      // change always changes the pair id. (`gameNow().toISOString().slice(0,10)`
      // is the production day-bucket source; tested separately in gameClock.)
      const beforeMidnightUtc = deterministicPairId('E001', 'E002', 'TRIVIA', '2026-05-11');
      const afterMidnightUtc = deterministicPairId('E001', 'E002', 'TRIVIA', '2026-05-12');
      expect(beforeMidnightUtc).not.toBe(afterMidnightUtc);
    });
  });
});

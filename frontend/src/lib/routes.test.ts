import { describe, it, expect } from 'vitest';
import { ROUTES } from './routes';

describe('ROUTES — static paths', () => {
  it('exposes welcome / user / missions / etc.', () => {
    expect(ROUTES.welcome).toBe('/');
    expect(ROUTES.user).toBe('/user');
    expect(ROUTES.missions).toBe('/missions');
    expect(ROUTES.triviaIntro).toBe('/missions/trivia');
    expect(ROUTES.triviaCards).toBe('/missions/trivia/cards');
    expect(ROUTES.teammateIntro).toBe('/missions/teammate');
    expect(ROUTES.teammate).toBe('/missions/teammate/list');
    expect(ROUTES.teammateScan).toBe('/missions/teammate/scan');
    expect(ROUTES.complete).toBe('/complete');
    expect(ROUTES.timeUp).toBe('/time-up');
    expect(ROUTES.memoryWall).toBe('/memory');
    expect(ROUTES.ranking).toBe('/ranking');
  });
});

describe('ROUTES — dynamic builders', () => {
  it('triviaScan(cardId) returns the scan path', () => {
    expect(ROUTES.triviaScan('CARD-01')).toBe('/missions/trivia/CARD-01/scan');
  });

  it('fail(pairId) returns the fail path', () => {
    expect(ROUTES.fail('pair-abc')).toBe('/result/fail/pair-abc');
  });

  it('chatConfirm(pairId) returns the chat path', () => {
    expect(ROUTES.chatConfirm('pair-xyz')).toBe('/chat/pair-xyz');
  });

  describe('success(ref) — URL-encodes the ref', () => {
    it('encodes plain ref', () => {
      expect(ROUTES.success('CARD-01')).toBe('/result/success?ref=CARD-01');
    });

    it('encodes special chars (slash, space)', () => {
      // encodeURIComponent('a/b c') → 'a%2Fb%20c'
      expect(ROUTES.success('a/b c')).toBe('/result/success?ref=a%2Fb%20c');
    });

    it('encodes ampersand to avoid query-string collision', () => {
      expect(ROUTES.success('x&y')).toBe('/result/success?ref=x%26y');
    });
  });
});

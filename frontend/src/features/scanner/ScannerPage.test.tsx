import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Employee } from '@/types/game';

// =====================================================================
// Mocks
// =====================================================================

// Capture the success callback that html5-qrcode would normally call on a
// successful decode. Tests invoke it directly to exercise the dispatch
// logic without needing a real camera or DOM video element.
const captured = vi.hoisted(() => ({
  onDecoded: null as ((decoded: string) => void) | null,
}));

vi.mock('html5-qrcode', () => {
  // Real Html5Qrcode is `new`-able; the mock has to be a constructor too.
  // arrow-functions and vi.fn().mockImplementation(() => ...) do NOT support
  // `new` — use an actual class.
  class MockHtml5Qrcode {
    start = vi.fn(
      async (
        _camera: unknown,
        _config: unknown,
        onSuccess: (decoded: string) => void,
      ) => {
        captured.onDecoded = onSuccess;
      },
    );
    stop = vi.fn(async () => {});
    clear = vi.fn();
    getState = vi.fn(() => 2);
  }
  return {
    Html5Qrcode: MockHtml5Qrcode,
    Html5QrcodeScannerState: { SCANNING: 2, PAUSED: 3 },
  };
});

// Navigation spy. useParams keeps reading from the router, but we override
// useNavigate to a vi.fn we can assert against.
const navigateMock = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useParams: () => ({ cardId: 'CARD-01' }),
  };
});

// scanEndpoints — controlled outcome per test.
const scanMock = vi.hoisted(() => vi.fn());
vi.mock('@/api/endpoints', () => ({
  scanEndpoints: { scan: scanMock },
}));

// Asset imports — Vitest doesn't bundle PNGs.
vi.mock('../../../assets/card02.png', () => ({ default: 'card02.png' }));
vi.mock('../../../assets/button_exit.png', () => ({ default: 'button_exit.png' }));

// =====================================================================
// Imports after mocks are set
// =====================================================================
import { ScannerPage } from './ScannerPage';
import { useGame } from '@/game/gameStore';
import { useErrorStore } from '@/lib/errorStore';
import { useLanguageStore } from '@/lib/i18n/languageStore';

// =====================================================================
// Fixtures
// =====================================================================
const PROFILE = {
  id: 'S001',
  name: 'Scanner',
  initial: 'S',
  dept: 'ENG',
  year: 2024,
  isLeader: false,
  email: 's@x.co',
};

const TARGET: Employee = {
  id: 'T001',
  name: 'Target',
  initial: 'T',
  dept: 'ENG',
  year: 2024,
  isLeader: false,
};

function renderScanner(mode: 'trivia' | 'teammate') {
  return render(
    <MemoryRouter>
      <ScannerPage mode={mode} />
    </MemoryRouter>,
  );
}

// After mount, html5-qrcode's mocked `start` resolves and captures the
// success callback. waitFor polls until the ref is populated.
async function waitForScannerReady(): Promise<(payload: string) => void> {
  await waitFor(() => {
    expect(captured.onDecoded).not.toBeNull();
  });
  return captured.onDecoded!;
}

// Helper: invoke the captured callback under act() and flush the promise
// returned by scanEndpoints.scan + the state updates it triggers.
async function trigger(payload: string, cb: (p: string) => void) {
  await act(async () => {
    cb(payload);
    // Flush microtask queue twice — once for scanEndpoints.scan resolve,
    // once for the subsequent setState calls.
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  captured.onDecoded = null;
  navigateMock.mockReset();
  scanMock.mockReset();
  useErrorStore.setState({ toasts: [] });
  useLanguageStore.setState({ lang: 'en' });
  useGame.getState().reset();
  useGame.setState({
    profile: PROFILE,
    trivia: {
      cards: [{ id: 'CARD-01', index: 1, clue: 'find someone', targetId: 'X' }],
      stamps: {},
    },
  });
});

// =====================================================================
// Trivia mode dispatch
// =====================================================================
describe('ScannerPage trivia — outcome dispatch', () => {
  it('match → addTriviaStamp + navigate to /result/success?ref=<cardId>', async () => {
    scanMock.mockResolvedValueOnce({
      outcome: 'match',
      card_ref: 'CARD-01',
      stamp: { id: 'scan-1', target: TARGET },
    });
    renderScanner('trivia');
    const fire = await waitForScannerReady();

    await trigger(TARGET.id, fire);

    await waitFor(() => {
      expect(scanMock).toHaveBeenCalledWith({
        scanner_id: PROFILE.id,
        scanned_id: TARGET.id,
        card_ref: 'CARD-01',
      });
      expect(useGame.getState().trivia.stamps['CARD-01']).toEqual(TARGET);
      expect(navigateMock).toHaveBeenCalledWith(
        '/result/success?ref=CARD-01',
        expect.objectContaining({ state: expect.objectContaining({ target: TARGET }) }),
      );
    });
  });

  it('mismatch → setPenalty(hunter) + navigate to /result/fail/<pairId>', async () => {
    scanMock.mockResolvedValueOnce({
      outcome: 'mismatch',
      pair_id: 'pair-abc',
      target: TARGET,
    });
    renderScanner('trivia');
    const fire = await waitForScannerReady();

    await trigger(TARGET.id, fire);

    await waitFor(() => {
      expect(useGame.getState().pendingPenalty).toEqual({
        pairId: 'pair-abc',
        role: 'hunter',
      });
      expect(navigateMock).toHaveBeenCalledWith('/result/fail/pair-abc');
    });
  });
});

// =====================================================================
// Teammate mode dispatch
// =====================================================================
describe('ScannerPage teammate — outcome dispatch', () => {
  it('chat → setChatTarget + navigate to /chat/<pairId>', async () => {
    scanMock.mockResolvedValueOnce({
      outcome: 'chat',
      pair_id: 'pair-xyz',
      target: TARGET,
    });
    renderScanner('teammate');
    const fire = await waitForScannerReady();

    await trigger(TARGET.id, fire);

    await waitFor(() => {
      expect(useGame.getState().chatTarget).toEqual(TARGET);
      expect(navigateMock).toHaveBeenCalledWith('/chat/pair-xyz');
    });
  });

  it('wrong_year → error toast, NO navigation, scanner stays open for retry', async () => {
    scanMock.mockResolvedValueOnce({ outcome: 'wrong_year', target: TARGET });
    renderScanner('teammate');
    const fire = await waitForScannerReady();

    await trigger(TARGET.id, fire);

    await waitFor(() => {
      const toasts = useErrorStore.getState().toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0].kind).toBe('error');
      expect(toasts[0].message).toContain(TARGET.name);
      expect(navigateMock).not.toHaveBeenCalled();
    });
  });

  it('already_added → INFO toast, no navigation', async () => {
    scanMock.mockResolvedValueOnce({ outcome: 'already_added', target: TARGET });
    renderScanner('teammate');
    const fire = await waitForScannerReady();

    await trigger(TARGET.id, fire);

    await waitFor(() => {
      const toasts = useErrorStore.getState().toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0].kind).toBe('info'); // already_added is info, others are error
      expect(navigateMock).not.toHaveBeenCalled();
    });
  });

  it('leader_clash → error toast, no navigation', async () => {
    scanMock.mockResolvedValueOnce({ outcome: 'leader_clash', target: TARGET });
    renderScanner('teammate');
    const fire = await waitForScannerReady();

    await trigger(TARGET.id, fire);

    await waitFor(() => {
      const toasts = useErrorStore.getState().toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0].kind).toBe('error');
      expect(navigateMock).not.toHaveBeenCalled();
    });
  });

  it('teammate_full → error toast, no navigation', async () => {
    scanMock.mockResolvedValueOnce({ outcome: 'teammate_full', target: TARGET });
    renderScanner('teammate');
    const fire = await waitForScannerReady();

    await trigger(TARGET.id, fire);

    await waitFor(() => {
      expect(useErrorStore.getState().toasts).toHaveLength(1);
      expect(navigateMock).not.toHaveBeenCalled();
    });
  });
});

// =====================================================================
// Self-scan + dedup guard rails
// =====================================================================
describe('ScannerPage — guard rails', () => {
  it('self-scan (payload === profile.id) shows info toast, NO API call', async () => {
    renderScanner('teammate');
    const fire = await waitForScannerReady();

    await trigger(PROFILE.id, fire);

    expect(scanMock).not.toHaveBeenCalled();
    const toasts = useErrorStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].kind).toBe('info');
  });

  it('same payload scanned twice within 3s → API called ONCE (dedup)', async () => {
    scanMock.mockResolvedValueOnce({
      outcome: 'wrong_year',
      target: TARGET,
    });
    renderScanner('teammate');
    const fire = await waitForScannerReady();

    await trigger(TARGET.id, fire);
    // Second call to same payload immediately — should be deduped.
    await trigger(TARGET.id, fire);

    expect(scanMock).toHaveBeenCalledTimes(1);
  });
});

import type { Employee, Profile, ScanOutcome, TriviaCard } from '@/types/game';
import { api } from './client';

export const authEndpoints = {
  logout: () => api.post<void>('/auth/logout'),
  me: () => api.get<Profile>('/me'),
  pendingPenalty: () =>
    api.get<{ pending: { pairId: string; role: 'hunter' | 'target' } | null }>(
      '/me/pending-penalty',
    ),
  pendingChat: () =>
    api.get<{
      pending: {
        pairId: string;
        role: 'hunter' | 'target';
        counterpart: Employee;
      } | null;
    }>('/me/pending-chat'),
  progress: () =>
    api.get<{
      cards: TriviaCard[];
      triviaStamps: Record<string, Employee>;
      teammateSlots: Employee[];
      completedAt: string | null;
      gameEndedAt: string | null;
      leaderClue: string | null;
    }>('/me/progress'),
  criteria: () => api.get<{ criteria: string[] }>('/me/criteria'),
  finalizeAll: () => api.post<{ endedAt: string }>('/completion/finalize-all'),
};

// Dev-only: bypass Azure SSO for local testing. The backend only registers
// these routes when DEV_LOGIN_ENABLED=true; calls 404 otherwise. The welcome
// page hides the dev UI behind VITE_DEV_LOGIN_ENABLED to keep this off the
// production bundle entirely.
export type DevEmployee = {
  id: string;
  name: string;
  dept: string;
  year: number;
  isLeader: boolean;
};

export const devAuthEndpoints = {
  listEmployees: () => api.get<{ employees: DevEmployee[] }>('/auth/dev/employees'),
  login: (employeeId: string) =>
    api.post<{ ok: true; employeeId: string }>('/auth/dev/login', { employeeId }),
};

export const missionEndpoints = {
  startTrivia: () => api.get<{ cards: TriviaCard[] }>('/missions/trivia/start'),
  startTeammate: () =>
    api.get<{ year: number; leaderClue: string | null }>('/missions/teammate/start'),
};

export const scanEndpoints = {
  scan: (body: { scanner_id: string; scanned_id: string; card_ref?: string }) =>
    api.post<ScanOutcome>('/scans', body),
  confirmPenalty: (pairId: string, photo: File) => {
    const form = new FormData();
    form.append('photo', photo);
    return api.postForm<{ proofPhotoUrl: string }>(`/penalty/${pairId}/confirm`, form);
  },
  getPenaltyState: (pairId: string) =>
    api.get<{
      targetConfirmed: boolean;
      proofPhotoUrl: string | null;
      penalty: { id: string; text: string } | null;
      hunter: { id: string; name: string } | null;
      target: { id: string; name: string } | null;
    }>(`/penalty/${pairId}`),
  confirmYear: (pairId: string, year: number) =>
    api.post<{ matched: boolean; target?: Employee }>(`/teammate/${pairId}/year-confirm`, { year }),
};

export const completionEndpoints = {
  markComplete: () =>
    api.post<{ completedAt: string; alreadyCompleted: boolean }>('/completion'),
};

export const memoryEndpoints = {
  upload: (
    photo: File,
    contextKind: 'trivia' | 'teammate',
    contextId: string,
    counterpartId: string,
  ) => {
    const form = new FormData();
    form.append('photo', photo);
    form.append('contextKind', contextKind);
    form.append('contextId', contextId);
    form.append('counterpartId', counterpartId);
    return api.postForm<{ id: string; url: string; createdAt: string }>('/memories', form);
  },
  getForPair: (pairId: string) =>
    api.get<{
      role: 'hunter' | 'target';
      counterpart: Employee;
      photo: {
        id: string;
        url: string;
        uploaderId: string;
        uploaderName: string;
        createdAt: string;
      } | null;
    }>(`/memories/pair/${pairId}`),
};

export type MemoryWallItem = {
  id: string;
  url: string;
  kind: 'memory' | 'penalty';
  createdAt: string;
};

export const memoryWallEndpoints = {
  list: () => api.get<{ items: MemoryWallItem[] }>('/memories/wall'),
};

export type RankingDoneRow = {
  id: string;
  name: string;
  dept: string;
  completedAt: string;
  updatedAt: string | null;
  done: number;
  total: number;
};

export type RankingPendingRow = {
  id: string;
  name: string;
  dept: string;
  updatedAt: string | null;
  done: number;
  total: number;
};

export const rankingEndpoints = {
  list: () =>
    api.get<{ done: RankingDoneRow[]; pending: RankingPendingRow[] }>('/completion/ranking'),
};

export const chatEndpoints = {
  getQuestion: (pairId: string) =>
    api.get<{
      question: string;
      role: 'hunter' | 'target';
      counterpart: Employee;
      myAnswered: boolean;
      theirAnswered: boolean;
    }>(`/chat/${pairId}/question`),
  confirmTeammate: (pairId: string, answer: string) =>
    api.post<{
      ok: true;
      bothAnswered: boolean;
      added: boolean;
      role: 'hunter' | 'target';
      counterpart: Employee;
    }>(`/chat/${pairId}/confirm-teammate`, { answer }),
};

// ─── Admin portal ───────────────────────────────────────────────────
// These mirror the route shapes in `backend/src/routes/admin.ts`. The gate
// is a temporary username/password from env (admin / admin123 by default).
// POST /admin/auth/login sets `isAdmin` on the session; requireAdmin
// checks that flag. Replace with the real role model later.

export const adminAuthEndpoints = {
  login: (username: string, password: string) =>
    api.post<{ ok: true }>('/admin/auth/login', { username, password }),
  logout: () => api.post<void>('/admin/auth/logout'),
  me: () => api.get<{ isAdmin: boolean }>('/admin/auth/me'),
};

export interface AdminEmployee extends Employee {
  email?: string | null;
  leaderClue?: string | null;
}

export interface EmpeoSyncFilter {
  statusIds?: number[];
  typeIds?: number[];
  orgLevel2?: string[];
  orgLevel3?: string[];
  hiredYearMin?: number;
  hiredYearMax?: number;
  rankPrefixes?: string[];
}

export interface EmpeoSyncResult {
  added: Array<{ id: string; name: string }>;
  updated: Array<{ id: string; name: string; changedFields: string[] }>;
  missingInApi: Array<{ id: string; name: string }>;
  errors: Array<{ id?: string; reason: string }>;
  fetchedAt: string;
}

export interface CsvImportResult {
  added: Array<{ id: string; name: string }>;
  updated: Array<{ id: string; name: string; changedFields: string[] }>;
  errors: Array<{ id?: string; row?: number; reason: string }>;
  skipped: number;
  total: number;
  fetchedAt: string;
}

export interface AdminScanRow {
  id: string;
  createdAt: string;
  mode: 'TRIVIA' | 'TEAMMATE';
  outcome: 'MATCH' | 'MISMATCH';
  cardRef: string | null;
  pairId: string | null;
  scanner: { id: string; name: string };
  target: { id: string; name: string };
}

export interface AdminPair {
  id: string;
  kind: 'TRIVIA' | 'TEAMMATE';
  createdAt: string;
  penalty: { id: string; text: string } | null;
  targetConfirmed: boolean;
  proofPhotoUrl: string | null;
  hunter: Employee | null;
  target: Employee | null;
}

export interface AdminMemory {
  id: string;
  url: string;
  contextKind: string;
  contextId: string;
  createdAt: string;
  uploader: { id: string; name: string };
  counterpart: { id: string; name: string };
}

export interface AdminPlayerRow {
  player: Employee;
  triviaStamps: Record<string, string>;
  teammateSlots: Employee[];
  assignedCardIds: string[];
  assignedLeaderId: string | null;
  completedAt: string | null;
  updatedAt: string;
  // Server-computed for the players table — mirrors selectIsComplete.
  triviaCount: number;
  memberCount: number;
  hasLeader: boolean;
  pct: number;
}

export interface AdminPlayerDetail extends AdminPlayerRow {
  assignedLeader: Employee | null;
  assignedCards: { id: string; index: number; clue: string; targetIds: string[] }[];
  stampedBy: Record<string, Employee | null>;
}

export interface AdminTriviaCardRow {
  id: string;
  index: number;
  clue: string;
  targets: Employee[];
  assignedToCount: number;
  stampedCount: number;
}

export interface AdminDashboard {
  totalPlayers: number;
  finished: number;
  playing: number;
  notStarted: number;
  activePairs: number;
  scansToday: number;
  memoriesUploaded: number;
  completedQuests: number;
  totalQuests: number;
  gameEndAt: string;
  isGameEnded: boolean;
  recentScans: AdminScanRow[];
  activePairsList: AdminPair[];
}

export const adminEndpoints = {
  dashboard: () => api.get<AdminDashboard>('/admin/dashboard'),

  // Players
  listPlayers: (q?: string, status?: string) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (status) params.set('status', status);
    const qs = params.toString();
    return api.get<{ players: AdminPlayerRow[] }>(`/admin/players${qs ? `?${qs}` : ''}`);
  },
  getPlayer: (id: string) => api.get<AdminPlayerDetail>(`/admin/players/${id}`),
  markPlayerComplete: (id: string) =>
    api.post<{ completedAt: string }>(`/admin/players/${id}/complete`),
  unmarkPlayerComplete: (id: string) =>
    api.delete<{ ok: true }>(`/admin/players/${id}/complete`),
  resetPlayerProgress: (id: string) =>
    api.delete<{ ok: true }>(`/admin/players/${id}/progress`),
  // Admin overrides — bypass cap checks and validation that the scan path
  // applies. Each one invalidates the completion ranking cache server-side.
  grantStamp: (id: string, cardId: string, targetId: string) =>
    api.post<{ ok: true; stamp: { cardId: string; targetId: string } }>(
      `/admin/players/${id}/stamp`,
      { cardId, targetId },
    ),
  revokeStamp: (id: string, cardId: string) =>
    api.delete<{ ok: true }>(`/admin/players/${id}/stamp/${cardId}`),
  addTeammate: (id: string, employeeId: string) =>
    api.post<{ ok: true; added: boolean; teammate: Employee }>(
      `/admin/players/${id}/teammate`,
      { employeeId },
    ),
  removeTeammate: (id: string, employeeId: string) =>
    api.delete<{
      ok: true;
      removed: boolean;
      removedReverse: boolean;
      slotsDeleted: number;
      pairsDeleted: number;
    }>(`/admin/players/${id}/teammate/${employeeId}`),
  patchAssignedLeader: (id: string, leaderId: string | null) =>
    api.patch<{ ok: true; assignedLeaderId: string | null }>(
      `/admin/players/${id}/assigned-leader`,
      { leaderId },
    ),
  rerollAssignedCards: (id: string) =>
    api.post<{ ok: true }>(`/admin/players/${id}/assigned-cards/reroll`),

  // Employees
  listEmployees: (q?: string, role?: string) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (role) params.set('role', role);
    const qs = params.toString();
    return api.get<{ employees: AdminEmployee[] }>(`/admin/employees${qs ? `?${qs}` : ''}`);
  },
  createEmployee: (body: Partial<AdminEmployee>) =>
    api.post<AdminEmployee>('/admin/employees', body),
  updateEmployee: (id: string, body: Partial<AdminEmployee>) =>
    api.patch<AdminEmployee>(`/admin/employees/${id}`, body),
  deleteEmployee: (id: string) => api.delete<{ ok: true }>(`/admin/employees/${id}`),
  syncEmployees: (filters: EmpeoSyncFilter) =>
    api.post<EmpeoSyncResult>('/admin/employees/sync', filters),
  importEmployeesCsv: (file: File) => {
    const form = new FormData();
    form.append('csv', file);
    return api.postForm<CsvImportResult>('/admin/employees/import-csv', form);
  },

  // Trivia cards
  listTrivia: () => api.get<{ cards: AdminTriviaCardRow[] }>('/admin/trivia'),
  createTrivia: (body: { id: string; index: number; clue: string; targetIds?: string[] }) =>
    api.post<AdminTriviaCardRow>('/admin/trivia', body),
  updateTrivia: (
    id: string,
    body: { index?: number; clue?: string; targetIds?: string[] },
  ) => api.patch<AdminTriviaCardRow>(`/admin/trivia/${id}`, body),
  deleteTrivia: (id: string) => api.delete<{ ok: true }>(`/admin/trivia/${id}`),

  // Pairs
  listPairs: (status?: string, kind?: string) => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (kind) params.set('kind', kind);
    const qs = params.toString();
    return api.get<{ pairs: AdminPair[] }>(`/admin/pairs${qs ? `?${qs}` : ''}`);
  },
  forceClearPair: (id: string) =>
    api.post<{ ok: true; alreadyConfirmed?: true }>(`/admin/pairs/${id}/force-clear`),

  // Scans
  listScans: (params: { q?: string; mode?: string; outcome?: string; limit?: number; cursor?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.mode) qs.set('mode', params.mode);
    if (params.outcome) qs.set('outcome', params.outcome);
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.cursor) qs.set('cursor', params.cursor);
    const s = qs.toString();
    return api.get<{ scans: AdminScanRow[]; nextCursor: string | null }>(
      `/admin/scans${s ? `?${s}` : ''}`,
    );
  },

  // Memories
  listMemories: (kind?: string, limit?: number) => {
    const params = new URLSearchParams();
    if (kind) params.set('kind', kind);
    if (limit) params.set('limit', String(limit));
    const qs = params.toString();
    return api.get<{ memories: AdminMemory[] }>(`/admin/memories${qs ? `?${qs}` : ''}`);
  },
  deleteMemory: (id: string) => api.delete<{ ok: true }>(`/admin/memories/${id}`),

  // Game lifecycle
  getGameClock: () =>
    api.get<{ gameEndAt: string; serverNow: string; isEnded: boolean }>('/admin/game'),
  redistributeLeaders: () =>
    api.post<{
      ok: true;
      totalPlayers: number;
      leaderCount: number;
      counts: Record<string, number>;
    }>('/admin/redistribute-leaders'),

  // Wipe (destructive — requires { confirm: 'WIPE' } body)
  wipeGameplay: () =>
    api.post<AdminWipeResult>('/admin/wipe/gameplay', { confirm: 'WIPE' }),
  wipeEmployees: () =>
    api.post<AdminWipeResult>('/admin/wipe/employees', { confirm: 'WIPE' }),
  wipeAll: () => api.post<AdminWipeResult>('/admin/wipe/all', { confirm: 'WIPE' }),

  // Chat answers
  listChatAnswers: (params: { q?: string; limit?: number; cursor?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.cursor) qs.set('cursor', params.cursor);
    const s = qs.toString();
    return api.get<{ answers: AdminChatAnswer[]; nextCursor: string | null }>(
      `/admin/chat-answers${s ? `?${s}` : ''}`,
    );
  },
  listChatAnswersByQuestion: () =>
    api.get<{ questions: AdminChatQuestionGroup[] }>('/admin/chat-answers/by-question'),
  createChatQuestion: (body: { question: string }) =>
    api.post<{ id: string; index: number; question: string }>('/admin/chat-questions', body),
  updateChatQuestion: (id: string, body: { question: string }) =>
    api.patch<{ id: string; index: number; question: string }>(
      `/admin/chat-questions/${id}`,
      body,
    ),
  deleteChatQuestion: (id: string) =>
    api.delete<{ ok: true }>(`/admin/chat-questions/${id}`),

  // Penalties
  listPenalties: () => api.get<{ penalties: AdminPenalty[] }>('/admin/penalties'),
  createPenalty: (body: { text: string }) =>
    api.post<AdminPenalty>('/admin/penalties', body),
  updatePenalty: (id: string, body: { text: string }) =>
    api.patch<AdminPenalty>(`/admin/penalties/${id}`, body),
  deletePenalty: (id: string) => api.delete<{ ok: true }>(`/admin/penalties/${id}`),

  // Photo places
  listPhotoPlaces: () => api.get<{ places: AdminPhotoPlace[] }>('/admin/photo-places'),
  createPhotoPlace: (body: { text: string }) =>
    api.post<AdminPhotoPlace>('/admin/photo-places', body),
  updatePhotoPlace: (id: string, body: { text: string }) =>
    api.patch<AdminPhotoPlace>(`/admin/photo-places/${id}`, body),
  deletePhotoPlace: (id: string) =>
    api.delete<{ ok: true }>(`/admin/photo-places/${id}`),
};

export const photoPlaceEndpoints = {
  list: () => api.get<{ places: { id: string; text: string }[] }>('/photo-places'),
};

export interface AdminPhotoPlace {
  id: string;
  text: string;
}

export interface AdminWipeResult {
  ok: true;
  level: 'gameplay' | 'employees' | 'all';
  counts: Record<string, number>;
  cloudinary: { destroyed: number; failed: number };
}

export interface AdminPenalty {
  id: string;
  text: string;
  usedCount: number;
}

export interface AdminChatAnswer {
  pairId: string;
  createdAt: string;
  question: string;
  answer: string;
  answerer: { id: string; name: string };
  target: { id: string; name: string };
}

export interface AdminChatQuestionGroup {
  id: string;
  question: string;
  answerCount: number;
  answers: Array<{
    pairId: string;
    answererId: string;
    createdAt: string;
    answer: string;
    answerer: { id: string; name: string };
    target: { id: string; name: string };
  }>;
}

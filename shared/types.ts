export type EmployeeId = string;
export type CardId = string;
export type PairId = string;

export interface Employee {
  id: EmployeeId;
  name: string;
  nickname?: string | null;
  position?: string | null;
  initial: string;
  dept: string;
  year: number;
  isLeader?: boolean;
  photoUrl?: string | null;
}

export interface Profile extends Employee {
  email: string;
}

export interface TriviaCard {
  id: CardId;
  index: number;
  clue: string;
  targetId: EmployeeId;
}

export type MissionKind = 'trivia' | 'teammate' | 'both';

export type ScanOutcome =
  | { outcome: 'match'; card_ref?: CardId; stamp: { id: string; target: Employee } }
  | { outcome: 'mismatch'; pair_id: PairId; target: Employee }
  | { outcome: 'chat'; pair_id: PairId; target: Employee }
  | { outcome: 'wrong_year'; target: Employee }
  | { outcome: 'wrong_leader'; target: Employee }
  | { outcome: 'leader_clash'; target: Employee }
  | { outcome: 'already_added'; target: Employee }
  | { outcome: 'leader_full'; target: Employee }
  | { outcome: 'teammate_full'; target: Employee };

export interface PenaltyState {
  pair_id: PairId;
  target_confirmed: boolean;
  proof_photo_url: string | null;
}

export type WsEvent =
  | { type: 'penalty.update'; targetConfirmed: boolean; proofPhotoUrl: string | null }
  | { type: 'game.ended'; endedAt: string };

import type {
  MatchFoundMessage,
  RoundResultMessage,
  RoundStartMessage,
  ServerMessage,
  UnitAction,
} from '@shared/messages';

export interface ClientUnitState {
  id: string;
  type: string;
  hp: number;
  position: { x: number; y: number };
  alive: boolean;
  graveCount?: number;
}

export interface ClientState {
  round: number;
  status: 'connecting' | 'ready' | 'waiting';
  units: ClientUnitState[];
  opponentUnits: ClientUnitState[];
  countdownMs: number;
  power: number;
}

export class GameStateManager {
  private state: ClientState = {
    round: 0,
    status: 'connecting',
    units: [],
    opponentUnits: [],
    countdownMs: 0,
    power: 0,
  };

  private readonly listeners: Array<(state: ClientState) => void> = [];

  subscribe(listener: (state: ClientState) => void) {
    this.listeners.push(listener);
    listener(this.state);
  }

  updateFromServer(message: ServerMessage) {
    switch (message.type) {
      case 'MATCH_FOUND':
        this.handleMatchFound(message);
        break;
      case 'ROUND_START':
        this.handleRoundStart(message);
        break;
      case 'ROUND_RESULT':
        this.handleRoundResult(message);
        break;
      default:
        break;
    }
  }

  setPower(power: number) {
    this.state.power = power;
    this.emit();
  }

  setStatus(status: ClientState['status']) {
    this.state.status = status;
    this.emit();
  }

  updateCountdown(ms: number) {
    this.state.countdownMs = ms;
    this.emit();
  }

  getSnapshot(): ClientState {
    return { ...this.state, units: [...this.state.units], opponentUnits: [...this.state.opponentUnits] };
  }

  private handleMatchFound(message: MatchFoundMessage) {
    this.state.round = 0;
    this.state.status = 'waiting';
    this.state.units = message.payload.you.units.map((unit) => ({
      ...unit,
      graveCount: 0,
    }));
    this.state.opponentUnits = message.payload.opponent.units.map((unit) => ({
      ...unit,
      graveCount: 0,
    }));
    this.emit();
  }

  private handleRoundStart(message: RoundStartMessage) {
    this.state.round = message.payload.round;
    this.state.status = 'ready';
    this.state.countdownMs = Math.max(message.payload.deadlineTs - Date.now(), 0);
    this.emit();
  }

  private handleRoundResult(message: RoundResultMessage) {
    this.state.round = message.payload.round;
    message.payload.diff.positions.forEach((update) => {
      const unit = this.state.units.find((u) => u.id === update.unitId);
      if (unit) {
        unit.position = update.position;
      }
      const opp = this.state.opponentUnits.find((u) => u.id === update.unitId);
      if (opp) {
        opp.position = update.position;
      }
    });
    message.payload.diff.deaths.forEach((death) => {
      const unit = this.state.units.find((u) => u.id === death.unitId);
      if (unit) {
        unit.alive = false;
        unit.graveCount = (unit.graveCount ?? 0) + 1;
        unit.position = death.position;
      }
      const opp = this.state.opponentUnits.find((u) => u.id === death.unitId);
      if (opp) {
        opp.alive = false;
        opp.graveCount = (opp.graveCount ?? 0) + 1;
        opp.position = death.position;
      }
    });
    this.state.status = 'waiting';
    this.state.countdownMs = 0;
    this.emit();
  }

  private emit() {
    this.listeners.forEach((listener) => listener(this.getSnapshot()));
  }
}

export interface DragAction {
  unitId: string;
  dragVec: { x: number; y: number };
  skill?: 'projectile' | 'aoe';
}

export function buildClientAction(action: DragAction): UnitAction {
  return {
    unitId: action.unitId,
    dragVec: action.dragVec,
    skill: action.skill,
  };
}

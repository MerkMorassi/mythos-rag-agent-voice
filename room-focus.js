// js/comms/room-focus.js
// Mutable, runtime-editable room intent profiles

const STORAGE_KEY = 'MYTHOS_ROOM_FOCUS';

const DEFAULT_FOCUS = {
  id: 'OPEN',
  title: 'Open Discussion',
  summary: 'General discussion without a strict objective.',
  rules: ['Stay relevant.', 'Avoid domination or derailment.']
};

export class RoomFocusRegistry {
  constructor(storageKey = STORAGE_KEY) {
    this.storageKey = storageKey;
    this.focusMap = {};
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      this.focusMap = raw ? JSON.parse(raw) : {};
    } catch {
      this.focusMap = {};
    }
    if (!this.focusMap.OPEN) {
      this.focusMap.OPEN = DEFAULT_FOCUS;
      this.save();
    }
  }

  save() {
    localStorage.setItem(this.storageKey, JSON.stringify(this.focusMap));
  }

  list() {
    return Object.values(this.focusMap);
  }

  get(id) {
    return this.focusMap[id] || this.focusMap.OPEN;
  }

  upsert(focus) {
    if (!focus?.id) throw new Error('RoomFocus requires id');
    this.focusMap[focus.id] = focus;
    this.save();
  }
}

export const RoomFocus = new RoomFocusRegistry();
window.RoomFocus = RoomFocus;

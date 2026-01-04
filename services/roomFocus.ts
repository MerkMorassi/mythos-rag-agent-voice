
export interface RoomFocus {
  id: string;
  title: string;
  summary: string;
  rules: string[];
}

export const DEFAULT_FOCUS: RoomFocus = {
  id: 'OPEN',
  title: 'Open Discussion',
  summary: 'General discussion without a strict objective.',
  rules: ['Stay relevant.', 'Avoid domination or derailment.']
};

export const STRATEGIC_COUNCIL_FOCUS: RoomFocus = {
    id: 'STRATEGIC_COUNCIL',
    title: 'High-Level Strategy',
    summary: 'Executive decision making and architectural planning.',
    rules: [
        'Focus on long-term goals and systemic impact.',
        'Address the "Why" before the "How".',
        'Consensus is preferred but not required.',
        'Record key decisions.'
    ]
};

export const BRAINSTORM_FOCUS: RoomFocus = {
    id: 'BRAINSTORM',
    title: 'Divergent Brainstorming',
    summary: 'Rapid idea generation and creative exploration.',
    rules: [
        'No bad ideas in this phase.',
        'Build on previous suggestions ("Yes, and...").',
        'Prioritize quantity and novelty.',
        'Cross-pollinate domains.'
    ]
};

const STORAGE_KEY = 'mythos_room_focus_registry';
const ACTIVE_KEY = 'mythos_active_focus_id';

export const RoomFocusService = {
    getAll(): RoomFocus[] {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            const map = raw ? JSON.parse(raw) : {};
            
            // Ensure defaults exist
            if (!map.OPEN) map.OPEN = DEFAULT_FOCUS;
            if (!map.STRATEGIC_COUNCIL) map.STRATEGIC_COUNCIL = STRATEGIC_COUNCIL_FOCUS;
            if (!map.BRAINSTORM) map.BRAINSTORM = BRAINSTORM_FOCUS;
            
            // Remove legacy if present
            delete map.WRITERS_ROOM;
            
            return Object.values(map);
        } catch(e) {
            return [DEFAULT_FOCUS, STRATEGIC_COUNCIL_FOCUS, BRAINSTORM_FOCUS];
        }
    },
    
    save(focus: RoomFocus) {
        const list = this.getAll();
        const map = Object.fromEntries(list.map(f => [f.id, f]));
        map[focus.id] = focus;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    },
    
    delete(id: string) {
        if (id === 'OPEN') return; // Cannot delete core default
        const list = this.getAll();
        const map = Object.fromEntries(list.map(f => [f.id, f]));
        delete map[id];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
        
        // Reset active if deleted
        if (this.getActive().id === id) {
            this.setActive('OPEN');
        }
    },

    getActive(): RoomFocus {
        const id = localStorage.getItem(ACTIVE_KEY);
        const list = this.getAll();
        return list.find(f => f.id === id) || DEFAULT_FOCUS;
    },
    
    setActive(id: string) {
        localStorage.setItem(ACTIVE_KEY, id);
    }
};

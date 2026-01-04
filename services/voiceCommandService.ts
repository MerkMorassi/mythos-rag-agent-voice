
export interface CommandItem {
    id: string;
    label: string;
    trigger: string;
    description: string;
}

export interface CommandSection {
    id: string;
    title: string;
    color: string;
    items: CommandItem[];
    createdBy: string; // 'USER' | 'SYSTEM' | AgentHandle
    authorized: boolean;
    timestamp: number;
}

const STORAGE_KEY = 'mythos_voice_commands_v1';

export const DEFAULT_SECTIONS: CommandSection[] = [
    {
        id: 'soma_mem',
        title: 'SOMA: MEMORY OPERATIONS',
        color: '#f87171',
        createdBy: 'SYSTEM',
        authorized: true,
        timestamp: Date.now(),
        items: [
            { id: 'c1', label: 'CREATE', trigger: '"Save this fact: [Content]"', description: 'Save to vector DB.' },
            { id: 'c2', label: 'UPDATE', trigger: '"Append to [Topic]: [Info]"', description: 'Update existing node.' },
            { id: 'c3', label: 'DELETE', trigger: '"Delete memory [Topic]"', description: 'Remove node (Archivax).' }
        ]
    },
    {
        id: 'prompt_eng',
        title: 'PROMPT ENGINEERING',
        color: '#4ade80',
        createdBy: 'SYSTEM',
        authorized: true,
        timestamp: Date.now(),
        items: [
            { id: 'p1', label: 'OPTIMIZE', trigger: '"Optimize prompt: [Text]"', description: 'Rewrite prompt via AI.' },
            { id: 'p2', label: 'SAVE', trigger: '"Save prompt as [Name]"', description: 'Persist current instructions.' }
        ]
    },
    {
        id: 'neural_cfg',
        title: 'NEURAL CONFIGURATION',
        color: '#a78bfa',
        createdBy: 'SYSTEM',
        authorized: true,
        timestamp: Date.now(),
        items: [
            { id: 'n1', label: 'TEMP', trigger: '"Set temperature to 1.5"', description: '0.0 (Robotic) - 2.0 (Wild)' },
            { id: 'n2', label: 'TOP P', trigger: '"Set Top P to 0.9"', description: 'Nucleus Sampling' }
        ]
    },
    {
        id: 'utils',
        title: 'UTILITIES',
        color: '#facc15',
        createdBy: 'SYSTEM',
        authorized: true,
        timestamp: Date.now(),
        items: [
            { id: 'u1', label: 'DOWNLOAD', trigger: '"Download transcript"', description: 'Export chat log.' },
            { id: 'u2', label: 'TERMINATE', trigger: '"Terminate connection"', description: 'End session.' }
        ]
    }
];

export const VoiceCommandService = {
    getAll(): CommandSection[] {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) {
                this.saveAll(DEFAULT_SECTIONS);
                return DEFAULT_SECTIONS;
            }
            return JSON.parse(raw);
        } catch (e) {
            return DEFAULT_SECTIONS;
        }
    },

    saveAll(sections: CommandSection[]) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sections));
    },

    addSection(section: CommandSection) {
        const list = this.getAll();
        list.push(section);
        this.saveAll(list);
    },

    updateSection(updated: CommandSection) {
        const list = this.getAll();
        const idx = list.findIndex(s => s.id === updated.id);
        if (idx !== -1) {
            list[idx] = updated;
            this.saveAll(list);
        }
    },

    deleteSection(id: string) {
        const list = this.getAll().filter(s => s.id !== id);
        this.saveAll(list);
    },

    authorizeSection(id: string, state: boolean) {
        const list = this.getAll();
        const section = list.find(s => s.id === id);
        if (section) {
            section.authorized = state;
            this.saveAll(list);
        }
    }
};

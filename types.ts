
export interface KnowledgeDoc {
  id: string;
  agentId?: string; // Links document to a specific agent
  title: string;
  content: string;
  embedding?: number[];
  timestamp: number;
  // Optional NumMark metadata
  numMarkId?: string;
  tags?: string[];
  permissions?: string; // UNIX-style "644", "777"
}

export enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
}

export interface LogMessage {
  id: string;
  type: 'user' | 'model' | 'system' | 'tool';
  text: string;
  timestamp: number;
  isStreaming?: boolean; // Tracks if the message is currently being generated
  feedback?: 'up' | 'down';
  attachment?: string; // Base64 image data or Video URI
  attachmentType?: 'image' | 'video' | 'text' | 'audio';
}

export interface ChatSession {
  id: string;
  title: string;
  timestamp: number;
  logs: LogMessage[];
}

export interface ModelConfig {
  temperature: number;
  topP: number;
  topK: number;
}

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  temperature: 0.7,
  topP: 0.95,
  topK: 40,
};

export interface AgentConfig {
  agentId: string;
  systemInstruction: string;
  modelConfig: ModelConfig;
  voiceName?: string;      // Persisted Voice Selection
  voiceReference?: string; // Base64 audio string for Voice Cloning
  voiceSpeed?: number;     // Playback Rate (default 1.0)
  voicePitch?: number;     // Detune in Semitones (default 0)
  accessLevel?: string; // "777", "755", etc.
}

export interface CloudFile {
  name: string; // The resource name (files/...)
  displayName: string;
  mimeType: string;
  sizeBytes: string;
  createTime: string;
  state: 'STATE_UNSPECIFIED' | 'PROCESSING' | 'ACTIVE' | 'FAILED';
  uri: string;
}

// SOMA PERMISSION TYPES
export type SomaPermission = 
  | 'READ_LORE'      // 400
  | 'WRITE_LORE'     // 200
  | 'MODIFY_LORE'    // 100
  | 'EXECUTE_CODE'   // 040
  | 'ROUTE_EXTERNAL' // 020
  | 'GENERATE_MEDIA' // 010
  | 'ADMIN_OVERRIDE' // 004
  | 'BROADCAST_COUNCIL' // 002
  | 'SELF_UPDATE';   // 001

export interface Agent {
  id: string;
  handle: string;
  role: string;
  system_instruction: string;
  voice: string;
  voiceReference?: string; 
  accessLevel: string; // Default CHMOD like "755"
  pronouns?: string; // "he/him", "she/her", "they/them"
  permissions?: SomaPermission[]; // Explicit capabilities list
}

// --- LOREPACK SCHEMA (MYTHOS.LOREPACK.v1) ---
export interface LorePackHeader {
  schema: "MYTHOS.LOREPACK.v1";
  id: string;
  agentId: string;
  handle: string;
  version: number;
  timestamp: number;
  description?: string;
}

export interface LorePack {
  header: LorePackHeader;
  sacred_archive: KnowledgeDoc[];
}

// --- MULTI-AGENT TYPES (ENVELOPE PROTOCOL) ---
export interface MultiAgentMessage {
    id: string;
    senderId: string; // 'USER' | 'SYSTEM' | AgentID
    senderName: string;
    text: string;
    timestamp: number;
    
    // Envelope Routing
    targets?: string[]; // Array of AgentIDs this message is addressed to (or empty for Room Broadcast)
    msgType?: 'utterance' | 'action' | 'thought' | 'system';
    
    // Metadata
    isThinking?: boolean;
    attachment?: string;
    meta?: Record<string, any>; // Provenance, confidence, tokens, etc.
}

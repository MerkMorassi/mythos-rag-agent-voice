
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
  feedback?: 'up' | 'down';
  attachment?: string; // Base64 image data from external models
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

export interface Agent {
  id: string;
  handle: string;
  role: string;
  system_instruction: string;
  voice: string;
  voiceReference?: string; // Path or URL to a default audio file for cloning
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

// --- MULTI-AGENT TYPES ---
export interface MultiAgentMessage {
    id: string;
    senderId: string; // 'USER' | 'SYSTEM' | AgentID
    senderName: string;
    text: string;
    timestamp: number;
    isThinking?: boolean;
}

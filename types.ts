export interface KnowledgeDoc {
  id: string;
  agentId?: string; // Links document to a specific agent
  title: string;
  content: string;
  embedding?: number[];
  timestamp: number;
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
}

export interface ChatSession {
  id: string;
  title: string;
  timestamp: number;
  logs: LogMessage[];
}
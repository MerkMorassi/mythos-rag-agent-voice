
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
  attachmentType?: 'image' | 'video' | 'text' | 'audio' | 'pdf';
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

// --- GRAPH MAGRAG ARCHITECTURE ---
export interface GraphNode {
  id: string; // Normalized Entity Name (e.g. "ZEUS") or UUID
  label: string; // Type: "PERSON", "LOCATION", "CONCEPT", "EVENT"
  name: string; // Display Name
  description: string; // Summarized description
  sourceDocIds: string[]; // Provenance links to KnowledgeDoc
  embedding?: number[]; // Vector of the description
  agentId: string;
  timestamp: number;
}

export interface GraphEdge {
  id: string;
  source: string; // Node ID
  target: string; // Node ID
  relation: string; // e.g. "MARRIED_TO", "LOCATED_IN"
  description?: string;
  agentId: string;
  timestamp: number;
}

export interface CommunitySummary {
  id: string;
  title: string;
  summary: string; // High level summary of the cluster
  embedding?: number[];
  agentId: string;
  nodeIds: string[]; // Nodes in this community
  level: number; // Hierarchical level (0 = granular)
}

// --- SOMA PERMISSION ARCHITECTURE ---
// Sector 1: MNEMOSYNE (Memory)
export type PermMemory = 'READ_LORE' | 'WRITE_LORE' | 'MODIFY_LORE';
// Sector 2: TECHNE (Tools)
export type PermTools = 'EXECUTE_CODE' | 'ROUTE_EXTERNAL' | 'GENERATE_MEDIA';
// Sector 3: METRON (System)
export type PermSystem = 'ADMIN_OVERRIDE' | 'BROADCAST_COUNCIL' | 'SELF_UPDATE' | 'WRITE_CANON';

export type SomaPermission = PermMemory | PermTools | PermSystem;

export enum SomaActionType {
    // Memory
    QUERY_DB = 'QUERY_DB',
    INGEST_DATA = 'INGEST_DATA',
    DELETE_DATA = 'DELETE_DATA',
    // Tools
    EXEC_CODE = 'EXEC_CODE',
    ROUTE_REQUEST = 'ROUTE_REQUEST',
    CREATE_IMAGE = 'CREATE_IMAGE',
    // System
    SYSTEM_ADMIN = 'SYSTEM_ADMIN',
    BROADCAST = 'BROADCAST',
    PUBLISH_CANON = 'PUBLISH_CANON',
    // Synapse
    DELEGATE_TASK = 'DELEGATE_TASK',
    COLLABORATE = 'COLLABORATE'
}

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
  name?: string; // User friendly name
}

export interface LorePack {
  id: string; // DB Key
  header: LorePackHeader;
  sacred_archive: KnowledgeDoc[];
}

// --- MEDIA ASSET ---
export interface MediaAsset {
    id: string;
    type: 'image' | 'video' | 'audio' | 'text' | 'pdf';
    data: string; // Base64 or URI or Text Content
    prompt: string;
    agentId: string;
    timestamp: number;
    tags?: string[];
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

// --- ANIMAGENTS PIPELINE TYPES ---

export enum ProductionStage {
    IDEATION = 'IDEATION',   // Divergent (Brainstorm)
    SCRIPT = 'SCRIPT',       // Convergent (Scribe)
    DESIGN = 'DESIGN',       // Visual Style (VisDev)
    ART = 'ART'              // High Fidelity (Lumiere)
}

export enum ApprovalStatus {
    DRAFT = 'DRAFT',
    PENDING = 'PENDING',
    APPROVED = 'APPROVED',
    REJECTED = 'REJECTED'
}

export interface CanonBlock {
    id: string;
    parentId?: string; // Lineage tracking
    stage: ProductionStage;
    title: string;
    content: string; // Text content or Image Prompts
    mediaRef?: string; // ID of MediaAsset if applicable
    agentId: string; // Creator
    timestamp: number;
    status: ApprovalStatus;
    version: number;
    feedback?: string; // Director's notes
}

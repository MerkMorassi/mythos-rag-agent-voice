
// The standard LorePack vector definition.
export interface VectorRecord {
  id: string;
  text: string;
  vector: number[];
  source: string;
  agent: string; // The "handle" or author
  timestamp: number;
  // FIX: Added optional permissions for virtual filesystem 'chmod' command.
  permissions?: string; 
}
export type LorePackExport = VectorRecord[];


export enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
}

export interface VisionEvent {
    id: string;
    timestamp: number;
    type: 'SCREENING_ROOM_SNAPSHOT';
    description: string; // The text analysis from Gemini Vision
    assetUrl: string;    // The snapshot
    witnessedBy: string[]; // ['BARBELO', 'KINE']
}

export interface LogMessage {
  id: string;
  type: 'user' | 'model' | 'system' | 'tool';
  text: string;
  timestamp: number;
  sender?: string; // Explicit sender name (e.g., "ARCHIVAX")
  isStreaming?: boolean; // Tracks if the message is currently being generated
  feedback?: 'up' | 'down';
  attachment?: string; // Base64 image data or Video URI
  attachmentType?: 'image' | 'video' | 'text' | 'audio' | 'pdf';
  visionEvent?: VisionEvent; // Vision Bridge Data
}

export interface ChatSession {
  id: string;
  title: string;
  timestamp: number;
  logs: LogMessage[];
  agentId: string;
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

export interface SovereignConfig {
  mode: 'PRESET' | 'CUSTOM' | 'SILENT';
  preset: string; // e.g., "Protocol Mythos"
  customGreeting: string;
}

export const DEFAULT_SOVEREIGN_CONFIG: SovereignConfig = {
  mode: 'PRESET',
  preset: 'Nexus Prime',
  customGreeting: ''
};

export interface RecognitionSettings {
    userInteraction: string;
    agentInteraction: string;
}

export interface AgentConfig {
  agentId: string;
  systemInstruction: string;
  modelConfig: ModelConfig;
  modelName?: string;      // Persisted Model Selection
  voiceName?: string;      // Persisted Voice Selection
  voiceReference?: string; // Base64 audio string for Voice Cloning
  voiceSpeed?: number;     // Playback Rate (default 1.0)
  voicePitch?: number;     // Detune in Semitones (default 0)
  accessLevel?: string; // "777", "755", etc.
  // FIX: Added bio for overrides
  bio?: string;
  recognition?: RecognitionSettings;
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

// --- GRAPH VISUALIZER TYPES (Re-added for compatibility) ---
export interface GraphNode {
  id: string;
  name: string;
  label: string; // 'PERSON', 'LOCATION', 'CONCEPT', 'EVENT'
  description: string;
  agentId: string;
}

export interface GraphEdge {
  source: string; // Node ID
  target: string; // Node ID
  label: string;
  agentId: string;
}

// --- SOMA PERMISSION ARCHITECTURE ---
// Sector 1: MNEMOSYNE (Memory)
export type PermMemory = 'READ_LORE' | 'WRITE_LORE' | 'MODIFY_LORE' | 'MANAGE_MEMORY';
// Sector 2: TECHNE (Tools)
export type PermTools = 'EXECUTE_CODE' | 'ROUTE_EXTERNAL' | 'GENERATE_MEDIA' | 'COLLABORATE';
// Sector 3: METRON (System)
export type PermSystem = 'ADMIN_OVERRIDE' | 'BROADCAST_COUNCIL' | 'SELF_UPDATE' | 'PUBLISH_CANON' | 'WRITE_CANON';

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

// --- HIERARCHY TYPES ---
export type AgentClass = 'PARTNER' | 'EXECUTIVE' | 'TALENT' | 'STAFF';
export type AgentDepartment = 'ADMINISTRATION' | 'CREATIVE' | 'PRODUCTION' | 'TECHNICAL';

export interface StudioConfig {
    preferredTools: string[];
    color: string;
}

export interface ActorProfile {
    canAct: boolean;
    currentRole?: string;     // e.g. "Kali Malindra"
    voiceCloneId?: string;
}

export interface Agent {
  id: string;
  handle: string;
  name: string;
  
  // Hierarchy
  agentClass: AgentClass;
  department: AgentDepartment;
  title: string; // Replaces 'role'
  
  // Identity
  bio: string;
  system_instruction: string;
  pronouns?: string;
  
  // Operational
  accessLevel: string; // '777', '755', '644'
  permissions: SomaPermission[]; 
  recognition: RecognitionSettings;
  
  // Capabilities
  voice: string;
  voiceReference?: string; // Legacy support for settings
  studioConfig?: StudioConfig;
  actorProfile?: ActorProfile;

  // State (Legacy support)
  file_ids?: string[]; 

  // Editor properties
  isCustom?: boolean;
  order: number;
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
  sacred_archive: VectorRecord[];
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

// --- SAVED PROMPT ---
export interface SavedPrompt {
    id: string;
    agentId: string;
    name: string;
    content: string;
}


// --- HOLODECK STATE (SHARED CANVAS) ---
export interface CanvasSection {
    id: string;
    title: string;
    content: string; // Markdown supported
    lastEditor: string; // Agent ID
    timestamp: number;
}

export interface WorkingMemory {
    id: 'HOLODECK_MAIN';
    title: string;
    sections: CanvasSection[];
    lastModified: number;
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
    model?: string; // e.g., 'gemini-3-pro-preview', 'Dolphin-Mistral'
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

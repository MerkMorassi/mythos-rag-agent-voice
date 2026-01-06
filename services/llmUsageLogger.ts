import { addLlmLog, getAllLlmLogs } from './db';

export interface UsageLogEntry {
  timestamp: string;
  provider: string;
  model: string;
  prompt: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  wasFallback: boolean;
}

export class LLMUsageLogger {

  constructor() {
    // No-op constructor, DB initialization is handled by db.ts
  }

  /**
   * Appends a log entry to the IndexedDB store.
   */
  async log(entry: UsageLogEntry): Promise<void> {
    try {
      await addLlmLog(entry);
    } catch (err) {
      console.error('Failed to write to LLM log database:', err);
    }
  }

  /**
   * Quick utility to calculate total session costs from the log.
   */
  async getTotalCost(): Promise<number> {
    try {
      const logs = await getAllLlmLogs();
      return logs.reduce((total, entry) => total + entry.costUsd, 0);
    } catch {
      return 0;
    }
  }
}

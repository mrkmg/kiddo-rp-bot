/**
 * Storage Utilities
 * 
 * Handles localStorage operations for session persistence
 * - Save/load session data
 * - Manage active session ID
 * - Handle settings storage
 * - Schema migration
 */

import type { Session } from '../stores/session';

// Storage keys from Plan.md
const STORAGE_KEYS = {
  CURRENT_SESSION: 'kiddo.session.current',
  SETTINGS: 'kiddo.settings',
  LLM_LOGS: 'kiddo.llm.logs',
} as const;

export interface Settings {
  openaiApiKey?: string;
  openrouterApiKey?: string;
  humeApiKey?: string;
  llmModel?: string;
  audioEnabled?: boolean;
  devMode?: boolean;
}

export interface LLMLogEntry {
  id: string;
  timestamp: string;
  type: 'request' | 'response';
  context: string;
  messages?: any[];
  response?: string;
  parsed?: any;
  error?: string;
}

/**
 * Save session to localStorage
 * Only stores the current active session (no history)
 * @param session - The session object to save
 * @throws Error if save fails
 */
export function saveSessionToStorage(session: Session): void {
  try {
    const updatedSession = {
      ...session,
      updatedAt: new Date().toISOString(),
    };
    
    const serialized = JSON.stringify(updatedSession);
    localStorage.setItem(STORAGE_KEYS.CURRENT_SESSION, serialized);
  } catch (error) {
    if (error instanceof Error && error.name === 'QuotaExceededError') {
      console.error('Storage quota exceeded');
      throw new Error('Storage quota exceeded. Please clear browser data.');
    }
    console.error('Failed to save session:', error);
    throw new Error('Failed to save session to localStorage');
  }
}

/**
 * Load current session from localStorage
 * Handles JSON deserialization and validates schema
 * @param sessionId - Ignored, kept for API compatibility
 * @returns The current session object or null if not found/invalid
 */
export function loadSessionFromStorage(sessionId?: string): Session | null {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.CURRENT_SESSION);
    if (!data) return null;

    const session = JSON.parse(data) as Session;
    
    // Validate session has required fields
    if (!session.id || !session.createdAt) {
      console.error('Invalid session schema');
      return null;
    }
    
    // Migrate old schema if needed
    if (!session.version || session.version < 2) {
      return migrateSession(session);
    }
    
    return session;
  } catch (error) {
    console.error('Failed to load session:', error);
    return null;
  }
}

/**
 * Delete current session from localStorage
 */
export function deleteSession(): void {
  localStorage.removeItem(STORAGE_KEYS.CURRENT_SESSION);
}

/**
 * Get active session ID
 * @returns The active session ID or null if none
 */
export function getActiveSessionId(): string | null {
  const session = loadSessionFromStorage();
  return session?.id || null;
}

/**
 * Set active session (no-op for compatibility, session is auto-saved)
 * @param sessionId - Ignored
 */
export function setActiveSession(sessionId: string): void {
  // No-op: we only store one session now
}

/**
 * Alias for setActiveSession (for consistency)
 */
export function setActiveSessionId(sessionId: string): void {
  setActiveSession(sessionId);
}

/**
 * Clear active session
 */
export function clearActiveSession(): void {
  deleteSession();
}

/**
 * Alias for clearActiveSession (for consistency)
 */
export function clearActiveSessionId(): void {
  clearActiveSession();
}

/**
 * Save settings to localStorage
 */
export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  } catch (error) {
    console.error('Failed to save settings:', error);
    throw new Error('Failed to save settings to localStorage');
  }
}

/**
 * Load settings from localStorage
 */
export function loadSettings(): Settings | null {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (!data) return null;
    return JSON.parse(data) as Settings;
  } catch (error) {
    console.error('Failed to load settings:', error);
    return null;
  }
}

/**
 * Get settings from localStorage (alias for loadSettings)
 * Returns settings object with API keys
 */
export function getSettings(): Settings {
  const settings = loadSettings();
  return settings || {
    openaiApiKey: '',
    openrouterApiKey: '',
    humeApiKey: '',
    llmModel: 'anthropic/claude-3-haiku',
    audioEnabled: true,
    devMode: false,
  };
}

/**
 * Save LLM log entry to localStorage
 */
export function saveLLMLog(entry: Omit<LLMLogEntry, 'id' | 'timestamp'>): void {
  try {
    const logs = getLLMLogs();
    const newEntry: LLMLogEntry = {
      id: generateUUID(),
      timestamp: new Date().toISOString(),
      ...entry,
    };
    
    // Keep only last 100 entries
    const updatedLogs = [...logs, newEntry].slice(-100);
    localStorage.setItem(STORAGE_KEYS.LLM_LOGS, JSON.stringify(updatedLogs));
  } catch (error) {
    console.error('Failed to save LLM log:', error);
  }
}

/**
 * Get all LLM logs from localStorage
 */
export function getLLMLogs(): LLMLogEntry[] {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.LLM_LOGS);
    if (!data) return [];
    return JSON.parse(data) as LLMLogEntry[];
  } catch (error) {
    console.error('Failed to load LLM logs:', error);
    return [];
  }
}

/**
 * Clear all LLM logs
 */
export function clearLLMLogs(): void {
  localStorage.removeItem(STORAGE_KEYS.LLM_LOGS);
}

/**
 * Generate a UUID v4
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Clear all session data (for testing/reset)
 */
export function clearAllSessions(): void {
  deleteSession();
}

/**
 * Check storage quota and warn if approaching limit
 * Monitors localStorage usage
 * @throws Error if quota is exceeded
 */
export function checkStorageQuota(): void {
  try {
    // Calculate approximate storage usage
    let totalSize = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        const value = localStorage.getItem(key);
        if (value) {
          // Approximate size in bytes (UTF-16 encoding)
          totalSize += (key.length + value.length) * 2;
        }
      }
    }
    
    // localStorage typically has 5-10MB limit
    // Warn at 80% (4MB for 5MB limit)
    const WARNING_THRESHOLD = 4 * 1024 * 1024; // 4MB
    const QUOTA_LIMIT = 5 * 1024 * 1024; // 5MB
    
    if (totalSize > QUOTA_LIMIT) {
      throw new Error('Storage quota exceeded');
    }
    
    if (totalSize > WARNING_THRESHOLD) {
      console.warn(`Storage usage at ${Math.round(totalSize / 1024 / 1024)}MB. Consider deleting old sessions.`);
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'Storage quota exceeded') {
      throw error;
    }
    // If we can't check quota, just continue
    console.warn('Could not check storage quota:', error);
  }
}

/**
 * Get storage usage info
 * @returns Object with used bytes, available bytes, and percentage
 */
export function getStorageInfo(): {
  used: number;
  available: number;
  percentage: number;
} {
  try {
    let totalSize = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        const value = localStorage.getItem(key);
        if (value) {
          totalSize += (key.length + value.length) * 2;
        }
      }
    }
    
    const QUOTA_LIMIT = 5 * 1024 * 1024; // 5MB typical limit
    const available = QUOTA_LIMIT - totalSize;
    const percentage = (totalSize / QUOTA_LIMIT) * 100;
    
    return {
      used: totalSize,
      available: Math.max(0, available),
      percentage: Math.min(100, percentage),
    };
  } catch (error) {
    console.error('Failed to get storage info:', error);
    return {
      used: 0,
      available: 0,
      percentage: 0,
    };
  }
}

/**
 * Migrate session schema if needed
 * Handles version upgrades for session data
 * @param session - The session object to migrate
 * @returns Migrated session object
 */
export function migrateSession(session: any): Session {
  // Migrate from version 1 to version 2 (scene-based architecture)
  if (!session.version || session.version < 2) {
    console.log('Migrating session to version 2 (scene-based architecture)');
    
    // Initialize scene-based fields
    session.version = 2;
    session.currentSceneId = '';
    session.scenes = [];
    session.storyContext = {
      theme: session.theme || '',
      overallGoal: session.theme ? `Complete the ${session.theme} adventure` : '',
      completedScenes: [],
    };
    
    // Remove old scene field if it exists
    delete session.scene;
  }
  
  // Ensure all required fields exist
  if (!session.heartsTrackedPhysically) {
    session.heartsTrackedPhysically = true;
  }
  
  if (!session.currentSceneId) {
    session.currentSceneId = '';
  }
  
  if (!session.scenes) {
    session.scenes = [];
  }
  
  if (!session.storyContext) {
    session.storyContext = {
      theme: session.theme || '',
      overallGoal: session.theme ? `Complete the ${session.theme} adventure` : '',
      completedScenes: [],
    };
  }
  
  return session as Session;
}

// TODO: Add compression for large sessions (e.g., using LZ-string)
// TODO: Add encryption for sensitive data if needed
// TODO: Add backup/export functionality (download as JSON)
// TODO: Add import from file functionality (upload JSON)
/**
 * TurnController
 *
 * Manages the turn-based state machine for the game loop
 * - Tracks current state (Idle, Recording, Transcribing, Thinking, Speaking, AwaitRoll)
 * - Handles state transitions with validation
 * - Coordinates between STT, LLM, and TTS services
 * - Provides state change notifications for UI updates
 *
 * State Machine Flow (from Plan.md lines 165-175):
 * idle -> recording (press and hold)
 * recording -> transcribing (release)
 * transcribing -> thinking (STT complete)
 * thinking -> speaking (LLM complete, no roll needed)
 * thinking -> awaiting_roll (LLM requests roll)
 * speaking -> idle (playback end)
 * awaiting_roll -> recording (ask for roll result)
 */

export type TurnState =
  | 'idle'              // Waiting for user input
  | 'recording'         // Recording user speech
  | 'transcribing'      // Converting speech to text
  | 'thinking'          // LLM processing
  | 'speaking'          // TTS playback
  | 'awaiting_roll'     // Waiting for dice roll result
  | 'story_init'        // Story Guide initializing story
  | 'story_update'      // Story Guide updating story state
  | 'scene_setup'       // Creating new scene
  | 'scene_transition'  // Transitioning between scenes
  | 'scene_summary'     // Summarizing completed scene
  | 'error'             // Error state
  | 'paused';           // Paused state

export interface TurnStateChange {
  from: TurnState;
  to: TurnState;
  timestamp: number;
}

export type StateChangeCallback = (change: TurnStateChange) => void;

/**
 * Turn-based state machine controller
 */
export class TurnController {
  private currentState: TurnState = 'idle';
  private stateHistory: TurnStateChange[] = [];
  private listeners: Set<StateChangeCallback> = new Set();
  private stateTimeout: number | null = null;
  private readonly STATE_TIMEOUT_MS = 60000; // 1 minute timeout for most states
  private readonly SPEAKING_TIMEOUT_MS = 120000; // 2 minutes timeout for speaking (TTS can be long)

  constructor() {
    // Initialize with idle state
    this.currentState = 'idle';
    this.stateHistory = [];
  }

  /**
   * Get current state
   * @returns The current turn state
   */
  getState(): TurnState {
    return this.currentState;
  }

  /**
   * Transition to a new state
   * Validates the transition, updates state, notifies listeners, and manages timeouts
   *
   * @param newState - Target state
   * @returns true if transition was successful
   */
  transition(newState: TurnState): boolean {
    // Validate transition
    if (!this.isValidTransition(this.currentState, newState)) {
      console.warn(`Invalid transition from ${this.currentState} to ${newState}`);
      return false;
    }

    // Clear any existing timeout
    this.clearStateTimeout();

    // Create state change record
    const change: TurnStateChange = {
      from: this.currentState,
      to: newState,
      timestamp: Date.now(),
    };

    // Update state
    this.currentState = newState;
    this.stateHistory.push(change);

    // Log transition for debugging
    console.log(`State transition: ${change.from} -> ${change.to}`);

    // Notify all listeners
    this.notifyListeners(change);

    // Set timeout for non-idle states to prevent getting stuck
    // (awaiting_roll is handled specially in setStateTimeout)
    if (newState !== 'idle' && newState !== 'error') {
      this.setStateTimeout();
    }

    return true;
  }

  /**
   * Check if a state transition is valid
   * Implements state machine rules from Plan.md (lines 165-175)
   *
   * @param from - Current state
   * @param to - Target state
   * @returns true if transition is allowed
   */
  private isValidTransition(from: TurnState, to: TurnState): boolean {
    return true; // Simplified: allow all transitions for flexibility
  }

  /**
   * Subscribe to state changes
   * @param callback - Function to call when state changes
   * @returns Unsubscribe function
   */
  onStateChange(callback: StateChangeCallback): () => void {
    this.listeners.add(callback);

    // Return unsubscribe function
    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * Notify all listeners of state change
   * @param change - The state change event
   */
  private notifyListeners(change: TurnStateChange): void {
    this.listeners.forEach(callback => {
      try {
        callback(change);
      } catch (error) {
        console.error('Error in state change listener:', error);
      }
    });
  }

  /**
   * Get state history
   * @returns Copy of state history array
   */
  getHistory(): TurnStateChange[] {
    return [...this.stateHistory];
  }

  /**
   * Reset to idle state
   * Clears any timeouts and transitions to idle
   */
  reset(): void {
    this.clearStateTimeout();
    this.transition('idle');
  }

  /**
   * Check if currently in a busy state
   * @returns true if not idle
   */
  isBusy(): boolean {
    return this.currentState !== 'idle' && this.currentState !== 'error';
  }

  /**
   * Check if can start recording
   * @returns true if in idle or awaiting_roll state
   */
  canRecord(): boolean {
    return this.currentState === 'idle' || this.currentState === 'awaiting_roll';
  }

  /**
   * Get state display name for UI
   * @param state - Optional state to get name for (defaults to current)
   * @returns Human-readable state name
   */
  getStateDisplayName(state?: TurnState): string {
    const s = state ?? this.currentState;
    const displayNames: Record<TurnState, string> = {
      idle: 'Ready',
      recording: 'Recording...',
      transcribing: 'Transcribing...',
      thinking: 'Thinking...',
      speaking: 'Speaking...',
      awaiting_roll: 'Please roll your dice and tell me the result!',
      story_init: 'Starting your adventure...',
      story_update: 'Planning next chapter...',
      scene_setup: 'Creating scene...',
      scene_transition: 'Scene transition...',
      scene_summary: 'Wrapping up scene...',
      error: 'Error',
      paused: 'Paused',
    };
    return displayNames[s];
  }

  /**
   * Set a timeout to prevent getting stuck in a state
   * If state doesn't change within timeout, transition to error
   * Note: awaiting_roll state has no timeout as we wait indefinitely for user input
   * Note: speaking state has a longer timeout (2 minutes) since TTS can take time
   */
  private setStateTimeout(): void {
    // Don't set timeout for awaiting_roll - we wait indefinitely for the user to roll
    if (this.currentState === 'awaiting_roll') {
      return;
    }
    
    // Use longer timeout for speaking state (TTS playback can be lengthy)
    const timeout = this.currentState === 'speaking'
      ? this.SPEAKING_TIMEOUT_MS
      : this.STATE_TIMEOUT_MS;
    
    this.stateTimeout = window.setTimeout(() => {
      console.error(`State timeout: stuck in ${this.currentState} for ${timeout}ms`);
      this.transition('error');
    }, timeout);
  }

  /**
   * Clear the state timeout
   */
  private clearStateTimeout(): void {
    if (this.stateTimeout !== null) {
      clearTimeout(this.stateTimeout);
      this.stateTimeout = null;
    }
  }

  /**
   * Get time spent in current state
   * @returns Time in milliseconds
   */
  getTimeInCurrentState(): number {
    const lastChange = this.stateHistory[this.stateHistory.length - 1];
    if (!lastChange) return 0;
    return Date.now() - lastChange.timestamp;
  }

  /**
   * Get metrics for state transitions
   * @returns Object with state transition statistics
   */
  getMetrics(): {
    totalTransitions: number;
    averageTimePerState: number;
    stateFrequency: Record<TurnState, number>;
  } {
    const stateFrequency: Record<string, number> = {};
    let totalTime = 0;

    for (let i = 0; i < this.stateHistory.length - 1; i++) {
      const current = this.stateHistory[i];
      const next = this.stateHistory[i + 1];
      const duration = next.timestamp - current.timestamp;
      
      stateFrequency[current.to] = (stateFrequency[current.to] || 0) + 1;
      totalTime += duration;
    }

    return {
      totalTransitions: this.stateHistory.length,
      averageTimePerState: this.stateHistory.length > 1 ? totalTime / (this.stateHistory.length - 1) : 0,
      stateFrequency: stateFrequency as Record<TurnState, number>,
    };
  }

  /**
   * Clean up resources
   * Clears listeners, history, and timeouts
   */
  cleanup(): void {
    this.clearStateTimeout();
    this.listeners.clear();
    this.stateHistory = [];
  }
}

// TODO: Add state persistence for session resume (save/load state to session)
// TODO: Add error recovery strategies (retry logic, fallback states)
// TODO: Add state transition animations/sound cues
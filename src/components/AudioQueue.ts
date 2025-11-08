/**
 * AudioQueue
 *
 * Manages sequential playback of TTS audio segments
 * - Queues multiple audio segments for sequential playback
 * - Plays one segment at a time in FIFO order
 * - Handles pause/resume/stop operations
 * - Provides playback status and event notifications
 * - Automatically advances to next item when current finishes
 *
 * Usage:
 * ```typescript
 * const queue = new AudioQueue();
 * queue.enqueue({ id: '1', audio: blob, text: 'Hello' });
 * queue.onStatusChange(status => console.log(status));
 * ```
 */

export interface AudioQueueItem {
  id: string;
  audio: Blob | string; // Audio blob or URL
  text: string; // Text being spoken (for captions)
  onStart?: () => void; // Called when this item starts playing
  onEnd?: () => void; // Called when this item finishes
  onError?: (error: Error) => void; // Called if playback fails
}

export type QueueStatus = 'idle' | 'playing' | 'paused';

export type StatusChangeCallback = (status: QueueStatus) => void;
export type ItemChangeCallback = (item: AudioQueueItem | null) => void;

/**
 * Audio playback queue manager
 */
export class AudioQueue {
  private queue: AudioQueueItem[] = [];
  private currentItem: AudioQueueItem | null = null;
  private currentAudio: HTMLAudioElement | null = null;
  private status: QueueStatus = 'idle';
  private statusListeners: Set<StatusChangeCallback> = new Set();
  private itemListeners: Set<ItemChangeCallback> = new Set();
  private objectUrls: Set<string> = new Set(); // Track created object URLs for cleanup

  constructor() {
    // Initialize with idle state
    this.status = 'idle';
  }

  /**
   * Add audio to the queue
   * Auto-starts playback if queue was empty
   *
   * @param item - Audio queue item to add
   */
  enqueue(item: AudioQueueItem): void {
    this.queue.push(item);
    
    // Auto-start playback if idle
    if (this.status === 'idle') {
      this.playNext();
    }
  }

  /**
   * Play next item in queue
   * Handles audio loading, playback, and callbacks
   * Auto-advances to next item when current finishes
   */
  private async playNext(): Promise<void> {
    // Check if queue is empty
    if (this.queue.length === 0) {
      this.currentItem = null;
      this.currentAudio = null;
      this.setStatus('idle');
      this.notifyItemListeners(null);
      return;
    }

    // Get next item from queue
    this.currentItem = this.queue.shift()!;
    this.notifyItemListeners(this.currentItem);

    try {
      // Create audio element
      this.currentAudio = new Audio();
      
      // Set audio source (handle both Blob and URL)
      if (this.currentItem.audio instanceof Blob) {
        const url = URL.createObjectURL(this.currentItem.audio);
        this.objectUrls.add(url);
        this.currentAudio.src = url;
      } else {
        this.currentAudio.src = this.currentItem.audio;
      }

      // Set up event handlers
      this.currentAudio.onplay = () => {
        this.setStatus('playing');
        this.currentItem?.onStart?.();
      };

      this.currentAudio.onended = () => {
        this.currentItem?.onEnd?.();
        this.cleanupCurrentAudio();
        this.playNext(); // Auto-advance to next item
      };

      this.currentAudio.onerror = (event) => {
        const error = new Error(`Audio playback failed: ${this.currentAudio?.error?.message || 'Unknown error'}`);
        console.error('Audio playback error:', error);
        this.currentItem?.onError?.(error);
        this.cleanupCurrentAudio();
        this.playNext(); // Try next item
      };

      // Start playback
      await this.currentAudio.play();
      
    } catch (error) {
      const playbackError = error instanceof Error ? error : new Error('Audio playback failed');
      console.error('Failed to play audio:', playbackError);
      this.currentItem?.onError?.(playbackError);
      this.cleanupCurrentAudio();
      this.playNext(); // Try next item
    }
  }

  /**
   * Pause current playback
   * Only works if currently playing
   */
  pause(): void {
    if (this.currentAudio && this.status === 'playing') {
      this.currentAudio.pause();
      this.setStatus('paused');
    }
  }

  /**
   * Resume paused playback
   * Only works if currently paused
   */
  resume(): void {
    if (this.currentAudio && this.status === 'paused') {
      this.currentAudio.play().catch(error => {
        console.error('Failed to resume playback:', error);
        this.currentItem?.onError?.(error instanceof Error ? error : new Error('Resume failed'));
      });
      this.setStatus('playing');
    }
  }

  /**
   * Stop current playback and clear queue
   * Resets to idle state
   */
  stop(): void {
    // Clear queue
    this.queue = [];
    
    // Stop current audio
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
    }
    
    // Cleanup
    this.cleanupCurrentAudio();
    this.currentItem = null;
    this.setStatus('idle');
    this.notifyItemListeners(null);
  }

  /**
   * Skip current item and play next
   * Useful for interrupting long narrations
   */
  skip(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
    }
    this.cleanupCurrentAudio();
    this.currentItem = null;
    this.playNext();
  }

  /**
   * Clear all queued items (but keep current playing)
   */
  clearQueue(): void {
    this.queue = [];
  }

  /**
   * Get current queue status
   * @returns Current playback status
   */
  getStatus(): QueueStatus {
    return this.status;
  }

  /**
   * Check if currently playing
   * @returns true if status is 'playing'
   */
  isPlaying(): boolean {
    return this.status === 'playing';
  }

  /**
   * Get number of items in queue (not including current)
   * @returns Queue length
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Get current playing item
   * @returns Current item or null if idle
   */
  getCurrentItem(): AudioQueueItem | null {
    return this.currentItem;
  }

  /**
   * Get all queued items (not including current)
   * @returns Copy of queue array
   */
  getQueue(): AudioQueueItem[] {
    return [...this.queue];
  }

  /**
   * Subscribe to status changes
   * @param callback - Function to call when status changes
   * @returns Unsubscribe function
   */
  onStatusChange(callback: StatusChangeCallback): () => void {
    this.statusListeners.add(callback);

    // Return unsubscribe function
    return () => {
      this.statusListeners.delete(callback);
    };
  }

  /**
   * Subscribe to current item changes
   * @param callback - Function to call when current item changes
   * @returns Unsubscribe function
   */
  onItemChange(callback: ItemChangeCallback): () => void {
    this.itemListeners.add(callback);

    // Return unsubscribe function
    return () => {
      this.itemListeners.delete(callback);
    };
  }

  /**
   * Set status and notify listeners
   * @param newStatus - New status to set
   */
  private setStatus(newStatus: QueueStatus): void {
    if (this.status !== newStatus) {
      this.status = newStatus;
      this.notifyStatusListeners(newStatus);
    }
  }

  /**
   * Notify all status listeners
   * @param status - Current status
   */
  private notifyStatusListeners(status: QueueStatus): void {
    this.statusListeners.forEach(callback => {
      try {
        callback(status);
      } catch (error) {
        console.error('Error in status change listener:', error);
      }
    });
  }

  /**
   * Notify all item listeners
   * @param item - Current item or null
   */
  private notifyItemListeners(item: AudioQueueItem | null): void {
    this.itemListeners.forEach(callback => {
      try {
        callback(item);
      } catch (error) {
        console.error('Error in item change listener:', error);
      }
    });
  }

  /**
   * Clean up current audio element and object URLs
   */
  private cleanupCurrentAudio(): void {
    if (this.currentAudio) {
      // Remove event listeners
      this.currentAudio.onplay = null;
      this.currentAudio.onended = null;
      this.currentAudio.onerror = null;
      
      // Revoke object URL if it was created
      if (this.currentAudio.src && this.objectUrls.has(this.currentAudio.src)) {
        URL.revokeObjectURL(this.currentAudio.src);
        this.objectUrls.delete(this.currentAudio.src);
      }
      
      this.currentAudio = null;
    }
  }

  /**
   * Clean up all resources
   * Call this when destroying the queue
   */
  cleanup(): void {
    this.stop();
    
    // Revoke any remaining object URLs
    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
    this.objectUrls.clear();
    
    // Clear listeners
    this.statusListeners.clear();
    this.itemListeners.clear();
  }
}

// TODO: Add preloading for next item in queue (create Audio element early)
// TODO: Add crossfade between items (overlap playback with volume fade)
// TODO: Add volume control (master volume for all items)
// TODO: Add playback speed control (for faster/slower narration)
// TODO: Add audio visualization (waveform or spectrum analyzer)
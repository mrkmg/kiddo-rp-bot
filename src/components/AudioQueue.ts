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
  audio: Blob | string | AsyncIterable<Uint8Array>; // Audio blob, URL, or streaming chunks
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
  private audioContext: AudioContext | null = null;
  private isAudioUnlocked: boolean = false;

  constructor() {
    // Initialize with idle state
    this.status = 'idle';
    
    // Initialize audio context for iOS
    this.initAudioContext();
  }

  /**
   * Initialize audio context and unlock audio for iOS
   * iOS requires user interaction to enable audio playback
   */
  private initAudioContext(): void {
    try {
      // Create audio context
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        this.audioContext = new AudioContextClass();
      }
    } catch (error) {
      console.warn('Failed to create AudioContext:', error);
    }
  }

  /**
   * Unlock audio playback for iOS
   * Must be called from a user interaction event (click, touch, etc.)
   * This creates a silent audio buffer and plays it to unlock the audio system
   */
  async unlockAudio(): Promise<void> {
    if (this.isAudioUnlocked) {
      return;
    }

    try {
      // Method 1: Resume AudioContext (required for iOS)
      if (this.audioContext && this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // Method 2: Play a silent audio element (iOS Safari requirement)
      const silentAudio = new Audio();
      silentAudio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
      silentAudio.volume = 0;
      
      try {
        await silentAudio.play();
        silentAudio.pause();
        silentAudio.remove();
      } catch (e) {
        // Ignore errors from silent audio
      }

      this.isAudioUnlocked = true;
      console.log('Audio unlocked for iOS');
    } catch (error) {
      console.warn('Failed to unlock audio:', error);
    }
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
   * Supports streaming audio for low-latency playback
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
      // Check if this is a streaming audio source
      if (this.isAsyncIterable(this.currentItem.audio)) {
        await this.playStreamingAudio(this.currentItem.audio);
      } else {
        await this.playStaticAudio(this.currentItem.audio);
      }
    } catch (error) {
      const playbackError = error instanceof Error ? error : new Error('Audio playback failed');
      console.error('Failed to play audio:', playbackError);
      this.currentItem?.onError?.(playbackError);
      this.cleanupCurrentAudio();
      this.playNext(); // Try next item
    }
  }

  /**
   * Check if value is an async iterable (streaming audio)
   */
  private isAsyncIterable(value: any): value is AsyncIterable<Uint8Array> {
    return value != null && typeof value[Symbol.asyncIterator] === 'function';
  }

  /**
   * Play static audio (Blob or URL)
   */
  private async playStaticAudio(audio: Blob | string): Promise<void> {
    // Ensure audio is unlocked for iOS
    await this.unlockAudio();

    // Create audio element
    this.currentAudio = new Audio();
    
    // iOS-specific settings for better compatibility
    this.currentAudio.preload = 'auto';
    (this.currentAudio as any).playsInline = true; // Required for iOS to play inline
    
    // Set audio source (handle both Blob and URL)
    if (audio instanceof Blob) {
      const url = URL.createObjectURL(audio);
      this.objectUrls.add(url);
      this.currentAudio.src = url;
    } else {
      this.currentAudio.src = audio;
    }

    // Load the audio before playing (important for iOS)
    await new Promise<void>((resolve, reject) => {
      this.currentAudio!.onloadeddata = () => resolve();
      this.currentAudio!.onerror = () => reject(new Error('Failed to load audio'));
      this.currentAudio!.load();
    });

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
    try {
      await this.currentAudio.play();
    } catch (error) {
      // Handle iOS autoplay restrictions
      if (error instanceof Error && error.name === 'NotAllowedError') {
        console.warn('Audio playback blocked - user interaction required');
        throw new Error('Audio playback requires user interaction on iOS');
      }
      throw error;
    }
  }

  /**
   * Play streaming audio chunks as they arrive
   * Uses MediaSource API for seamless streaming playback
   */
  private async playStreamingAudio(audioStream: AsyncIterable<Uint8Array>): Promise<void> {
    // Ensure audio is unlocked for iOS
    await this.unlockAudio();

    // Use existing audio context or create new one
    const audioContext = this.audioContext || new (window.AudioContext || (window as any).webkitAudioContext)();
    
    // Resume context if suspended (iOS requirement)
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }
    
    let startTime = audioContext.currentTime;
    let hasStarted = false;

    try {
      // Collect all chunks and concatenate them
      const chunks: Uint8Array[] = [];
      
      for await (const chunk of audioStream) {
        chunks.push(chunk);
        
        // Start playback as soon as we have the first chunk
        if (!hasStarted && chunks.length > 0) {
          hasStarted = true;
          this.setStatus('playing');
          this.currentItem?.onStart?.();
        }
      }

      // Concatenate all chunks into a single buffer
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const audioData = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        audioData.set(chunk, offset);
        offset += chunk.length;
      }

      // Create a WAV blob from the raw PCM data
      const wavBlob = this.createWavBlob(audioData);
      const arrayBuffer = await wavBlob.arrayBuffer();
      
      // Decode and play the audio
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      
      // Set up completion handler
      source.onended = () => {
        this.currentItem?.onEnd?.();
        audioContext.close();
        this.cleanupCurrentAudio();
        this.playNext();
      };

      // Start playback
      source.start(0);
      
      // Store reference for potential cleanup
      (this as any).currentAudioSource = source;
      (this as any).currentAudioContext = audioContext;

    } catch (error) {
      audioContext.close();
      throw error;
    }
  }

  /**
   * Create a WAV blob from raw PCM audio data
   * Assumes 16-bit PCM, 24kHz sample rate, mono
   */
  private createWavBlob(pcmData: Uint8Array): Blob {
    const sampleRate = 24000; // Hume.ai default sample rate
    const numChannels = 1; // Mono
    const bitsPerSample = 16;
    
    const wavHeader = new ArrayBuffer(44);
    const view = new DataView(wavHeader);
    
    // RIFF chunk descriptor
    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + pcmData.length, true);
    this.writeString(view, 8, 'WAVE');
    
    // fmt sub-chunk
    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
    view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * bitsPerSample / 8, true); // ByteRate
    view.setUint16(32, numChannels * bitsPerSample / 8, true); // BlockAlign
    view.setUint16(34, bitsPerSample, true);
    
    // data sub-chunk
    this.writeString(view, 36, 'data');
    view.setUint32(40, pcmData.length, true);
    
    // Convert to ArrayBuffer to satisfy TypeScript
    const pcmBuffer = pcmData.buffer as ArrayBuffer;
    return new Blob([wavHeader, pcmBuffer], { type: 'audio/wav' });
  }

  /**
   * Write a string to a DataView
   */
  private writeString(view: DataView, offset: number, string: string): void {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
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
    
    // Close audio context
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}

// TODO: Add preloading for next item in queue (create Audio element early)
// TODO: Add crossfade between items (overlap playback with volume fade)
// TODO: Add volume control (master volume for all items)
// TODO: Add playback speed control (for faster/slower narration)
// TODO: Add audio visualization (waveform or spectrum analyzer)
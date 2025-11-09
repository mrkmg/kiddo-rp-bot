/**
 * Voice Activity Detection (VAD) Service
 *
 * Wraps the @ricky0123/vad-web library to detect speech in audio
 * - Analyzes audio to determine if speech is present
 * - Rejects silent or non-speech audio before sending to Whisper
 * - Reduces unnecessary API calls and improves user experience
 */

import { MicVAD } from '@ricky0123/vad-web';

export interface VADConfig {
  /**
   * Probability threshold for speech detection (0-1)
   * Higher = more strict (less false positives)
   * Default: 0.5
   */
  positiveSpeechThreshold?: number;
  
  /**
   * Probability threshold for non-speech (0-1)
   * Lower = more strict (less false negatives)
   * Default: 0.35
   */
  negativeSpeechThreshold?: number;
  
  /**
   * Minimum speech duration in milliseconds
   * Default: 250ms
   */
  minSpeechMs?: number;
  
  /**
   * Redemption time in milliseconds (grace period after silence)
   * Default: 800ms
   */
  redemptionMs?: number;
  
  /**
   * Pre-speech padding in milliseconds
   * Default: 300ms
   */
  preSpeechPadMs?: number;
}

export interface VADResult {
  hasSpeech: boolean;
  confidence: number;
  duration: number;
}

/**
 * VAD Service for detecting voice activity in audio
 */
export class VADService {
  private config: Required<VADConfig>;
  private vad: any = null;
  private isInitialized = false;
  private speechDetected = false;
  private speechFrameCount = 0;

  constructor(config: VADConfig = {}) {
    this.config = {
      positiveSpeechThreshold: config.positiveSpeechThreshold ?? 0.5,
      negativeSpeechThreshold: config.negativeSpeechThreshold ?? 0.35,
      minSpeechMs: config.minSpeechMs ?? 250,
      redemptionMs: config.redemptionMs ?? 800,
      preSpeechPadMs: config.preSpeechPadMs ?? 300,
    };
  }

  /**
   * Initialize the VAD with a media stream
   */
  async initialize(stream: MediaStream): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Reset state
      this.speechDetected = false;
      this.speechFrameCount = 0;

      // Create VAD instance with new API
      this.vad = await MicVAD.new({
        positiveSpeechThreshold: this.config.positiveSpeechThreshold,
        negativeSpeechThreshold: this.config.negativeSpeechThreshold,
        minSpeechMs: this.config.minSpeechMs,
        redemptionMs: this.config.redemptionMs,
        preSpeechPadMs: this.config.preSpeechPadMs,
        startOnLoad: false, // Don't start automatically
        // Assets are copied to /vad by vite-plugin-static-copy
        baseAssetPath: '/vad/',
        onnxWASMBasePath: '/vad/',
        getStream: async () => stream,
        pauseStream: async (s: MediaStream) => {
          s.getTracks().forEach(track => track.enabled = false);
        },
        resumeStream: async (s: MediaStream) => {
          s.getTracks().forEach(track => track.enabled = true);
          return s;
        },
        onSpeechStart: () => {
          console.log('[VAD] Speech started');
          this.speechDetected = true;
        },
        onSpeechEnd: () => {
          console.log('[VAD] Speech ended');
        },
        onVADMisfire: () => {
          console.log('[VAD] Misfire detected');
        },
        onFrameProcessed: (probabilities) => {
          // Track speech frames
          if (probabilities.isSpeech) {
            this.speechFrameCount++;
          }
        },
      });

      this.isInitialized = true;
      console.log('[VAD] Initialized successfully');
    } catch (error) {
      console.error('[VAD] Initialization failed:', error);
      throw new Error(`Failed to initialize VAD: ${(error as Error).message}`);
    }
  }

  /**
   * Start VAD processing
   */
  start(): void {
    if (!this.vad) {
      throw new Error('VAD not initialized');
    }
    
    this.speechDetected = false;
    this.speechFrameCount = 0;
    this.vad.start();
    console.log('[VAD] Started');
  }

  /**
   * Pause VAD processing
   */
  pause(): void {
    if (this.vad) {
      this.vad.pause();
      console.log('[VAD] Paused');
    }
  }

  /**
   * Check if speech was detected during recording
   */
  hasSpeech(): boolean {
    return this.speechDetected && this.speechFrameCount > 0;
  }

  /**
   * Get the number of speech frames detected
   */
  getSpeechFrameCount(): number {
    return this.speechFrameCount;
  }

  /**
   * Reset VAD state
   */
  reset(): void {
    this.speechDetected = false;
    this.speechFrameCount = 0;
  }

  /**
   * Destroy VAD instance and clean up resources
   */
  destroy(): void {
    if (this.vad) {
      this.vad.destroy();
      this.vad = null;
      this.isInitialized = false;
      this.speechDetected = false;
      this.speechFrameCount = 0;
      console.log('[VAD] Destroyed');
    }
  }

  /**
   * Check if VAD is initialized
   */
  isReady(): boolean {
    return this.isInitialized && this.vad !== null;
  }
}
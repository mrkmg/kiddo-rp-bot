/**
 * Text-to-Speech Service
 * 
 * Handles voice synthesis using Hume.ai API
 * - Converts DM text to speech using "Warm Storyteller" voice
 * - Manages audio playback
 * - Provides fallback to text-only display on errors
 */

export interface TTSConfig {
  apiKey: string;
  voiceId?: string;
  baseUrl?: string;
}

export interface SpeechRequest {
  text: string;
  voiceId?: string;
}

export interface SpeechResult {
  audioUrl?: string;
  audioBlob?: Blob;
  duration?: number;
}

/**
 * Text-to-Speech service using Hume.ai
 */
export class TTSService {
  private config: TTSConfig;
  private audioContext: AudioContext | null = null;
  private currentAudio: HTMLAudioElement | null = null;

  constructor(config: TTSConfig) {
    this.config = {
      voiceId: 'English Children\'s Book Narrator',
      baseUrl: 'https://api.hume.ai/v0',
      ...config,
    };
  }

  /**
   * Convert text to speech and return audio
   *
   * @param request - Speech request with text and optional voice
   * @returns Speech result with audio data
   */
  async synthesize(request: SpeechRequest): Promise<SpeechResult> {
    if (!this.config.apiKey) {
      throw new Error('Hume API key not configured');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    try {
      // Hume.ai TTS endpoint - /v0/tts for JSON response
      const response = await fetch(`${this.config.baseUrl}/tts`, {
        method: 'POST',
        headers: {
          'X-Hume-Api-Key': this.config.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          utterances: [
            {
              text: request.text,
              voice: {
                name: request.voiceId || this.config.voiceId || 'Ava Song',
                provider: 'HUME_AI'
              }
            }
          ],
          version: '2'
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          `Hume TTS API error: ${response.status} - ${errorData.message || response.statusText}`
        );
      }

      // Parse JSON response
      const data = await response.json();
      
      // Extract audio from first generation
      if (!data.generations || !data.generations[0] || !data.generations[0].audio) {
        throw new Error('No audio data in response');
      }

      // Convert base64 audio to blob
      const base64Audio = data.generations[0].audio;
      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const audioBlob = new Blob([bytes], { type: 'audio/wav' });
      
      // Create object URL for playback
      const audioUrl = URL.createObjectURL(audioBlob);

      return {
        audioUrl,
        audioBlob,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      
      if ((error as Error).name === 'AbortError') {
        throw new Error('TTS request timed out after 30 seconds');
      }
      
      // Provide helpful error message for fallback
      throw new Error(`Text-to-speech failed: ${(error as Error).message}`);
    }
  }

  /**
   * Play audio from blob or URL
   * 
   * @param audio - Audio blob or URL to play
   * @returns Promise that resolves when playback completes
   */
  async play(audio: Blob | string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Initialize audio context if needed (for autoplay policy)
        this.initAudioContext();

        // Stop any current playback
        this.stop();

        // Create audio element
        this.currentAudio = new Audio();
        
        // Set source
        if (typeof audio === 'string') {
          this.currentAudio.src = audio;
        } else {
          this.currentAudio.src = URL.createObjectURL(audio);
        }

        // Handle playback completion
        this.currentAudio.onended = () => {
          // Clean up object URL if it was created from blob
          if (typeof audio !== 'string') {
            URL.revokeObjectURL(this.currentAudio!.src);
          }
          this.currentAudio = null;
          resolve();
        };

        // Handle errors
        this.currentAudio.onerror = (event) => {
          const error = new Error(`Audio playback error: ${event}`);
          this.stop();
          reject(error);
        };

        // Start playback
        this.currentAudio.play().catch(error => {
          // Handle autoplay policy errors
          if (error.name === 'NotAllowedError') {
            reject(new Error('Audio playback blocked by browser. User interaction required.'));
          } else {
            reject(error);
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Stop current playback
   */
  stop(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      
      // Revoke object URL if it exists
      if (this.currentAudio.src.startsWith('blob:')) {
        URL.revokeObjectURL(this.currentAudio.src);
      }
      
      this.currentAudio = null;
    }
  }

  /**
   * Pause current playback
   */
  pause(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
    }
  }

  /**
   * Resume paused playback
   */
  resume(): void {
    if (this.currentAudio && this.currentAudio.paused) {
      this.currentAudio.play().catch(error => {
        console.error('Failed to resume playback:', error);
      });
    }
  }

  /**
   * Check if TTS is currently playing
   */
  isPlaying(): boolean {
    return this.currentAudio !== null && !this.currentAudio.paused;
  }

  /**
   * Initialize audio context
   * Helps with browser autoplay policies
   */
  private initAudioContext(): void {
    if (!this.audioContext) {
      try {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        
        // Resume context if suspended (for autoplay policy)
        if (this.audioContext.state === 'suspended') {
          this.audioContext.resume();
        }
      } catch (error) {
        console.warn('Failed to initialize AudioContext:', error);
      }
    }
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    this.stop();
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  /**
   * Validate API configuration
   */
  validateConfig(): boolean {
    return !!this.config.apiKey;
  }
}

// TODO: Add audio preprocessing (normalize volume, etc.)
// TODO: Add support for SSML markup if Hume supports it
// TODO: Add audio caching for repeated phrases
// TODO: Add playback speed control
// TODO: Add audio visualization support

/**
 * NOTE: Hume.ai API endpoint verification needed
 * 
 * The actual Hume.ai TTS endpoint may differ from the implementation above.
 * Common alternatives:
 * 
 * 1. EVI (Empathic Voice Interface) WebSocket API:
 *    - Requires WebSocket connection
 *    - Provides streaming audio
 *    - May be more suitable for real-time interaction
 * 
 * 2. REST API endpoint variations:
 *    - /v0/tts/synthesize
 *    - /v0/evi/synthesize
 *    - Check Hume.ai documentation for correct endpoint
 * 
 * 3. Voice ID verification:
 *    - "warm-storyteller" may need to be replaced with actual Hume voice ID
 *    - Check available voices in Hume.ai dashboard
 * 
 * If the current implementation fails, consider:
 * - Using Hume Browser SDK if available (npm package)
 * - Implementing WebSocket-based streaming
 * - Falling back to alternative TTS service (e.g., OpenAI TTS)
 */
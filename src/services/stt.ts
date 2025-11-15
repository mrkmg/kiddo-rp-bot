/**
 * Speech-to-Text Service
 *
 * Handles audio recording and transcription using OpenAI Whisper API
 * - Captures audio from microphone using MediaRecorder
 * - Uses VAD (Voice Activity Detection) to reject non-speech audio
 * - Converts audio to appropriate format (webm/ogg)
 * - Uploads to OpenAI Whisper API for transcription
 * - Returns transcribed text
 */

import { VADService } from './vad';

export interface STTConfig {
  apiKey: string;
  model?: string;
  language?: string;
  enableVAD?: boolean;
}

export interface TranscriptionResult {
  text: string;
  duration?: number;
  confidence?: number;
}

export interface RecordingState {
  isRecording: boolean;
  duration: number;
  error: string | null;
}

/**
 * Exponential backoff retry utility
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (i < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, i);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError!;
}

/**
 * Speech-to-Text service class
 */
export class STTService {
  private config: STTConfig;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private vadService: VADService | null = null;

  constructor(config: STTConfig) {
    this.config = {
      model: 'whisper-1',
      language: 'en',
      enableVAD: true,
      ...config,
    };
    
    // Initialize VAD if enabled
    if (this.config.enableVAD) {
      this.vadService = new VADService();
    }
  }

  /**
   * Start recording audio from microphone
   */
  async startRecording(): Promise<void> {
    try {
      // Request microphone access if we don't have a stream
      if (!this.stream) {
        try {
          this.stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              sampleRate: 44100,
            }
          });
        } catch (error) {
          // If constraints fail (common on iOS), try with simpler constraints
          if ((error as Error).name === 'OverconstrainedError' || (error as Error).name === 'NotFoundError') {
            console.warn('Advanced audio constraints failed, trying basic constraints');
            this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          } else {
            throw error;
          }
        }

        // Initialize VAD once with the stream
        if (this.config.enableVAD && this.vadService) {
          await this.vadService.initialize(this.stream);
        }
      }

      // Reset VAD state and start for this recording
      if (this.config.enableVAD && this.vadService) {
        this.vadService.reset();
        this.vadService.start();
      }

      // Determine supported MIME type
      const mimeType = this.getSupportedMimeType();
      
      // Create MediaRecorder
      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType,
      });

      // Reset audio chunks
      this.audioChunks = [];

      // Collect audio data
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      // Start recording
      this.mediaRecorder.start();
    } catch (error) {
      this.cleanup();
      throw new Error(`Failed to start recording: ${(error as Error).message}`);
    }
  }

  /**
   * Stop recording and return audio blob
   * Throws error if no speech was detected by VAD
   */
  async stopRecording(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(new Error('No active recording'));
        return;
      }

      this.mediaRecorder.onstop = () => {
        // Check VAD for speech detection
        if (this.config.enableVAD && this.vadService) {
          this.vadService.pause();
          
          if (!this.vadService.hasSpeech()) {
            const frameCount = this.vadService.getSpeechFrameCount();
            console.log(`[STT] No speech detected (frames: ${frameCount})`);
            reject(new Error('No speech detected. Please speak clearly and try again.'));
            return;
          }
          
          console.log(`[STT] Speech detected (frames: ${this.vadService.getSpeechFrameCount()})`);
        }
        
        const mimeType = this.mediaRecorder?.mimeType || 'audio/webm';
        const audioBlob = new Blob(this.audioChunks, { type: mimeType });
        resolve(audioBlob);
      };

      this.mediaRecorder.onerror = (event) => {
        reject(new Error(`Recording error: ${event}`));
      };

      this.mediaRecorder.stop();
      
      // Don't stop stream tracks - keep them alive for VAD reuse
      // Tracks will be stopped in cleanup() or destroy()
    });
  }

  /**
   * Transcribe audio blob using OpenAI Whisper API
   * 
   * @param audioBlob - Audio blob to transcribe
   * @returns Transcription result with text
   */
  async transcribe(audioBlob: Blob): Promise<TranscriptionResult> {
    if (!this.config.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const transcribeRequest = async (): Promise<TranscriptionResult> => {
      // Create FormData for file upload
      const formData = new FormData();
      formData.append('file', audioBlob, 'audio.webm');
      formData.append('model', this.config.model || 'whisper-1');
      formData.append('language', this.config.language || 'en');

      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      try {
        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
          },
          body: formData,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            `Whisper API error: ${response.status} - ${errorData.error?.message || response.statusText}`
          );
        }

        const data = await response.json();
        
        return {
          text: data.text || '',
          duration: data.duration,
        };
      } catch (error) {
        clearTimeout(timeoutId);
        
        if ((error as Error).name === 'AbortError') {
          throw new Error('Transcription request timed out after 30 seconds');
        }
        throw error;
      }
    };

    // Retry with exponential backoff: 1s, 2s, 4s
    try {
      return await retryWithBackoff(transcribeRequest, 3, 1000);
    } catch (error) {
      throw new Error(`Transcription failed: ${(error as Error).message}`);
    }
  }

  /**
   * Cancel current recording
   */
  cancelRecording(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    
    // Pause VAD
    if (this.vadService) {
      this.vadService.pause();
    }
    
    this.cleanup();
  }

  /**
   * Check if microphone is available
   */
  async checkMicrophoneAvailable(): Promise<boolean> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.some(device => device.kind === 'audioinput');
    } catch (error) {
      console.error('Failed to check microphone availability:', error);
      return false;
    }
  }

  /**
   * Get supported MIME type for MediaRecorder
   */
  private getSupportedMimeType(): string {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/ogg',
    ];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }

    // Fallback to default
    return 'audio/webm';
  }

  /**
   * Clean up resources (but keep stream/VAD alive for reuse)
   */
  cleanup(): void {
    // Don't stop stream or destroy VAD - keep them for next recording
    // Only clean up the recorder and chunks
    this.mediaRecorder = null;
    this.audioChunks = [];
  }
  
  /**
   * Destroy service and clean up all resources
   */
  destroy(): void {
    // Stop stream tracks
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    
    // Destroy VAD
    if (this.vadService) {
      this.vadService.destroy();
      this.vadService = null;
    }
    
    this.mediaRecorder = null;
    this.audioChunks = [];
  }
}

// TODO: Add audio level monitoring for visual feedback
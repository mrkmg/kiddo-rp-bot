<script lang="ts">
/**
 * TalkButton Component
 * 
 * Main voice input button for the Kiddo RP Storyteller app
 * - Press-and-hold to record voice input
 * - Visual feedback during recording, processing, and speaking
 * - Integrates with STTService, TurnController, and session store
 * - Minimum 500ms recording duration to avoid accidental taps
 * - Large touch target (120px) for accessibility
 */

import { STTService } from '../services/stt';
import { TurnController, type TurnState } from './TurnController';
import { sessionStore } from '../stores/session';
import { getSettings } from '../utils/storage';

// Props
interface Props {
  sttService: STTService;
  turnController: TurnController;
  onTranscribed?: (text: string) => void;
  onError?: (error: Error) => void;
}

let { 
  sttService, 
  turnController, 
  onTranscribed, 
  onError 
}: Props = $props();

// State
let isPressed = $state(false);
let pressStartTime = $state(0);
let currentState = $state<TurnState>('idle');
let errorMessage = $state<string | null>(null);
let recordingDuration = $state(0);
let recordingTimer: number | null = null;
let lastPressTime = $state(0);

// Minimum recording duration (500ms to avoid accidental taps)
const MIN_RECORDING_DURATION = 500;
// Maximum recording duration (60 seconds)
const MAX_RECORDING_DURATION = 60000;
// Warning threshold (30 seconds)
const WARNING_DURATION = 30000;
// Debounce time between presses (300ms)
const DEBOUNCE_TIME = 300;

// Subscribe to turn controller state changes
$effect(() => {
  const unsubscribe = turnController.onStateChange((change) => {
    currentState = change.to;
  });
  
  return () => unsubscribe();
});

/**
 * Handle press start (mousedown/touchstart)
 */
async function handlePressStart(event: MouseEvent | TouchEvent) {
  event.preventDefault();
  
  // Debounce rapid button presses
  const now = Date.now();
  if (now - lastPressTime < DEBOUNCE_TIME) {
    console.log('Button press debounced');
    return;
  }
  lastPressTime = now;
  
  // Only allow recording if in idle or awaiting_roll state
  if (!turnController.canRecord()) {
    return;
  }
  
  isPressed = true;
  pressStartTime = Date.now();
  recordingDuration = 0;
  errorMessage = null;
  
  try {
    // Transition to recording state
    if (!turnController.transition('recording')) {
      throw new Error('Cannot start recording in current state');
    }
    
    // Play beep sound (optional)
    playBeep('start');
    
    // Start recording
    await sttService.startRecording();
    
    // Start recording duration timer
    startRecordingTimer();
    
  } catch (error) {
    console.error('Failed to start recording:', error);
    errorMessage = error instanceof Error ? error.message : 'Failed to start recording';
    turnController.transition('error');
    onError?.(error instanceof Error ? error : new Error('Recording failed'));
    isPressed = false;
    stopRecordingTimer();
  }
}

/**
 * Handle press end (mouseup/touchend)
 */
async function handlePressEnd(event: MouseEvent | TouchEvent) {
  event.preventDefault();
  
  if (!isPressed) return;
  
  isPressed = false;
  stopRecordingTimer();
  
  const pressDuration = Date.now() - pressStartTime;
  
  // Ignore releases that are too short (< 500ms)
  if (pressDuration < MIN_RECORDING_DURATION) {
    console.log('Recording too short, ignoring');
    errorMessage = 'Recording too short. Please hold the button longer.';
    sttService.cancelRecording();
    turnController.reset();
    
    // Clear error after 3 seconds
    setTimeout(() => {
      errorMessage = null;
    }, 3000);
    return;
  }
  
  try {
    // Play beep sound (optional)
    playBeep('stop');
    
    // Stop recording and get audio blob
    const audioBlob = await sttService.stopRecording();
    
    // Check if audio blob is valid
    if (!audioBlob || audioBlob.size === 0) {
      throw new Error('No audio recorded. Please try again.');
    }
    
    // Transition to transcribing state
    if (!turnController.transition('transcribing')) {
      throw new Error('Cannot transition to transcribing state');
    }
    
    // Transcribe audio
    const result = await sttService.transcribe(audioBlob);
    
    // Handle no speech detected
    if (!result.text || result.text.trim().length === 0) {
      errorMessage = 'No speech detected. Please speak louder and try again.';
      turnController.reset();
      
      // Clear error after 5 seconds
      setTimeout(() => {
        errorMessage = null;
      }, 5000);
      return;
    }
    
    // Handle very short transcriptions (likely background noise)
    if (result.text.trim().length < 3) {
      errorMessage = 'Could not understand. Please try again.';
      turnController.reset();
      
      // Clear error after 5 seconds
      setTimeout(() => {
        errorMessage = null;
      }, 5000);
      return;
    }
    
    // Notify parent component (which will add to transcript and handle state transition)
    onTranscribed?.(result.text);
    
    // Note: Parent component should handle transition to 'thinking' state
    // Don't transition here to avoid race condition
    
  } catch (error) {
    console.error('Transcription failed:', error);
    
    // Provide specific error messages
    const errorMsg = error instanceof Error ? error.message : 'Transcription failed';
    if (errorMsg.toLowerCase().includes('network') || errorMsg.toLowerCase().includes('offline')) {
      errorMessage = 'No internet connection. Please check your network.';
    } else if (errorMsg.toLowerCase().includes('timeout')) {
      errorMessage = 'Request timed out. Please try again.';
    } else if (errorMsg.toLowerCase().includes('inaudible') || errorMsg.toLowerCase().includes('no speech')) {
      errorMessage = 'Could not hear you clearly. Please speak louder.';
    } else {
      errorMessage = 'Transcription failed. Please try again.';
    }
    
    turnController.transition('error');
    onError?.(error instanceof Error ? error : new Error('Transcription failed'));
    
    // Auto-reset after error
    setTimeout(() => {
      turnController.reset();
      errorMessage = null;
    }, 5000);
  }
}

/**
 * Handle press cancel (mouseleave while pressed)
 */
function handlePressCancel(event: MouseEvent | TouchEvent) {
  if (isPressed) {
    isPressed = false;
    stopRecordingTimer();
    sttService.cancelRecording();
    turnController.reset();
    errorMessage = null;
  }
}

/**
 * Start recording duration timer
 */
function startRecordingTimer() {
  stopRecordingTimer(); // Clear any existing timer
  
  recordingTimer = window.setInterval(() => {
    recordingDuration = Date.now() - pressStartTime;
    
    // Warn at 30 seconds
    if (recordingDuration >= WARNING_DURATION && recordingDuration < WARNING_DURATION + 1000) {
      errorMessage = 'Recording will stop in 30 seconds...';
    }
    
    // Auto-stop at 60 seconds
    if (recordingDuration >= MAX_RECORDING_DURATION) {
      console.log('Maximum recording duration reached, auto-stopping');
      errorMessage = 'Maximum recording time reached (60 seconds).';
      
      // Simulate press end
      if (isPressed) {
        isPressed = false;
        stopRecordingTimer();
        
        // Stop recording
        sttService.stopRecording().then(async (audioBlob) => {
          try {
            if (!turnController.transition('transcribing')) {
              throw new Error('Cannot transition to transcribing state');
            }
            
            const result = await sttService.transcribe(audioBlob);
            
            if (result.text && result.text.trim().length > 0) {
              // Notify parent component (which will add to transcript and handle state transition)
              onTranscribed?.(result.text);
              // Note: Parent component should handle transition to 'thinking' state
            } else {
              errorMessage = 'No speech detected in recording.';
              turnController.reset();
            }
          } catch (error) {
            console.error('Auto-stop transcription failed:', error);
            errorMessage = 'Transcription failed. Please try again.';
            turnController.transition('error');
            onError?.(error instanceof Error ? error : new Error('Transcription failed'));
          }
        }).catch((error) => {
          console.error('Auto-stop recording failed:', error);
          errorMessage = 'Recording failed. Please try again.';
          turnController.reset();
        });
      }
    }
  }, 100); // Update every 100ms
}

/**
 * Stop recording duration timer
 */
function stopRecordingTimer() {
  if (recordingTimer !== null) {
    clearInterval(recordingTimer);
    recordingTimer = null;
  }
  recordingDuration = 0;
}

/**
 * Play beep sound for audio feedback
 * @param type - 'start' or 'stop'
 */
function playBeep(type: 'start' | 'stop') {
  try {
    // Create a simple beep using Web Audio API
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    // Different frequencies for start/stop
    oscillator.frequency.value = type === 'start' ? 800 : 600;
    oscillator.type = 'sine';
    
    // Short beep
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.1);
  } catch (error) {
    // Beep is optional, don't fail if it doesn't work
    console.warn('Failed to play beep:', error);
  }
}

/**
 * Get button color based on state
 */
function getButtonColor(): string {
  switch (currentState) {
    case 'recording':
      return 'bg-red-500 hover:bg-red-600 animate-pulse';
    case 'transcribing':
    case 'thinking':
      return 'bg-yellow-500 hover:bg-yellow-600';
    case 'speaking':
      return 'bg-blue-500 hover:bg-blue-600 animate-pulse';
    case 'awaiting_roll':
      return 'bg-purple-500 hover:bg-purple-600';
    case 'error':
      return 'bg-gray-400 cursor-not-allowed';
    default:
      return 'bg-green-500 hover:bg-green-600';
  }
}

/**
 * Check if button should be disabled
 */
function isDisabled(): boolean {
  return currentState === 'transcribing' ||
         currentState === 'thinking' ||
         currentState === 'speaking' ||
         currentState === 'story_init' ||
         currentState === 'story_update' ||
         currentState === 'scene_setup' ||
         currentState === 'scene_transition' ||
         currentState === 'scene_summary' ||
         currentState === 'error';
}
</script>

<div class="flex flex-col items-center justify-center space-y-4 p-4">
  <!-- Talk Button -->
  <button
    class="talk-button rounded-full shadow-lg transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed {getButtonColor()}"
    style="width: 120px; height: 120px; min-width: 120px; min-height: 120px;"
    disabled={isDisabled()}
    onmousedown={handlePressStart}
    onmouseup={handlePressEnd}
    onmouseleave={handlePressCancel}
    ontouchstart={handlePressStart}
    ontouchend={handlePressEnd}
    ontouchcancel={handlePressCancel}
    aria-label={turnController.getStateDisplayName()}
    aria-pressed={isPressed}
  >
    <div class="flex flex-col items-center justify-center text-white">
      {#if currentState === 'recording'}
        <!-- Recording icon -->
        <svg class="w-12 h-12" fill="currentColor" viewBox="0 0 20 20">
          <circle cx="10" cy="10" r="6" />
        </svg>
        <span class="text-xs mt-1 font-bold">Recording</span>
      {:else if currentState === 'transcribing'}
        <!-- Transcribing icon -->
        <svg class="w-12 h-12 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        <span class="text-xs mt-1 font-bold">Listening...</span>
      {:else if currentState === 'thinking'}
        <!-- Thinking icon -->
        <svg class="w-12 h-12 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        <span class="text-xs mt-1 font-bold">Thinking...</span>
      {:else if currentState === 'story_init'}
        <!-- Story Init icon -->
        <svg class="w-12 h-12 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
        <span class="text-xs mt-1 font-bold">Starting...</span>
      {:else if currentState === 'story_update'}
        <!-- Story Update icon -->
        <svg class="w-12 h-12 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
        <span class="text-xs mt-1 font-bold">Planning...</span>
      {:else if currentState === 'scene_setup'}
        <!-- Scene Setup icon -->
        <svg class="w-12 h-12 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
        <span class="text-xs mt-1 font-bold">Creating...</span>
      {:else if currentState === 'scene_transition'}
        <!-- Scene Transition icon -->
        <svg class="w-12 h-12 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
        </svg>
        <span class="text-xs mt-1 font-bold">Transitioning...</span>
      {:else if currentState === 'scene_summary'}
        <!-- Scene Summary icon -->
        <svg class="w-12 h-12 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <span class="text-xs mt-1 font-bold">Wrapping up...</span>
      {:else if currentState === 'speaking'}
        <!-- Speaking icon -->
        <svg class="w-12 h-12" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clip-rule="evenodd" />
        </svg>
        <span class="text-xs mt-1 font-bold">Speaking...</span>
      {:else if currentState === 'awaiting_roll'}
        <!-- Dice icon -->
        <svg class="w-12 h-12" fill="currentColor" viewBox="0 0 20 20">
          <path d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V4a2 2 0 00-2-2H6zm1 2a1 1 0 000 2 1 1 0 000-2zm0 9a1 1 0 000 2 1 1 0 000-2zm4-8a1 1 0 100 2 1 1 0 000-2zm0 4a1 1 0 100 2 1 1 0 000-2zm0 4a1 1 0 100 2 1 1 0 000-2zm2-8a1 1 0 000 2 1 1 0 000-2zm0 9a1 1 0 000 2 1 1 0 000-2z" />
        </svg>
        <span class="text-xs mt-1 font-bold">Roll Dice!</span>
      {:else if currentState === 'error'}
        <!-- Error icon -->
        <svg class="w-12 h-12" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
        </svg>
        <span class="text-xs mt-1 font-bold">Error</span>
      {:else}
        <!-- Microphone icon (idle) -->
        <svg class="w-12 h-12" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clip-rule="evenodd" />
        </svg>
        <span class="text-xs mt-1 font-bold">Hold to Talk</span>
      {/if}
    </div>
  </button>

  <!-- Status Text -->
  <div class="text-center">
    <p class="text-lg font-bold text-gray-900">
      {turnController.getStateDisplayName()}
    </p>
    {#if errorMessage}
      <p class="text-sm text-red-600 mt-1">
        {errorMessage}
      </p>
    {/if}
    {#if currentState === 'idle' || currentState === 'awaiting_roll'}
      <p class="text-sm text-gray-600 mt-1">
        Press and hold to speak
      </p>
    {/if}
  </div>
</div>

<style>
  .talk-button {
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-tap-highlight-color: transparent;
  }
</style>
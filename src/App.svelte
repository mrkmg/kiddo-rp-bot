<script lang="ts">
/**
 * Main App Component
 * 
 * Root component that orchestrates the entire Kiddo RP Storyteller application
 * - Manages app state and session lifecycle
 * - Coordinates between UI components and services
 * - Handles turn loop orchestration
 * - Provides error handling and user feedback
 */

import { onMount, onDestroy, untrack } from 'svelte';
import { sessionStore } from './stores/session';
import type { SceneDefinition } from './stores/session';
import TalkButton from './components/TalkButton.svelte';
import Transcript from './components/Transcript.svelte';
import SetupWizard from './components/SetupWizard.svelte';
import DebugPanel from './components/DebugPanel.svelte';
import DiceRoller from './components/DiceRoller.svelte';
import { TurnController } from './components/TurnController';
import { AudioQueue } from './components/AudioQueue';
import { STTService } from './services/stt';
import { StoryGuideService } from './services/storyGuide';
import { SceneGuideService } from './services/sceneGuide';
import { TTSService } from './services/tts';
import { sceneManager } from './services/sceneManager';
import { ScenePreprocessor } from './services/scenePreprocessor';
import type { SceneDirective } from './services/storyGuide';
import { getSettings, saveSettings, type Settings } from './utils/storage';
import { getMicrophoneDevices } from './utils/permissions';
import {
  handleError,
  showErrorToast,
  dismissToast,
  subscribeToToasts,
  type RecoveryAction,
  isOnline
} from './utils/errorHandler';

// App state
let showSetupWizard = $state(false);
let showSettings = $state(false);
let showResumeDialog = $state(false);
let showDiceRoller = $state(false);
let currentRollDifficulty = $state<number | undefined>(undefined);
let errorMessage = $state<string | null>(null);
let isInitialized = $state(false);
let isOffline = $state(!navigator.onLine);

// Error toast state
let toastMessage = $state<string | null>(null);
let toastAction = $state<RecoveryAction | undefined>(undefined);

// Settings
let settings = $state<Settings>(getSettings());
let availableMicrophones = $state<MediaDeviceInfo[]>([]);

// Controllers and services
let turnController = $state<TurnController>() as TurnController;
let audioQueue = $state<AudioQueue>() as AudioQueue;
let sttService = $state<STTService>() as STTService;
let storyGuideService = $state<StoryGuideService>() as StoryGuideService;
let sceneGuideService = $state<SceneGuideService>() as SceneGuideService;
let ttsService = $state<TTSService>() as TTSService;
let scenePreprocessor: ScenePreprocessor;

// Story state
let currentDirective = $state<SceneDirective | null>(null);

// Track state changes for persistence using untrack to avoid infinite loops
$effect(() => {
  // Only track the variables we want to react to
  const state = turnController?.getState() || 'idle';
  const roller = showDiceRoller;
  const difficulty = currentRollDifficulty;
  const directive = currentDirective;
  
  // Use untrack to prevent reading sessionStore from triggering this effect
  untrack(() => {
    if ($sessionStore.id) {
      sessionStore.updateAppState({
        turnState: state,
        showDiceRoller: roller,
        currentRollDifficulty: difficulty,
        pendingDirective: directive,
      });
    }
  });
});

/**
 * Initialize services with API keys from settings
 */
function initializeServices() {
  try {
    // Initialize controllers
    turnController = new TurnController();
    audioQueue = new AudioQueue();

    // Initialize services with API keys
    sttService = new STTService({
      apiKey: settings.openaiApiKey || '',
    });

    storyGuideService = new StoryGuideService({
      apiKey: settings.openrouterApiKey || '',
      model: 'deepseek/deepseek-chat-v3-0324',
    });

    sceneGuideService = new SceneGuideService({
      apiKey: settings.openrouterApiKey || '',
      model: 'deepseek/deepseek-chat-v3-0324',
    });

    ttsService = new TTSService({
      apiKey: settings.humeApiKey || '',
    });

    scenePreprocessor = new ScenePreprocessor(
      storyGuideService,
      sceneGuideService
    );

    isInitialized = true;
  } catch (error) {
    const errorInfo = handleError(error as Error, 'initializeServices');
    showErrorToast(errorInfo.userMessage, errorInfo.recoveryAction);
    throw error;
  }
}

/**
 * Check if API keys are configured
 */
function hasApiKeys(): boolean {
  return !!(settings.openaiApiKey && settings.openrouterApiKey && settings.humeApiKey);
}

/**
 * Handle app initialization
 */
onMount(() => {
  try {
    // Subscribe to toast notifications
    const unsubscribe = subscribeToToasts((toast) => {
      if (toast) {
        toastMessage = toast.message;
        toastAction = toast.action;
      } else {
        toastMessage = null;
        toastAction = undefined;
      }
    });

    // Monitor online/offline status
    const handleOnline = () => {
      isOffline = false;
      showErrorToast('Back online! You can continue your adventure.', undefined, 3000);
    };
    const handleOffline = () => {
      isOffline = true;
      showErrorToast('You are offline. Some features may not work.', undefined, 0);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Listen for settings open requests from error handler
    const handleOpenSettings = () => {
      showSettings = true;
    };
    window.addEventListener('open-settings', handleOpenSettings);

    // Handle visibility change (pause audio when tab hidden)
    const handleVisibilityChange = () => {
      if (document.hidden && ttsService?.isPlaying()) {
        ttsService.pause();
      } else if (!document.hidden && ttsService && !ttsService.isPlaying()) {
        ttsService.resume();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Load settings
    settings = getSettings();

    // Check if API keys are configured
    if (!hasApiKeys()) {
      showSettings = true;
      return;
    }

    // Initialize services
    initializeServices();

    // Check for existing session and prompt to resume
    try {
      const hasActiveSession = sessionStore.resumeActiveSession();
      if (hasActiveSession) {
        showResumeDialog = true;
      } else {
        showSetupWizard = true;
      }
    } catch (error) {
      const errorInfo = handleError(error as Error, 'resumeSession');
      if (errorInfo.type === 'storage') {
        showErrorToast(errorInfo.userMessage, errorInfo.recoveryAction);
      }
      showSetupWizard = true;
    }

    // Cleanup on unmount
    return () => {
      unsubscribe();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('open-settings', handleOpenSettings);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      turnController?.cleanup();
      audioQueue?.cleanup();
      sttService?.cleanup();
      ttsService?.cleanup();
    };
  } catch (error) {
    const errorInfo = handleError(error as Error, 'appInitialization');
    showErrorToast(errorInfo.userMessage, errorInfo.recoveryAction);
  }
});

/**
 * Handle setup wizard completion
 */
function handleSetupComplete() {
  showSetupWizard = false;
  
  // Start the adventure with initial DM narration
  startAdventure();
}

/**
 * Handle skip to settings from setup wizard
 */
function handleSkipToSettings() {
  showSetupWizard = false;
  showSettings = true;
}

/**
 * Start the adventure with story initialization
 */
async function startAdventure() {
  try {
    console.log('[startAdventure] Starting adventure, current state:', turnController.getState());
    
    // Check if online
    if (!isOnline()) {
      showErrorToast('You need to be online to start an adventure.', {
        label: 'Retry',
        action: () => window.location.reload(),
      });
      return;
    }

    // Transition to story_init state
    console.log('[startAdventure] Transitioning to story_init');
    turnController.transition('story_init');
    
    // Initialize story with Story Guide
    const storyInit = await storyGuideService.initializeStory(
      sessionStore.current.theme,
      sessionStore.current.players,
      sessionStore.current.storyContext.overallGoal
    );
    
    // Update story state with plan
    sessionStore.updateStoryState({
      storyPlan: storyInit.storyPlan,
    });
    
    // Store the first scene directive
    currentDirective = storyInit.firstSceneDirective;
    
    // Add prologue to transcript
    sessionStore.addTranscriptEntry({
      speaker: 'DM',
      playerName: 'DM',
      text: storyInit.prologueNarration,
    });
    
    // Play prologue narration
    await playDMResponse(storyInit.prologueNarration, false, async () => {
      // After prologue, create first scene
      await createSceneFromDirective(currentDirective!);
    });
    
  } catch (error) {
    const errorInfo = handleError(error as Error, 'startAdventure');
    showErrorToast(errorInfo.userMessage, errorInfo.recoveryAction);
    turnController.transition('error');
    
    // Auto-reset after error
    setTimeout(() => {
      turnController.reset();
    }, 3000);
  }
}

/**
 * Create a scene from Story Guide directive
 */
async function createSceneFromDirective(directive: SceneDirective) {
  try {
    // Transition to scene_setup state
    turnController.transition('scene_setup');
    
    // Get previous scene summary if available
    const previousSummary = sessionStore.current.storyContext.completedScenes.length > 0
      ? sessionStore.current.storyContext.completedScenes[sessionStore.current.storyContext.completedScenes.length - 1]
      : null;
    
    // Generate scene using Scene Guide
    const sceneSetup = await sceneGuideService.createScene(
      directive,
      previousSummary,
      sessionStore.current.players
    );
    
    // Create scene structure
    const newScene = sceneManager.createSceneStructure(
      directive.sceneNumber,
      sceneSetup.title,
      sceneSetup.setting,
      sceneSetup.situation,
      sceneSetup.internalGoal,
      sceneSetup.possibleExits
    );
    
    // Add scene to session
    sessionStore.addScene(newScene);
    
    // Add opening narration as DM interaction
    const fullOpening = `${sceneSetup.openingNarration} ${sceneSetup.openingQuestion}`;
    sessionStore.addSceneInteraction({
      speaker: 'DM',
      text: fullOpening,
    });
    
    // Also add to legacy transcript for display
    sessionStore.addTranscriptEntry({
      speaker: 'DM',
      playerName: 'DM',
      text: fullOpening,
    });
    
    // Generate and play TTS
    await playDMResponse(fullOpening);
    
  } catch (error) {
    const errorInfo = handleError(error as Error, 'createSceneFromDirective');
    showErrorToast(errorInfo.userMessage, errorInfo.recoveryAction);
    turnController.transition('error');
    
    setTimeout(() => {
      turnController.reset();
    }, 3000);
  }
}

/**
 * Handle player transcription from TalkButton
 */
async function handlePlayerTranscribed(text: string) {
  try {
    // Transition to thinking state
    turnController.transition('thinking');
    
    // Save player input for potential resumption
    sessionStore.updateAppState({ lastPlayerInput: text });
    
    // Get current scene
    const currentScene = sessionStore.getCurrentScene();
    if (!currentScene) {
      throw new Error('No active scene');
    }
    
    // Add player interaction to scene
    sessionStore.addSceneInteraction({
      speaker: 'Player',
      playerName: sessionStore.current.players[0]?.name || 'Player',
      text,
    });
    
    // Also add to legacy transcript for display
    sessionStore.addTranscriptEntry({
      speaker: 'Player',
      playerName: sessionStore.current.players[0]?.name || 'Player',
      text,
    });
    
    // Get previous scene summary for context
    const previousSummary = sessionStore.current.storyContext.completedScenes.length > 0
      ? sessionStore.current.storyContext.completedScenes[sessionStore.current.storyContext.completedScenes.length - 1]
      : null;
    
    // Generate DM response using Scene Guide
    const { response, rawJson } = await sceneGuideService.handleInteraction(
      currentScene,
      text,
      previousSummary
    );
    
    // Clear saved player input since we successfully processed it
    sessionStore.updateAppState({ lastPlayerInput: undefined });
    
    // Add DM response to scene with raw JSON
    sessionStore.addSceneInteraction({
      speaker: 'DM',
      text: `${response.say} ${response.ask}`,
      rawResponse: rawJson,
    });
    
    // Also add to legacy transcript for display
    sessionStore.addTranscriptEntry({
      speaker: 'DM',
      playerName: 'DM',
      text: `${response.say} ${response.ask}`,
    });
    
    // Handle roll request
    const needsRoll = !!(response.needRoll && response.rollPurpose && response.rollDifficulty);
    if (needsRoll && response.rollPurpose && response.rollDifficulty) {
      const rollOpp = sessionStore.addRollOpportunity({
        description: response.rollPurpose,
        difficulty: response.rollDifficulty,
      });
      // Store the difficulty for the dice roller
      currentRollDifficulty = response.rollDifficulty;
    }
    
    // Handle scene completion
    if (response.sceneComplete) {
      // Start pre-processing the next scene DURING the final speech
      // This reduces wait time between scenes
      const currentStoryState = {
        id: sessionStore.current.id,
        theme: sessionStore.current.storyState.theme,
        overallGoal: sessionStore.current.storyState.overallGoal,
        targetSceneCount: sessionStore.current.storyState.targetSceneCount,
        currentPhase: sessionStore.current.storyState.currentPhase,
        storyPlan: sessionStore.current.storyState.storyPlan,
        completedScenes: sessionStore.current.storyContext.completedScenes,
        createdAt: sessionStore.current.createdAt,
        updatedAt: sessionStore.current.updatedAt,
      };
      
      // Start pre-processing in background
      scenePreprocessor.startPreprocessing(
        currentScene,
        response.exitTaken,
        currentStoryState,
        sessionStore.current.players
      );
      
      // Play the final DM message, then transition to scene_summary when it finishes
      await playDMResponse(`${response.say} ${response.ask}`, false, async () => {
        // This callback runs after the audio finishes playing
        await handleSceneComplete(currentScene, response.exitTaken);
      });
      return;
    }
    
    // Generate and play TTS, then transition based on whether roll is needed
    // The response.ask should already contain the roll instruction if needsRoll is true
    await playDMResponse(`${response.say} ${response.ask}`, needsRoll, needsRoll ? () => {
      // Show dice roller after TTS completes
      showDiceRoller = true;
    } : undefined);
    
  } catch (error) {
    const errorInfo = handleError(error as Error, 'handlePlayerInput');
    showErrorToast(errorInfo.userMessage, errorInfo.recoveryAction);
    turnController.transition('error');
    
    // Auto-reset after error
    setTimeout(() => {
      turnController.reset();
    }, 3000);
  }
}

/**
 * Handle scene completion and story update
 * ALWAYS uses preprocessor - waits for it and updates UI state based on preprocessing stage
 */
async function handleSceneComplete(scene: SceneDefinition, exitTaken?: string) {
  try {
    // Mark scene as complete
    sessionStore.updateCurrentScene({
      status: 'complete',
      completedAt: new Date().toISOString(),
      exitTaken,
    });
    
    // Get the updated scene with all interactions from the store
    const updatedScene = sessionStore.getCurrentScene();
    if (!updatedScene) {
      throw new Error('No current scene found for summary');
    }
    
    // ALWAYS use the preprocessor - wait for it and update UI based on stage
    console.log('[handleSceneComplete] Waiting for preprocessor...');
    
    // Check current stage and update UI accordingly
    const currentStage = scenePreprocessor.getStage(scene.id);
    console.log('[handleSceneComplete] Current preprocessing stage:', currentStage);
    
    // Update turn controller state based on preprocessing stage
    if (currentStage === 'summarizing' || currentStage === 'idle') {
      turnController.transition('scene_summary');
    } else if (currentStage === 'updating_story') {
      turnController.transition('story_update');
    } else if (currentStage === 'creating_scene') {
      turnController.transition('scene_setup');
    }
    
    // Wait for preprocessing to complete
    const preprocessedResult = await scenePreprocessor.getResult(scene.id);
    
    if (!preprocessedResult) {
      throw new Error('Preprocessing failed - no result available');
    }
    
    console.log('[handleSceneComplete] Using preprocessed results! 🚀');
    
    const { summary, storyUpdate, sceneSetup } = preprocessedResult;
    
    // Save summary to session
    sessionStore.completeCurrentScene(summary);
    
    // Update story state in session
    sessionStore.updateStoryState({
      currentPhase: storyUpdate.currentPhase,
      storyPlan: storyUpdate.updatedPlan,
    });
    
    // Check if story is complete
    if (storyUpdate.storyComplete && storyUpdate.epilogueNarration) {
      // Add epilogue to transcript
      const epilogueMessage = `🎉 THE END 🎉\n\n${storyUpdate.epilogueNarration}\n\nThank you for playing!`;
      
      sessionStore.addTranscriptEntry({
        speaker: 'DM',
        playerName: 'DM',
        text: epilogueMessage,
      });
      
      // Play epilogue
      await playDMResponse(epilogueMessage, false, async () => {
        // End the session
        sessionStore.endSession();
        
        // Transition back to idle
        turnController.transition('idle');
        
        // Show completion dialog after a brief delay
        setTimeout(() => {
          showSetupWizard = true;
        }, 2000);
      });
      
      return;
    }
    
    // Story continues - use preprocessed scene if available
    if (storyUpdate.nextSceneDirective) {
      const directive = storyUpdate.nextSceneDirective;
      currentDirective = directive;
      
      if (sceneSetup) {
        // We have preprocessed scene setup - use it directly!
        console.log('[handleSceneComplete] Using preprocessed scene setup! 🚀');
        
        // Transition to scene_setup state briefly for UI feedback
        turnController.transition('scene_setup');
        
        // Create scene structure
        const newScene = sceneManager.createSceneStructure(
          directive.sceneNumber,
          sceneSetup.title,
          sceneSetup.setting,
          sceneSetup.situation,
          sceneSetup.internalGoal,
          sceneSetup.possibleExits
        );
        
        // Add scene to session
        sessionStore.addScene(newScene);
        
        // Add opening narration as DM interaction
        const fullOpening = `${sceneSetup.openingNarration} ${sceneSetup.openingQuestion}`;
        sessionStore.addSceneInteraction({
          speaker: 'DM',
          text: fullOpening,
        });
        
        // Also add to legacy transcript for display
        sessionStore.addTranscriptEntry({
          speaker: 'DM',
          playerName: 'DM',
          text: fullOpening,
        });
        
        // Generate and play TTS
        await playDMResponse(fullOpening);
      } else {
        // No preprocessed scene (story might be ending), create normally
        await createSceneFromDirective(directive);
      }
    } else {
      throw new Error('Story not complete but no next scene directive provided');
    }
    
  } catch (error) {
    const errorInfo = handleError(error as Error, 'handleSceneComplete');
    showErrorToast(errorInfo.userMessage, errorInfo.recoveryAction);
    turnController.transition('error');
    
    setTimeout(() => {
      turnController.reset();
    }, 3000);
  }
}

/**
 * Handle errors from TalkButton
 */
function handleTalkButtonError(error: Error) {
  const errorInfo = handleError(error, 'talkButton');
  showErrorToast(errorInfo.userMessage, errorInfo.recoveryAction);
}

/**
 * Play DM response using TTS
 * @param text - The text to speak
 * @param needsRoll - Whether a roll is needed after speaking (transitions to awaiting_roll instead of idle)
 * @param onComplete - Optional callback to run after audio finishes (instead of normal state transition)
 */
async function playDMResponse(text: string, needsRoll: boolean = false, onComplete?: () => void | Promise<void>) {
  // Check if audio is enabled in settings
  if (!settings.audioEnabled) {
    // Skip TTS entirely - just show text and transition state
    console.log('Audio disabled, skipping TTS');
    
    // Transition to speaking state briefly to show the text is being "delivered"
    turnController.transition('speaking');
    
    // Wait a brief moment (500ms) to let user see the text, then transition
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Complete the turn
    if (onComplete) {
      await onComplete();
    } else if (needsRoll) {
      turnController.transition('awaiting_roll');
    } else {
      turnController.transition('idle');
    }
    return;
  }
  
  try {
    // Transition to speaking state
    turnController.transition('speaking');
    
    // Generate TTS audio using streaming for lower latency
    const streamingResult = await ttsService.synthesizeStreaming({ text });
    
    // Enqueue streaming audio for playback
    // Audio will start playing as soon as first chunks arrive
    audioQueue.enqueue({
      id: `dm-${Date.now()}`,
      audio: streamingResult.audioStream,
      text,
      onEnd: async () => {
        // If custom completion handler provided, use it
        if (onComplete) {
          await onComplete();
        } else {
          // Otherwise, transition to awaiting_roll if needed, or return to idle
          if (needsRoll) {
            turnController.transition('awaiting_roll');
          } else {
            turnController.transition('idle');
          }
        }
      },
      onError: async (error) => {
        console.error('TTS playback error:', error);
        showErrorToast('Audio playback failed. Showing text only.', undefined, 3000);
        // Cancel the stream
        streamingResult.cancel();
        // Fall back to text-only display
        if (onComplete) {
          await onComplete();
        } else if (needsRoll) {
          turnController.transition('awaiting_roll');
        } else {
          turnController.transition('idle');
        }
      },
    });
    
  } catch (error) {
    // TTS failed, but that's okay - we'll show text only
    console.warn('TTS generation failed, falling back to text-only:', error);
    showErrorToast('Voice unavailable. Using text-only mode.', undefined, 3000);
    // Transcript already shows the text
    if (onComplete) {
      await onComplete();
    } else if (needsRoll) {
      turnController.transition('awaiting_roll');
    } else {
      turnController.transition('idle');
    }
  }
}

/**
 * Handle resume session
 */
async function handleResumeSession() {
  showResumeDialog = false;
  
  // Restore app state from saved session
  const appState = sessionStore.getAppState();
  if (!appState) return;
  
  // Restore state variables
  if (appState.showDiceRoller) {
    showDiceRoller = true;
    currentRollDifficulty = appState.currentRollDifficulty;
  }
  
  if (appState.pendingDirective) {
    currentDirective = appState.pendingDirective;
  }
  
  // Restore turn controller state
  const savedState = appState.turnState;
  if (savedState && savedState !== 'idle') {
    console.log(`[Resume] Restoring state: ${savedState}`);
    
    // Handle different states
    switch (savedState) {
      case 'awaiting_roll':
        // Show dice roller if we were waiting for a roll
        if (!showDiceRoller) {
          showDiceRoller = true;
        }
        turnController.transition('awaiting_roll');
        break;
        
      case 'scene_setup':
      case 'scene_summary':
      case 'story_init':
      case 'story_update':
        // These states should continue their async operations
        // For now, transition to the state and let the operation resume
        turnController.transition(savedState as any);
        
        // If we have a pending directive, try to continue scene creation
        if (savedState === 'scene_setup' && currentDirective) {
          await createSceneFromDirective(currentDirective);
        }
        break;
        
      case 'speaking':
        // If we were speaking, the audio is lost - transition to idle
        console.log('[Resume] Was speaking, transitioning to idle');
        turnController.transition('idle');
        break;
        
      case 'thinking':
        // If we were thinking, we can retry with the last player input
        console.log('[Resume] Was thinking, retrying with last player input');
        if (appState.lastPlayerInput) {
          // Re-process the last player input
          await handlePlayerTranscribed(appState.lastPlayerInput);
        } else {
          // No saved input, transition to idle
          console.log('[Resume] No saved player input, transitioning to idle');
          turnController.transition('idle');
        }
        break;
        
      default:
        // For other states, reset to idle
        turnController.reset();
    }
  }
}

/**
 * Handle new session (abandon current)
 */
function handleNewSession() {
  sessionStore.clearSession();
  showResumeDialog = false;
  showSetupWizard = true;
}

/**
 * Handle dice roll completion
 */
async function handleDiceRollComplete(result: number) {
  try {
    // Hide dice roller
    showDiceRoller = false;
    currentRollDifficulty = undefined;
    
    // Get current scene and latest roll opportunity
    const currentScene = sessionStore.getCurrentScene();
    if (!currentScene) {
      throw new Error('No active scene');
    }
    
    const unresolvedRolls = currentScene.rollOpportunities.filter(r => !r.resolved);
    if (unresolvedRolls.length === 0) {
      throw new Error('No unresolved roll opportunities');
    }
    
    const rollOpp = unresolvedRolls[unresolvedRolls.length - 1];
    
    // Resolve the roll
    sessionStore.resolveRollOpportunity(rollOpp.id, result);
    
    // Add the roll result to transcript
    const success = result >= rollOpp.difficulty;
    const rollText = `🎲 Rolled ${result} (needed ${rollOpp.difficulty}+) - ${success ? 'Success!' : 'Not quite...'}`;
    
    sessionStore.addTranscriptEntry({
      speaker: 'Player',
      playerName: sessionStore.current.players[0]?.name || 'Player',
      text: rollText,
    });
    
    sessionStore.addSceneInteraction({
      speaker: 'Player',
      playerName: sessionStore.current.players[0]?.name || 'Player',
      text: rollText,
      rollResult: result,
    });
    
    // Ensure we're in a valid state before transitioning to thinking
    // If we're still speaking, transition to idle first
    const currentState = turnController.getState();
    if (currentState === 'speaking') {
      turnController.transition('idle');
    }
    
    // Transition to thinking to get DM response
    turnController.transition('thinking');
    
    // Send roll result to LLM for continuation
    const rollResultMessage = `I rolled a ${result}! ${success ? 'I succeeded!' : 'I didn\'t quite make it...'}`;
    
    // Get previous scene summary for context
    const previousSummary = sessionStore.current.storyContext.completedScenes.length > 0
      ? sessionStore.current.storyContext.completedScenes[sessionStore.current.storyContext.completedScenes.length - 1]
      : null;
    
    // Generate DM response based on roll result using Scene Guide
    const { response, rawJson } = await sceneGuideService.handleInteraction(
      currentScene,
      rollResultMessage,
      previousSummary
    );
    
    // Add DM response to scene with raw JSON
    sessionStore.addSceneInteraction({
      speaker: 'DM',
      text: `${response.say} ${response.ask}`,
      rawResponse: rawJson,
    });
    
    // Also add to legacy transcript for display
    sessionStore.addTranscriptEntry({
      speaker: 'DM',
      playerName: 'DM',
      text: `${response.say} ${response.ask}`,
    });
    
    // Handle scene completion
    if (response.sceneComplete) {
      await playDMResponse(`${response.say} ${response.ask}`, false, async () => {
        await handleSceneComplete(currentScene, response.exitTaken);
      });
      return;
    }
    
    // Check if another roll is needed
    const needsRoll = !!(response.needRoll && response.rollPurpose && response.rollDifficulty);
    if (needsRoll && response.rollPurpose && response.rollDifficulty) {
      sessionStore.addRollOpportunity({
        description: response.rollPurpose,
        difficulty: response.rollDifficulty,
      });
      currentRollDifficulty = response.rollDifficulty;
    }
    
    // Play DM response
    await playDMResponse(`${response.say} ${response.ask}`, needsRoll, needsRoll ? () => {
      showDiceRoller = true;
    } : undefined);
    
  } catch (error) {
    const errorInfo = handleError(error as Error, 'handleDiceRoll');
    showErrorToast(errorInfo.userMessage, errorInfo.recoveryAction);
    turnController.transition('error');
    
    setTimeout(() => {
      turnController.reset();
    }, 3000);
  }
}

/**
 * Handle end session
 */
function handleEndSession() {
  if (confirm('Are you sure you want to end this adventure?')) {
    sessionStore.endSession();
    showSetupWizard = true;
  }
}

/**
 * Load available microphones for settings
 */
async function loadMicrophonesForSettings() {
  try {
    const devices = await getMicrophoneDevices();
    availableMicrophones = devices;
    
    // Auto-select the first microphone if none selected
    if (devices.length > 0 && !settings.selectedMicrophoneId) {
      settings.selectedMicrophoneId = devices[0].deviceId;
    }
  } catch (error) {
    console.error('Failed to load microphones:', error);
  }
}

/**
 * Handle settings save
 */
function handleSaveSettings() {
  try {
    saveSettings(settings);
    
    // Reinitialize services with new settings
    if (hasApiKeys()) {
      initializeServices();
      showSettings = false;
      
      // If no active session, show setup wizard
      if (!$sessionStore.id) {
        showSetupWizard = true;
      }
    } else {
      showErrorToast('Please configure all API keys to continue.', undefined, 5000);
    }
  } catch (error) {
    const errorInfo = handleError(error as Error, 'saveSettings');
    showErrorToast(errorInfo.userMessage, errorInfo.recoveryAction);
  }
}

/**
 * Handle settings modal open
 */
async function handleOpenSettings() {
  showSettings = true;
  await loadMicrophonesForSettings();
}
</script>

<main class="min-h-screen bg-linear-to-b from-purple-50 to-blue-50">
  {#if showSettings}
    <!-- Settings Modal -->
    <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div class="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-8">
        <h2 class="text-3xl font-bold text-gray-900 mb-6">Settings</h2>
        
        <div class="space-y-4">
          <div>
            <label for="openai-key" class="block text-sm font-bold text-gray-700 mb-2">
              OpenAI API Key (for Speech-to-Text):
            </label>
            <input
              id="openai-key"
              type="password"
              bind:value={settings.openaiApiKey}
              placeholder="sk-..."
              class="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-purple-600 focus:outline-none"
            />
          </div>
          
          <div>
            <label for="openrouter-key" class="block text-sm font-bold text-gray-700 mb-2">
              OpenRouter API Key (for Story Generation):
            </label>
            <input
              id="openrouter-key"
              type="password"
              bind:value={settings.openrouterApiKey}
              placeholder="sk-or-..."
              class="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-purple-600 focus:outline-none"
            />
          </div>
          
          <div>
            <label for="hume-key" class="block text-sm font-bold text-gray-700 mb-2">
              Hume API Key (for Text-to-Speech):
            </label>
            <input
              id="hume-key"
              type="password"
              bind:value={settings.humeApiKey}
              placeholder="..."
              class="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-purple-600 focus:outline-none"
            />
          </div>
          
          <div>
            <label for="microphone-select" class="block text-sm font-bold text-gray-700 mb-2">
              Microphone:
            </label>
            {#if availableMicrophones.length > 0}
              <select
                id="microphone-select"
                bind:value={settings.selectedMicrophoneId}
                class="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-purple-600 focus:outline-none bg-white"
              >
                {#each availableMicrophones as mic}
                  <option value={mic.deviceId}>
                    {mic.label || `Microphone ${availableMicrophones.indexOf(mic) + 1}`}
                  </option>
                {/each}
              </select>
              <p class="text-xs text-gray-500 mt-1">
                {availableMicrophones.length} microphone{availableMicrophones.length !== 1 ? 's' : ''} detected
              </p>
            {:else}
              <p class="text-sm text-gray-500 italic">No microphones detected. Please connect a microphone and reopen settings.</p>
            {/if}
          </div>
          
          <div class="bg-green-50 border-l-4 border-green-400 p-4">
            <label class="flex items-center space-x-3 cursor-pointer">
              <input
                type="checkbox"
                bind:checked={settings.audioEnabled}
                class="w-5 h-5 text-green-600 border-gray-300 rounded focus:ring-green-500"
              />
              <div>
                <span class="text-sm font-bold text-green-900">Enable Voice (Text-to-Speech)</span>
                <p class="text-xs text-green-700">When disabled, the DM's responses will be shown as text only without voice</p>
              </div>
            </label>
          </div>
          
          <div class="bg-purple-50 border-l-4 border-purple-400 p-4">
            <label class="flex items-center space-x-3 cursor-pointer">
              <input
                type="checkbox"
                bind:checked={settings.devMode}
                class="w-5 h-5 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
              />
              <div>
                <span class="text-sm font-bold text-purple-900">Developer Mode</span>
                <p class="text-xs text-purple-700">Enable debug panel to view LLM requests and responses</p>
              </div>
            </label>
          </div>
          
          <div class="bg-blue-50 border-l-4 border-blue-400 p-4">
            <p class="text-sm text-blue-700">
              <strong>Note:</strong> API keys are stored locally in your browser and never sent to any server except the respective API providers.
            </p>
          </div>
        </div>
        
        <div class="flex space-x-4 mt-6">
          <button
            onclick={() => showSettings = false}
            class="flex-1 py-3 text-lg font-bold rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-700 transition-colors duration-200"
          >
            Cancel
          </button>
          <button
            onclick={handleSaveSettings}
            class="flex-1 py-3 text-lg font-bold rounded-lg bg-purple-600 hover:bg-purple-700 text-white transition-colors duration-200"
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if showResumeDialog}
    <!-- Resume Session Dialog -->
    <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div class="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8">
        <h2 class="text-2xl font-bold text-gray-900 mb-4">Continue Your Adventure?</h2>
        <p class="text-gray-600 mb-6">
          You have an active adventure in progress. Would you like to continue where you left off?
        </p>
        
        <div class="bg-purple-50 rounded-lg p-4 mb-6">
          <p class="text-sm text-gray-700">
            <strong>Theme:</strong> {$sessionStore.theme}
          </p>
          <p class="text-sm text-gray-700 mt-1">
            <strong>Players:</strong> {$sessionStore.players.map(p => p.name).join(', ')}
          </p>
        </div>
        
        <div class="flex space-x-4">
          <button
            onclick={handleNewSession}
            class="flex-1 py-3 text-lg font-bold rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-700 transition-colors duration-200"
          >
            New Adventure
          </button>
          <button
            onclick={handleResumeSession}
            class="flex-1 py-3 text-lg font-bold rounded-lg bg-purple-600 hover:bg-purple-700 text-white transition-colors duration-200"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if showSetupWizard}
    <!-- Setup Wizard -->
    <SetupWizard 
      onComplete={handleSetupComplete}
      onSkipToSettings={handleSkipToSettings}
    />
  {:else if isInitialized && $sessionStore.id}
    <!-- Main Game View -->
    <div class="flex flex-col h-screen max-w-4xl mx-auto">
      <!-- Header -->
      <header class="bg-linear-to-r from-purple-600 to-blue-600 text-white p-4 shadow-lg">
        <div class="flex justify-between items-center">
          <div>
            <h1 class="text-2xl font-bold">🎭 Kiddo RP Storyteller</h1>
            <p class="text-sm opacity-90">{$sessionStore.theme}</p>
          </div>
          <div class="flex space-x-2">
            <button
              onclick={handleOpenSettings}
              class="w-10 h-10 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors duration-200 text-white"
              title="Settings"
            >
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            <button
              onclick={handleEndSession}
              class="w-10 h-10 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors duration-200 text-white"
              title="End Adventure"
            >
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <!-- Main Content -->
      <div class="flex-1 flex flex-col overflow-hidden p-4 space-y-4">
        <!-- Transcript -->
        <div class="flex-1 overflow-hidden">
          <Transcript entries={$sessionStore.transcript} />
        </div>

        <!-- Talk Button -->
        <div class="flex justify-center">
          <TalkButton
            {sttService}
            {turnController}
            onTranscribed={handlePlayerTranscribed}
            onError={handleTalkButtonError}
          />
        </div>
      </div>

      <!-- Error Toast -->
      {#if toastMessage}
        <div class="fixed bottom-4 left-4 right-4 bg-red-50 border-l-4 border-red-500 p-4 rounded-lg shadow-lg animate-fade-in z-50">
          <div class="flex items-start">
            <svg class="w-6 h-6 text-red-500 mr-3 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
            </svg>
            <div class="flex-1">
              <p class="text-red-800 font-medium">{toastMessage}</p>
              {#if toastAction}
                <button
                  onclick={() => {
                    toastAction?.action();
                    dismissToast();
                  }}
                  class="mt-2 text-sm font-bold text-red-700 hover:text-red-900 underline"
                >
                  {toastAction.label}
                </button>
              {/if}
            </div>
            <button
              onclick={() => dismissToast()}
              class="text-red-500 hover:text-red-700 ml-4"
              aria-label="Dismiss error message"
            >
              <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
              </svg>
            </button>
          </div>
        </div>
      {/if}

      <!-- Offline Indicator -->
      {#if isOffline}
        <div class="fixed top-4 left-1/2 transform -translate-x-1/2 bg-yellow-50 border-l-4 border-yellow-400 p-3 rounded-lg shadow-lg z-50">
          <div class="flex items-center">
            <svg class="w-5 h-5 text-yellow-400 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
            </svg>
            <p class="text-sm font-medium text-yellow-800">You are offline</p>
          </div>
        </div>
      {/if}
      
      <!-- Debug Panel (only shown in dev mode) -->
      {#if settings.devMode}
        <DebugPanel />
      {/if}
      
      <!-- Dice Roller -->
      {#if showDiceRoller}
        <DiceRoller
          onRollComplete={handleDiceRollComplete}
          difficulty={currentRollDifficulty}
        />
      {/if}
    </div>
  {:else}
    <!-- Loading State -->
    <div class="flex items-center justify-center h-screen">
      <div class="text-center">
        <svg class="w-16 h-16 text-purple-600 animate-spin mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        <p class="text-xl text-gray-600">Loading...</p>
      </div>
    </div>
  {/if}
</main>

<style>
  @keyframes fade-in {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .animate-fade-in {
    animation: fade-in 0.3s ease-out;
  }
</style>

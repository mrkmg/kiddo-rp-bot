/**
 * Scene Preprocessor Service
 * 
 * Handles pre-processing of the next scene during current scene's final speech playback
 * This reduces wait times between scenes by starting LLM calls early
 * 
 * Key Features:
 * - Starts scene summary, story update, and scene creation in parallel during speech
 * - Caches results for immediate use when scene actually completes
 * - Handles cancellation if scene doesn't actually complete
 * - Thread-safe with proper state management
 * - Tracks preprocessing stage for UI feedback
 */

import type { SceneDefinition, SceneSummary } from '../stores/session';
import type { SceneDirective, StoryState } from './storyGuide';
import type { SceneSetupResponse } from '../stores/session';
import { StoryGuideService } from './storyGuide';
import { SceneGuideService } from './sceneGuide';

export type PreprocessingStage = 
  | 'idle'
  | 'summarizing'
  | 'updating_story'
  | 'creating_scene'
  | 'complete'
  | 'error';

interface PreprocessingResult {
  summary: SceneSummary;
  storyUpdate: {
    storyComplete: boolean;
    updatedPlan: any;
    currentPhase: 'beginning' | 'middle' | 'climax' | 'resolution';
    nextSceneDirective?: SceneDirective;
    epilogueNarration?: string;
  };
  sceneSetup?: SceneSetupResponse;
}

interface PreprocessingState {
  sceneId: string;
  promise: Promise<PreprocessingResult>;
  cancelled: boolean;
  stage: PreprocessingStage;
  error?: Error;
}

/**
 * Scene Preprocessor Service
 * Manages pre-processing of next scene during speech playback
 */
export class ScenePreprocessor {
  private currentPreprocessing: PreprocessingState | null = null;
  private storyGuideService: StoryGuideService;
  private sceneGuideService: SceneGuideService;

  constructor(
    storyGuideService: StoryGuideService,
    sceneGuideService: SceneGuideService
  ) {
    this.storyGuideService = storyGuideService;
    this.sceneGuideService = sceneGuideService;
  }

  /**
   * Start pre-processing the next scene
   * This should be called when the final speech of a scene starts playing
   * 
   * @param scene - The scene that is completing
   * @param exitTaken - The exit that was taken
   * @param storyState - Current story state
   * @param players - Player information
   * @returns Promise that resolves when pre-processing is complete
   */
  async startPreprocessing(
    scene: SceneDefinition,
    exitTaken: string | undefined,
    storyState: StoryState,
    players: { name: string; bio: string }[]
  ): Promise<void> {
    // Cancel any existing preprocessing
    this.cancel();

    const sceneId = scene.id;
    console.log('[ScenePreprocessor] Starting pre-processing for scene:', sceneId);

    // Create preprocessing promise
    const promise = this.executePreprocessing(scene, exitTaken, storyState, players);

    // Store state
    this.currentPreprocessing = {
      sceneId,
      promise,
      cancelled: false,
      stage: 'summarizing',
      error: undefined,
    };

    // Don't await here - let it run in background
  }

  /**
   * Get current preprocessing stage
   */
  getStage(sceneId: string): PreprocessingStage {
    if (!this.currentPreprocessing || this.currentPreprocessing.sceneId !== sceneId) {
      return 'idle';
    }
    return this.currentPreprocessing.stage;
  }

  /**
   * Execute the actual preprocessing steps
   */
  private async executePreprocessing(
    scene: SceneDefinition,
    exitTaken: string | undefined,
    storyState: StoryState,
    players: { name: string; bio: string }[]
  ): Promise<PreprocessingResult> {
    try {
      // Step 1: Generate scene summary
      if (this.currentPreprocessing) {
        this.currentPreprocessing.stage = 'summarizing';
      }
      console.log('[ScenePreprocessor] Step 1: Generating scene summary...');
      const summaryResponse = await this.sceneGuideService.summarizeScene(scene);

      // Check if cancelled
      if (this.currentPreprocessing?.cancelled) {
        throw new Error('Preprocessing cancelled');
      }

      const summary: SceneSummary = {
        sceneNumber: scene.number,
        title: scene.title,
        summary: summaryResponse.summary,
        keyEvents: summaryResponse.keyEvents,
        itemsGained: summaryResponse.itemsGained,
        locationEnd: summaryResponse.locationEnd,
        characterDevelopment: summaryResponse.characterDevelopment,
        timestamp: new Date().toISOString(),
      };

      // Step 2: Update story state
      if (this.currentPreprocessing) {
        this.currentPreprocessing.stage = 'updating_story';
      }
      console.log('[ScenePreprocessor] Step 2: Updating story state...');
      const storyUpdate = await this.storyGuideService.updateStoryState(
        storyState,
        summary
      );

      // Check if cancelled
      if (this.currentPreprocessing?.cancelled) {
        throw new Error('Preprocessing cancelled');
      }

      // Step 3: If story continues, create next scene
      let sceneSetup: SceneSetupResponse | undefined;
      if (!storyUpdate.storyComplete && storyUpdate.nextSceneDirective) {
        if (this.currentPreprocessing) {
          this.currentPreprocessing.stage = 'creating_scene';
        }
        console.log('[ScenePreprocessor] Step 3: Creating next scene...');
        
        sceneSetup = await this.sceneGuideService.createScene(
          storyUpdate.nextSceneDirective,
          summary,
          players
        );

        // Check if cancelled
        if (this.currentPreprocessing?.cancelled) {
          throw new Error('Preprocessing cancelled');
        }
      }

      if (this.currentPreprocessing) {
        this.currentPreprocessing.stage = 'complete';
      }
      console.log('[ScenePreprocessor] Pre-processing complete!');

      return {
        summary,
        storyUpdate,
        sceneSetup,
      };
    } catch (error) {
      if (this.currentPreprocessing) {
        this.currentPreprocessing.stage = 'error';
        this.currentPreprocessing.error = error as Error;
      }
      if (this.currentPreprocessing?.cancelled) {
        console.log('[ScenePreprocessor] Pre-processing cancelled');
      } else {
        console.error('[ScenePreprocessor] Pre-processing failed:', error);
      }
      throw error;
    }
  }

  /**
   * Get the preprocessing result if available
   * This should be called when the scene actually completes
   * Waits for preprocessing to finish if still in progress
   * 
   * @param sceneId - The scene ID to get results for
   * @returns The preprocessing result or null if not available/cancelled
   */
  async getResult(sceneId: string): Promise<PreprocessingResult | null> {
    if (!this.currentPreprocessing || this.currentPreprocessing.sceneId !== sceneId) {
      console.log('[ScenePreprocessor] No preprocessing result for scene:', sceneId);
      return null;
    }

    if (this.currentPreprocessing.cancelled) {
      console.log('[ScenePreprocessor] Preprocessing was cancelled for scene:', sceneId);
      return null;
    }

    try {
      const stage = this.currentPreprocessing.stage;
      if (stage !== 'complete') {
        console.log(`[ScenePreprocessor] Waiting for preprocessing to complete (currently: ${stage})...`);
      }
      
      const result = await this.currentPreprocessing.promise;
      console.log('[ScenePreprocessor] Preprocessing result ready!');
      
      // Clear the preprocessing state
      this.currentPreprocessing = null;
      
      return result;
    } catch (error) {
      console.error('[ScenePreprocessor] Failed to get preprocessing result:', error);
      this.currentPreprocessing = null;
      return null;
    }
  }

  /**
   * Check if preprocessing is in progress for a scene
   */
  isPreprocessing(sceneId: string): boolean {
    return !!(
      this.currentPreprocessing &&
      this.currentPreprocessing.sceneId === sceneId &&
      !this.currentPreprocessing.cancelled
    );
  }

  /**
   * Cancel current preprocessing
   * This should be called if the scene doesn't actually complete
   */
  cancel(): void {
    if (this.currentPreprocessing) {
      console.log('[ScenePreprocessor] Cancelling preprocessing for scene:', this.currentPreprocessing.sceneId);
      this.currentPreprocessing.cancelled = true;
      this.currentPreprocessing = null;
    }
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    this.cancel();
  }
}
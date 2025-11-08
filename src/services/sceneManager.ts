/**
 * Scene Manager Service
 * 
 * Manages scene lifecycle and operations:
 * - Creating new scenes
 * - Managing scene state
 * - Handling scene transitions
 * - Building scene context for LLM
 */

import type {
  Session,
  SceneDefinition,
  SceneSummary,
  SceneInteraction,
  RollOpportunity,
  SceneExit,
  StoryContext,
} from '../stores/session';

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
 * Scene Manager Class
 * Handles all scene-related operations
 */
export class SceneManager {
  /**
   * Get current active scene from session
   */
  getCurrentScene(session: Session): SceneDefinition | null {
    if (!session.currentSceneId) return null;
    return session.scenes.find(s => s.id === session.currentSceneId) || null;
  }

  /**
   * Get recent completed scenes (last N scenes)
   */
  getRecentScenes(session: Session, count: number = 3): SceneSummary[] {
    return session.storyContext.completedScenes.slice(-count);
  }

  /**
   * Get older completed scenes (all except recent N)
   */
  getOlderScenes(session: Session, recentCount: number = 3): SceneSummary[] {
    const total = session.storyContext.completedScenes.length;
    if (total <= recentCount) return [];
    return session.storyContext.completedScenes.slice(0, total - recentCount);
  }

  /**
   * Check if current scene is complete
   */
  isSceneComplete(scene: SceneDefinition): boolean {
    return scene.status === 'complete' || scene.status === 'summarized';
  }

  /**
   * Create a new scene definition (without LLM - just structure)
   */
  createSceneStructure(
    sceneNumber: number,
    title: string,
    setting: string,
    situation: string,
    internalGoal: string,
    possibleExits: Omit<SceneExit, 'id'>[]
  ): SceneDefinition {
    const sceneId = generateUUID();
    
    return {
      id: sceneId,
      number: sceneNumber,
      title,
      setting,
      situation,
      internalGoal,
      possibleExits: possibleExits.map(exit => ({
        ...exit,
        id: generateUUID(),
      })),
      status: 'active',
      startedAt: new Date().toISOString(),
      interactions: [],
      rollOpportunities: [],
    };
  }

  /**
   * Add interaction to scene
   */
  addInteraction(
    scene: SceneDefinition,
    interaction: Omit<SceneInteraction, 'id' | 'timestamp'>
  ): SceneInteraction {
    const newInteraction: SceneInteraction = {
      id: generateUUID(),
      timestamp: new Date().toISOString(),
      ...interaction,
    };
    
    scene.interactions.push(newInteraction);
    return newInteraction;
  }

  /**
   * Create roll opportunity in scene
   */
  createRollOpportunity(
    scene: SceneDefinition,
    opportunity: Omit<RollOpportunity, 'id' | 'resolved'>
  ): RollOpportunity {
    const newOpportunity: RollOpportunity = {
      id: generateUUID(),
      resolved: false,
      ...opportunity,
    };
    
    scene.rollOpportunities.push(newOpportunity);
    return newOpportunity;
  }

  /**
   * Resolve roll opportunity
   */
  resolveRoll(
    scene: SceneDefinition,
    opportunityId: string,
    result: number
  ): void {
    const opportunity = scene.rollOpportunities.find(o => o.id === opportunityId);
    if (!opportunity) {
      throw new Error(`Roll opportunity ${opportunityId} not found`);
    }
    
    opportunity.resolved = true;
    opportunity.result = result;
    opportunity.success = result >= opportunity.difficulty;
  }

  /**
   * Mark scene as complete
   */
  completeScene(scene: SceneDefinition, exitTaken?: string): void {
    scene.status = 'complete';
    scene.completedAt = new Date().toISOString();
    if (exitTaken) {
      scene.exitTaken = exitTaken;
    }
  }

  /**
   * Build context for LLM from session state
   * Implements the three-tier context system from SCENE_ARCHITECTURE.md
   */
  buildSceneContext(session: Session): string {
    const currentScene = this.getCurrentScene(session);
    if (!currentScene) {
      return this.buildInitialContext(session);
    }

    const recentScenes = this.getRecentScenes(session, 3);
    const olderScenes = this.getOlderScenes(session, 3);

    return `
OVERALL STORY:
Theme: ${session.storyContext.theme}
Main Goal: ${session.storyContext.overallGoal}

${olderScenes.length > 0 ? `STORY SO FAR (brief):
${olderScenes.map(s => `- ${s.title}: ${s.summary}`).join('\n')}
` : ''}

${recentScenes.length > 0 ? `RECENT SCENES (detailed):
${recentScenes.map(s => this.formatDetailedSummary(s)).join('\n\n')}

WHAT HAPPENED RECENTLY:
${this.buildRecentEventsNarrative(recentScenes)}
` : ''}

CURRENT SCENE:
Title: ${currentScene.title}
Setting: ${currentScene.setting}
Situation: ${currentScene.situation}
Internal Goal: ${currentScene.internalGoal}

Possible Exits:
${currentScene.possibleExits.map(e => this.formatExit(e)).join('\n')}
`.trim();
  }

  /**
   * Build initial context for first scene
   */
  private buildInitialContext(session: Session): string {
    const playerBios = session.players
      .map(p => `${p.name}: ${p.bio}`)
      .join('\n');

    return `
OVERALL STORY:
Theme: ${session.storyContext.theme}
Main Goal: ${session.storyContext.overallGoal}

Players:
${playerBios}

This is the beginning of the adventure. No scenes have been created yet.
`.trim();
  }

  /**
   * Format detailed scene summary
   */
  private formatDetailedSummary(scene: SceneSummary): string {
    return `Scene ${scene.sceneNumber}: ${scene.title}
${scene.summary}
Key Events: ${scene.keyEvents.join(', ')}`;
  }

  /**
   * Format scene exit for prompt
   */
  private formatExit(exit: SceneExit): string {
    const rollInfo = exit.requiresRoll ? ` (requires roll, difficulty ${exit.difficulty})` : '';
    return `- ${exit.description}: ${exit.condition}${rollInfo}`;
  }

  /**
   * Format interaction for prompt
   */
  private formatInteraction(interaction: SceneInteraction): string {
    const rollInfo = interaction.rollResult ? ` [rolled ${interaction.rollResult}]` : '';
    const speaker = interaction.speaker === 'DM' ? 'DM' : interaction.playerName || 'Player';
    return `${speaker}: ${interaction.text}${rollInfo}`;
  }

  /**
   * Build narrative of recent events
   */
  private buildRecentEventsNarrative(recentScenes: SceneSummary[]): string {
    if (recentScenes.length === 0) {
      return "This is the beginning of your adventure.";
    }
    
    const events = recentScenes.flatMap(s => s.keyEvents);
    return events.join('. ') + '.';
  }

  /**
   * Create scene summary from completed scene
   */
  createSceneSummary(
    scene: SceneDefinition,
    summaryText: string,
    keyEvents: string[],
    itemsGained: string[] = [],
    locationEnd: string = '',
    characterDevelopment?: string
  ): SceneSummary {
    return {
      sceneNumber: scene.number,
      title: scene.title,
      summary: summaryText,
      keyEvents,
      itemsGained,
      locationEnd,
      characterDevelopment,
      timestamp: scene.completedAt || new Date().toISOString(),
    };
  }

  /**
   * Get next scene number
   */
  getNextSceneNumber(session: Session): number {
    if (session.scenes.length === 0) return 1;
    return Math.max(...session.scenes.map(s => s.number)) + 1;
  }

  /**
   * Get unresolved roll opportunities in current scene
   */
  getUnresolvedRolls(scene: SceneDefinition): RollOpportunity[] {
    return scene.rollOpportunities.filter(r => !r.resolved);
  }

  /**
   * Check if scene has any unresolved rolls
   */
  hasUnresolvedRolls(scene: SceneDefinition): boolean {
    return this.getUnresolvedRolls(scene).length > 0;
  }
}

// Export singleton instance
export const sceneManager = new SceneManager();
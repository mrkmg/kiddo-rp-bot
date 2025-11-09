/**
 * Story Guide Service
 * 
 * Tier 1 of the two-tier LLM system
 * Handles overall story arc, pacing, and narrative coherence
 * 
 * Responsibilities:
 * - Initialize story with prologue narration
 * - Generate scene directives for Scene Guide
 * - Update story state after scene completion
 * - Determine story completion
 * - Generate epilogue narration
 */

import type { Session, SceneSummary, Player } from '../stores/session';
import { saveLLMLog, getSettings } from '../utils/storage';

export interface SceneDirective {
  sceneNumber: number;
  purpose: string;
  suggestedSetting: string;
  storyObjective: string;
  pacing: 'fast' | 'normal' | 'slow';
  themeElements: string[];
}

export interface StoryPlan {
  currentObjective: string;
  upcomingChallenges: string[];
  themeElements: string[];
}

export interface StoryState {
  id: string;
  theme: string;
  overallGoal: string;
  targetSceneCount: number;
  currentPhase: 'beginning' | 'middle' | 'climax' | 'resolution';
  storyPlan: StoryPlan;
  completedScenes: SceneSummary[];
  createdAt: string;
  updatedAt: string;
}

export interface StoryInitResponse {
  storyPlan: StoryPlan;
  firstSceneDirective: SceneDirective;
  prologueNarration: string;
}

export interface StoryUpdateResponse {
  storyComplete: boolean;
  updatedPlan: StoryPlan;
  currentPhase: 'beginning' | 'middle' | 'climax' | 'resolution';
  nextSceneDirective?: SceneDirective;
  epilogueNarration?: string;
}

export interface LLMConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
}

interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
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
 * Story Guide Service
 * Manages overall story arc and generates scene directives
 */
export class StoryGuideService {
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = {
      baseUrl: 'https://openrouter.ai/api/v1',
      temperature: 0.85,
      maxTokens: 1000,
      ...config,
    };
  }

  /**
   * Initialize story with prologue and first scene directive
   */
  async initializeStory(
    theme: string,
    players: Player[],
    overallGoal: string
  ): Promise<StoryInitResponse> {
    if (!this.config.apiKey) {
      throw new Error('OpenRouter API key not configured');
    }

    const playerBios = players
      .map(p => `${p.name}: ${p.bio}`)
      .join('\n');

    const systemPrompt = `You are a creative Story Guide for children's adventures (ages 6-10).

CORE PRINCIPLES:
- Create engaging, age-appropriate stories with clear structure
- Design stories that complete in 8-10 scenes
- Ensure each player has moments to shine
- Build tension gradually with satisfying resolution
- Always return valid JSON only

NARRATION STYLE:
- Speak directly to players using "you" and "your"
- Use vivid, exciting language that captures imagination
- Introduce characters by name with their key traits
- Set an adventurous, uplifting tone
- Keep narration concise but evocative (3-5 sentences)`;

    const prompt = `Create an engaging story plan for a children's adventure.

THEME: ${theme}
PLAYERS:
${playerBios}
OVERALL GOAL: ${overallGoal}

STORY PLAN REQUIREMENTS:
1. Design for 8-10 scenes with clear beginning, middle, climax, and resolution
2. Incorporate the theme and player characteristics
3. Build tension gradually
4. Include moments for each player to shine
5. End with a satisfying conclusion

PROLOGUE NARRATION - SPEAK DIRECTLY TO PLAYERS:
- Address players as "you" and "your" (not "the heroes" or third person)
- Introduce each player by name with their key characteristic
- Describe the world/setting they're in
- Explain their overall goal/quest
- Set an exciting, adventurous tone
- Keep it 3-5 sentences long
- Example: "You are brave knights in the kingdom of Lumina. Sarah, with your quick thinking, and John, with your strong heart, you've been chosen for an important quest..."

Return JSON:
{
  "storyPlan": {
    "currentObjective": "First major goal",
    "upcomingChallenges": ["challenge1", "challenge2", "challenge3"],
    "themeElements": ["element1", "element2"]
  },
  "firstSceneDirective": {
    "sceneNumber": 1,
    "purpose": "Why this scene exists",
    "suggestedSetting": "Where it takes place",
    "storyObjective": "What should be accomplished",
    "pacing": "normal",
    "themeElements": ["element1"]
  },
  "prologueNarration": "Exciting prologue addressing players as 'you', introducing each by name with their trait, describing the world, and explaining the quest (3-5 sentences)"
}`;

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: prompt,
      },
    ];

    return await retryWithBackoff(
      async () => {
        const rawResponse = await this.makeRequest(messages, 'story initialization');
        return this.parseJSON(rawResponse, 'story initialization') as StoryInitResponse;
      },
      3,
      1000
    );
  }

  /**
   * Generate next scene directive based on story progress
   */
  async generateSceneDirective(
    storyState: StoryState,
    previousSceneSummary: SceneSummary
  ): Promise<SceneDirective> {
    if (!this.config.apiKey) {
      throw new Error('OpenRouter API key not configured');
    }

    const sceneNumber = storyState.completedScenes.length + 1;
    const completedSummaries = storyState.completedScenes
      .map(s => `Scene ${s.sceneNumber}: ${s.title} - ${s.summary}`)
      .join('\n');

    const systemPrompt = `You are a Story Guide creating scene directives for children's adventures.

CORE PRINCIPLES:
- Maintain story coherence and pacing
- Build on previous events naturally
- Incorporate items and abilities players have gained
- Match pacing to story phase (beginning/middle/climax/resolution)
- Weave theme elements naturally into scenes
- Always return valid JSON only`;

    const prompt = `Based on story progress, create the next scene directive.

CURRENT STORY STATE:
Theme: ${storyState.theme}
Phase: ${storyState.currentPhase}
Scene ${sceneNumber} of ~${storyState.targetSceneCount}
Current Objective: ${storyState.storyPlan.currentObjective}

COMPLETED SCENES:
${completedSummaries}

LAST SCENE DETAILS (for continuity):
Title: ${previousSceneSummary.title}
Summary: ${previousSceneSummary.summary}
Key Events: ${previousSceneSummary.keyEvents.join(', ')}
Items/Abilities Players Now Have: ${previousSceneSummary.itemsGained?.join(', ') || 'none'}
Where Players Are Now: ${previousSceneSummary.locationEnd}

CONTINUITY NOTE: Players have accumulated these items/abilities and are at this location. The next scene should acknowledge and build on this.

STORY PLAN:
Upcoming Challenges: ${storyState.storyPlan.upcomingChallenges.join(', ')}
Theme Elements: ${storyState.storyPlan.themeElements.join(', ')}

DIRECTIVE REQUIREMENTS:
1. Advance the story toward the overall goal
2. Build naturally on what happened in previous scenes
3. ACKNOWLEDGE items/abilities players have - make them useful or relevant
4. START the scene where players ended the last scene (locationEnd)
5. Match appropriate pacing for story phase
6. Weave in theme elements naturally
7. Create opportunities for players to use what they've gained

Return JSON:
{
  "sceneNumber": ${sceneNumber},
  "purpose": "Why this scene exists in the story",
  "suggestedSetting": "Where (consider where players ended last scene)",
  "storyObjective": "What should be accomplished",
  "pacing": "fast|normal|slow",
  "themeElements": ["element1", "element2"]
}`;

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: prompt,
      },
    ];

    return await retryWithBackoff(
      async () => {
        const rawResponse = await this.makeRequest(messages, 'scene directive generation');
        return this.parseJSON(rawResponse, 'scene directive generation') as SceneDirective;
      },
      3,
      1000
    );
  }

  /**
   * Update story state after scene completion
   */
  async updateStoryState(
    storyState: StoryState,
    newSceneSummary: SceneSummary
  ): Promise<StoryUpdateResponse> {
    if (!this.config.apiKey) {
      throw new Error('OpenRouter API key not configured');
    }

    const completedCount = storyState.completedScenes.length + 1;
    const allSummaries = [...storyState.completedScenes, newSceneSummary]
      .map(s => `Scene ${s.sceneNumber}: ${s.title} - ${s.summary}`)
      .join('\n');

    const systemPrompt = `You are a Story Guide managing story progression for children's adventures.

CORE PRINCIPLES:
- Analyze story progress to determine appropriate next steps
- Recognize natural ending points for satisfying conclusions
- Adjust pacing and objectives based on completed scenes
- Create uplifting epilogues that celebrate player achievements
- Always return valid JSON only

EPILOGUE STYLE:
- Speak directly to players using "you" and "your"
- Describe the positive impact of their adventure on the world
- Mention each player by name and their specific contribution
- Provide a satisfying, uplifting conclusion
- Keep it 3-5 sentences long`;

    const prompt = `Update the story state after scene completion.

CURRENT STORY STATE:
Theme: ${storyState.theme}
Overall Goal: ${storyState.overallGoal}
Phase: ${storyState.currentPhase}
Current Objective: ${storyState.storyPlan.currentObjective}

NEW SCENE SUMMARY:
Scene ${newSceneSummary.sceneNumber}: ${newSceneSummary.title}
${newSceneSummary.summary}
Key Events: ${newSceneSummary.keyEvents.join(', ')}
Items/Abilities Gained This Scene: ${newSceneSummary.itemsGained?.join(', ') || 'none'}
Where Players Are Now: ${newSceneSummary.locationEnd}

ALL COMPLETED SCENES: ${completedCount} of ~${storyState.targetSceneCount}
${allSummaries}

ANALYSIS REQUIRED:
1. Is the story ready to conclude? (natural ending point reached)
2. What's the next objective?
3. What phase are we in?
4. Should we adjust the story plan?

EPILOGUE REQUIREMENTS (if story is complete):
- Address players as "you" and "your"
- Describe what happened to the world/kingdom because of their actions
- Show the positive impact of their adventure
- Mention each player by name and their specific contribution
- Provide a satisfying, uplifting conclusion
- Keep it 3-5 sentences long
- Example: "Thanks to your bravery, the kingdom of Lumina shines bright once more! Sarah, your clever thinking helped solve the ancient riddle, and John, your kind heart brought the forest creatures to your aid. The people celebrate you as heroes, and your names will be remembered in songs for generations to come!"

Return JSON:
{
  "storyComplete": true|false,
  "updatedPlan": {
    "currentObjective": "Next goal",
    "upcomingChallenges": ["updated challenges"],
    "themeElements": ["elements to weave in"]
  },
  "currentPhase": "beginning|middle|climax|resolution",
  "nextSceneDirective": {
    "sceneNumber": ${completedCount + 1},
    "purpose": "...",
    "suggestedSetting": "...",
    "storyObjective": "...",
    "pacing": "normal",
    "themeElements": ["..."]
  } or null if complete,
  "epilogueNarration": "Uplifting epilogue addressing players as 'you', describing impact, mentioning each player by name with their contribution (3-5 sentences)" or null if not complete
}`;

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: prompt,
      },
    ];

    return await retryWithBackoff(
      async () => {
        const rawResponse = await this.makeRequest(messages, 'story update');
        return this.parseJSON(rawResponse, 'story update') as StoryUpdateResponse;
      },
      3,
      1000
    );
  }

  /**
   * Parse JSON with error handling
   */
  private parseJSON(rawResponse: string, context: string): any {
    try {
      const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : rawResponse;
      return JSON.parse(jsonStr);
    } catch (error) {
      console.error(`Failed to parse JSON for ${context}:`, rawResponse);
      throw new Error(`Failed to parse Story Guide response for ${context}`);
    }
  }

  /**
   * Make API request to OpenRouter
   */
  private async makeRequest(messages: LLMMessage[], context: string = 'request'): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    
    const settings = getSettings();
    const devMode = settings.devMode || false;

    if (devMode) {
      saveLLMLog({
        type: 'request',
        context: `StoryGuide: ${context}`,
        messages,
      });
    }

    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': window.location.origin,
          'X-Title': 'Kiddo RP Storyteller - Story Guide',
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          temperature: this.config.temperature,
          max_tokens: this.config.maxTokens,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`OpenRouter API error: ${response.status} - ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json();
      const content = data.choices[0].message.content;
      
      if (devMode) {
        saveLLMLog({
          type: 'response',
          context: `StoryGuide: ${context}`,
          response: content,
        });
      }

      return content;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }
}
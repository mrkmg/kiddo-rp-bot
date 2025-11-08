/**
 * Scene Guide Service
 * 
 * Tier 2 of the two-tier LLM system
 * Handles individual scene execution, player interactions, and scene completion
 * 
 * Responsibilities:
 * - Create scenes from Story Guide directives
 * - Handle player interactions within scenes
 * - Request dice rolls when needed
 * - Guide players toward scene exits
 * - Summarize completed scenes
 */

import type {
  Session,
  SceneDefinition,
  SceneResponse,
  SceneSetupResponse,
  SceneSummaryResponse,
  SceneSummary,
} from '../stores/session';
import type { SceneDirective } from './storyGuide';
import { filterUserInput, filterDMResponse, getSafeFallback } from '../utils/safety';
import { saveLLMLog, getSettings } from '../utils/storage';

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
 * Scene Guide Service
 * Manages individual scene execution and player interactions
 */
export class SceneGuideService {
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = {
      baseUrl: 'https://openrouter.ai/api/v1',
      temperature: 0.85,
      maxTokens: 800,
      ...config,
    };
  }

  /**
   * Create a new scene from Story Guide directive
   */
  async createScene(
    directive: SceneDirective,
    previousSceneSummary: SceneSummary | null,
    players: { name: string; bio: string }[]
  ): Promise<SceneSetupResponse> {
    if (!this.config.apiKey) {
      throw new Error('OpenRouter API key not configured');
    }

    const playerBios = players.map(p => `${p.name}: ${p.bio}`).join('\n');
    const previousContext = previousSceneSummary
      ? `PREVIOUS SCENE:
Title: ${previousSceneSummary.title}
Summary: ${previousSceneSummary.summary}
Key Events: ${previousSceneSummary.keyEvents.join(', ')}
Items Gained: ${previousSceneSummary.itemsGained?.join(', ') || 'none'}
Location End: ${previousSceneSummary.locationEnd}`
      : 'This is the first scene of the adventure.';

    const prompt = `You are the Scene Guide. Create an engaging scene from the Story Guide's directive.

SCENE DIRECTIVE:
Purpose: ${directive.purpose}
Story Objective: ${directive.storyObjective}
Suggested Setting: ${directive.suggestedSetting}
Pacing: ${directive.pacing}
Theme Elements: ${directive.themeElements.join(', ')}

${previousContext}

PLAYERS:
${playerBios}

Create a focused, completable scene (3-5 player turns) with:
1. Clear setting and situation
2. Specific, achievable goal
3. 2-3 possible exits (at least one requires roll)
4. Opening narration that sets the scene
5. Open-ended opening question

SCENE DESIGN PRINCIPLES:
- Keep the goal SIMPLE and DIRECT (one clear objective, not multi-step)
- Design exits that can be reached QUICKLY (avoid complex requirements)
- Think "micro-scene" - a single interaction or challenge, not a long quest
- Examples of good goals: "Get past the guard", "Find the key", "Convince the merchant"
- Examples of bad goals: "Explore the entire castle", "Solve all the mysteries"

OPENING NARRATION GUIDELINES:
- Describe what players see, hear, and the immediate situation
- Show available options through description, don't list them
- Build atmosphere and set the scene clearly
- Keep it focused on the immediate challenge

OPENING QUESTION GUIDELINES:
- MUST be open-ended, never yes/no questions
- NEVER suggest specific actions ("Would you like to...", "Do you want to...")
- NEVER offer choices ("Will you use X or Y?", "Should you...")
- Good questions: "What do you do?", "How do you handle this?", "What's your approach?"
- Bad questions: "Would you like to follow the constellation?", "Do you open the door?"
- Let the narration show options, let the question ask what they do
- Trust players to be creative based on your narration

Return JSON:
{
  "title": "Scene title (specific and focused)",
  "setting": "Where this takes place",
  "situation": "What's happening (one clear challenge)",
  "internalGoal": "Single, achievable objective",
  "possibleExits": [
    {
      "description": "Talk your way past the guard",
      "condition": "Persuade the guard with a good reason",
      "requiresRoll": true,
      "difficulty": 4
    },
    {
      "description": "Find another way around",
      "condition": "Explore and discover alternate path",
      "requiresRoll": false
    }
  ],
  "openingNarration": "What you say to start the scene (describe what they see, hear, and the situation)",
  "openingQuestion": "Your opening question for the players - must be open-ended, not yes/no (max 20 words)"
}`;

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: 'You are a Scene Guide creating engaging scenes for kids. Always return valid JSON only.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ];

    return await retryWithBackoff(
      async () => {
        const rawResponse = await this.makeRequest(messages, 'scene creation');
        return this.parseJSON(rawResponse, 'scene creation') as SceneSetupResponse;
      },
      3,
      1000
    );
  }

  /**
   * Handle player interaction within current scene
   */
  async handleInteraction(
    scene: SceneDefinition,
    playerInput: string,
    previousSceneSummary: SceneSummary | null
  ): Promise<{ response: SceneResponse; rawJson: string }> {
    if (!this.config.apiKey) {
      throw new Error('OpenRouter API key not configured');
    }

    // Apply safety filter to user input
    const inputFilter = filterUserInput(playerInput);
    
    if (!inputFilter.safe) {
      console.warn('User input blocked by safety filter:', inputFilter.reason);
      const fallbackResponse = {
        say: getSafeFallback(),
        ask: "What would you like to do instead?",
        needRoll: false,
        sceneComplete: false,
      };
      return {
        response: fallbackResponse,
        rawJson: JSON.stringify(fallbackResponse),
      };
    }

    const prompt = this.buildScenePlayingPrompt(scene, previousSceneSummary);

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: prompt,
      },
      ...this.buildSceneConversationHistory(scene),
      {
        role: 'user',
        content: inputFilter.filtered,
      },
    ];

    // Retry both the request AND parsing with backoff
    let rawResponse: string = '';
    const parsed = await retryWithBackoff(
      async () => {
        rawResponse = await this.makeRequest(messages, 'scene interaction');
        return this.parseJSON(rawResponse, 'scene interaction') as SceneResponse;
      },
      3,
      1000
    );
    
    // Apply safety filter to DM response
    const responseFilter = filterDMResponse(parsed);
    
    if (!responseFilter.safe) {
      console.warn('DM response blocked by safety filter:', responseFilter.reason);
      const filteredResponse = responseFilter.filtered as SceneResponse;
      return {
        response: filteredResponse,
        rawJson: JSON.stringify(filteredResponse),
      };
    }

    return {
      response: parsed,
      rawJson: rawResponse,
    };
  }

  /**
   * Summarize a completed scene
   */
  async summarizeScene(scene: SceneDefinition): Promise<SceneSummaryResponse> {
    if (!this.config.apiKey) {
      throw new Error('OpenRouter API key not configured');
    }

    const conversationHistory = scene.interactions
      .map(i => `${i.speaker === 'DM' ? 'DM' : i.playerName}: ${i.text}`)
      .join('\n');

    const prompt = `You are the Scene Guide. Summarize the completed scene.

SCENE:
Title: ${scene.title}
Setting: ${scene.setting}
Goal: ${scene.internalGoal}

INTERACTIONS:
${conversationHistory}

EXIT TAKEN: ${scene.exitTaken || 'Unknown'}

Create a summary that:
1. Describes what players accomplished (2-3 sentences)
2. Lists key events
3. Notes items/abilities gained
4. States where players are now
5. Mentions character growth if any

IMPORTANT: If players gained any items, maps, abilities, or important information,
list them in itemsGained so they carry forward to future scenes.

IMPORTANT: Include where players are and what they are doing when scene ended in locationEnd.

Return JSON:
{
  "summary": "2-3 sentence summary",
  "keyEvents": ["event1", "event2"],
  "itemsGained": ["item1", "ability1"],
  "locationEnd": "Where players are now",
  "characterDevelopment": "How characters grew" or null
}`;

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: 'You are a Scene Guide summarizing scenes. Always return valid JSON only.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ];

    return await retryWithBackoff(
      async () => {
        const rawResponse = await this.makeRequest(messages, 'scene summary');
        return this.parseJSON(rawResponse, 'scene summary') as SceneSummaryResponse;
      },
      3,
      1000
    );
  }

  /**
   * Build system prompt for scene playing
   */
  private buildScenePlayingPrompt(scene: SceneDefinition, previousSceneSummary: SceneSummary | null): string {
    const exitsFormatted = scene.possibleExits
      .map(e => `- ${e.description}: ${e.condition}${e.requiresRoll ? ` (requires roll, difficulty ${e.difficulty})` : ''}`)
      .join('\n');

    const previousContext = previousSceneSummary
      ? `PREVIOUS SCENE (for continuity):
${previousSceneSummary.summary}
Location: ${previousSceneSummary.locationEnd}`
      : '';

    return `You are the Scene Guide DM for kids ages 6-10.

SCENE CONTEXT:
Title: ${scene.title}
Setting: ${scene.setting}
Situation: ${scene.situation}
Internal Goal: ${scene.internalGoal}

POSSIBLE EXITS:
${exitsFormatted}

${previousContext}

INTERACTIONS SO FAR:
${scene.interactions.length} turns completed

CRITICAL SCENE PACING:
- This scene should complete in 3-5 player turns MAXIMUM
- Current turn count: ${scene.interactions.filter(i => i.speaker !== 'DM').length + 1}
- If players are making progress toward the goal, MOVE THEM FORWARD quickly
- If players have attempted the goal, RESOLVE IT (success or failure) - don't drag it out
- Don't add unnecessary obstacles or complications - keep it focused
- When an exit condition is reasonably met, COMPLETE THE SCENE

Respond with:
1. Narration of what happens
2. Clear question or roll instruction
3. Guide toward scene exits when appropriate
4. Complete scene when exit condition met

CRITICAL DM CONTROL RULES:
- YOU control all NPCs, not the players
- If a player tries to dictate what an NPC says or does, narrate what the player ATTEMPTS instead
- Players can only control their own character's actions and words
- NPCs respond based on YOUR decisions as the DM
- Don't ask the player what they can see, hear, or do - narrate it for them based on the scene

KEEPING PLAYERS ON TASK - STAY IN CHARACTER:
- ALWAYS stay in character as the storyteller - never break the fourth wall
- If players get distracted or go off-track, use story elements to redirect them IMMEDIATELY
- Use environmental cues to guide them: sounds, NPCs calling out, visual details
- If they're stuck in loops or repeating actions, RESOLVE THE SITUATION
- Never say "remember your goal" or break character - instead, have NPCs remind them

QUESTION GUIDELINES - DESCRIBE, DON'T SUGGEST:
- Your narration should SHOW the situation, your question should ask what they DO
- NEVER suggest specific actions in your questions
- NEVER offer choices in your questions
- Good questions: "What do you do?", "How do you handle this?", "What's your next move?"
- Bad questions: "Would you like to...", "Do you want to...", "Will you use X or Y?"

CRITICAL FORMATTING RULES:
- DO NOT include your question in the "say" field
- The "say" field is ONLY for narration and description
- The "ask" field will be automatically appended and spoken separately

DICE ROLL RULES:
- Use dice rolls for instances of uncertainty, risk, or challenge
- Request a roll when approaching an exit that requires one
- Set difficulty 1-6 (1-2=fail, 3-4=partial, 5-6=success)
- DON'T request rolls for: simple conversations, basic observations, routine actions
- DO request rolls for: sneaking, picking locks, climbing, persuading, finding hidden things

CRITICAL:
- When needRoll is true, your "ask" field MUST tell them to roll their dice
- Example: "Roll your dice to see if you succeed!"
- NEVER ask a question when needRoll=true - always tell them to roll!

SCENE COMPLETION - BE GENEROUS:
- If players have made a reasonable attempt at the goal, LET THEM SUCCEED
- Don't require perfection - if they're trying the right approach, complete the scene
- Signal when an exit condition is met (or reasonably close)
- Celebrate the accomplishment briefly
- Set sceneComplete flag
- Don't add "one more thing" - when the goal is met, END THE SCENE
- Do not ask a question when sceneComplete=true

Return JSON:
{
  "say": "Your narration ONLY - no questions here (max 100 words)",
  "ask": "Your question OR roll instruction OR nothing if sceneComplete (max 20 words)",
  "needRoll": true/false,
  "rollPurpose": "What the roll is for (if needRoll=true)",
  "rollDifficulty": 4,
  "sceneComplete": false,
  "exitTaken": null
}`;
  }

  /**
   * Build conversation history from scene interactions
   */
  private buildSceneConversationHistory(scene: SceneDefinition): LLMMessage[] {
    return scene.interactions.map(interaction => ({
      role: interaction.speaker === 'DM' ? 'assistant' as const : 'user' as const,
      content: interaction.speaker === 'DM'
        ? (interaction.rawResponse || interaction.text)
        : `${interaction.playerName || 'Player'}: ${interaction.text}`,
    }));
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
      throw new Error(`Failed to parse Scene Guide response for ${context}`);
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
        context: `SceneGuide: ${context}`,
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
          'X-Title': 'Kiddo RP Storyteller - Scene Guide',
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
          context: `SceneGuide: ${context}`,
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
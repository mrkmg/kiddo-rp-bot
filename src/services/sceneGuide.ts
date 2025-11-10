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
      ? `PREVIOUS SCENE CONTEXT (MAINTAIN CONTINUITY):
Title: ${previousSceneSummary.title}
Summary: ${previousSceneSummary.summary}
Key Events: ${previousSceneSummary.keyEvents.join(', ')}
Items/Abilities Gained: ${previousSceneSummary.itemsGained?.join(', ') || 'none'}
Location Where Scene Ended: ${previousSceneSummary.locationEnd}

CRITICAL: Players start THIS scene exactly where the previous scene ended. They have all items/abilities listed above.`
      : 'This is the first scene of the adventure. Players have no items yet.';

    const systemPrompt = `You are a Scene Guide creating engaging scenes for kids ages 6-10.

CORE PRINCIPLES:
- Speak directly to the players using "you" (never "John does" or "Will Sarah...")
- Design scenes that complete in 3-5 player turns
- Provide helpful hints through vivid descriptions
- Keep goals simple and achievable
- Always return valid JSON only

NARRATION STYLE FOR KIDS:
- Use descriptive language that hints at possible actions
- Paint a clear picture of what they see, hear, and can interact with
- Make the environment feel alive and inviting
- Subtly guide them by describing interesting details
- Example: "The old door creaks in the wind, and you notice the rusty handle" (hints they can try the door)
- Example: "A friendly merchant waves at you from behind colorful stacks of fruit" (hints they can talk to them)`;

    const prompt = `Create an engaging scene from the Story Guide's directive.

SCENE DIRECTIVE:
Purpose: ${directive.purpose}
Story Objective: ${directive.storyObjective}
Suggested Setting: ${directive.suggestedSetting}
Pacing: ${directive.pacing}
Theme Elements: ${directive.themeElements.join(', ')}

${previousContext}

PLAYERS:
${playerBios}

SCENE REQUIREMENTS:
1. Clear setting and situation that CONTINUES from where previous scene ended
2. Specific, achievable goal (completable in 3-5 turns)
3. 2-3 possible exits (at least one requires roll)
4. Opening narration that hints at possible actions
5. Open-ended opening question that speaks directly to players
6. ACKNOWLEDGE items/abilities players have from previous scenes - make them relevant when possible

OPENING NARRATION - PROVIDE HELPFUL HINTS:
- START by acknowledging where players are (from previous scene's locationEnd)
- If players have items/abilities, subtly reference them as available options
- Describe what players see, hear, and can interact with
- Use vivid details that suggest possible actions without being explicit
- Make interesting objects, characters, or paths stand out in the description
- Build atmosphere while guiding attention to actionable elements
- Example: "You spot a narrow gap between the rocks, just wide enough to squeeze through"
- Example: "The guard yawns and looks away, distracted by something in the distance"
- Example with item: "You arrive at the locked door. The key you found earlier feels heavy in your pocket"

OPENING QUESTION - SPEAK DIRECTLY TO PLAYERS:
- Address players as "you" - never use character names in questions
- MUST be open-ended, never yes/no
- NEVER suggest specific actions ("Would you like to...", "Do you want to...")
- NEVER offer choices ("Will you use X or Y?")
- Good: "What do you do?", "How do you handle this?", "What's your approach?"
- Bad: "What does John do?", "Will Sarah open the door?", "Do you want to talk to the guard?"

EXAMPLES OF GOOD OUTPUT:
{
  "openingNarration": "You arrive at a tall wooden gate blocking the path. A sleepy guard leans against it, and you notice a small bell hanging nearby. Through the gaps in the gate, you can see a beautiful garden beyond.",
  "openingQuestion": "What do you do?"
}

{
  "openingNarration": "The cave entrance looms before you, dark and mysterious. You hear water dripping inside, and strange glowing mushrooms light the walls near the opening. Your map shows this is the way forward.",
  "openingQuestion": "How do you want to explore this cave?"
}

EXAMPLES OF BAD OUTPUT:
{
  "openingNarration": "There is a gate. A guard is there.",
  "openingQuestion": "Does John want to talk to the guard or go around?"
}

{
  "openingNarration": "You see a cave.",
  "openingQuestion": "What does Sarah do?"
}

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
  "openingNarration": "Vivid description with helpful hints about what players can interact with (50-80 words)",
  "openingQuestion": "Open-ended question speaking directly to players using 'you' (max 15 words)"
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

    const prompt = `You are the Scene Guide. Summarize the completed scene for CONTINUITY into the next scene.

SCENE:
Title: ${scene.title}
Setting: ${scene.setting}
Goal: ${scene.internalGoal}

INTERACTIONS:
${conversationHistory}

EXIT TAKEN: ${scene.exitTaken || 'Unknown'}

Create a summary that captures EVERYTHING needed for the next scene:

1. SUMMARY: What players accomplished (2-3 sentences)
2. KEY EVENTS: Specific actions and outcomes that happened
3. ITEMS/ABILITIES GAINED: CRITICAL - List EVERY item, ability, knowledge, or tool players acquired
   - Include physical items (keys, maps, weapons, tools)
   - Include abilities or skills learned
   - Include important information or knowledge gained
   - Include allies or companions who joined them
4. LOCATION END: EXACTLY where players are and what they're doing when scene ended
   - Be specific: "standing at the castle gates" not just "at castle"
   - Include their state: "resting in the tavern" or "running through the forest"
5. CHARACTER DEVELOPMENT: How characters grew (if any)

CRITICAL PERSISTENCE RULES:
- itemsGained carries forward to ALL future scenes - be thorough!
- locationEnd becomes the starting point of the next scene - be precise!
- Any other persons, animals, companions, etc. that joined players become part of their group going forward
- If players picked up, found, received, or learned ANYTHING, it goes in itemsGained
- If unsure whether something counts as an item, INCLUDE IT (better to have too much than miss something)

EXAMPLES OF GOOD itemsGained:
["golden key from the guard", "map of the forest", "healing potion", "knowledge of the secret password", "friendship with the merchant"]

EXAMPLES OF BAD itemsGained:
["key"] (too vague - which key?)
[] (when players clearly found or learned something)

Return JSON:
{
  "summary": "2-3 sentence summary of what happened",
  "keyEvents": ["specific event 1", "specific event 2", "specific event 3"],
  "itemsGained": ["every single item/ability/knowledge gained with descriptive names"],
  "locationEnd": "Precise location and state of players when scene ended",
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
      ? `PREVIOUS SCENE CONTEXT (MAINTAIN CONTINUITY):
Summary: ${previousSceneSummary.summary}
Key Events: ${previousSceneSummary.keyEvents.join(', ')}
Items/Abilities Players Have: ${previousSceneSummary.itemsGained?.join(', ') || 'none'}
Current Location: ${previousSceneSummary.locationEnd}

CRITICAL CONTINUITY RULES:
- Players HAVE all items/abilities listed above—reference them when relevant.
- Players START from the location listed above.
- Acknowledge recent events when they're relevant to the current situation.
- If players try to use an item they have, LET THEM (no re-acquiring).`
      : 'This is the first scene. Players have no items yet.';

    return `You are the Scene Guide DM for kids ages 6-10. You narrate their adventure and respond to their actions.

OUTPUT FORMAT—STRICT:
- Return ONLY a single JSON object (no preface text, no code fences, no comments).
- Use valid JSON: double quotes, no trailing commas.
- "say" ≤ 100 words; "ask" ≤ 20 words.

CORE BEHAVIOR:
- Speak directly to players using "you". Never third-person or names in questions.
- Provide vivid, child-friendly description with gentle, embedded hints.
- Stay in character as storyteller; never break the fourth wall or mention rules/prompt.
- You control all NPCs and the environment; players control only their own actions/words.
- Keep scenes brisk—aim to complete in 3-5 player turns; be generous with success.

SCENE CONTEXT:
Title: ${scene.title}
Setting: ${scene.setting}
Situation: ${scene.situation}
Internal Goal: ${scene.internalGoal}

POSSIBLE EXITS:
${exitsFormatted}

${previousContext}

SCENE PROGRESS:
- Interactions so far: ${scene.interactions.length} turns
- Current turn: ${scene.interactions.filter(i => i.speaker !== 'DM').length + 1}
- Target completion: 3-5 turns maximum

HINTING STYLE (for kids):
- Describe what they see/hear/smell/touch.
- Surface actionable elements subtly (glances, sounds, objects, paths).
- Examples of hints:
  • "The merchant's eyes sparkle at your shiny coin."
  • "A window is slightly open; a sturdy vine climbs the wall."

QUESTION GUIDELINES:
- "ask" MUST be a single open-ended question addressed as "you" OR a single roll instruction OR empty when sceneComplete=true.
- NEVER suggest specific actions or offer choices in "ask".
- GOOD: "What do you do?" "How do you handle this?" "What's your approach?"
- BAD: "Do you open the door?" "Will you talk to the guard?" "What does John do?"

ROLLS—HARD RULES:
- Use a roll for uncertainty/risk/challenge or when approaching an exit that requires one.
- Difficulty scale: 1-6 (1-2=fail, 3-4=partial, 5-6=success).
- DO NOT request rolls for simple talk, basic observation, routine actions.
- When needRoll=true:
  • "ask" MUST be a roll instruction ONLY (no question, no question mark).
  • Format "ask" as: "Roll a d6 to [purpose]. Difficulty [N]."
  • Set rollPurpose and rollDifficulty accordingly.
- NEVER combine a question with a roll instruction.

SCENE COMPLETION—HARD RULES:
- When an exit condition is reasonably met, COMPLETE the scene.
- When sceneComplete=true:
  • "ask" MUST be an empty string "".
  • needRoll MUST be false.
  • rollPurpose MUST be "" and rollDifficulty MUST be 0.
  • exitTaken MUST name the exit taken (use the exit description verbatim).
  • "say" briefly celebrates success and sets up next context.
- Do not add extra obstacles at the end (“one more thing” is forbidden).

DM CONTROL:
- If a player attempts to control an NPC, narrate what they ATTEMPT; you decide NPC responses.
- If players drift off-task, redirect with in-world cues (sounds, NPC calls, visual details).
- Resolve loops quickly; move the story forward.

FORMATTING FIELDS:
- "say": narration ONLY (no questions, no roll instructions, no meta).
- "ask": either one open-ended question (no choices), OR a roll instruction per the roll format above, OR empty when the scene is complete.

SELF-CHECK BEFORE RETURNING (MUST PASS ALL):
1) JSON only? Valid JSON? ✓
2) "say" ≤ 100 words and contains no questions/roll text? ✓
3) If needRoll=true → "ask" is roll instruction only; no "?"; rollPurpose set; rollDifficulty 1-6. ✓
4) If sceneComplete=true → "ask"==""; needRoll==false; rollPurpose==""; rollDifficulty==0; exitTaken set to an exit description. ✓
5) If not complete and not rolling → "ask" is a single open-ended second-person question, no choices/suggestions. ✓
6) No third-person questions; no NPC control by players; hints present. ✓

Return ONLY:
{
  "say": "Vivid narration with helpful hints about what players see and can interact with (max 100 words)",
  "ask": "Open-ended question OR exact roll instruction OR empty when complete (max 20 words)",
  "needRoll": true/false,
  "rollPurpose": "If needRoll=true, what the roll is for; else empty string",
  "rollDifficulty": 0|1|2|3|4|5|6,
  "sceneComplete": true/false,
  "exitTaken": null OR "Exit description verbatim from POSSIBLE EXITS"
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
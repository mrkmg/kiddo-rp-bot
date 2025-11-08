/**
 * Content Safety Filters
 * 
 * Implements kid-appropriate content filtering for the Kiddo RP Storyteller app
 * - Filters inappropriate language and content
 * - Blocks personal information
 * - Ensures age-appropriate themes and responses
 * - Replaces weapons with imaginative alternatives
 */

import type { DMResponse } from '../services/llm';

/**
 * Safety filter result
 */
export interface SafetyResult {
  safe: boolean;
  filtered: string;
  reason?: string;
}

/**
 * Theme validation result
 */
export interface ThemeValidation {
  valid: boolean;
  suggestion?: string;
}

/**
 * Inappropriate words and phrases to filter
 * Keep content PG-rated for ages 6-10
 */
const INAPPROPRIATE_WORDS = [
  // Violence and weapons
  'kill', 'murder', 'blood', 'gore', 'stab', 'shoot', 'gun', 'knife',
  'sword', 'weapon', 'attack', 'destroy', 'death', 'die', 'dead',
  // Scary content
  'scary', 'horror', 'terror', 'nightmare', 'monster', 'demon', 'ghost',
  'zombie', 'vampire', 'witch', 'evil', 'dark magic',
  // Inappropriate language
  'stupid', 'dumb', 'idiot', 'hate', 'shut up',
  // Other
  'fight', 'hurt', 'pain', 'suffer', 'cry',
];

/**
 * Patterns for detecting personal information
 */
const PERSONAL_INFO_PATTERNS = [
  /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, // Phone numbers
  /\b\d{5}(?:-\d{4})?\b/g, // ZIP codes
  /\b\d{1,5}\s+\w+\s+(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd)\b/gi, // Street addresses
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, // Email addresses
];

/**
 * Inappropriate themes to block
 */
const INAPPROPRIATE_THEMES = [
  'horror', 'scary', 'zombie', 'vampire', 'war', 'battle', 'fight',
  'murder', 'death', 'dark', 'evil', 'demon', 'hell', 'apocalypse',
];

/**
 * Weapon replacements for kid-friendly alternatives
 */
const WEAPON_REPLACEMENTS: Record<string, string> = {
  'sword': 'magic wand',
  'knife': 'enchanted tool',
  'gun': 'bubble blaster',
  'weapon': 'helpful tool',
  'bow': 'rainbow launcher',
  'arrow': 'sparkle dart',
  'axe': 'builder\'s hammer',
  'spear': 'pointing stick',
  'dagger': 'shiny key',
  'bomb': 'surprise package',
  'grenade': 'glitter ball',
};

/**
 * Filter user input for inappropriate content
 * 
 * @param text - User input text to filter
 * @returns Safety result with filtered text
 */
export function filterUserInput(text: string): SafetyResult {
  let filtered = text;
  const issues: string[] = [];

  // Check for personal information
  for (const pattern of PERSONAL_INFO_PATTERNS) {
    if (pattern.test(filtered)) {
      filtered = filtered.replace(pattern, '[REMOVED]');
      issues.push('personal information');
    }
  }

  // Check for inappropriate words (case-insensitive)
  const lowerText = filtered.toLowerCase();
  for (const word of INAPPROPRIATE_WORDS) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    if (regex.test(lowerText)) {
      // Replace with kid-friendly alternatives
      if (WEAPON_REPLACEMENTS[word.toLowerCase()]) {
        filtered = filtered.replace(regex, WEAPON_REPLACEMENTS[word.toLowerCase()]);
      } else {
        filtered = filtered.replace(regex, '[removed]');
      }
      issues.push(`inappropriate content (${word})`);
    }
  }

  // Check for excessive length (prevent abuse)
  if (filtered.length > 500) {
    filtered = filtered.substring(0, 500) + '...';
    issues.push('text too long');
  }

  // If significant filtering occurred, mark as unsafe
  if (issues.length > 3) {
    return {
      safe: false,
      filtered: "Let's keep our adventure friendly and fun!",
      reason: `Content filtered: ${issues.join(', ')}`,
    };
  }

  return {
    safe: true,
    filtered,
    reason: issues.length > 0 ? `Minor filtering: ${issues.join(', ')}` : undefined,
  };
}

/**
 * Filter DM response for age-appropriate content
 * 
 * @param response - DM response to filter
 * @returns Safety result with filtered response
 */
export function filterDMResponse(response: DMResponse): { safe: boolean; filtered: DMResponse; reason?: string } {
  let filteredSay = response.say;
  let filteredAsk = response.ask;
  const issues: string[] = [];

  // Check for inappropriate words in narration
  const lowerSay = filteredSay.toLowerCase();
  for (const word of INAPPROPRIATE_WORDS) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    if (regex.test(lowerSay)) {
      // Replace weapons with imaginative tools
      if (WEAPON_REPLACEMENTS[word.toLowerCase()]) {
        filteredSay = filteredSay.replace(regex, WEAPON_REPLACEMENTS[word.toLowerCase()]);
      } else {
        // For other inappropriate words, mark as unsafe
        issues.push(`inappropriate content in narration (${word})`);
      }
    }
  }

  // Check for inappropriate words in question
  const lowerAsk = filteredAsk.toLowerCase();
  for (const word of INAPPROPRIATE_WORDS) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    if (regex.test(lowerAsk)) {
      if (WEAPON_REPLACEMENTS[word.toLowerCase()]) {
        filteredAsk = filteredAsk.replace(regex, WEAPON_REPLACEMENTS[word.toLowerCase()]);
      } else {
        issues.push(`inappropriate content in question (${word})`);
      }
    }
  }

  // Check for negative tone (should be encouraging)
  const negativePhrases = ['you fail', 'you lose', 'you die', 'game over', 'you\'re wrong'];
  for (const phrase of negativePhrases) {
    if (lowerSay.includes(phrase) || lowerAsk.includes(phrase)) {
      issues.push('negative tone detected');
    }
  }

  // If too many issues, block the response
  if (issues.length > 2) {
    return {
      safe: false,
      filtered: {
        say: "Let me think of a better way to tell this story...",
        ask: "What would you like to do next?",
        needRoll: false,
      },
      reason: `Response blocked: ${issues.join(', ')}`,
    };
  }

  // Ensure positive, encouraging tone
  const filtered: DMResponse = {
    say: filteredSay,
    ask: filteredAsk,
    needRoll: response.needRoll,
  };

  return {
    safe: true,
    filtered,
    reason: issues.length > 0 ? `Minor filtering: ${issues.join(', ')}` : undefined,
  };
}

/**
 * Validate theme for kid-appropriateness
 * 
 * @param theme - Theme to validate
 * @returns Validation result with suggestion if needed
 */
export function validateTheme(theme: string): ThemeValidation {
  const lowerTheme = theme.toLowerCase();

  // Check for inappropriate themes
  for (const inappropriate of INAPPROPRIATE_THEMES) {
    if (lowerTheme.includes(inappropriate)) {
      // Suggest alternatives based on the inappropriate theme
      const suggestions: Record<string, string> = {
        'horror': 'Magical Mystery',
        'scary': 'Exciting Adventure',
        'zombie': 'Friendly Monsters',
        'vampire': 'Night Explorers',
        'war': 'Team Challenge',
        'battle': 'Friendly Competition',
        'fight': 'Problem Solving Quest',
        'murder': 'Mystery Detective',
        'death': 'Rescue Mission',
        'dark': 'Starlight Adventure',
        'evil': 'Hero Training',
        'demon': 'Magical Creatures',
        'hell': 'Underground Exploration',
        'apocalypse': 'Rebuilding Adventure',
      };

      return {
        valid: false,
        suggestion: suggestions[inappropriate] || 'Friendly Adventure',
      };
    }
  }

  // Check for weapon-focused themes
  const weaponWords = ['sword', 'gun', 'weapon', 'combat', 'fighting'];
  for (const weapon of weaponWords) {
    if (lowerTheme.includes(weapon)) {
      return {
        valid: false,
        suggestion: 'Magical Tools Quest',
      };
    }
  }

  // Theme is appropriate
  return {
    valid: true,
  };
}

/**
 * Sanitize player name
 * 
 * @param name - Player name to sanitize
 * @returns Sanitized name
 */
export function sanitizePlayerName(name: string): string {
  // Remove special characters except spaces, hyphens, and apostrophes
  let sanitized = name.replace(/[^a-zA-Z0-9\s\-']/g, '');

  // Trim whitespace
  sanitized = sanitized.trim();

  // Limit length to 20 characters
  if (sanitized.length > 20) {
    sanitized = sanitized.substring(0, 20);
  }

  // Check for inappropriate words
  const lowerName = sanitized.toLowerCase();
  for (const word of INAPPROPRIATE_WORDS) {
    if (lowerName.includes(word)) {
      // Replace with generic name
      return 'Adventurer';
    }
  }

  // Ensure name is not empty
  if (!sanitized) {
    return 'Player';
  }

  return sanitized;
}

/**
 * Get safe fallback responses for when content is blocked
 */
export const SAFE_FALLBACKS = [
  "Let me think of a better way to tell this story...",
  "How about we try something more fun and friendly?",
  "Let's keep our adventure kind and exciting!",
  "That's a creative idea! Let me adjust it to fit our story better.",
  "I have an even better idea for what happens next!",
];

/**
 * Get a random safe fallback response
 */
export function getSafeFallback(): string {
  return SAFE_FALLBACKS[Math.floor(Math.random() * SAFE_FALLBACKS.length)];
}
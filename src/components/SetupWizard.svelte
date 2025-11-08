<script lang="ts">
/**
 * SetupWizard Component
 * 
 * Initial session setup flow for the Kiddo RP Storyteller app
 * - Welcome screen with content notice
 * - Microphone permission request
 * - Theme selection (voice or text input)
 * - Player name input (voice or text, support 1-4 players)
 * - Start session button
 * - Skip to settings for API key configuration
 */

import { sessionStore, type Player } from '../stores/session';
import { requestMicrophonePermission, checkMicrophonePermission } from '../utils/permissions';
import { validateTheme, sanitizePlayerName } from '../utils/safety';

// Props
interface Props {
  onComplete?: () => void;
  onSkipToSettings?: () => void;
}

let { onComplete, onSkipToSettings }: Props = $props();

// Wizard state
type WizardStep = 'welcome' | 'permissions' | 'theme' | 'players' | 'confirm';
let currentStep = $state<WizardStep>('welcome');
let isLoading = $state(false);
let errorMessage = $state<string | null>(null);
let hasMicrophoneAccess = $state(false);

// Session data
let theme = $state('');
let players = $state<Player[]>([]);
let currentPlayerName = $state('');
let currentPlayerBio = $state('');

// Suggested themes
const suggestedThemes = [
  'Knights and Dragons',
  'Space Adventure',
  'Underwater Quest',
  'Magical Forest',
  'Pirate Treasure Hunt',
  'Superhero City',
];

/**
 * Move to next step
 */
function nextStep() {
  errorMessage = null;
  
  switch (currentStep) {
    case 'welcome':
      // Skip permissions step if we already have microphone access
      currentStep = hasMicrophoneAccess ? 'theme' : 'permissions';
      break;
    case 'permissions':
      currentStep = 'theme';
      break;
    case 'theme':
      if (!theme.trim()) {
        errorMessage = 'Please select or enter a theme';
        return;
      }
      
      // Validate theme for kid-appropriateness
      const themeValidation = validateTheme(theme);
      if (!themeValidation.valid) {
        errorMessage = `That theme might not be suitable for kids. How about "${themeValidation.suggestion}" instead?`;
        theme = themeValidation.suggestion || '';
        return;
      }
      
      currentStep = 'players';
      break;
    case 'players':
      if (players.length === 0) {
        errorMessage = 'Please add at least one player';
        return;
      }
      currentStep = 'confirm';
      break;
    case 'confirm':
      createSession();
      break;
  }
}

/**
 * Move to previous step
 */
function previousStep() {
  errorMessage = null;
  
  switch (currentStep) {
    case 'permissions':
      currentStep = 'welcome';
      break;
    case 'theme':
      // Skip permissions step if we already have microphone access
      currentStep = hasMicrophoneAccess ? 'welcome' : 'permissions';
      break;
    case 'players':
      currentStep = 'theme';
      break;
    case 'confirm':
      currentStep = 'players';
      break;
  }
}

/**
 * Request microphone permission
 */
async function handleRequestPermission() {
  isLoading = true;
  errorMessage = null;
  
  try {
    const granted = await requestMicrophonePermission();
    if (granted) {
      nextStep();
    } else {
      errorMessage = 'Microphone permission is required to play. Please allow access and try again.';
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : 'Failed to request microphone permission';
  } finally {
    isLoading = false;
  }
}

/**
 * Select a suggested theme
 */
function selectTheme(selectedTheme: string) {
  theme = selectedTheme;
  errorMessage = null; // Clear any previous errors
}

/**
 * Add a player
 */
function addPlayer() {
  if (!currentPlayerName.trim()) {
    errorMessage = 'Please enter a player name';
    return;
  }
  
  if (players.length >= 4) {
    errorMessage = 'Maximum 4 players allowed';
    return;
  }
  
  // Sanitize player name for safety
  const sanitizedName = sanitizePlayerName(currentPlayerName);
  
  if (sanitizedName !== currentPlayerName.trim()) {
    errorMessage = `Player name adjusted to: "${sanitizedName}"`;
  }
  
  players = [
    ...players,
    {
      name: sanitizedName,
      bio: currentPlayerBio.trim() || 'adventurer',
    },
  ];
  
  currentPlayerName = '';
  currentPlayerBio = '';
  
  // Clear error after a moment if it was just a name adjustment
  if (errorMessage?.includes('adjusted')) {
    setTimeout(() => {
      errorMessage = null;
    }, 3000);
  }
}

/**
 * Remove a player
 */
function removePlayer(index: number) {
  players = players.filter((_, i) => i !== index);
}

/**
 * Create session and complete wizard
 */
function createSession() {
  isLoading = true;
  errorMessage = null;
  
  try {
    sessionStore.createSession(theme, players);
    onComplete?.();
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : 'Failed to create session';
    isLoading = false;
  }
}

/**
 * Handle skip to settings
 */
function handleSkipToSettings() {
  onSkipToSettings?.();
}

/**
 * Check microphone permission on mount
 */
async function checkInitialPermission() {
  const status = await checkMicrophonePermission();
  hasMicrophoneAccess = status === 'granted';
}

// Check permission when component mounts
checkInitialPermission();
</script>

<div class="setup-wizard min-h-screen bg-linear-to-b from-purple-100 to-blue-100 flex items-center justify-center p-4">
  <div class="wizard-card bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-8">
    
    {#if currentStep === 'welcome'}
      <!-- Welcome Screen -->
      <div class="text-center space-y-6">
        <div class="flex justify-center">
          <svg class="w-24 h-24 text-purple-600" fill="currentColor" viewBox="0 0 20 20">
            <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
            <path fill-rule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clip-rule="evenodd" />
          </svg>
        </div>
        
        <h1 class="text-4xl font-bold text-gray-900">Welcome, Adventurer!</h1>
        
        <div class="bg-yellow-50 border-l-4 border-yellow-400 p-4 text-left">
          <div class="flex">
            <svg class="w-6 h-6 text-yellow-400 mr-3 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
            </svg>
            <div>
              <h3 class="text-lg font-bold text-yellow-800">Content Notice</h3>
              <p class="text-yellow-700 mt-1">
                This app creates interactive stories for kids ages 6-10. 
                All content is kept friendly and age-appropriate (PG rated).
                Stories involve adventure, teamwork, and problem-solving.
              </p>
            </div>
          </div>
        </div>
        
        <p class="text-gray-600 text-lg">
          Get ready for an amazing storytelling adventure! 
          I'll be your Dungeon Master, guiding you through exciting quests.
        </p>
        
        <button
          onclick={nextStep}
          class="btn-primary w-full py-4 text-xl font-bold rounded-lg bg-purple-600 hover:bg-purple-700 text-white transition-colors duration-200"
        >
          Let's Begin!
        </button>
        
        <button
          onclick={handleSkipToSettings}
          class="text-sm text-gray-500 hover:text-gray-700 underline"
        >
          Configure API Keys First
        </button>
      </div>
      
    {:else if currentStep === 'permissions'}
      <!-- Microphone Permission -->
      <div class="text-center space-y-6">
        <div class="flex justify-center">
          <svg class="w-24 h-24 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clip-rule="evenodd" />
          </svg>
        </div>
        
        <h2 class="text-3xl font-bold text-gray-900">Microphone Access</h2>
        
        <p class="text-gray-600 text-lg">
          To play, I need to hear your voice! 
          Please allow microphone access so we can talk together.
        </p>
        
        {#if errorMessage}
          <div class="bg-red-50 border-l-4 border-red-400 p-4 text-left">
            <p class="text-red-700">{errorMessage}</p>
          </div>
        {/if}
        
        <div class="flex space-x-4">
          <button
            onclick={previousStep}
            class="flex-1 py-3 text-lg font-bold rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-700 transition-colors duration-200"
          >
            Back
          </button>
          <button
            onclick={handleRequestPermission}
            disabled={isLoading}
            class="flex-1 py-3 text-lg font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors duration-200 disabled:opacity-50"
          >
            {isLoading ? 'Requesting...' : 'Allow Microphone'}
          </button>
        </div>
      </div>
      
    {:else if currentStep === 'theme'}
      <!-- Theme Selection -->
      <div class="space-y-6">
        <h2 class="text-3xl font-bold text-gray-900 text-center">Choose Your Adventure</h2>
        
        <p class="text-gray-600 text-center">
          What kind of story would you like to experience?
        </p>
        
        <!-- Suggested Themes -->
        <div class="grid grid-cols-2 gap-3">
          {#each suggestedThemes as suggestedTheme}
            <button
              onclick={() => selectTheme(suggestedTheme)}
              class="p-4 rounded-lg border-2 transition-all duration-200 {theme === suggestedTheme ? 'border-purple-600 bg-purple-50' : 'border-gray-200 hover:border-purple-300'}"
            >
              <span class="font-bold text-gray-900">{suggestedTheme}</span>
            </button>
          {/each}
        </div>
        
        <!-- Custom Theme -->
        <div>
          <label for="custom-theme" class="block text-sm font-bold text-gray-700 mb-2">
            Or create your own theme:
          </label>
          <input
            id="custom-theme"
            type="text"
            bind:value={theme}
            placeholder="e.g., Dinosaur Discovery"
            class="w-full px-4 py-3 text-lg border-2 border-gray-300 rounded-lg focus:border-purple-600 focus:outline-none"
          />
        </div>
        
        {#if errorMessage}
          <p class="text-red-600 text-sm">{errorMessage}</p>
        {/if}
        
        <div class="flex space-x-4">
          <button
            onclick={previousStep}
            class="flex-1 py-3 text-lg font-bold rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-700 transition-colors duration-200"
          >
            Back
          </button>
          <button
            onclick={nextStep}
            class="flex-1 py-3 text-lg font-bold rounded-lg bg-purple-600 hover:bg-purple-700 text-white transition-colors duration-200"
          >
            Next
          </button>
        </div>
      </div>
      
    {:else if currentStep === 'players'}
      <!-- Player Names -->
      <div class="space-y-6">
        <h2 class="text-3xl font-bold text-gray-900 text-center">Who's Playing?</h2>
        
        <p class="text-gray-600 text-center">
          Add 1-4 players. Each player will take turns in the adventure!
        </p>
        
        <!-- Player List -->
        {#if players.length > 0}
          <div class="space-y-2">
            {#each players as player, index}
              <div class="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                <div>
                  <span class="font-bold text-gray-900">{player.name}</span>
                  <span class="text-sm text-gray-600 ml-2">({player.bio})</span>
                </div>
                <button
                  onclick={() => removePlayer(index)}
                  class="text-red-600 hover:text-red-800"
                  aria-label="Remove player"
                >
                  <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            {/each}
          </div>
        {/if}
        
        <!-- Add Player Form -->
        {#if players.length < 4}
          <div class="space-y-3">
            <div>
              <label for="player-name" class="block text-sm font-bold text-gray-700 mb-2">
                Player Name:
              </label>
              <input
                id="player-name"
                type="text"
                bind:value={currentPlayerName}
                placeholder="e.g., Alex"
                class="w-full px-4 py-3 text-lg border-2 border-gray-300 rounded-lg focus:border-blue-600 focus:outline-none"
                onkeydown={(e) => e.key === 'Enter' && addPlayer()}
              />
            </div>
            
            <div>
              <label for="player-bio" class="block text-sm font-bold text-gray-700 mb-2">
                Character Type (optional):
              </label>
              <input
                id="player-bio"
                type="text"
                bind:value={currentPlayerBio}
                placeholder="e.g., brave knight, clever wizard"
                class="w-full px-4 py-3 text-lg border-2 border-gray-300 rounded-lg focus:border-blue-600 focus:outline-none"
                onkeydown={(e) => e.key === 'Enter' && addPlayer()}
              />
            </div>
            
            <button
              onclick={addPlayer}
              class="w-full py-3 text-lg font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors duration-200"
            >
              Add Player
            </button>
          </div>
        {:else}
          <p class="text-center text-gray-600">Maximum 4 players reached</p>
        {/if}
        
        {#if errorMessage}
          <p class="text-red-600 text-sm text-center">{errorMessage}</p>
        {/if}
        
        <div class="flex space-x-4">
          <button
            onclick={previousStep}
            class="flex-1 py-3 text-lg font-bold rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-700 transition-colors duration-200"
          >
            Back
          </button>
          <button
            onclick={nextStep}
            disabled={players.length === 0}
            class="flex-1 py-3 text-lg font-bold rounded-lg bg-purple-600 hover:bg-purple-700 text-white transition-colors duration-200 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
      
    {:else if currentStep === 'confirm'}
      <!-- Confirmation -->
      <div class="space-y-6">
        <h2 class="text-3xl font-bold text-gray-900 text-center">Ready to Begin?</h2>
        
        <div class="bg-purple-50 rounded-lg p-6 space-y-4">
          <div>
            <h3 class="font-bold text-gray-700 mb-2">Adventure Theme:</h3>
            <p class="text-xl text-gray-900">{theme}</p>
          </div>
          
          <div>
            <h3 class="font-bold text-gray-700 mb-2">Players:</h3>
            <ul class="space-y-1">
              {#each players as player}
                <li class="text-lg text-gray-900">
                  {player.name} <span class="text-gray-600">({player.bio})</span>
                </li>
              {/each}
            </ul>
          </div>
        </div>
        
        <p class="text-gray-600 text-center">
          Your adventure is about to begin! Press the talk button to speak with the Dungeon Master.
        </p>
        
        {#if errorMessage}
          <p class="text-red-600 text-sm text-center">{errorMessage}</p>
        {/if}
        
        <div class="flex space-x-4">
          <button
            onclick={previousStep}
            class="flex-1 py-3 text-lg font-bold rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-700 transition-colors duration-200"
          >
            Back
          </button>
          <button
            onclick={nextStep}
            disabled={isLoading}
            class="flex-1 py-3 text-lg font-bold rounded-lg bg-green-600 hover:bg-green-700 text-white transition-colors duration-200 disabled:opacity-50"
          >
            {isLoading ? 'Starting...' : 'Start Adventure!'}
          </button>
        </div>
      </div>
    {/if}
    
    <!-- Progress Indicator -->
    <div class="mt-8 flex justify-center space-x-2">
      {#each ['welcome', 'permissions', 'theme', 'players', 'confirm'] as step, index}
        <!-- Skip permissions indicator if we already have access -->
        {#if step !== 'permissions' || !hasMicrophoneAccess}
          <div
            class="w-3 h-3 rounded-full transition-colors duration-200 {currentStep === step ? 'bg-purple-600' : 'bg-gray-300'}"
            aria-label={`Step ${index + 1}`}
          ></div>
        {/if}
      {/each}
    </div>
  </div>
</div>

<style>
  .setup-wizard {
    min-height: 100vh;
  }

  .wizard-card {
    animation: fadeIn 0.3s ease-in-out;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* Mobile optimizations */
  @media (max-width: 640px) {
    .wizard-card {
      padding: 1.5rem;
    }

    h1 {
      font-size: 2rem;
    }

    h2 {
      font-size: 1.75rem;
    }
  }
</style>
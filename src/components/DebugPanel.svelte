<script lang="ts">
/**
 * Debug Panel Component
 * 
 * Displays LLM request/response logs for debugging purposes
 * Only visible when dev mode is enabled
 */

import { onMount, onDestroy } from 'svelte';
import { getLLMLogs, clearLLMLogs, type LLMLogEntry } from '../utils/storage';
import { sessionStore } from '../stores/session';
import DiceRoller from './DiceRoller.svelte';

let logs = $state<LLMLogEntry[]>([]);
let isExpanded = $state(false);
let selectedLog = $state<LLMLogEntry | null>(null);
let autoRefresh = $state(true);
let refreshInterval: number | null = null;
let activeTab = $state<'logs' | 'session' | 'dice' | 'states'>('logs');
let showDiceTest = $state(false);
let testDifficulty = $state(4);

// Load logs on mount
onMount(() => {
  loadLogs();
  
  // Auto-refresh every 2 seconds if enabled
  if (autoRefresh) {
    refreshInterval = window.setInterval(() => {
      loadLogs();
    }, 2000);
  }
});

onDestroy(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
});

function loadLogs() {
  logs = getLLMLogs();
}

function handleClearLogs() {
  if (confirm('Clear all LLM logs?')) {
    clearLLMLogs();
    logs = [];
    selectedLog = null;
  }
}

function toggleAutoRefresh() {
  autoRefresh = !autoRefresh;
  
  if (autoRefresh) {
    refreshInterval = window.setInterval(() => {
      loadLogs();
    }, 2000);
  } else if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString();
}

function formatJSON(obj: any): string {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

function selectLog(log: LLMLogEntry) {
  selectedLog = selectedLog?.id === log.id ? null : log;
}

// Dice test
function handleDiceTestComplete(result: number) {
  console.log('🎲 Test dice roll result:', result, 'Target:', testDifficulty, 'Success:', result >= testDifficulty);
  showDiceTest = false;
}

// State triggers
function triggerState(state: string) {
  console.log('🔧 Triggering state:', state);
  
  switch (state) {
    case 'idle':
      sessionStore.updateAppState({ turnState: 'idle' });
      break;
    case 'listening':
      sessionStore.updateAppState({ turnState: 'listening' });
      break;
    case 'thinking':
      sessionStore.updateAppState({ turnState: 'thinking' });
      break;
    case 'speaking':
      sessionStore.updateAppState({ turnState: 'speaking' });
      break;
    case 'rolling':
      sessionStore.updateAppState({ 
        turnState: 'idle',
        showDiceRoller: true,
        currentRollDifficulty: 4
      });
      break;
    case 'scene_complete':
      const currentScene = sessionStore.getCurrentScene();
      if (currentScene) {
        sessionStore.updateCurrentScene({ status: 'complete' });
      }
      break;
    case 'new_scene':
      // This would normally be handled by scene manager
      console.log('New scene trigger - use scene manager in production');
      break;
  }
}
</script>

<div class="debug-panel fixed bottom-0 right-0 z-50 bg-gray-900 text-gray-100 shadow-2xl border-t-2 border-purple-500">
  {#if !isExpanded}
    <!-- Collapsed state - just a tab -->
    <button
      onclick={() => isExpanded = true}
      class="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-mono text-sm rounded-t-lg transition-colors"
    >
      🐛 Debug Panel ({logs.length} logs)
    </button>
  {:else}
    <!-- Expanded state -->
    <div class="w-screen md:w-[800px] h-[500px] flex flex-col">
      <!-- Header -->
      <div class="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
        <div class="flex items-center space-x-4">
          <h3 class="font-mono font-bold text-purple-400">🐛 Debug Panel</h3>
          
          <!-- Tab Navigation -->
          <div class="flex gap-1">
            <button
              onclick={() => activeTab = 'logs'}
              class="px-3 py-1 text-xs rounded transition-colors {activeTab === 'logs' ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}"
            >
              📋 Logs ({logs.length})
            </button>
            <button
              onclick={() => activeTab = 'session'}
              class="px-3 py-1 text-xs rounded transition-colors {activeTab === 'session' ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}"
            >
              📊 Session
            </button>
            <button
              onclick={() => activeTab = 'dice'}
              class="px-3 py-1 text-xs rounded transition-colors {activeTab === 'dice' ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}"
            >
              🎲 Dice Test
            </button>
            <button
              onclick={() => activeTab = 'states'}
              class="px-3 py-1 text-xs rounded transition-colors {activeTab === 'states' ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}"
            >
              ⚡ States
            </button>
          </div>
        </div>
        
        <div class="flex items-center space-x-2">
          <button
            onclick={toggleAutoRefresh}
            class="px-3 py-1 text-xs rounded {autoRefresh ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-600 hover:bg-gray-700'} transition-colors"
            title={autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
          >
            {autoRefresh ? '🔄 Auto' : '⏸️ Manual'}
          </button>
          
          <button
            onclick={loadLogs}
            class="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 rounded transition-colors"
            title="Refresh logs"
          >
            🔄 Refresh
          </button>
          
          <button
            onclick={handleClearLogs}
            class="px-3 py-1 text-xs bg-red-600 hover:bg-red-700 rounded transition-colors"
            title="Clear all logs"
          >
            🗑️ Clear
          </button>
          
          <button
            onclick={() => isExpanded = false}
            class="px-3 py-1 text-xs bg-gray-600 hover:bg-gray-700 rounded transition-colors"
            title="Minimize"
          >
            ➖
          </button>
        </div>
      </div>
      
      <!-- Content -->
      <div class="flex-1 overflow-hidden">
        {#if activeTab === 'logs'}
          <!-- Logs Tab -->
          <div class="flex h-full">
            <!-- Log list -->
            <div class="w-1/3 border-r border-gray-700 overflow-y-auto">
              {#if logs.length === 0}
                <div class="p-4 text-center text-gray-500">
                  No logs yet. Logs will appear when LLM requests are made.
                </div>
              {:else}
                <div class="divide-y divide-gray-700">
                  {#each logs.slice().reverse() as log}
                    <button
                      onclick={() => selectLog(log)}
                      class="w-full text-left px-3 py-2 hover:bg-gray-800 transition-colors {selectedLog?.id === log.id ? 'bg-gray-800 border-l-4 border-purple-500' : ''}"
                    >
                      <div class="flex items-center justify-between mb-1">
                        <span class="text-xs font-mono {log.type === 'request' ? 'text-blue-400' : log.error ? 'text-red-400' : 'text-green-400'}">
                          {log.type === 'request' ? '→ REQ' : log.error ? '✗ ERR' : '← RES'}
                        </span>
                        <span class="text-xs text-gray-500">{formatTimestamp(log.timestamp)}</span>
                      </div>
                      <div class="text-sm text-gray-300 truncate">{log.context}</div>
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
            
            <!-- Log details -->
            <div class="flex-1 overflow-y-auto p-4 bg-gray-950">
              {#if selectedLog}
                <div class="space-y-4">
                  <div>
                    <div class="text-xs text-gray-500 mb-1">Type</div>
                    <div class="font-mono text-sm {selectedLog.type === 'request' ? 'text-blue-400' : selectedLog.error ? 'text-red-400' : 'text-green-400'}">
                      {selectedLog.type.toUpperCase()}
                    </div>
                  </div>
                  
                  <div>
                    <div class="text-xs text-gray-500 mb-1">Context</div>
                    <div class="font-mono text-sm text-gray-300">{selectedLog.context}</div>
                  </div>
                  
                  <div>
                    <div class="text-xs text-gray-500 mb-1">Timestamp</div>
                    <div class="font-mono text-sm text-gray-300">{selectedLog.timestamp}</div>
                  </div>
                  
                  {#if selectedLog.messages}
                    <div>
                      <div class="text-xs text-gray-500 mb-1">Messages</div>
                      <pre class="bg-gray-900 p-3 rounded text-xs overflow-x-auto text-gray-300">{formatJSON(selectedLog.messages)}</pre>
                    </div>
                  {/if}
                  
                  {#if selectedLog.response}
                    <div>
                      <div class="text-xs text-gray-500 mb-1">Response</div>
                      <pre class="bg-gray-900 p-3 rounded text-xs overflow-x-auto text-gray-300">{selectedLog.response}</pre>
                    </div>
                  {/if}
                  
                  {#if selectedLog.parsed}
                    <div>
                      <div class="text-xs text-gray-500 mb-1">Parsed</div>
                      <pre class="bg-gray-900 p-3 rounded text-xs overflow-x-auto text-gray-300">{formatJSON(selectedLog.parsed)}</pre>
                    </div>
                  {/if}
                  
                  {#if selectedLog.error}
                    <div>
                      <div class="text-xs text-gray-500 mb-1">Error</div>
                      <pre class="bg-red-900 p-3 rounded text-xs overflow-x-auto text-red-200">{selectedLog.error}</pre>
                    </div>
                  {/if}
                </div>
              {:else}
                <div class="text-center text-gray-500 mt-8">
                  Select a log entry to view details
                </div>
              {/if}
            </div>
          </div>
        
        {:else if activeTab === 'session'}
          <!-- Session Tab -->
          <div class="h-full overflow-y-auto p-4 bg-gray-950">
            <div class="space-y-4">
              <div>
                <h4 class="text-sm font-bold text-purple-400 mb-2">Session Overview</h4>
                <div class="bg-gray-900 p-3 rounded space-y-2 text-xs">
                  <div><span class="text-gray-500">ID:</span> <span class="text-gray-300 font-mono">{sessionStore.current.id || 'No session'}</span></div>
                  <div><span class="text-gray-500">Status:</span> <span class="text-gray-300">{sessionStore.current.status}</span></div>
                  <div><span class="text-gray-500">Theme:</span> <span class="text-gray-300">{sessionStore.current.theme || 'Not set'}</span></div>
                  <div><span class="text-gray-500">Total Turns:</span> <span class="text-gray-300">{sessionStore.current.totalTurns}</span></div>
                  <div><span class="text-gray-500">Last Speaker:</span> <span class="text-gray-300">{sessionStore.current.lastSpeaker}</span></div>
                  <div><span class="text-gray-500">Created:</span> <span class="text-gray-300">{sessionStore.current.createdAt}</span></div>
                  <div><span class="text-gray-500">Updated:</span> <span class="text-gray-300">{sessionStore.current.updatedAt}</span></div>
                </div>
              </div>
              
              <div>
                <h4 class="text-sm font-bold text-purple-400 mb-2">Players ({sessionStore.current.players.length})</h4>
                <div class="bg-gray-900 p-3 rounded text-xs">
                  {#if sessionStore.current.players.length === 0}
                    <div class="text-gray-500">No players</div>
                  {:else}
                    {#each sessionStore.current.players as player, i}
                      <div class="mb-2 pb-2 {i < sessionStore.current.players.length - 1 ? 'border-b border-gray-800' : ''}">
                        <div class="text-gray-300 font-bold">{player.name}</div>
                        <div class="text-gray-500">{player.bio}</div>
                      </div>
                    {/each}
                  {/if}
                </div>
              </div>
              
              <div>
                <h4 class="text-sm font-bold text-purple-400 mb-2">Current Scene</h4>
                <div class="bg-gray-900 p-3 rounded text-xs">
                  {#if sessionStore.getCurrentScene()}
                    {@const scene = sessionStore.getCurrentScene()!}
                    <div class="space-y-2">
                      <div><span class="text-gray-500">Scene #:</span> <span class="text-gray-300">{scene.number}</span></div>
                      <div><span class="text-gray-500">Title:</span> <span class="text-gray-300">{scene.title}</span></div>
                      <div><span class="text-gray-500">Status:</span> <span class="text-gray-300">{scene.status}</span></div>
                      <div><span class="text-gray-500">Interactions:</span> <span class="text-gray-300">{scene.interactions.length}</span></div>
                      <div><span class="text-gray-500">Roll Opportunities:</span> <span class="text-gray-300">{scene.rollOpportunities.length}</span></div>
                      <div class="mt-2 pt-2 border-t border-gray-800">
                        <div class="text-gray-500 mb-1">Setting:</div>
                        <div class="text-gray-300">{scene.setting}</div>
                      </div>
                      <div class="mt-2 pt-2 border-t border-gray-800">
                        <div class="text-gray-500 mb-1">Situation:</div>
                        <div class="text-gray-300">{scene.situation}</div>
                      </div>
                    </div>
                  {:else}
                    <div class="text-gray-500">No active scene</div>
                  {/if}
                </div>
              </div>
              
              <div>
                <h4 class="text-sm font-bold text-purple-400 mb-2">Story State</h4>
                <div class="bg-gray-900 p-3 rounded text-xs">
                  <div class="space-y-2">
                    <div><span class="text-gray-500">Phase:</span> <span class="text-gray-300">{sessionStore.current.storyState.currentPhase}</span></div>
                    <div><span class="text-gray-500">Target Scenes:</span> <span class="text-gray-300">{sessionStore.current.storyState.targetSceneCount}</span></div>
                    <div><span class="text-gray-500">Completed Scenes:</span> <span class="text-gray-300">{sessionStore.current.storyContext.completedScenes.length}</span></div>
                    <div><span class="text-gray-500">Overall Goal:</span> <span class="text-gray-300">{sessionStore.current.storyState.overallGoal}</span></div>
                  </div>
                </div>
              </div>
              
              <div>
                <h4 class="text-sm font-bold text-purple-400 mb-2">App State</h4>
                <div class="bg-gray-900 p-3 rounded text-xs">
                  <div class="space-y-2">
                    <div><span class="text-gray-500">Turn State:</span> <span class="text-gray-300">{sessionStore.current.appState?.turnState || 'unknown'}</span></div>
                    <div><span class="text-gray-500">Show Dice:</span> <span class="text-gray-300">{sessionStore.current.appState?.showDiceRoller ? 'Yes' : 'No'}</span></div>
                    {#if sessionStore.current.appState?.currentRollDifficulty}
                      <div><span class="text-gray-500">Roll Difficulty:</span> <span class="text-gray-300">{sessionStore.current.appState.currentRollDifficulty}</span></div>
                    {/if}
                  </div>
                </div>
              </div>
              
              <div>
                <h4 class="text-sm font-bold text-purple-400 mb-2">Full Session Data (JSON)</h4>
                <pre class="bg-gray-900 p-3 rounded text-xs overflow-x-auto text-gray-300">{formatJSON(sessionStore.current)}</pre>
              </div>
            </div>
          </div>
        
        {:else if activeTab === 'dice'}
          <!-- Dice Test Tab -->
          <div class="h-full overflow-y-auto p-4 bg-gray-950">
            <div class="max-w-2xl mx-auto space-y-6">
              <div>
                <h4 class="text-lg font-bold text-purple-400 mb-4">🎲 Dice Roller Test</h4>
                <p class="text-sm text-gray-400 mb-6">
                  Test the dice roller component with different difficulty settings.
                  Results will be logged to the console.
                </p>
              </div>
              
              <div class="bg-gray-900 p-4 rounded">
                <label class="block text-sm text-gray-300 mb-2">
                  Difficulty Target (1-6):
                </label>
                <input
                  type="range"
                  min="1"
                  max="6"
                  bind:value={testDifficulty}
                  class="w-full"
                />
                <div class="text-center text-2xl font-bold text-purple-400 mt-2">
                  {testDifficulty}
                </div>
              </div>
              
              <button
                onclick={() => showDiceTest = true}
                class="w-full px-6 py-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-bold rounded-lg transition-all transform hover:scale-105 text-lg"
              >
                🎲 Roll Dice (Target: {testDifficulty}+)
              </button>
              
              <div class="bg-gray-900 p-4 rounded">
                <h5 class="text-sm font-bold text-gray-300 mb-2">How it works:</h5>
                <ul class="text-xs text-gray-400 space-y-1 list-disc list-inside">
                  <li>Click the button to launch the dice roller</li>
                  <li>Tap anywhere on the screen to roll</li>
                  <li>The die will animate and show the result</li>
                  <li>Success/failure is determined by the difficulty target</li>
                  <li>Check the browser console for detailed results</li>
                </ul>
              </div>
            </div>
          </div>
        
        {:else if activeTab === 'states'}
          <!-- States Tab -->
          <div class="h-full overflow-y-auto p-4 bg-gray-950">
            <div class="max-w-2xl mx-auto space-y-6">
              <div>
                <h4 class="text-lg font-bold text-purple-400 mb-4">⚡ State Triggers</h4>
                <p class="text-sm text-gray-400 mb-6">
                  Manually trigger different application states for testing.
                  Current state: <span class="font-mono text-purple-400">{sessionStore.current.appState?.turnState || 'unknown'}</span>
                </p>
              </div>
              
              <div class="space-y-3">
                <h5 class="text-sm font-bold text-gray-300">Turn States</h5>
                
                <button
                  onclick={() => triggerState('idle')}
                  class="w-full px-4 py-3 bg-gray-800 hover:bg-gray-700 text-left rounded transition-colors"
                >
                  <div class="font-bold text-gray-200">🟢 Idle</div>
                  <div class="text-xs text-gray-400">Ready for player input</div>
                </button>
                
                <button
                  onclick={() => triggerState('listening')}
                  class="w-full px-4 py-3 bg-gray-800 hover:bg-gray-700 text-left rounded transition-colors"
                >
                  <div class="font-bold text-gray-200">🎤 Listening</div>
                  <div class="text-xs text-gray-400">Recording player speech</div>
                </button>
                
                <button
                  onclick={() => triggerState('thinking')}
                  class="w-full px-4 py-3 bg-gray-800 hover:bg-gray-700 text-left rounded transition-colors"
                >
                  <div class="font-bold text-gray-200">🤔 Thinking</div>
                  <div class="text-xs text-gray-400">Processing with LLM</div>
                </button>
                
                <button
                  onclick={() => triggerState('speaking')}
                  class="w-full px-4 py-3 bg-gray-800 hover:bg-gray-700 text-left rounded transition-colors"
                >
                  <div class="font-bold text-gray-200">🔊 Speaking</div>
                  <div class="text-xs text-gray-400">Playing DM response</div>
                </button>
              </div>
              
              <div class="space-y-3 pt-4 border-t border-gray-800">
                <h5 class="text-sm font-bold text-gray-300">Special States</h5>
                
                <button
                  onclick={() => triggerState('rolling')}
                  class="w-full px-4 py-3 bg-purple-800 hover:bg-purple-700 text-left rounded transition-colors"
                >
                  <div class="font-bold text-gray-200">🎲 Show Dice Roller</div>
                  <div class="text-xs text-gray-400">Trigger dice roll UI (difficulty: 4)</div>
                </button>
                
                <button
                  onclick={() => triggerState('scene_complete')}
                  class="w-full px-4 py-3 bg-green-800 hover:bg-green-700 text-left rounded transition-colors"
                >
                  <div class="font-bold text-gray-200">✅ Complete Scene</div>
                  <div class="text-xs text-gray-400">Mark current scene as complete</div>
                </button>
                
                <button
                  onclick={() => triggerState('new_scene')}
                  class="w-full px-4 py-3 bg-blue-800 hover:bg-blue-700 text-left rounded transition-colors"
                >
                  <div class="font-bold text-gray-200">🎬 New Scene</div>
                  <div class="text-xs text-gray-400">Trigger new scene creation (console only)</div>
                </button>
              </div>
              
              <div class="bg-yellow-900/20 border border-yellow-700/50 p-4 rounded">
                <div class="text-xs text-yellow-200">
                  ⚠️ <strong>Note:</strong> These triggers modify the session state directly.
                  Some may require additional app logic to fully function.
                  Check the console for detailed logs.
                </div>
              </div>
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}
  
  <!-- Dice Test Overlay -->
  {#if showDiceTest}
    <DiceRoller 
      onRollComplete={handleDiceTestComplete}
      difficulty={testDifficulty}
    />
  {/if}
</div>

<style>
  .debug-panel {
    font-family: 'Courier New', monospace;
  }
</style>
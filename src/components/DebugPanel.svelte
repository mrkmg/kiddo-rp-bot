<script lang="ts">
/**
 * Debug Panel Component
 * 
 * Displays LLM request/response logs for debugging purposes
 * Only visible when dev mode is enabled
 */

import { onMount, onDestroy } from 'svelte';
import { getLLMLogs, clearLLMLogs, type LLMLogEntry } from '../utils/storage';

let logs = $state<LLMLogEntry[]>([]);
let isExpanded = $state(false);
let selectedLog = $state<LLMLogEntry | null>(null);
let autoRefresh = $state(true);
let refreshInterval: number | null = null;

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
          <h3 class="font-mono font-bold text-purple-400">🐛 LLM Debug Panel</h3>
          <span class="text-sm text-gray-400">{logs.length} entries</span>
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
      <div class="flex-1 flex overflow-hidden">
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
    </div>
  {/if}
</div>

<style>
  .debug-panel {
    font-family: 'Courier New', monospace;
  }
</style>
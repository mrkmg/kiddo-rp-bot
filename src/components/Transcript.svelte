<script lang="ts">
/**
 * Transcript Component
 * 
 * Displays conversation history between DM and players
 * - Scrollable list of transcript entries
 * - Speaker tags (DM vs Player name)
 * - Relative timestamps ("2 minutes ago")
 * - Auto-scroll to bottom on new entries
 * - Different styling for DM vs Player messages
 * - High contrast for readability
 * - Shows last 50 entries (enforced by session store)
 */

import type { TranscriptEntry } from '../stores/session';

// Props
interface Props {
  entries: TranscriptEntry[];
}

let { entries }: Props = $props();

// Reference to scroll container
let scrollContainer: HTMLDivElement | undefined = $state();
let shouldAutoScroll = $state(true);

/**
 * Format timestamp as relative time
 * @param isoTimestamp - ISO 8601 timestamp
 * @returns Relative time string (e.g., "2 minutes ago")
 */
function formatRelativeTime(isoTimestamp: string): string {
  const now = new Date();
  const timestamp = new Date(isoTimestamp);
  const diffMs = now.getTime() - timestamp.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 10) {
    return 'just now';
  } else if (diffSeconds < 60) {
    return `${diffSeconds} seconds ago`;
  } else if (diffMinutes === 1) {
    return '1 minute ago';
  } else if (diffMinutes < 60) {
    return `${diffMinutes} minutes ago`;
  } else if (diffHours === 1) {
    return '1 hour ago';
  } else if (diffHours < 24) {
    return `${diffHours} hours ago`;
  } else if (diffDays === 1) {
    return '1 day ago';
  } else {
    return `${diffDays} days ago`;
  }
}

/**
 * Check if user is near bottom of scroll container
 */
function isNearBottom(): boolean {
  if (!scrollContainer) return true;
  const threshold = 100; // pixels from bottom
  const position = scrollContainer.scrollTop + scrollContainer.clientHeight;
  const height = scrollContainer.scrollHeight;
  return position >= height - threshold;
}

/**
 * Handle scroll event to determine if auto-scroll should be enabled
 */
function handleScroll() {
  shouldAutoScroll = isNearBottom();
}

/**
 * Scroll to bottom of transcript
 */
function scrollToBottom() {
  if (scrollContainer && shouldAutoScroll) {
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
  }
}

/**
 * Auto-scroll when new entries are added
 */
$effect(() => {
  // Watch for changes to entries
  if (entries.length > 0) {
    // Use setTimeout to ensure DOM has updated
    setTimeout(() => {
      scrollToBottom();
    }, 0);
  }
});
</script>

<div class="transcript-container flex flex-col h-full bg-white rounded-lg shadow-md">
  <!-- Header -->
  <div class="transcript-header px-4 py-3 border-b border-gray-200 bg-gray-50">
    <h2 class="text-lg font-bold text-gray-900">Story Transcript</h2>
    <p class="text-sm text-gray-600">
      {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
    </p>
  </div>

  <!-- Transcript Entries -->
  <div 
    bind:this={scrollContainer}
    onscroll={handleScroll}
    class="transcript-scroll flex-1 overflow-y-auto p-4 space-y-4"
  >
    {#if entries.length === 0}
      <!-- Empty state -->
      <div class="flex flex-col items-center justify-center h-full text-center p-8">
        <svg class="w-16 h-16 text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        <p class="text-gray-500 text-lg font-medium">No messages yet</p>
        <p class="text-gray-400 text-sm mt-2">Press the talk button to start your adventure!</p>
      </div>
    {:else}
      {#each entries as entry (entry.id)}
        <div 
          class="transcript-entry {entry.speaker === 'DM' ? 'dm-entry' : 'player-entry'}"
        >
          <!-- Speaker and Timestamp -->
          <div class="flex items-baseline justify-between mb-1">
            <div class="flex items-center space-x-2">
              {#if entry.speaker === 'DM'}
                <!-- DM Icon -->
                <svg class="w-5 h-5 text-purple-600" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                  <path fill-rule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clip-rule="evenodd" />
                </svg>
                <span class="font-bold text-purple-700">Dungeon Master</span>
              {:else}
                <!-- Player Icon -->
                <svg class="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clip-rule="evenodd" />
                </svg>
                <span class="font-bold text-blue-700">{entry.playerName}</span>
              {/if}
            </div>
            <span class="text-xs text-gray-500">
              {formatRelativeTime(entry.t)}
            </span>
          </div>

          <!-- Message Text -->
          <div 
            class="message-text text-base leading-relaxed {entry.speaker === 'DM' ? 'text-gray-900' : 'text-gray-800'}"
          >
            {entry.text}
          </div>
        </div>
      {/each}
    {/if}
  </div>

  <!-- Auto-scroll indicator (when not at bottom) -->
  {#if !shouldAutoScroll && entries.length > 0}
    <button
      onclick={scrollToBottom}
      class="absolute bottom-20 right-4 bg-blue-500 hover:bg-blue-600 text-white rounded-full p-3 shadow-lg transition-all duration-200"
      aria-label="Scroll to bottom"
    >
      <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
      </svg>
    </button>
  {/if}
</div>

<style>
  .transcript-container {
    position: relative;
    max-height: 600px;
  }

  .transcript-scroll {
    scroll-behavior: smooth;
  }

  .transcript-scroll::-webkit-scrollbar {
    width: 8px;
  }

  .transcript-scroll::-webkit-scrollbar-track {
    background: #f1f1f1;
    border-radius: 4px;
  }

  .transcript-scroll::-webkit-scrollbar-thumb {
    background: #888;
    border-radius: 4px;
  }

  .transcript-scroll::-webkit-scrollbar-thumb:hover {
    background: #555;
  }

  .transcript-entry {
    padding: 12px;
    border-radius: 8px;
    transition: background-color 0.2s;
  }

  .dm-entry {
    background-color: #f3f4f6;
    border-left: 4px solid #9333ea;
  }

  .player-entry {
    background-color: #eff6ff;
    border-left: 4px solid #3b82f6;
  }

  .transcript-entry:hover {
    background-color: #e5e7eb;
  }

  .message-text {
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  /* High contrast for readability */
  @media (prefers-contrast: high) {
    .dm-entry {
      background-color: #e5e7eb;
      border-left-width: 6px;
    }

    .player-entry {
      background-color: #dbeafe;
      border-left-width: 6px;
    }

    .message-text {
      font-weight: 500;
    }
  }

  /* Mobile optimizations */
  @media (max-width: 640px) {
    .transcript-container {
      max-height: 400px;
    }

    .transcript-entry {
      padding: 10px;
    }

    .message-text {
      font-size: 0.9rem;
    }
  }
</style>
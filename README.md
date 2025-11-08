# Kiddo RP Storyteller

Interactive voice-driven storytelling app for kids ages 6-10.

## Project Structure

```
kiddo-rp-bot/
├── index.html                      # Main HTML entry point with PWA meta tags
├── package.json                    # Dependencies and scripts
├── vite.config.ts                  # Vite + PWA configuration
├── tailwind.config.js              # Tailwind CSS mobile-first config
├── postcss.config.js               # PostCSS configuration
├── tsconfig.json                   # TypeScript configuration
├── Plan.md                         # Complete project specification
├── public/
│   └── manifest.json               # PWA manifest
└── src/
    ├── main.ts                     # Application entry point
    ├── app.css                     # Global styles with Tailwind
    ├── App.svelte                  # Root component
    ├── stores/
    │   └── session.ts              # Session state management
    ├── services/
    │   ├── stt.ts                  # Speech-to-Text (OpenAI Whisper)
    │   ├── llm.ts                  # LLM integration (OpenRouter)
    │   └── tts.ts                  # Text-to-Speech (Hume.ai)
    ├── components/
    │   ├── TalkButton.svelte       # Press-and-hold voice input button
    │   ├── Transcript.svelte       # Conversation history display
    │   ├── SetupWizard.svelte      # Initial session configuration
    │   ├── AudioQueue.ts           # TTS playback queue manager
    │   └── TurnController.ts       # State machine for turn flow
    └── utils/
        ├── storage.ts              # localStorage utilities
        └── permissions.ts          # Browser permission handlers
```

## Tech Stack

- **Framework**: Svelte 5 + Vite
- **Styling**: Tailwind CSS (mobile-first)
- **Language**: TypeScript
- **PWA**: vite-plugin-pwa
- **APIs**:
  - OpenAI Whisper (Speech-to-Text)
  - OpenRouter (LLM - Claude 3 Haiku)
  - Hume.ai (Text-to-Speech)

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- API keys for:
  - OpenAI (for Whisper STT)
  - OpenRouter (for LLM)
  - Hume.ai (for TTS)

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Type check
npm run check
```

### Development Server

The app will be available at `http://localhost:5173`

## Current Status

✅ **Project Structure Setup Complete**

All placeholder files have been created with:
- TypeScript type definitions
- Function signatures
- TODO comments for implementation
- Proper imports and exports

### What's Been Set Up

1. ✅ Svelte + Vite project with TypeScript
2. ✅ Tailwind CSS with mobile-first configuration
3. ✅ PWA configuration with vite-plugin-pwa
4. ✅ Complete file structure matching Plan.md
5. ✅ All component and service skeletons
6. ✅ Type definitions for session, services, and components
7. ✅ State management store structure
8. ✅ Utility modules for storage and permissions

### What Needs Implementation

The following files contain TODO comments and need implementation:

#### Services (High Priority)
- [ ] `src/services/stt.ts` - Implement OpenAI Whisper integration
- [ ] `src/services/llm.ts` - Implement OpenRouter API calls
- [ ] `src/services/tts.ts` - Implement Hume.ai TTS integration

#### Components
- [ ] `src/components/TalkButton.svelte` - Implement press-and-hold recording
- [ ] `src/components/Transcript.svelte` - Complete auto-scroll and formatting
- [ ] `src/components/SetupWizard.svelte` - Implement voice input for setup
- [ ] `src/components/AudioQueue.ts` - Implement sequential audio playback
- [ ] `src/components/TurnController.ts` - Complete state machine logic

#### Core Logic
- [ ] `src/stores/session.ts` - Implement session management functions
- [ ] `src/utils/storage.ts` - Implement localStorage operations
- [ ] `src/utils/permissions.ts` - Complete permission request handlers
- [ ] `src/App.svelte` - Wire up all components and services

#### Configuration
- [ ] Add API keys to settings (localStorage)
- [ ] Create placeholder PWA icons (192x192, 512x512)
- [ ] Test PWA installation flow

## Key Features to Implement

### 1. Voice Input Flow
- Press-and-hold talk button
- MediaRecorder for audio capture
- OpenAI Whisper for transcription
- Visual feedback during recording

### 2. Story Generation
- OpenRouter API integration
- Structured JSON responses (say, ask, needRoll)
- Context management from session state
- PG content filtering

### 3. Voice Output
- Hume.ai "Warm Storyteller" voice
- Audio queue for sequential playback
- Synchronized text display

### 4. Session Management
- localStorage persistence
- Auto-save on every turn
- Resume capability
- Transcript trimming (max 50 entries)

### 5. Turn State Machine
States: idle → recording → transcribing → thinking → speaking → idle
Special: awaiting_roll for dice requests

## Development Notes

### API Key Management
API keys should be stored in localStorage under `kiddo.settings`:
```typescript
{
  openaiApiKey: "sk-...",
  openrouterApiKey: "sk-...",
  humeApiKey: "..."
}
```

⚠️ **Security Note**: This is a client-side only app with embedded keys for personal use. Do not expose API keys in public repositories.

### Mobile-First Design
- All touch targets minimum 60px
- Large talk button (120px)
- High contrast for readability
- Portrait orientation optimized

### Content Guidelines
- PG-rated content only
- Short sentences for TTS
- Clear, direct questions
- Encourage kindness and teamwork

## Testing Checklist

- [ ] Microphone permission flow
- [ ] Voice recording and transcription
- [ ] LLM response generation
- [ ] TTS playback
- [ ] Session save/load
- [ ] PWA installation
- [ ] Offline mode (read-only transcript)
- [ ] Mobile device testing

## Resources

- [Plan.md](./Plan.md) - Complete project specification
- [Svelte Documentation](https://svelte.dev/)
- [Tailwind CSS](https://tailwindcss.com/)
- [OpenAI Whisper API](https://platform.openai.com/docs/guides/speech-to-text)
- [OpenRouter](https://openrouter.ai/)
- [Hume.ai](https://hume.ai/)

## License

Private project for personal use.

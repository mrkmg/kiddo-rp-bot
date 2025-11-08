# Kiddo RP Storyteller

Interactive voice-driven storytelling app for kids ages 6-10.

## Project Structure

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

## Resources

- [Svelte Documentation](https://svelte.dev/)
- [Tailwind CSS](https://tailwindcss.com/)
- [OpenAI Whisper API](https://platform.openai.com/docs/guides/speech-to-text)
- [OpenRouter](https://openrouter.ai/)
- [Hume.ai](https://hume.ai/)

## License

Private project for personal use.

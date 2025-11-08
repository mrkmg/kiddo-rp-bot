/**
 * Main Entry Point
 *
 * Initializes the Svelte application
 * - Mounts the root App component
 * - Registers service worker for PWA
 * - Sets up global error handlers
 */

import './app.css'
import { mount } from 'svelte'
import App from './App.svelte'

// Mount the app (Svelte 5 syntax)
const app = mount(App, {
  target: document.getElementById('app')!,
})

// Register service worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(
      (registration) => {
        console.log('ServiceWorker registration successful:', registration.scope);
      },
      (error) => {
        console.log('ServiceWorker registration failed:', error);
      }
    );
  });
}

// Global error handler
window.addEventListener('error', (event) => {
  console.error('Global error:', event.error);
  // TODO: Show user-friendly error message
  // TODO: Log to error tracking service if configured
});

// Unhandled promise rejection handler
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
  // TODO: Show user-friendly error message
  // TODO: Log to error tracking service if configured
});

export default app

/**
 * Centralized Error Handler
 * 
 * Provides comprehensive error handling utilities for the Kiddo RP Storyteller app
 * - Categorizes error types
 * - Generates user-friendly messages
 * - Provides recovery actions
 * - Manages error toast notifications
 */

/**
 * Error types that can occur in the app
 */
export type ErrorType = 
  | 'network'           // Network connectivity issues
  | 'permission'        // Permission denied (mic, etc.)
  | 'api_key'          // Missing or invalid API key
  | 'api_limit'        // API rate limit or quota exceeded
  | 'storage'          // localStorage quota exceeded
  | 'content_safety'   // Content filtered by safety rules
  | 'timeout'          // Request timeout
  | 'unknown';         // Unknown error

/**
 * Recovery action for errors
 */
export interface RecoveryAction {
  label: string;
  action: () => void | Promise<void>;
}

/**
 * Error information with user-friendly details
 */
export interface ErrorInfo {
  type: ErrorType;
  message: string;
  userMessage: string;
  canRetry: boolean;
  recoveryAction?: RecoveryAction;
}

/**
 * Toast notification state
 */
interface ToastState {
  message: string;
  action?: RecoveryAction;
  timeoutId?: number;
}

let currentToast: ToastState | null = null;
let toastCallbacks: Array<(toast: ToastState | null) => void> = [];

/**
 * Subscribe to toast notifications
 */
export function subscribeToToasts(callback: (toast: ToastState | null) => void): () => void {
  toastCallbacks.push(callback);
  // Immediately call with current state
  callback(currentToast);
  
  // Return unsubscribe function
  return () => {
    toastCallbacks = toastCallbacks.filter(cb => cb !== callback);
  };
}

/**
 * Notify all toast subscribers
 */
function notifyToastSubscribers() {
  toastCallbacks.forEach(callback => callback(currentToast));
}

/**
 * Handle and categorize errors
 * 
 * @param error - Error object to handle
 * @param context - Context where error occurred
 * @returns Error information with user-friendly details
 */
export function handleError(error: Error, context: string): ErrorInfo {
  console.error(`[${context}]`, error);

  const errorMessage = error.message.toLowerCase();
  
  // Network errors
  if (errorMessage.includes('network') || 
      errorMessage.includes('fetch') || 
      errorMessage.includes('offline') ||
      error.name === 'NetworkError') {
    return {
      type: 'network',
      message: error.message,
      userMessage: 'No internet connection. Please check your network and try again.',
      canRetry: true,
      recoveryAction: {
        label: 'Retry',
        action: () => window.location.reload(),
      },
    };
  }

  // Timeout errors
  if (errorMessage.includes('timeout') || 
      errorMessage.includes('timed out') ||
      error.name === 'AbortError') {
    return {
      type: 'timeout',
      message: error.message,
      userMessage: 'Request took too long. Please try again.',
      canRetry: true,
    };
  }

  // Permission errors
  if (errorMessage.includes('permission') || 
      errorMessage.includes('notallowederror') ||
      errorMessage.includes('denied')) {
    return {
      type: 'permission',
      message: error.message,
      userMessage: 'Microphone permission is required. Please allow access in your browser settings.',
      canRetry: false,
      recoveryAction: {
        label: 'Help',
        action: () => {
          alert('To enable microphone:\n\n1. Click the lock icon in your browser\'s address bar\n2. Find "Microphone" permissions\n3. Select "Allow"\n4. Refresh the page');
        },
      },
    };
  }

  // API key errors
  if (errorMessage.includes('api key') || 
      errorMessage.includes('unauthorized') ||
      errorMessage.includes('401') ||
      errorMessage.includes('403')) {
    return {
      type: 'api_key',
      message: error.message,
      userMessage: 'API key is missing or invalid. Please check your settings.',
      canRetry: false,
      recoveryAction: {
        label: 'Settings',
        action: () => {
          // This will be handled by the component
          const event = new CustomEvent('open-settings');
          window.dispatchEvent(event);
        },
      },
    };
  }

  // API rate limit errors
  if (errorMessage.includes('rate limit') || 
      errorMessage.includes('quota') ||
      errorMessage.includes('429')) {
    return {
      type: 'api_limit',
      message: error.message,
      userMessage: 'API rate limit reached. Please wait a moment and try again.',
      canRetry: true,
    };
  }

  // Storage errors
  if (errorMessage.includes('quota') || 
      errorMessage.includes('storage') ||
      errorMessage.includes('localstorage')) {
    return {
      type: 'storage',
      message: error.message,
      userMessage: 'Storage is full. Try clearing old sessions or browser data.',
      canRetry: false,
      recoveryAction: {
        label: 'Clear Data',
        action: () => {
          if (confirm('Clear all saved sessions? This cannot be undone.')) {
            localStorage.clear();
            window.location.reload();
          }
        },
      },
    };
  }

  // Content safety errors
  if (errorMessage.includes('content') || 
      errorMessage.includes('safety') ||
      errorMessage.includes('filtered')) {
    return {
      type: 'content_safety',
      message: error.message,
      userMessage: 'Let\'s keep our adventure friendly and fun!',
      canRetry: true,
    };
  }

  // Unknown errors
  return {
    type: 'unknown',
    message: error.message,
    userMessage: 'Something went wrong. Please try again.',
    canRetry: true,
  };
}

/**
 * Get recovery action for specific error type
 * 
 * @param errorType - Type of error
 * @returns Recovery action if available
 */
export function getRecoveryAction(errorType: ErrorType): RecoveryAction | undefined {
  switch (errorType) {
    case 'network':
      return {
        label: 'Retry',
        action: () => window.location.reload(),
      };
    
    case 'permission':
      return {
        label: 'Help',
        action: () => {
          alert('To enable microphone:\n\n1. Click the lock icon in your browser\'s address bar\n2. Find "Microphone" permissions\n3. Select "Allow"\n4. Refresh the page');
        },
      };
    
    case 'api_key':
      return {
        label: 'Settings',
        action: () => {
          const event = new CustomEvent('open-settings');
          window.dispatchEvent(event);
        },
      };
    
    case 'storage':
      return {
        label: 'Clear Data',
        action: () => {
          if (confirm('Clear all saved sessions? This cannot be undone.')) {
            localStorage.clear();
            window.location.reload();
          }
        },
      };
    
    default:
      return undefined;
  }
}

/**
 * Show error toast notification
 * 
 * @param message - Error message to display
 * @param action - Optional recovery action
 * @param duration - Duration in milliseconds (default: 5000)
 */
export function showErrorToast(
  message: string, 
  action?: RecoveryAction,
  duration: number = 5000
): void {
  // Clear existing toast
  dismissToast();

  // Create new toast
  currentToast = { message, action };
  notifyToastSubscribers();

  // Auto-dismiss after duration
  if (duration > 0) {
    currentToast.timeoutId = window.setTimeout(() => {
      dismissToast();
    }, duration);
  }
}

/**
 * Dismiss current toast notification
 */
export function dismissToast(): void {
  if (currentToast?.timeoutId) {
    clearTimeout(currentToast.timeoutId);
  }
  currentToast = null;
  notifyToastSubscribers();
}

/**
 * Get current toast state
 */
export function getCurrentToast(): ToastState | null {
  return currentToast;
}

/**
 * Retry with exponential backoff
 * 
 * @param fn - Function to retry
 * @param maxRetries - Maximum number of retries (default: 3)
 * @param baseDelay - Base delay in milliseconds (default: 1000)
 * @returns Result of the function
 */
export async function retryWithBackoff<T>(
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
      
      // Don't retry on certain error types
      const errorInfo = handleError(lastError, 'retry');
      if (!errorInfo.canRetry) {
        throw lastError;
      }
      
      // Wait before retrying (exponential backoff)
      if (i < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, i);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError!;
}

/**
 * Handle async errors with user-friendly messages
 * 
 * @param promise - Promise to handle
 * @param context - Context where error occurred
 * @param showToast - Whether to show error toast (default: true)
 * @returns Result or null if error occurred
 */
export async function handleAsyncError<T>(
  promise: Promise<T>,
  context: string,
  showToast: boolean = true
): Promise<T | null> {
  try {
    return await promise;
  } catch (error) {
    const errorInfo = handleError(error as Error, context);
    
    if (showToast) {
      showErrorToast(errorInfo.userMessage, errorInfo.recoveryAction);
    }
    
    return null;
  }
}

/**
 * Create a safe error boundary wrapper for functions
 * 
 * @param fn - Function to wrap
 * @param context - Context for error handling
 * @param fallback - Fallback value if error occurs
 * @returns Wrapped function
 */
export function createErrorBoundary<T extends (...args: any[]) => any>(
  fn: T,
  context: string,
  fallback?: ReturnType<T>
): T {
  return ((...args: Parameters<T>) => {
    try {
      const result = fn(...args);
      
      // Handle async functions
      if (result instanceof Promise) {
        return result.catch((error: Error) => {
          const errorInfo = handleError(error, context);
          showErrorToast(errorInfo.userMessage, errorInfo.recoveryAction);
          return fallback;
        });
      }
      
      return result;
    } catch (error) {
      const errorInfo = handleError(error as Error, context);
      showErrorToast(errorInfo.userMessage, errorInfo.recoveryAction);
      return fallback;
    }
  }) as T;
}

/**
 * Check if browser is online
 */
export function isOnline(): boolean {
  return navigator.onLine;
}

/**
 * Wait for browser to come online
 * 
 * @param timeout - Maximum time to wait in milliseconds
 * @returns Promise that resolves when online or rejects on timeout
 */
export function waitForOnline(timeout: number = 30000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (navigator.onLine) {
      resolve();
      return;
    }

    const timeoutId = setTimeout(() => {
      window.removeEventListener('online', onlineHandler);
      reject(new Error('Timeout waiting for network connection'));
    }, timeout);

    const onlineHandler = () => {
      clearTimeout(timeoutId);
      window.removeEventListener('online', onlineHandler);
      resolve();
    };

    window.addEventListener('online', onlineHandler);
  });
}
/**
 * Permission Manager
 * 
 * Handles browser permissions for microphone access
 * - Request microphone permission
 * - Check current permission status
 * - Handle permission denied scenarios
 * - Provide user-friendly error messages
 */

export type PermissionStatus = 'granted' | 'denied' | 'prompt' | 'unknown';

/**
 * Request microphone permission from the user
 * 
 * @returns Promise that resolves to true if permission granted, false otherwise
 */
export async function requestMicrophonePermission(): Promise<boolean> {
  try {
    // Check if getUserMedia is supported
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Your browser does not support microphone access. Please use a modern browser like Chrome, Firefox, or Safari.');
    }

    // Request microphone access
    // This will trigger the browser's permission prompt
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 44100,
      }
    });

    // Permission granted - stop the stream immediately
    // We just needed to trigger the permission prompt
    stream.getTracks().forEach(track => track.stop());

    return true;
  } catch (error) {
    console.error('Microphone permission request failed:', error);
    
    // Handle specific error types
    if (error instanceof Error) {
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        // User explicitly denied permission
        return false;
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        // On iOS, this often means no microphone permission was granted yet
        const userAgent = navigator.userAgent.toLowerCase();
        if (userAgent.includes('iphone') || userAgent.includes('ipad')) {
          throw new Error('No microphone detected. Please ensure microphone access is enabled in Settings > Safari > Microphone, then refresh this page.');
        }
        throw new Error('No microphone found. Please connect a microphone and try again.');
      } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
        throw new Error('Microphone is already in use by another application. Please close other apps and try again.');
      } else if (error.name === 'OverconstrainedError') {
        // Try again with simpler constraints for iOS compatibility
        try {
          const simpleStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          simpleStream.getTracks().forEach(track => track.stop());
          return true;
        } catch {
          throw new Error('Microphone does not meet the required specifications. Please try a different microphone.');
        }
      } else if (error.name === 'SecurityError') {
        throw new Error('Microphone access is blocked by your browser security settings. Please check your browser settings.');
      }
    }
    
    // Generic error
    throw new Error('Failed to access microphone. Please check your browser settings and try again.');
  }
}

/**
 * Check current microphone permission status
 * 
 * @returns Promise that resolves to the current permission status
 */
export async function checkMicrophonePermission(): Promise<PermissionStatus> {
  try {
    // Check if Permissions API is supported
    if (!navigator.permissions || !navigator.permissions.query) {
      // Fallback: try to access microphone to check permission
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        return 'granted';
      } catch {
        return 'unknown';
      }
    }

    // Query microphone permission status
    const result = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    
    return result.state as PermissionStatus;
  } catch (error) {
    console.error('Failed to check microphone permission:', error);
    return 'unknown';
  }
}

/**
 * Handle permission denied scenario
 * Provides user-friendly instructions for enabling microphone access
 * 
 * @returns Object with error message and instructions
 */
export function handlePermissionDenied(): {
  message: string;
  instructions: string[];
} {
  // Detect browser type for specific instructions
  const userAgent = navigator.userAgent.toLowerCase();
  let browserName = 'your browser';
  let instructions: string[] = [];

  if (userAgent.includes('chrome') && !userAgent.includes('edge')) {
    browserName = 'Chrome';
    instructions = [
      'Click the camera icon in the address bar',
      'Select "Always allow microphone access"',
      'Click "Done" and refresh the page',
    ];
  } else if (userAgent.includes('firefox')) {
    browserName = 'Firefox';
    instructions = [
      'Click the microphone icon in the address bar',
      'Select "Allow" for microphone access',
      'Refresh the page',
    ];
  } else if (userAgent.includes('safari')) {
    browserName = 'Safari';
    instructions = [
      'Go to Safari > Settings > Websites > Microphone',
      'Find this website and select "Allow"',
      'Refresh the page',
    ];
  } else if (userAgent.includes('edge')) {
    browserName = 'Edge';
    instructions = [
      'Click the lock icon in the address bar',
      'Select "Permissions for this site"',
      'Change Microphone to "Allow"',
      'Refresh the page',
    ];
  } else {
    instructions = [
      'Check your browser settings for microphone permissions',
      'Allow this website to access your microphone',
      'Refresh the page',
    ];
  }

  return {
    message: `Microphone access was denied. To use this app, you need to allow microphone access in ${browserName}.`,
    instructions,
  };
}

/**
 * Check if microphone is available (device exists)
 * 
 * @returns Promise that resolves to true if microphone device is found
 */
export async function isMicrophoneAvailable(): Promise<boolean> {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      return false;
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(device => device.kind === 'audioinput');
    
    // On iOS Safari, devices may appear but have empty labels until permission is granted
    // If we find audio inputs but they all have empty labels, we need to request permission first
    if (audioInputs.length > 0) {
      const hasLabels = audioInputs.some(device => device.label && device.label.trim() !== '');
      
      // If no labels, try to get permission to see actual devices
      if (!hasLabels) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach(track => track.stop());
          
          // Re-enumerate after permission granted
          const newDevices = await navigator.mediaDevices.enumerateDevices();
          return newDevices.some(device => device.kind === 'audioinput');
        } catch {
          // Permission denied or no microphone
          return false;
        }
      }
      
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('Failed to check microphone availability:', error);
    return false;
  }
}

/**
 * Get list of available microphone devices
 * 
 * @returns Promise that resolves to array of microphone device info
 */
export async function getMicrophoneDevices(): Promise<MediaDeviceInfo[]> {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      return [];
    }

    let devices = await navigator.mediaDevices.enumerateDevices();
    let audioInputs = devices.filter(device => device.kind === 'audioinput');
    
    // On iOS Safari, devices may have empty labels until permission is granted
    if (audioInputs.length > 0) {
      const hasLabels = audioInputs.some(device => device.label && device.label.trim() !== '');
      
      if (!hasLabels) {
        try {
          // Request permission to get actual device labels
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach(track => track.stop());
          
          // Re-enumerate after permission granted
          devices = await navigator.mediaDevices.enumerateDevices();
          audioInputs = devices.filter(device => device.kind === 'audioinput');
        } catch {
          // Permission denied, return devices without labels
          return audioInputs;
        }
      }
    }
    
    return audioInputs;
  } catch (error) {
    console.error('Failed to get microphone devices:', error);
    return [];
  }
}

/**
 * Listen for permission changes
 * 
 * @param callback - Function to call when permission status changes
 * @returns Cleanup function to stop listening
 */
export function onPermissionChange(
  callback: (status: PermissionStatus) => void
): () => void {
  let permissionStatus: PermissionStatus | null = null;

  // Check if Permissions API is supported
  if (!navigator.permissions || !navigator.permissions.query) {
    console.warn('Permissions API not supported');
    return () => {}; // No-op cleanup
  }

  // Query permission and listen for changes
  navigator.permissions.query({ name: 'microphone' as PermissionName })
    .then(result => {
      permissionStatus = result.state as PermissionStatus;
      
      // Listen for changes
      result.addEventListener('change', () => {
        const newStatus = result.state as PermissionStatus;
        if (newStatus !== permissionStatus) {
          permissionStatus = newStatus;
          callback(newStatus);
        }
      });
    })
    .catch(error => {
      console.error('Failed to listen for permission changes:', error);
    });

  // Return cleanup function
  return () => {
    // Note: There's no standard way to remove the event listener
    // The listener will be garbage collected when the page unloads
  };
}

// TODO: Add notification permission handling for background alerts
// TODO: Add camera permission handling if video features are added
// TODO: Add storage permission handling for offline mode
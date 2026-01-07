// Utility functions for Firebase authentication
import { getAuth, getIdToken } from 'firebase/auth';
import { app } from './config';

/**
 * Gets the current Firebase ID token for the authenticated user
 * @returns The ID token or null if not authenticated
 */
export async function getFirebaseIdToken(): Promise<string | null> {
  const auth = getAuth(app);
  const user = auth.currentUser;
  
  if (user) {
    try {
      // Get the ID token that can be sent to backend services
      return await getIdToken(user);
    } catch (error) {
      console.error('Error getting Firebase ID token:', error);
      return null;
    }
  }
  
  return null;
}

/**
 * Sets up automatic token refreshing for Firebase authentication
 * @param callback Callback function to handle token updates
 * @returns Function to unsubscribe from token refresh events
 */
export function onFirebaseTokenRefresh(callback: (token: string | null) => void): () => void {
  const auth = getAuth(app);
  
  // Listen for user changes (login/logout)
  const unsubscribe = auth.onIdTokenChanged(async (user) => {
    if (user) {
      try {
        const token = await getIdToken(user);
        callback(token);
      } catch (error) {
        console.error('Error getting refreshed token:', error);
        callback(null);
      }
    } else {
      callback(null);
    }
  });
  
  return unsubscribe;
}
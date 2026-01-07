// Firebase Authentication Service
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged, 
  GoogleAuthProvider, 
  signInWithPopup,
  User,
  type Auth,
  OAuthProvider,
  signInWithRedirect,
  getRedirectResult
} from 'firebase/auth';
import { app } from './config';

// Define authentication interfaces
export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
}

export interface AuthResult {
  success: boolean;
  user?: AuthUser;
  error?: string;
}

export interface AuthProvider {
  email: boolean;
  google: boolean;
  microsoft?: boolean;
  apple?: boolean;
}

class FirebaseAuthService {
  private auth: Auth;
  private providerConfig: AuthProvider;

  constructor() {
    this.auth = getAuth(app);
    this.providerConfig = {
      email: true,
      google: true
    };
    
    // Allow customization through environment variables
    if (process.env.AUTH_PROVIDERS) {
      const providers = process.env.AUTH_PROVIDERS.split(',');
      this.providerConfig = {
        email: providers.includes('email'),
        google: providers.includes('google'),
        microsoft: providers.includes('microsoft'),
        apple: providers.includes('apple')
      };
    }
  }

  // Sign in with email and password
  async signInWithEmail(email: string, password: string): Promise<AuthResult> {
    try {
      const userCredential = await signInWithEmailAndPassword(this.auth, email, password);
      const user = this.mapUser(userCredential.user);
      return { success: true, user };
    } catch (error: any) {
      return { 
        success: false, 
        error: this.formatAuthError(error.code, error.message) 
      };
    }
  }

  // Create user with email and password
  async signUpWithEmail(email: string, password: string): Promise<AuthResult> {
    try {
      const userCredential = await createUserWithEmailAndPassword(this.auth, email, password);
      const user = this.mapUser(userCredential.user);
      return { success: true, user };
    } catch (error: any) {
      return { 
        success: false, 
        error: this.formatAuthError(error.code, error.message) 
      };
    }
  }

  // Sign in with Google
  async signInWithGoogle(): Promise<AuthResult> {
    try {
      const provider = new GoogleAuthProvider();
      const userCredential = await signInWithPopup(this.auth, provider);
      const user = this.mapUser(userCredential.user);
      return { success: true, user };
    } catch (error: any) {
      return { 
        success: false, 
        error: this.formatAuthError(error.code, error.message) 
      };
    }
  }

  // Sign in with redirect (for mobile/cross-origin scenarios)
  async signInWithGoogleRedirect(): Promise<void> {
    const provider = new GoogleAuthProvider();
    await signInWithRedirect(this.auth, provider);
  }

  // Handle redirect result after sign-in
  async handleSignInRedirect(): Promise<AuthResult> {
    try {
      const result = await getRedirectResult(this.auth);
      if (result?.user) {
        const user = this.mapUser(result.user);
        return { success: true, user };
      } else {
        return { success: false, error: 'No redirect result found' };
      }
    } catch (error: any) {
      return { 
        success: false, 
        error: this.formatAuthError(error.code, error.message) 
      };
    }
  }

  // Microsoft sign-in (if configured)
  async signInWithMicrosoft(): Promise<AuthResult> {
    if (!this.providerConfig.microsoft) {
      return { success: false, error: 'Microsoft sign-in not enabled' };
    }

    try {
      const provider = new OAuthProvider('microsoft.com');
      const userCredential = await signInWithPopup(this.auth, provider);
      const user = this.mapUser(userCredential.user);
      return { success: true, user };
    } catch (error: any) {
      return { 
        success: false, 
        error: this.formatAuthError(error.code, error.message) 
      };
    }
  }

  // Sign out
  async signOut(): Promise<boolean> {
    try {
      await signOut(this.auth);
      return true;
    } catch (error) {
      console.error('Sign out error:', error);
      return false;
    }
  }

  // Get current user
  getCurrentUser(): AuthUser | null {
    const user = this.auth.currentUser;
    return user ? this.mapUser(user) : null;
  }

  // Subscribe to auth state changes
  onAuthStateChange(callback: (user: AuthUser | null) => void) {
    return onAuthStateChanged(this.auth, (user) => {
      callback(user ? this.mapUser(user) : null);
    });
  }

  // Check if user is authenticated
  isAuthenticated(): boolean {
    return this.auth.currentUser !== null;
  }

  // Map Firebase user to AuthUser interface
  private mapUser(user: User): AuthUser {
    return {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
      emailVerified: user.emailVerified
    };
  }

  // Format Firebase auth errors for better UX
  private formatAuthError(code: string, message: string): string {
    const errorMap: Record<string, string> = {
      'auth/user-not-found': 'No account found with this email address.',
      'auth/wrong-password': 'Incorrect password. Please try again.',
      'auth/invalid-email': 'Please enter a valid email address.',
      'auth/email-already-in-use': 'An account already exists with this email address.',
      'auth/weak-password': 'Password is too weak. Please use at least 6 characters.',
      'auth/operation-not-allowed': 'This sign-in method is not enabled. Please contact support.',
      'auth/popup-blocked': 'Popup was blocked. Please allow popups and try again.',
      'auth/cancelled-popup-request': 'Sign-in was cancelled. Please try again.',
      'auth/popup-closed-by-user': 'Popup was closed before completing sign-in.',
      'auth/network-request-failed': 'Network error. Please check your connection and try again.',
      'auth/too-many-requests': 'Too many requests. Please try again later.'
    };

    return errorMap[code] || message;
  }
}

// Export a singleton instance
export const firebaseAuthService = new FirebaseAuthService();
export default firebaseAuthService;
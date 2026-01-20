import { AuthChangeEvent, Session, User } from '@supabase/supabase-js';
import { supabaseClient } from './config';

// Add type declaration for window in Node.js environment
declare const window: any;

export interface AuthUser {
  id: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  emailVerified: boolean;
}

// Utility function to get origin that works in both browser and Node.js
function getOrigin(): string {
  if (typeof window !== 'undefined' && window?.location) {
    return window.location.origin;
  }

  // Return from environment variable or default
  return process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';
}

export interface AuthResult {
  success: boolean;
  user?: AuthUser;
  error?: string;
  session?: Session;
}

export interface AuthProvider {
  email: boolean;
  google: boolean;
  github?: boolean;
  microsoft?: boolean;
}

class SupabaseAuthService {
  private authProviderConfig: AuthProvider;

  constructor() {
    this.authProviderConfig = {
      email: true,
      google: true,
      github: true,
      microsoft: true
    };
    
    // Allow customization through environment variables
    if (process.env.AUTH_PROVIDERS) {
      const providers = process.env.AUTH_PROVIDERS.split(',');
      this.authProviderConfig = {
        email: providers.includes('email'),
        google: providers.includes('google'),
        github: providers.includes('github'),
        microsoft: providers.includes('microsoft')
      };
    }
  }

  // Sign in with email and password
  async signInWithEmail(email: string, password: string): Promise<AuthResult> {
    try {
      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        return { success: false, error: this.formatAuthError(error.code || 'unknown_error', error.message) };
      }

      const { user, session } = data;
      return {
        success: true,
        user: user ? this.mapUser(user) : undefined,
        session: session || undefined
      };
    } catch (error: any) {
      return { 
        success: false, 
        error: this.formatAuthError(error.code || 'unknown_error', error.message) 
      };
    }
  }

  // Sign up with email and password
  async signUpWithEmail(email: string, password: string): Promise<AuthResult> {
    try {
      const { data, error } = await supabaseClient.auth.signUp({
        email,
        password
      });

      if (error) {
        return { success: false, error: this.formatAuthError(error.code || 'unknown_error', error.message) };
      }

      const { user, session } = data;
      return {
        success: true,
        user: user ? this.mapUser(user) : undefined,
        session: session || undefined
      };
    } catch (error: any) {
      return { 
        success: false, 
        error: this.formatAuthError(error.code || 'unknown_error', error.message) 
      };
    }
  }

  // Sign in with Google
  async signInWithGoogle(redirectTo?: string): Promise<AuthResult> {
    if (!this.authProviderConfig.google) {
      return { success: false, error: 'Google sign-in not enabled' };
    }

    try {
      const origin = getOrigin();
      const { error } = await supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectTo || `${origin}/auth/callback`,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          }
        }
      });

      if (error) {
        return { success: false, error: this.formatAuthError(error.code || 'unknown_error', error.message) };
      }

      // For OAuth flows, we redirect the user, so we return success here
      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: this.formatAuthError(error.code || 'unknown_error', error.message)
      };
    }
  }

  // Sign in with GitHub
  async signInWithGitHub(redirectTo?: string): Promise<AuthResult> {
    if (!this.authProviderConfig.github) {
      return { success: false, error: 'GitHub sign-in not enabled' };
    }

    try {
      const origin = getOrigin();
      const { error } = await supabaseClient.auth.signInWithOAuth({
        provider: 'github',
        options: {
          redirectTo: redirectTo || `${origin}/auth/callback`
        }
      });

      if (error) {
        return { success: false, error: this.formatAuthError(error.code || 'unknown_error', error.message) };
      }

      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: this.formatAuthError(error.code || 'unknown_error', error.message)
      };
    }
  }

  // Sign in with Microsoft
  async signInWithMicrosoft(redirectTo?: string): Promise<AuthResult> {
    if (!this.authProviderConfig.microsoft) {
      return { success: false, error: 'Microsoft sign-in not enabled' };
    }

    try {
      const origin = getOrigin();
      const { error } = await supabaseClient.auth.signInWithOAuth({
        provider: 'azure',
        options: {
          redirectTo: redirectTo || `${origin}/auth/callback`
        }
      });

      if (error) {
        return { success: false, error: this.formatAuthError(error.code || 'unknown_error', error.message) };
      }

      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: this.formatAuthError(error.code || 'unknown_error', error.message)
      };
    }
  }

  // Sign out
  async signOut(): Promise<boolean> {
    try {
      const { error } = await supabaseClient.auth.signOut();
      if (error) {
        console.error('Sign out error:', error);
        return false;
      }
      return true;
    } catch (error) {
      console.error('Sign out error:', error);
      return false;
    }
  }

  // Get current session
  async getCurrentSession(): Promise<Session | null> {
    const { data: { session } } = await supabaseClient.auth.getSession();
    return session;
  }

  // Get current user
  async getCurrentUser(): Promise<AuthUser | null> {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (user) {
      return this.mapUser(user);
    }
    return null;
  }

  // Subscribe to auth state changes
  onAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void) {
    return supabaseClient.auth.onAuthStateChange(callback);
  }

  // Check if user is authenticated
  async isAuthenticated(): Promise<boolean> {
    const { data: { session } } = await supabaseClient.auth.getSession();
    return session !== null;
  }

  // Update user profile
  async updateProfile(updates: { displayName?: string; avatarUrl?: string }): Promise<AuthResult> {
    try {
      const { data, error } = await supabaseClient.auth.updateUser({
        data: {
          ...updates,
          displayName: updates.displayName,
        }
      });

      if (error) {
        return { success: false, error: this.formatAuthError(error.code || 'unknown_error', error.message) };
      }

      return { success: true, user: data.user ? this.mapUser(data.user) : undefined };
    } catch (error: any) {
      return { 
        success: false, 
        error: this.formatAuthError(error.code || 'unknown_error', error.message) 
      };
    }
  }

  // Reset password
  async resetPassword(email: string): Promise<AuthResult> {
    try {
      const origin = getOrigin();
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: `${origin}/update-password`
      });

      if (error) {
        return { success: false, error: this.formatAuthError(error.code || 'unknown_error', error.message) };
      }

      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: this.formatAuthError(error.code || 'unknown_error', error.message)
      };
    }
  }

  // Map Supabase user to AuthUser interface
  private mapUser(user: User): AuthUser {
    return {
      id: user.id,
      email: user.email || null,
      displayName: user.user_metadata?.full_name || user.email?.split('@')[0] || null,
      avatarUrl: user.user_metadata?.avatar_url || null,
      emailVerified: user.email_confirmed_at !== null
    };
  }

  // Format Supabase auth errors for better UX
  private formatAuthError(code: string, message: string): string {
    const errorMap: Record<string, string> = {
      'invalid_email': 'Please enter a valid email address.',
      'email_exists': 'An account already exists with this email address.',
      'invalid_credentials': 'Incorrect email or password. Please try again.',
      'weak_password': 'Password is too weak. Please use at least 6 characters.',
      'user_not_found': 'No account found with this email address.',
      'session_expired': 'Your session has expired. Please sign in again.',
      'network_error': 'Network error. Please check your connection and try again.',
      'rate_limit_exceeded': 'Too many requests. Please try again later.',
      'email_not_confirmed': 'Please confirm your email address before signing in.',
      'provider_already_linked': 'This provider is already linked to your account.'
    };

    return errorMap[code] || message;
  }
}

// Export a singleton instance
export const supabaseAuthService = new SupabaseAuthService();
export default supabaseAuthService;
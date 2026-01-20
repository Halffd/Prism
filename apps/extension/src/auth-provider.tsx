import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import {
  supabaseAuthService,
  type AuthUser,
  type AuthResult
} from '@prism/supabase-client';

// Define the authentication context type
interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  loading: boolean;
  signInWithEmail: (email: string, password: string) => Promise<AuthResult>;
  signUpWithEmail: (email: string, password: string) => Promise<AuthResult>;
  signInWithGoogle: () => Promise<AuthResult>;
  signOut: () => Promise<void>;
  updateProfile: (displayName?: string, photoURL?: string) => Promise<void>;
}

// Create the authentication context
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// AuthProvider component
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Initialize with current user if available
    const initializeUser = async () => {
      const sessionResult = await supabaseAuthService.getCurrentSession();
      if (sessionResult) {
        const currentUser = supabaseAuthService.getCurrentUser();
        if (currentUser) {
          setUser(currentUser);
        }
      }
      setLoading(false);
    };

    initializeUser();

    // Subscribe to authentication state changes
    const { data: { subscription } } = supabaseAuthService.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        const mappedUser: AuthUser = {
          id: session.user.id,
          email: session.user.email || '',
          displayName: session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'Anonymous User',
          avatarUrl: session.user.user_metadata?.avatar_url || '',
          emailVerified: session.user.email_confirmed_at ? true : false
        };
        setUser(mappedUser);
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
      }
    });

    // Clean up subscription
    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const signInWithEmail = async (email: string, password: string): Promise<AuthResult> => {
    const result = await supabaseAuthService.signInWithEmail(email, password);
    if (result.success && result.user) {
      setUser(result.user);
    }
    return result;
  };

  const signUpWithEmail = async (email: string, password: string): Promise<AuthResult> => {
    const result = await supabaseAuthService.signUpWithEmail(email, password);
    if (result.success && result.user) {
      setUser(result.user);
    }
    return result;
  };

  const signInWithGoogle = async (): Promise<AuthResult> => {
    // For browser extensions, we need to handle OAuth differently
    // This will open a popup or redirect depending on the environment
    const result = await supabaseAuthService.signInWithGoogle();
    // The user state will be updated via the onAuthStateChange listener
    return result;
  };

  const signOut = async (): Promise<void> => {
    await supabaseAuthService.signOut();
    setUser(null);
  };

  const updateProfile = async (displayName?: string, avatarUrl?: string): Promise<void> => {
    await supabaseAuthService.updateProfile({ displayName, avatarUrl });
    // The user state will be updated via the onAuthStateChange listener
  };

  const value: AuthContextType = {
    user,
    isAuthenticated: !!user,
    loading,
    signInWithEmail,
    signUpWithEmail,
    signInWithGoogle,
    signOut,
    updateProfile
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// Custom hook to use the auth context
export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
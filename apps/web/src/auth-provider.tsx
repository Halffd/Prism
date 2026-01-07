'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { 
  firebaseAuthService, 
  type AuthUser, 
  type AuthResult 
} from '@prism/firebase-auth';
import { useRouter } from 'next/navigation';

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
  const router = useRouter();

  useEffect(() => {
    // Subscribe to authentication state changes
    const unsubscribe = firebaseAuthService.onAuthStateChange((authUser) => {
      setUser(authUser);
      setLoading(false);
    });

    // Clean up subscription
    return () => unsubscribe();
  }, []);

  const signInWithEmail = async (email: string, password: string): Promise<AuthResult> => {
    const result = await firebaseAuthService.signInWithEmail(email, password);
    if (result.success && result.user) {
      setUser(result.user);
    }
    return result;
  };

  const signUpWithEmail = async (email: string, password: string): Promise<AuthResult> => {
    const result = await firebaseAuthService.signUpWithEmail(email, password);
    if (result.success && result.user) {
      setUser(result.user);
    }
    return result;
  };

  const signInWithGoogle = async (): Promise<AuthResult> => {
    const result = await firebaseAuthService.signInWithGoogle();
    if (result.success && result.user) {
      setUser(result.user);
    }
    return result;
  };

  const signOut = async (): Promise<void> => {
    await firebaseAuthService.signOut();
    setUser(null);
    // Redirect to home or login page after sign out
    router.push('/');
  };

  const updateProfile = async (displayName?: string, photoURL?: string): Promise<void> => {
    // In a real implementation, you would update the profile through Firebase
    // This is a placeholder implementation
    console.log('Update profile not yet implemented');
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
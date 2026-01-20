import { Request, Response, NextFunction } from 'express';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { Database } from '@prism/supabase-client';

export interface SupabaseAuthenticatedRequest extends Request {
  supabaseClient?: ReturnType<typeof createServerClient<Database>>;
  user?: {
    id: string;
    email: string;
    displayName: string;
    avatarUrl: string;
    emailVerified: boolean;
  };
}

export const supabaseAuthMiddleware = (req: SupabaseAuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    // Create Supabase client for server-side requests with cookies
    req.supabaseClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return req.cookies[name];
          },
          set(name: string, value: string, options: CookieOptions) {
            // Set cookie in response
            res.cookie(name, value, options);
          },
          remove(name: string, options: CookieOptions) {
            // Remove cookie from response
            res.cookie(name, '', { ...options, maxAge: 0 });
          },
        },
      }
    );

    next();
  } catch (error) {
    console.error('Supabase auth middleware error:', error);
    next(error);
  }
};

// Middleware to require Supabase authentication
export const requireSupabaseAuth = async (req: SupabaseAuthenticatedRequest, res: Response, next: NextFunction) => {
  // Ensure the Supabase client is available
  if (!req.supabaseClient) {
    return res.status(401).json({
      success: false,
      error: 'Authentication client not initialized'
    });
  }

  try {
    // Get user session from Supabase
    const {
      data: { user },
      error
    } = await req.supabaseClient.auth.getUser();

    if (error || !user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    // Map Supabase user to our user object
    req.user = {
      id: user.id,
      email: user.email || '',
      displayName: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Anonymous',
      avatarUrl: user.user_metadata?.avatar_url || '',
      emailVerified: user.email_confirmed_at ? true : false
    };

    next();
  } catch (error: any) {
    console.error('Supabase auth error:', error);
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired session'
    });
  }
};

// Middleware for optional Supabase authentication 
export const optionalSupabaseAuth = async (req: SupabaseAuthenticatedRequest, res: Response, next: NextFunction) => {
  // Ensure the Supabase client is available
  if (!req.supabaseClient) {
    // Just continue without authentication
    return next();
  }

  try {
    // Get user session from Supabase
    const {
      data: { user }
    } = await req.supabaseClient.auth.getUser();

    if (user) {
      // User is authenticated, attach to request
      req.user = {
        id: user.id,
        email: user.email || '',
        displayName: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Anonymous',
        avatarUrl: user.user_metadata?.avatar_url || '',
        emailVerified: user.email_confirmed_at ? true : false
      };
    }

    next();
  } catch (error) {
    // If there's an error, continue without authentication
    next();
  }
};
// Supabase Database Types for Prism
// This file contains the TypeScript definitions for the Supabase database tables

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string;
          display_name: string | null;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
          email_verified: boolean;
        };
        Insert: {
          id: string;
          email: string;
          display_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
          email_verified?: boolean;
        };
        Update: {
          id?: string;
          email?: string;
          display_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
          email_verified?: boolean;
        };
      };
      sessions: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      messages: {
        Row: {
          id: string;
          session_id: string;
          role: 'user' | 'assistant' | 'system';
          content: string;
          context: Json | null;
          tokens: number | null;
          timestamp: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          role: 'user' | 'assistant' | 'system';
          content: string;
          context?: Json | null;
          tokens?: number | null;
          timestamp?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string;
          role?: 'user' | 'assistant' | 'system';
          content?: string;
          context?: Json | null;
          tokens?: number | null;
          timestamp?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      prompt_shortcuts: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          content: string;
          category: string | null;
          shortcut_key: string | null;
          keyboard_shortcut: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          content: string;
          category?: string | null;
          shortcut_key?: string | null;
          keyboard_shortcut?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          content?: string;
          category?: string | null;
          shortcut_key?: string | null;
          keyboard_shortcut?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}

type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// Type aliases for convenience
export type User = Database['public']['Tables']['users']['Row'];
export type Session = Database['public']['Tables']['sessions']['Row'];
export type Message = Database['public']['Tables']['messages']['Row'];
export type PromptShortcut = Database['public']['Tables']['prompt_shortcuts']['Row'];

// Insert types
export type NewUser = Database['public']['Tables']['users']['Insert'];
export type NewSession = Database['public']['Tables']['sessions']['Insert'];
export type NewMessage = Database['public']['Tables']['messages']['Insert'];
export type NewPromptShortcut = Database['public']['Tables']['prompt_shortcuts']['Insert'];

// Update types
export type UpdateUser = Database['public']['Tables']['users']['Update'];
export type UpdateSession = Database['public']['Tables']['sessions']['Update'];
export type UpdateMessage = Database['public']['Tables']['messages']['Update'];
export type UpdatePromptShortcut = Database['public']['Tables']['prompt_shortcuts']['Update'];
// @ts-nocheck
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.1';

console.log('Sync edge function initialized');

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      },
    });
  }

  try {
    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    // Get user from token
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError) {
      throw new Error('Authentication error: ' + userError.message);
    }

    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    const pathname = new URL(req.url).pathname;

    if (req.method === 'POST') {
      // Handle sync requests
      const { pathname } = new URL(req.url);
      
      if (pathname.endsWith('/messages')) {
        // Sync messages
        const { messages } = await req.json();
        
        if (!Array.isArray(messages)) {
          return new Response(JSON.stringify({ error: 'Messages must be an array' }), {
            headers: { 'Content-Type': 'application/json' },
            status: 400,
          });
        }

        // Process and save messages
        const processedMessages = messages.map(msg => ({
          ...msg,
          id: msg.id || crypto.randomUUID(),
          user_id: user.id,
          timestamp: new Date(msg.timestamp).toISOString()
        }));

        const { error } = await supabaseClient
          .from('messages')
          .insert(processedMessages)
          .select();

        if (error) {
          return new Response(JSON.stringify({ error: 'Failed to sync messages', details: error.message }), {
            headers: { 'Content-Type': 'application/json' },
            status: 500,
          });
        }

        return new Response(JSON.stringify({
          success: true,
          message: 'Messages synced successfully',
          count: processedMessages.length
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (pathname.endsWith('/sessions')) {
        // Sync sessions
        const { sessions } = await req.json();
        
        if (!Array.isArray(sessions)) {
          return new Response(JSON.stringify({ error: 'Sessions must be an array' }), {
            headers: { 'Content-Type': 'application/json' },
            status: 400,
          });
        }

        // Process and save sessions
        const processedSessions = sessions.map(session => ({
          ...session,
          user_id: user.id,
          created_at: session.createdAt ? new Date(session.createdAt).toISOString() : new Date().toISOString(),
          updated_at: session.updatedAt ? new Date(session.updatedAt).toISOString() : new Date().toISOString()
        }));

        const { error } = await supabaseClient
          .from('sessions')
          .insert(processedSessions)
          .select();

        if (error) {
          return new Response(JSON.stringify({ error: 'Failed to sync sessions', details: error.message }), {
            headers: { 'Content-Type': 'application/json' },
            status: 500,
          });
        }

        return new Response(JSON.stringify({
          success: true,
          message: 'Sessions synced successfully',
          count: processedSessions.length
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (pathname.endsWith('/prompts')) {
        // Sync prompts
        const { prompts } = await req.json();
        
        if (!Array.isArray(prompts)) {
          return new Response(JSON.stringify({ error: 'Prompts must be an array' }), {
            headers: { 'Content-Type': 'application/json' },
            status: 400,
          });
        }

        // Process and save prompts
        const processedPrompts = prompts.map(prompt => ({
          ...prompt,
          user_id: user.id,
          created_at: prompt.createdAt ? new Date(prompt.createdAt).toISOString() : new Date().toISOString()
        }));

        const { error } = await supabaseClient
          .from('prompt_shortcuts')
          .insert(processedPrompts)
          .select();

        if (error) {
          return new Response(JSON.stringify({ error: 'Failed to sync prompts', details: error.message }), {
            headers: { 'Content-Type': 'application/json' },
            status: 500,
          });
        }

        return new Response(JSON.stringify({
          success: true,
          message: 'Prompts synced successfully',
          count: processedPrompts.length
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
    } else if (req.method === 'GET' && pathname.endsWith('/data')) {
      // Get all synced data
      const { data: messages, error: messagesError } = await supabaseClient
        .from('messages')
        .select('*')
        .eq('user_id', user.id);

      if (messagesError) {
        return new Response(JSON.stringify({ error: 'Failed to get messages', details: messagesError.message }), {
          headers: { 'Content-Type': 'application/json' },
          status: 500,
        });
      }

      const { data: sessions, error: sessionsError } = await supabaseClient
        .from('sessions')
        .select('*')
        .eq('user_id', user.id);

      if (sessionsError) {
        return new Response(JSON.stringify({ error: 'Failed to get sessions', details: sessionsError.message }), {
          headers: { 'Content-Type': 'application/json' },
          status: 500,
        });
      }

      const { data: prompts, error: promptsError } = await supabaseClient
        .from('prompt_shortcuts')
        .select('*')
        .eq('user_id', user.id);

      if (promptsError) {
        return new Response(JSON.stringify({ error: 'Failed to get prompts', details: promptsError.message }), {
          headers: { 'Content-Type': 'application/json' },
          status: 500,
        });
      }

      return new Response(JSON.stringify({
        success: true,
        messages,
        sessions,
        prompts
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } else if (req.method === 'DELETE' && pathname.endsWith('/clear')) {
      // Clear all data for user
      const { error: messagesError } = await supabaseClient
        .from('messages')
        .delete()
        .eq('user_id', user.id);

      if (messagesError) {
        return new Response(JSON.stringify({ error: 'Failed to clear messages', details: messagesError.message }), {
          headers: { 'Content-Type': 'application/json' },
          status: 500,
        });
      }

      const { error: sessionsError } = await supabaseClient
        .from('sessions')
        .delete()
        .eq('user_id', user.id);

      if (sessionsError) {
        return new Response(JSON.stringify({ error: 'Failed to clear sessions', details: sessionsError.message }), {
          headers: { 'Content-Type': 'application/json' },
          status: 500,
        });
      }

      const { error: promptsError } = await supabaseClient
        .from('prompt_shortcuts')
        .delete()
        .eq('user_id', user.id);

      if (promptsError) {
        return new Response(JSON.stringify({ error: 'Failed to clear prompts', details: promptsError.message }), {
          headers: { 'Content-Type': 'application/json' },
          status: 500,
        });
      }

      return new Response(JSON.stringify({
        success: true,
        message: 'All data cleared successfully'
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 405,
    });
  } catch (error) {
    console.error('Error in sync function:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
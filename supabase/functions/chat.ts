// @ts-nocheck
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.1';

console.log('Chat completion edge function initialized');

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

    // Parse request body
    const { content, context, sessionId, images } = await req.json();

    if (!content) {
      return new Response(JSON.stringify({ error: 'Content is required' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    // Create a new message in the database
    const newMessage = {
      id: crypto.randomUUID(),
      session_id: sessionId || crypto.randomUUID(),
      role: 'user',
      content,
      context,
      tokens: content.length / 4, // Rough estimate
      timestamp: new Date().toISOString()
    };

    const { error: insertError } = await supabaseClient
      .from('messages')
      .insert([newMessage]);

    if (insertError) {
      return new Response(JSON.stringify({ error: 'Failed to save message', details: insertError.message }), {
        headers: { 'Content-Type': 'application/json' },
        status: 500,
      });
    }

    // TODO: Implement actual AI response generation
    // For now, returning a mock response
    const responseMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: `Echo: ${content}`,
      timestamp: Date.now(),
      tokens: content.length / 4 // Rough estimate
    };

    return new Response(JSON.stringify({
      success: true,
      data: responseMessage
    }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    console.error('Error in chat completion function:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
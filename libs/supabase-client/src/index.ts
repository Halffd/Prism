// Supabase Client Library for Prism
export * from './config';
export * from './auth';
export * from './db-service';
export * from './database.types';

// Explicitly export supabaseClient to ensure it's available
export { supabaseClient } from './config';
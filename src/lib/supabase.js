import { createClient } from "@supabase/supabase-js";
// Only the public anon key is used in the browser. Data access is enforced by Row Level Security.
const url = import.meta.env.VITE_SUPABASE_URL, key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const configured = Boolean(url && key);
export const supabase = configured ? createClient(url, key) : null;
console.log("Supabase configured:", configured);

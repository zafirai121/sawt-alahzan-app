import { createClient } from '@supabase/supabase-js';

// Read before the client starts: it signs in from the link's tokens and then
// clears them from the address bar
export const isPasswordRecovery = /[#&]type=recovery\b/.test(location.hash);

const supabaseUrl = 'https://ckhtndmrcypkqrpjlzli.supabase.co';
const supabaseKey = 'sb_publishable_8jeopxp1S7VUh8hj0B6syA_4rSIaJuN';

export const supabase = createClient(supabaseUrl, supabaseKey);

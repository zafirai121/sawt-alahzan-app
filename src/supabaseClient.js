import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://ckhtndmrcypkqrpjlzli.supabase.co';
const supabaseKey = 'sb_publishable_8jeopxp1S7VUh8hj0B6syA_4rSIaJuN';

export const supabase = createClient(supabaseUrl, supabaseKey);

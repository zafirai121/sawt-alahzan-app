import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const supabaseUrl = 'https://ckhtndmrcypkqrpjlzli.supabase.co'
const supabaseKey = 'sb_publishable_8jeopxp1S7VUh8hj0B6syA_4rSIaJuN'

export const supabase = createClient(supabaseUrl, supabaseKey)

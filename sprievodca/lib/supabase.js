const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

// Appka Supabase Realtime (WebSocket subscriptions) vôbec nepoužíva — len bežné REST volania
// (.from(), .rpc()). Klient si ale interne vytvára aj RealtimeClient hneď pri konštrukcii a na
// Node < 22 bez natívneho globálneho WebSocket to hodí "native WebSocket not found" a appka
// spadne pri štarte. Riešenie je presne to, čo navrhuje chybová hláška — dodať vlastnú WS
// implementáciu (balík "ws"), nech je jedno, akú verziu Node servera CloudPanel používa.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { realtime: { transport: WebSocket } }
);

module.exports = supabase;

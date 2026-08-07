import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import crypto from 'crypto';

const env = Object.fromEntries(readFileSync('/dev-server/.env','utf8').split('\n')
  .filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1).replace(/^"|"$/g,'')]}));

const url = env.VITE_SUPABASE_URL, key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const OWNER = 'verify-device-key-' + crypto.randomBytes(4).toString('hex');
const mine = createClient(url, key, { auth:{persistSession:false}, global:{headers:{'x-owner-key':OWNER}} });
const other = createClient(url, key, { auth:{persistSession:false}, global:{headers:{'x-owner-key':'someone-elses-key'}} });
const nokey = createClient(url, key, { auth:{persistSession:false} });

const profileUrl = 'https://www.linkedin.com/in/verify-' + Date.now();
const id = crypto.randomUUID();

// realtime: subscribe to my fingerprint before writing
const fp = crypto.createHash('sha256').update(OWNER).digest('hex');
let events = 0;
const ch = mine.channel('t').on('postgres_changes',
  { event:'INSERT', schema:'public', table:'sync_events', filter:`owner_fingerprint=eq.${fp}` },
  () => { events++; }).subscribe();
await new Promise(r=>setTimeout(r,2500));

const row = { id, owner_key: OWNER, full_name:'Verify User', profile_url: profileUrl, tags:['alpha','beta'], modified_at: new Date().toISOString() };
const ins = await mine.from('contacts').upsert(row, { onConflict:'owner_key,profile_url' }).select('id, modified_at').single();
console.log('insert:', ins.error?.message || 'ok', ins.data?.id === id ? '(same id)' : ins.data?.id);

// same profile url, new local uuid -> should merge into existing row
const dupId = crypto.randomUUID();
const dup = await mine.from('contacts').upsert({ ...row, id: dupId, full_name:'Verify Updated', modified_at:new Date().toISOString() }, { onConflict:'owner_key,profile_url' }).select('id, full_name, modified_at').single();
console.log('upsert-merge:', dup.error?.message || `id=${dup.data.id === id ? 'reused existing' : 'NEW ('+dup.data.id+')'} name=${dup.data.full_name}`);

console.log('modified_at advanced:', dup.data && dup.data.modified_at > ins.data.modified_at);

const mineRead = await mine.from('contacts').select('id,tags').eq('id', id);
console.log('own read:', mineRead.error?.message || `${mineRead.data.length} row, tags=${mineRead.data[0]?.tags}`);
const otherRead = await other.from('contacts').select('id').eq('id', id);
console.log('other-key read:', otherRead.error ? 'blocked: '+otherRead.error.message : `${otherRead.data.length} rows (expect 0)`);
const noKeyRead = await nokey.from('contacts').select('id');
console.log('no-key read:', noKeyRead.error ? 'blocked: '+noKeyRead.error.message : `${noKeyRead.data.length} rows (expect 0)`);
const spoof = await other.from('contacts').update({ full_name:'HACKED' }).eq('id', id).select();
console.log('cross-key update:', spoof.error ? 'blocked' : `${spoof.data.length} rows changed (expect 0)`);

await new Promise(r=>setTimeout(r,2000));
console.log('realtime markers received:', events);

const del = await mine.from('contacts').delete().eq('id', id);
console.log('delete:', del.error?.message || 'ok');
await mine.removeChannel(ch);
process.exit(0);

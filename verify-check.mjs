import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import crypto from 'crypto';
const env = Object.fromEntries(readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1).replace(/^"|"$/g,'')]}));
const OWNER='verify-'+crypto.randomBytes(4).toString('hex');
const mine=createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false},global:{headers:{'x-owner-key':OWNER}}});
const other=createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false},global:{headers:{'x-owner-key':'not-my-key'}}});
const pu='https://www.linkedin.com/in/verify-'+Date.now();

// replicate sync-engine push: update-then-insert
async function push(row){
  const { id, ...updatable } = row;
  const up = await mine.from('contacts').update(updatable).eq('owner_key',OWNER).eq('profile_url',row.profile_url).lte('modified_at',row.modified_at).select('id,modified_at');
  if (up.error) return {err:up.error.message};
  if (up.data.length) return {path:'update', ...up.data[0]};
  const ex = await mine.from('contacts').select('id,modified_at').eq('owner_key',OWNER).eq('profile_url',row.profile_url).maybeSingle();
  if (ex.error) return {err:ex.error.message};
  if (ex.data) return {path:'remote-newer-skip', ...ex.data};
  const ins = await mine.from('contacts').insert(row).select('id,modified_at').single();
  if (ins.error) return {err:ins.error.message};
  return {path:'insert', ...ins.data};
}

const localId = crypto.randomUUID();
const base = { id: localId, owner_key:OWNER, full_name:'Verify User', profile_url:pu, tags:['alpha'], modified_at:new Date().toISOString() };
const r1 = await push(base); console.log('1st push:', r1.err||`${r1.path} id=${r1.id===localId?'local id kept':'other'}`);
const r2 = await push({ ...base, id: crypto.randomUUID(), full_name:'Verify Edited', tags:['alpha','beta'], modified_at:new Date(Date.now()+1000).toISOString() });
console.log('2nd push (edit, new local id):', r2.err||`${r2.path} pk-stable=${r2.id===r1.id}`);
const r3 = await push({ ...base, full_name:'Stale Edit', modified_at:new Date(Date.now()-60000).toISOString() });
console.log('stale push:', r3.err||r3.path);
const now = await mine.from('contacts').select('full_name,tags').eq('id',r1.id).single();
console.log('final row:', now.error?.message||JSON.stringify(now.data), '(expect Verify Edited)');
const o1 = await other.from('contacts').select('id').eq('id',r1.id); console.log('other-key read:', o1.data?.length, 'rows (expect 0)');
const o2 = await other.from('contacts').update({full_name:'HACKED'}).eq('id',r1.id).select(); console.log('other-key update:', o2.data?.length ?? o2.error.message, 'rows (expect 0)');
console.log('delete:', (await mine.from('contacts').delete().eq('id',r1.id)).error?.message||'ok');
process.exit(0);

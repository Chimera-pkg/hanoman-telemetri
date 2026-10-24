import {useEffect,useState} from 'react';
import {Brain,Check,CloudOff,RefreshCcw} from 'lucide-react';
import {api,isNative} from './lib/api';
import type {MemoryInfo} from './types';

const MAX_CHARS=8000;
const emptyMemory:MemoryInfo={workspace:'',conversation:'',messages:0,recent:0,digest:0};

/**
 * Durable memory editor. The Rust layer injects these notes (plus a digest of turns that fall
 * outside the replay window) into every chat request, so the text is context — not a scratchpad.
 * With `conversationId` the note belongs to that thread; without it, to the whole workspace.
 */
export function MemoryPanel({conversationId,compact=false,notify}:{conversationId?:string|null;compact?:boolean;notify?:(message:string)=>void}){
 const scope=compact?conversationId??null:null;
 const [info,setInfo]=useState<MemoryInfo>(emptyMemory);
 const [text,setText]=useState('');
 const [loading,setLoading]=useState(true);
 const [saving,setSaving]=useState(false);
 const [saved,setSaved]=useState(false);
 const [error,setError]=useState('');
 const stored=scope?info.conversation:info.workspace;
 useEffect(()=>{
  let active=true;setLoading(true);setError('');setSaved(false);
  api.getMemory(scope).then(next=>{if(!active)return;setInfo(next);setText(scope?next.conversation:next.workspace);})
   .catch(e=>{if(active)setError(String(e))}).finally(()=>{if(active)setLoading(false)});
  return()=>{active=false};
 },[scope]);
 const save=async()=>{
  if(!isNative){notify?.('Memori hanya tersimpan di aplikasi desktop.');return;}
  setSaving(true);setError('');
  try{
   const next=await api.saveMemory(scope,scope?info.workspace:text,scope?text:'');
   setInfo(next);setText(scope?next.conversation:next.workspace);setSaved(true);notify?.('Memori tersimpan.');
  }catch(e){setError(String(e));}finally{setSaving(false)}
 };
 return <div className={`memory-panel ${compact?'is-compact':''}`}>
  <div className="memory-panel-head"><span className="memory-panel-icon"><Brain size={compact?15:17}/></span><div><strong>{scope?'Memori percakapan':'Memori workspace'}</strong><p>{scope?'Hanya dikirim pada percakapan ini.':'Dikirim pada setiap percakapan.'}</p></div>{loading&&<RefreshCcw size={14} className="spin"/>}</div>
  <label className="memory-field"><span>Catatan <small>{text.length.toLocaleString('id-ID')}/{MAX_CHARS.toLocaleString('id-ID')}</small></span><textarea rows={compact?4:5} maxLength={MAX_CHARS} value={text} disabled={!isNative||(compact&&!scope)} placeholder={scope?'Fakta, keputusan, atau preferensi yang harus diingat pada percakapan ini…':'Konteks tetap: gaya penulisan, istilah internal, atau aturan yang berlaku di semua percakapan…'} onChange={e=>{setText(e.target.value);setSaved(false)}}/></label>
  {scope&&info.messages>0&&<div className="memory-stats"><span>{info.messages.toLocaleString('id-ID')} pesan</span><span>{info.recent} diputar penuh</span><span>{info.digest} diringkas</span></div>}
  {!isNative&&<div className="memory-note"><CloudOff size={14}/><span>Pratinjau browser: memori hanya dapat diubah di aplikasi desktop.</span></div>}
  {error&&<div className="inline-error">{error}</div>}
  <div className="memory-actions"><button type="button" className="btn btn-quiet" disabled={saving||text===stored||!isNative} onClick={()=>{setText(stored);setSaved(false)}}>Batalkan</button><button type="button" className="btn btn-secondary" disabled={saving||text===stored||!isNative} onClick={()=>void save()}>{saving?<RefreshCcw size={14} className="spin"/>:saved?<Check size={14}/>:<Brain size={14}/>} {saving?'Menyimpan…':saved?'Tersimpan':'Simpan memori'}</button></div>
 </div>;
}

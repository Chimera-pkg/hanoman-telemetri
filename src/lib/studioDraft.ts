import {newReport,newSubject,normalizeReport,normalizeSubject,type ReportRecord,type SubjectRecord} from './documents';

export type StudioMode='reports'|'subjects';
export type StudioTab='identity'|'profile'|'content';

export interface StudioDraft {
 subject:SubjectRecord;
 report:ReportRecord;
 tab:StudioTab;
 savedAt:string;
}
export interface DraftSaveResult { ok:boolean; at?:string; reason?:string; }

const key=(mode:StudioMode)=>`hanoman-studio-draft-${mode}`;
const isTab=(v:unknown):v is StudioTab=>v==='identity'||v==='profile'||v==='content';
const storage=():Storage|null=>{try{return typeof localStorage==='undefined'?null:localStorage;}catch{return null;}};

/** Restore the last local draft. Corrupt or legacy payloads fall back to a fresh record. */
export function loadDraft(mode:StudioMode):StudioDraft|null {
 const store=storage();if(!store)return null;
 const raw=store.getItem(key(mode));if(!raw)return null;
 try{
  const parsed=JSON.parse(raw) as Partial<StudioDraft>;
  const subject=normalizeSubject(parsed.subject??{});
  const report=normalizeReport(parsed.report??{},subject.id);
  return {subject,report,tab:isTab(parsed.tab)?parsed.tab:'identity',savedAt:typeof parsed.savedAt==='string'?parsed.savedAt:new Date().toISOString()};
 }catch{store.removeItem(key(mode));return null;}
}

/**
 * Persist the working draft. Photos are dropped when the browser quota is exceeded so the
 * textual work still survives; the caller surfaces that trade-off to the user.
 */
export function saveDraft(mode:StudioMode,draft:{subject:SubjectRecord;report:ReportRecord;tab:StudioTab}):DraftSaveResult {
 const store=storage();if(!store)return {ok:false,reason:'Penyimpanan browser tidak tersedia.'};
 const at=new Date().toISOString();
 try{store.setItem(key(mode),JSON.stringify({...draft,savedAt:at}));return {ok:true,at};}
 catch{
  try{
   const light={...draft,subject:{...draft.subject,photoDataUrl:'',supportDataUrl:''},savedAt:at};
   store.setItem(key(mode),JSON.stringify(light));
   return {ok:true,at,reason:'Foto tidak ikut tersimpan otomatis (batas penyimpanan browser). Klik "Simpan draf" agar foto masuk ke basis data lokal.'};
  }catch{return {ok:false,reason:'Draf otomatis tidak dapat disimpan: penyimpanan browser penuh.'};}
 }
}

export function clearDraft(mode:StudioMode){const store=storage();if(store)store.removeItem(key(mode));}

/** True when the working record differs from an empty template (dates and default bidang do not count). */
export function hasDraftContent(subject:SubjectRecord,report:ReportRecord):boolean {
 const baseSubject=newSubject();
 const baseReport=newReport('');
 const subjectDirty=(Object.keys(baseSubject) as (keyof SubjectRecord)[]).some(k=>k!=='id'&&subject[k]!==baseSubject[k]&&String(subject[k]??'').trim()!=='');
 const reportDirty=(Object.keys(baseReport) as (keyof ReportRecord)[]).some(k=>{
  if(k==='id'||k==='subjectId')return false;
  const value=report[k],base=baseReport[k];
  if(Array.isArray(value)&&Array.isArray(base))return value.some((item,i)=>item!==base[i]&&String(item??'').trim()!=='');
  return value!==base&&String(value??'').trim()!=='';
 });
 return subjectDirty||reportDirty;
}

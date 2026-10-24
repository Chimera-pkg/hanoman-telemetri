/** Structured data for local-first Word and PowerPoint template rendering. */
export interface SubjectRecord {
  id:string; fullName:string; birthPlace:string; birthDate:string; profession:string;
  institution:string; faculty:string; education:string; issue:string; role:string;
  shortBackground:string; summary:string; background:string; events:string;
  affiliations:string; issueContext:string; publicActivity:string; regions:string;
  photoDataUrl:string; supportDataUrl:string;
}
export interface ReportRecord {
  id:string; subjectId:string; reportNumber:string; field:string; subjectLine:string;
  activityDate:string; factsIntro:string; profiling:string[]; analysis:string[];
  reporterOpinion:string; recommendations:string[]; signedDate:string;
}
const makeId=()=>globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
export const newSubject=():SubjectRecord=>({id:makeId(),fullName:'',birthPlace:'',birthDate:'',profession:'',institution:'',faculty:'',education:'',issue:'',role:'',shortBackground:'',summary:'',background:'',events:'',affiliations:'',issueContext:'',publicActivity:'',regions:'',photoDataUrl:'',supportDataUrl:''});
export const newReport=(subjectId:string):ReportRecord=>({id:makeId(),subjectId,reportNumber:'',field:'Politik, Ekonomi dan Sosbud',subjectLine:'',activityDate:today(),factsIntro:'',profiling:Array(5).fill(''),analysis:Array(4).fill(''),reporterOpinion:'',recommendations:Array(4).fill(''),signedDate:today()});
export function normalizeSubject(obj:Partial<SubjectRecord>):SubjectRecord{return {...newSubject(),...obj,id:obj.id||makeId()};}
export function normalizeReport(obj:Partial<ReportRecord>,subjectId:string):ReportRecord {
 const base=newReport(subjectId);
 return {...base,...obj,id:obj.id||makeId(),subjectId,profiling:Array.from({length:5},(_,i)=>obj.profiling?.[i]||''),analysis:Array.from({length:4},(_,i)=>obj.analysis?.[i]||''),recommendations:Array.from({length:4},(_,i)=>obj.recommendations?.[i]||'')};
}

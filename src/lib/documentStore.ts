import {invoke} from '@tauri-apps/api/core';
import {isNative} from './api';
import type {SubjectRecord,ReportRecord} from './documents';
// In browser preview, data exists in memory only. Native Tauri saves records in local SQLite.
let sampleSubjects:SubjectRecord[]=[];
let sampleReports:ReportRecord[]=[];
export const documentStore={
 listSubjects:():Promise<SubjectRecord[]>=>isNative?invoke<SubjectRecord[]>('list_subject_records'):Promise.resolve([...sampleSubjects]),
 listReports:():Promise<ReportRecord[]>=>isNative?invoke<ReportRecord[]>('list_report_records'):Promise.resolve([...sampleReports]),
 saveSubject:async(s:SubjectRecord)=>{if(isNative)await invoke('save_subject_record',{record:s});else sampleSubjects=[s,...sampleSubjects.filter(x=>x.id!==s.id)];},
 saveReport:async(r:ReportRecord)=>{if(isNative)await invoke('save_report_record',{record:r});else sampleReports=[r,...sampleReports.filter(x=>x.id!==r.id)];},
 deleteSubject:async(id:string)=>{if(isNative)await invoke('delete_subject_record',{subjectId:id});else {sampleSubjects=sampleSubjects.filter(x=>x.id!==id);sampleReports=sampleReports.filter(x=>x.subjectId!==id);}},
};

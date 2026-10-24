import {useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {Activity,AlertCircle,BookOpen,Check,CheckCircle2,ChevronRight,ClipboardList,Download,FilePenLine,FileText,HardDrive,Image as ImageIcon,Layers,LockKeyhole,Plus,Presentation,Save,Shield,Trash2,Upload,UserRound, X} from 'lucide-react';
import {isNative} from './lib/api';
import {newReport,newSubject,normalizeReport,normalizeSubject,type SubjectRecord,type ReportRecord} from './lib/documents';
import {documentStore} from './lib/documentStore';
import {downloadBlob,idDate,makePowerPoint,makeWord,safeFileName,validateDocument} from './lib/documentEngine';
import {clearDraft,hasDraftContent,loadDraft,saveDraft,type StudioTab} from './lib/studioDraft';

type Mode='reports'|'subjects';
type Tab=StudioTab;
const ID_FIELDS:{label:string;key:keyof SubjectRecord;hint?:string;wide?:boolean}[]=[
 {label:'Nama lengkap',key:'fullName',wide:true},{label:'Tempat lahir',key:'birthPlace'},{label:'Tanggal lahir',key:'birthDate'},
 {label:'Profesi',key:'profession'},{label:'Institusi',key:'institution'},
 {label:'Fakultas / unit',key:'faculty'},{label:'Pendidikan',key:'education'},
 {label:'Peran / jabatan',key:'role'},{label:'Isu yang disoroti',key:'issue',wide:true},
 ];
const PROFILE_FIELDS:{label:string;key:keyof SubjectRecord;help:string}[]=[
 {label:'Anteseden singkat',key:'shortBackground',help:'Untuk slide profil 2'},
 {label:'Profil singkat',key:'summary',help:'Untuk slide profil 3'},
 {label:'Riwayat dan latar belakang',key:'background',help:'Catat fakta bersumber yang relevan'},
 {label:'Riwayat peristiwa',key:'events',help:'Satu poin tiap baris'},
 {label:'Afiliasi terverifikasi',key:'affiliations',help:'Batasi pada keterkaitan kelembagaan yang terdokumentasi'},
 {label:'Keterkaitan isu',key:'issueContext',help:'Satu poin tiap baris'},
 {label:'Aktivitas publik',key:'publicActivity',help:'Aktivitas dan karya yang terdokumentasi, satu poin tiap baris'},
 {label:'Wilayah yang relevan',key:'regions',help:'Lokasi penelitian/kegiatan publik, bukan pemantauan lokasi pribadi'},
];
async function imageToPng(file:File,mode:'photo'|'support'):Promise<string>{
 if(!/^image\//.test(file.type)&&!(file.type===''&&/\.(png|jpe?g|webp)$/i.test(file.name)))throw new Error('Pilih gambar PNG, JPG atau WebP.');
 if(file.size>8_000_000)throw new Error('File foto maksimal 8MB.');
 // Read the file as a data URL instead of URL.createObjectURL: the desktop build CSP
 // did not allow `blob:` in img-src, so blob: URLs failed to decode ("Gambar tidak dapat dibaca.").
 // data: is allowed by both the shipped CSP and every WebView, so this path is CSP-proof.
 const source=await new Promise<string>((resolve,reject)=>{
  const reader=new FileReader();
  reader.onload=()=>resolve(String(reader.result));
  reader.onerror=()=>reject(new Error('Gambar tidak dapat dibaca.'));
  reader.readAsDataURL(file);
 });
 const image=await new Promise<HTMLImageElement>((resolve,reject)=>{const img=new window.Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('Gambar tidak dapat dibaca.'));img.src=source;});
 const w=mode==='photo'?328:1002,h=mode==='photo'?391:913;
 const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
 const context=canvas.getContext('2d');if(!context)throw new Error('Image canvas unavailable.');
 const ratio=Math.max(w/image.naturalWidth,h/image.naturalHeight),cw=w/ratio,ch=h/ratio;
 context.fillStyle='#eeeeec';context.fillRect(0,0,w,h);
 context.drawImage(image,(image.naturalWidth-cw)/2,(image.naturalHeight-ch)/2,cw,ch,0,0,w,h);
 return canvas.toDataURL('image/png');
}
function Field({label,children,hint}:{label:string;children:ReactNode;hint?:string}){return <label className="studio-field"><span>{label}</span>{children}{hint&&<small>{hint}</small>}</label>}
function TextArea({value,onChange,rows=3,placeholder}:{value:string;onChange:(s:string)=>void;rows?:number;placeholder?:string}){
 return <textarea rows={rows} value={value} placeholder={placeholder||'Ketik informasi yang terverifikasi...'} onChange={e=>onChange(e.target.value)}/>;
}
function CardHeader({number,title,subtitle}:{number:string;title:string;subtitle?:string}){return <div className="studio-card-header"><span className="studio-step">{number}</span><div><h3>{title}</h3>{subtitle&&<p>{subtitle}</p>}</div></div>}
function ArrayInputs({name,items,change}:{name:string;items:string[];change:(a:string[])=>void}){return <div className="studio-array">{items.map((item,i)=><Field key={i} label={`${name} ${i+1}`}><TextArea rows={3} value={item} onChange={value=>change(items.map((t,k)=>k===i?value:t))} placeholder={`Isi ${name.toLowerCase()} nomor ${i+1} (boleh kosong)`}/></Field>)}</div>}
export default function DocumentStudio({mode}:{mode:Mode}){
 const restored=useRef(loadDraft(mode));
 const [savedSubjects,setSavedSubjects]=useState<SubjectRecord[]>([]);
 const [savedReports,setSavedReports]=useState<ReportRecord[]>([]);
 const [subject,setSubject]=useState<SubjectRecord>(()=>restored.current?.subject??newSubject());
 const [report,setReport]=useState<ReportRecord>(()=>restored.current?.report??newReport(''));
 const [tab,setTab]=useState<Tab>(()=>restored.current?.tab??'identity');
 const [notice,setNotice]=useState(()=>restored.current?`Draf lokal dipulihkan (${new Date(restored.current.savedAt).toLocaleString('id-ID')}).`:'');
 const [draftState,setDraftState]=useState<'idle'|'saved'|'error'>(restored.current?'saved':'idle');
 const [draftAt,setDraftAt]=useState<string|null>(restored.current?.savedAt??null);
 const [busy,setBusy]=useState(false);
 const uploadPhoto=useRef<HTMLInputElement>(null);
 const hydrated=useRef(false);
 const isReport=mode==='reports';
 useEffect(()=>{let active=true;void Promise.all([documentStore.listSubjects(),documentStore.listReports()]).then(([s,r])=>{if(!active)return;setSavedSubjects(s);setSavedReports(r);}).catch(e=>setNotice(String(e)));return()=>{active=false}},[]);
 // Autosave the working draft so a reload, crash or navigation never loses typed content.
 useEffect(()=>{
  if(!hydrated.current){hydrated.current=true;return;}
  if(!hasDraftContent(subject,report)){clearDraft(mode);setDraftState('idle');setDraftAt(null);return;}
  const timer=window.setTimeout(()=>{
   const result=saveDraft(mode,{subject,report:{...report,subjectId:subject.id},tab});
   if(result.ok){setDraftState('saved');setDraftAt(result.at??new Date().toISOString());if(result.reason)setNotice(result.reason);}
   else{setDraftState('error');setNotice(result.reason??'Draf otomatis gagal disimpan.');}
  },500);
  return()=>window.clearTimeout(timer);
 },[mode,subject,report,tab]);
 const edit=(key:keyof SubjectRecord,value:string)=>setSubject(x=>({...x,[key]:value}));
 const editR=(key:keyof ReportRecord,value:string)=>setReport(x=>({...x,[key]:value}));
 const changeArray=(key:'profiling'|'analysis'|'recommendations',items:string[])=>setReport(x=>({...x,[key]:items}));
 const selectSubject=(id:string)=>{
  const found=savedSubjects.find(x=>x.id===id);
  if(!found)return;
  const normalized=normalizeSubject(found);
  setSubject(normalized);
  const old=savedReports.find(x=>x.subjectId===id);
  setReport(old?normalizeReport(old,id):newReport(id));
  setTab('identity');setNotice('');
 };
 const clear=()=>{const fresh=newSubject();setSubject(fresh);setReport(newReport(fresh.id));setTab('identity');clearDraft(mode);setDraftState('idle');setDraftAt(null);setNotice('Draf baru. Isi nama subjek, kemudian simpan.')};
 const save=async()=>{
  if(!subject.fullName.trim()){setNotice('Isi nama lengkap sebelum menyimpan.');return;}
  setBusy(true);
  try{const r={...report,subjectId:subject.id};await documentStore.saveSubject(subject);await documentStore.saveReport(r);
   const [s,rr]=await Promise.all([documentStore.listSubjects(),documentStore.listReports()]);setSavedSubjects(s);setSavedReports(rr);setReport(r);
   clearDraft(mode);setDraftState('idle');setDraftAt(null);
   setNotice(isNative?'Tersimpan ke SQLite lokal.':'Tersimpan sementara di memori browser, tidak permanen.');
  }catch(e){setNotice('Gagal menyimpan: '+String(e))}finally{setBusy(false)}
 };
 const remove=async()=>{if(!savedSubjects.some(x=>x.id===subject.id)){clear();return;}if(!window.confirm('Hapus subject ini beserta seluruh draf laporannya?'))return;
  try{await documentStore.deleteSubject(subject.id);setSavedSubjects(await documentStore.listSubjects());setSavedReports(await documentStore.listReports());clear();}catch(e){setNotice(String(e))}
 };
 const generate=async(kind:'word'|'pptx'|'both')=>{
  const problems=validateDocument(subject,kind==='word'?report:undefined);
  if(problems.length){setNotice(problems.join(' · '));return;}
  setBusy(true);setNotice('');
  try{
   const saveFile=async(blob:Blob,name:string)=>{if(isNative){const bytes=Array.from(new Uint8Array(await blob.arrayBuffer()));return invoke<string>('save_office_export',{fileName:name,data:bytes});}downloadBlob(blob,name);return name;};
   const paths:string[]=[];
   const basename=`${safeFileName(subject.fullName)}_${report.activityDate||'report'}`;
   if(kind==='word'||kind==='both'){const doc=await makeWord(subject,report);paths.push(await saveFile(doc,`Laporan_Informasi_${basename}.docx`));}
   if(kind==='pptx'||kind==='both'){const ppt=await makePowerPoint(subject,report);paths.push(await saveFile(ppt,`Subject_${basename}.pptx`));}
   setNotice(`File berhasil dibuat: ${paths.join(' · ')}. Periksa tata letak, isi, dan pengesahan sebelum digunakan.`);
  }catch(e){setNotice('Ekspor gagal: '+String(e));}finally{setBusy(false)}
 };
 const loadImage=async(file:File|undefined,key:'photoDataUrl'|'supportDataUrl')=>{if(!file)return;try{const url=await imageToPng(file,key==='photoDataUrl'?'photo':'support');edit(key,url);setNotice('Foto masuk ke draf. Klik Simpan jika ingin menyimpannya.');}catch(e){setNotice(String(e));}};
 const completed=useMemo(()=>[subject.fullName,subject.profession,subject.institution,subject.shortBackground,subject.summary,report.factsIntro].filter(x=>Boolean(x.trim())).length,[subject,report]);
 return <div className="studio-page">
  <div className="studio-heading"><div className="eyebrow">WORKSPACE / DOCUMENT STUDIO / {isReport?'REPORTS':'SUBJECTS'}</div><h1>{isReport?'Laporan Informasi':'Subject Studio'}</h1><p>{isReport?'Susun laporan Word menggunakan format template tetap dan konten yang kamu tinjau.':'Kelola identitas, foto, profil dan anteseden untuk lima slide PowerPoint.'}</p></div>
  <div className="studio-banner"><LockKeyhole size={17}/><span><b>Local-first documents.</b> Tidak ada data pada halaman ini yang dikirim otomatis ke provider AI. {isNative?'Draf tersimpan di SQLite lokal (belum terenkripsi saat tidak digunakan).':'Mode browser hanya menyimpan draf sementara selama halaman aktif.'}</span></div>
  <div className="studio-top-actions"><Field label="Pilih subjek tersimpan"><select value={savedSubjects.some(x=>x.id===subject.id)?subject.id:''} onChange={e=>selectSubject(e.target.value)}><option value="">{subject.fullName&&!savedSubjects.some(x=>x.id===subject.id)?'Draf baru (belum tersimpan)':'Pilih subject…'}</option>{savedSubjects.map(s=><option key={s.id} value={s.id}>{s.fullName}</option>)}</select></Field><span className={`studio-draft-state ${draftState}`} role="status">{draftState==='saved'?<><Check size={13}/> Draf lokal tersimpan {draftAt&&new Date(draftAt).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'})}</>:draftState==='error'?<><AlertCircle size={13}/> Draf lokal gagal disimpan</>:<>Belum ada draf lokal</>}</span><button className="btn btn-quiet" onClick={clear}><Plus size={15}/> Subject baru</button><button className="btn btn-quiet" onClick={remove}><Trash2 size={15}/> Hapus</button><button className="btn btn-primary" onClick={save} disabled={busy}><Save size={16}/> Simpan draf</button></div>
  <div className="studio-grid"><div className="studio-workspace">
   {isReport?<>
    <section className="studio-card"><CardHeader number="01" title="Subjek laporan" subtitle="Mengisi tabel identitas pada DOCX — atau pilih subjek tersimpan di atas"/><div className="studio-form-grid">{ID_FIELDS.map(field=><Field key={field.key} label={field.label}><input type={field.key==='birthDate'?'date':'text'} value={String(subject[field.key]||'')} onChange={e=>edit(field.key,e.target.value)}/></Field>)}</div><small className="studio-inline-hint">Profil naratif untuk slide PowerPoint diisi di halaman Subject Studio.</small></section>
    <section className="studio-card"><CardHeader number="02" title="Metadata laporan" subtitle="Judul, nomor surat, bidang, tanggal dan perihal"/><div className="studio-form-grid">
     <Field label="Nomor R / ... / LAPINFO"><input value={report.reportNumber} placeholder="Kosongkan jika belum ditetapkan" onChange={e=>editR('reportNumber',e.target.value)}/></Field>
     <Field label="Bidang"><input value={report.field} onChange={e=>editR('field',e.target.value)}/></Field>
     <Field label="Tanggal kegiatan"><input type="date" value={report.activityDate} onChange={e=>editR('activityDate',e.target.value)}/></Field>
     <Field label="Tanggal penandatanganan"><input type="date" value={report.signedDate} onChange={e=>editR('signedDate',e.target.value)}/></Field>
     <Field label="Masalah / perihal"><input value={report.subjectLine} placeholder="Nama subject — deskripsi perihal" onChange={e=>editR('subjectLine',e.target.value)}/></Field>
    </div></section>
    <section className="studio-card"><CardHeader number="03" title="Fakta dan hasil profiling" subtitle="Isi berdasar materi faktual, bukan teks hasil tebakan"/><Field label="Fakta-Fakta (narasi pembuka)"><TextArea rows={5} value={report.factsIntro} onChange={t=>editR('factsIntro',t)} placeholder="Tuliskan tanggal, waktu, kegiatan dan ringkasan fakta yang benar-benar diketahui."/></Field><h4 className="studio-subheading">Hasil Profiling — maksimal 5 paragraf pada template ini</h4><ArrayInputs name="Paragraf" items={report.profiling} change={arr=>changeArray('profiling',arr)}/></section>
    <section className="studio-card"><CardHeader number="04" title="Analisa" subtitle="Empat slot mengikuti penomoran master DOCX"/><ArrayInputs name="Analisa" items={report.analysis} change={arr=>changeArray('analysis',arr)}/></section>
    <section className="studio-card"><CardHeader number="05" title="Pendapat pelapor dan rekomendasi"/><Field label="Pendapat pelapor"><TextArea value={report.reporterOpinion} onChange={t=>editR('reporterOpinion',t)} rows={5}/></Field><h4 className="studio-subheading">Rekomendasi — maksimal 4 butir pada template</h4><ArrayInputs name="Rekomendasi" items={report.recommendations} change={arr=>changeArray('recommendations',arr)}/></section>
   </>:<>
    <div className="studio-tabs">{([{id:'identity',name:'Identitas'},{id:'profile',name:'Profil & Anteseden'},{id:'content',name:'Konten PPT'}] as const).map(t=><button key={t.id} onClick={()=>setTab(t.id)} className={tab===t.id?'selected':''}>{t.name}</button>)}</div>
    {tab==='identity'&&<section className="studio-card"><CardHeader number="01" title="Data identitas subjek" subtitle="Dipakai bersama oleh tabel Word dan PowerPoint"/><div className="studio-form-grid">{ID_FIELDS.map(field=><Field key={field.key} label={field.label}><input type={field.key==='birthDate'?'date':'text'} value={String(subject[field.key]||'')} onChange={e=>edit(field.key,e.target.value)}/></Field>)}</div>
       <div className="studio-media-row"><div className="studio-photo">{subject.photoDataUrl?<img src={subject.photoDataUrl} alt="Foto subjek"/>:<UserRound size={38}/>}</div><div className="studio-media-controls"><strong>Foto subject</strong><p>Dipakai otomatis untuk foto pada DOCX dan slide PowerPoint. PNG/JPG/WebP, maks. 8 MB. Jangan mengunggah foto tanpa hak penggunaan.</p><button className="btn btn-quiet" onClick={()=>uploadPhoto.current?.click()}><Upload size={15}/> Pilih foto</button>{subject.photoDataUrl&&<button className="btn btn-quiet" onClick={()=>edit('photoDataUrl','')}><X size={15}/> Kosongkan</button>}<input ref={uploadPhoto} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{void loadImage(e.target.files?.[0],'photoDataUrl');e.currentTarget.value='';}}/></div></div>
     </section>}
    {tab==='profile'&&<section className="studio-card"><CardHeader number="02" title="Profil dan anteseden" subtitle="Field konten disalin langsung ke shape yang sesuai pada master slide"/>{PROFILE_FIELDS.map(field=><Field key={field.key} label={field.label} hint={field.help}><TextArea rows={field.key==='shortBackground'?5:4} value={String(subject[field.key]||'')} onChange={t=>edit(field.key,t)}/></Field>)}</section>}
    {tab==='content'&&<section className="studio-card"><CardHeader number="03" title="Sinkronisasi slide" subtitle="Slide 4 dan 5 terhubung dengan isi laporan Word"/><div className="studio-sync-notice"><CheckCircle2 size={18}/><div><strong>Konten tersinkron</strong><p>Slide 4 otomatis mengambil poin Analisa dan slide 5 mengambil poin Rekomendasi dari form Laporan Informasi. Foto subjek dipakai di ketiga slide pertama; gambar asli yang tidak berkaitan telah dikeluarkan dari master.</p></div></div></section>}
   </>}
  </div><aside className="studio-aside">
   <section className="studio-card studio-side"><CardHeader number="H" title="Master template"/><div className="studio-fact"><span>Word</span><strong>Laporan Informasi (4 halaman asli)</strong></div><div className="studio-fact"><span>PowerPoint</span><strong>5 slide · 16:9</strong></div><div className="studio-fact"><span>Field siap</span><strong>{completed}/6 bagian inti</strong></div><div className="studio-fact"><span>Penandatangan</span><strong>Dantim Jaknik · nama/pangkat master tetap</strong></div><div className="studio-fact"><span>Tanda tangan</span><strong>DOCX · pindaian 3,2 cm</strong></div><div className="studio-approval"><Shield size={15}/><span>Tanda tangan pindaian ditempel otomatis pada celah di atas nama penandatangan. Dokumen ekspor tetap draf yang harus ditinjau dan disahkan pihak berwenang.</span></div></section>
   <section className="studio-card studio-side"><CardHeader number="↓" title="Ekspor Office" subtitle="Buat dokumen dengan template asli yang sudah disiapkan"/>
    <div className="studio-export"><button className="btn btn-primary" disabled={busy} onClick={()=>void generate('word')}><FileText size={16}/> Generate DOCX <Download size={15}/></button><button className="btn btn-secondary" disabled={busy} onClick={()=>void generate('pptx')}><Presentation size={16}/> Generate PPTX <Download size={15}/></button><button className="btn btn-quiet" disabled={busy} onClick={()=>void generate('both')}><Layers size={16}/> Export keduanya</button></div><small>File yang diunduh belum otomatis disimpan sebagai versi arsip. Pemeriksaan visual setelah ekspor tetap diperlukan.</small>
   </section>
   <section className="studio-card studio-side"><CardHeader number="i" title="Document preview"/><p className="studio-preview-note">Ringkasan data terisi — bukan render halaman Word/slide yang sebenarnya.</p><div className="studio-mini-doc"><div className="studio-doc-top">RAHASIA</div><div className="studio-doc-title">{isReport?'LAPORAN INFORMASI':'PROFIL SUBJEK'}</div><div className="studio-doc-row"><b>SUBJEK</b><span>{subject.fullName||'—'}</span></div><div className="studio-doc-row"><b>PERIHAL</b><span>{report.subjectLine||subject.issue||'—'}</span></div><div className="studio-doc-row"><b>BIDANG</b><span>{report.field||'—'}</span></div><div className="studio-doc-row"><b>TANGGAL</b><span>{idDate(report.signedDate)}</span></div><div className="studio-doc-footer">DRAF · BELUM DISAHKAN</div></div></section>
  </aside></div>
  {notice&&<div className="studio-alert" role="status"><AlertCircle size={17}/><span>{notice}</span><button aria-label="Tutup notifikasi" onClick={()=>setNotice('')}><X size={15}/></button></div>}
 </div>
}

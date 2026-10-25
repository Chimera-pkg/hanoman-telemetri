import JSZip from 'jszip';
import type {ReportRecord,SubjectRecord} from './documents';

const XML_PART_DOC='word/document.xml';
const XML_PART_RELS='word/_rels/document.xml.rels';
const SIGNATURE_IMAGE='signature.png';
const PART_CORE='docProps/core.xml';
const PART_APP='docProps/app.xml';
const PPT_THUMBNAIL='docProps/thumbnail.jpeg';
const PPT_PHOTO='ppt/media/image1.png';
const PPT_SUPPORT='ppt/media/image2.png';
const DOC_PHOTO='word/media/image1.png';
// The masters were authored with a real subject inside them. Every export rewrites the picture
// parts and the cover thumbnail so a document can never inherit a person from the template.
const PHOTO_SIZE=[328,391] as const;
const SUPPORT_SIZE=[1002,913] as const;
const THUMB_SIZE=[256,144] as const;
const PLACEHOLDER_FILL='#eeeeec';
// The signer block in the master reserves one empty paragraph between the role line and the
// signer name. The scanned signature is centred in that gap so the printed report matches the
// layout of a hand-signed original.
const SIGNATURE_ANCHOR_ROLE='Dantim Jaknik,';
const SIGNATURE_WIDTH_EMU=1150000;
function fail(m:string):never{throw new Error(m);}
function escapeXml(value:string):string{return value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');}
const upper=(s:string)=>s.toLocaleUpperCase('id-ID');
export function idDate(s:string,weekday=false):string {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return s.trim()||'—';
  const d=new Date(`${s}T12:00:00`);
  if(isNaN(d.getTime()))return s;
  return new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'long',year:'numeric',...(weekday?{weekday:'long' as const}:{})}).format(d);
}
const birthLine=(subject:SubjectRecord)=>[subject.birthPlace,idDate(subject.birthDate)].filter(x=>x&&x!=='—').join(', ');
const monthRoman=(s:string)=>['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'][Math.max(0,Math.min(11,Number(s.slice(5,7))-1))];
function subjectValues(s:SubjectRecord):Record<string,string>{return {
 full_name:s.fullName.trim(),name_upper:upper(s.fullName),birth_line:birthLine(s),profession:s.profession,institution:s.institution,
 faculty:s.faculty,education:s.education,issue:s.issue,role:s.role,short_background:s.shortBackground,summary:s.summary,
 background:s.background,events:s.events,affiliations:s.affiliations,issue_context:s.issueContext,public_activity:s.publicActivity,
 regions:s.regions,subject_headline:`${upper(s.fullName)}${s.role?' ('+upper(s.role)+')':''}${s.issue?' — '+upper(s.issue):''}`,
 };}
function reportValues(s:SubjectRecord,r:ReportRecord):Record<string,string>{
 // The master already prints "R / ... / LAPINFO / <roman> / <year>". Strip any wrapper the user
 // pasted so the number is not duplicated, and keep only the middle segment.
 const bareNumber=(r.reportNumber||'').trim().replace(/^R\s*\/\s*/i,'').replace(/\s*\/\s*LAPINFO\b.*$/i,'').replace(/^\/+|\/+$/g,'').trim();
 const v:Record<string,string>={...subjectValues(s),report_number:bareNumber||'—',roman_month:monthRoman(r.activityDate),
  year:r.activityDate.slice(0,4),field:r.field,subject_line:r.subjectLine||`${s.fullName} — ${s.role}`,
  facts_intro:r.factsIntro,reporter_opinion:r.reporterOpinion,signed_date:idDate(r.signedDate)};
 for(let i=0;i<5;i++)v[`profiling_${i+1}`]=r.profiling[i]||'';
 for(let i=0;i<4;i++){v[`analysis_${i+1}`]=r.analysis[i]||'';v[`recommendations_${i+1}`]=r.recommendations[i]||'';}
 return v;
}
function fillTokens(xml:string, values:Record<string,string>):string{
 return xml.replace(/\{\{([a-z_0-9]+)\}\}/g,(_all,key:string)=>escapeXml(values[key]||''));
}
// Empty numbered slots are removed rather than exporting misleading empty letter/number labels.
// The master prints its own "a." / "1." prefix inside the paragraph, so the surviving slots are
// renumbered to stay contiguous instead of leaving gaps such as "a." followed by "c.".
function removeEmptyWordSlots(xml:string,values:Record<string,string>):string {
 const counters:Record<string,number>={profiling:0,analysis:0,recommendations:0};
 return xml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, block=>{
  const matches=[...block.matchAll(/\{\{((?:profiling|analysis|recommendations)_\d+)\}\}/g)];
  if(matches.length!==1)return block;
  const key=matches[0][1],family=key.replace(/_\d+$/,'');
  if(!values[key]?.trim())return '';
  const index=counters[family]++;
  const label=family==='profiling'?`${String.fromCharCode(97+index)}.`:`${index+1}.`;
  return block.replace(/<w:t>[a-e1-9]\.<\/w:t>/,`<w:t>${label}</w:t>`);
 });
}
/**
 * Identity rows whose only value is blank would print a label with nothing beside it, so the whole
 * row is dropped instead. Rows that also carry the subject photo or several fields are left alone.
 */
const OPTIONAL_WORD_ROWS=new Set(['birth_line','profession','institution','faculty','education','issue']);
function removeEmptyWordRows(xml:string,values:Record<string,string>):string {
 return xml.replace(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g, row=>{
  if(row.includes('<w:tbl'))return row;
  const keys=[...row.matchAll(/\{\{([a-z_0-9]+)\}\}/g)].map(m=>m[1]);
  if(keys.length!==1||!OPTIONAL_WORD_ROWS.has(keys[0]))return row;
  return values[keys[0]]?.trim()?row:'';
 });
}
/**
 * Splices a `w:drawing` run into the empty paragraph between the signer role and the signer name,
 * so the scanned signature lands in the gap the master reserves for it instead of over the text.
 */
function insertSignatureDrawing(xml:string,relId:string,docPrId:number,cx:number,cy:number):string {
  const paragraphs=[...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)];
  const texts=paragraphs.map(p=>p[0].replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").trim());
  const roleIndex=texts.indexOf(SIGNATURE_ANCHOR_ROLE);
  if(roleIndex<0)fail(`Word template is missing the signer block (${SIGNATURE_ANCHOR_ROLE}).`);
  // The first text-free paragraph after the role is the gap the master reserves for the signature.
  const gapIndex=texts.findIndex((t,i)=>i>roleIndex&&t==='');
  if(gapIndex<0)fail('Word template has no empty paragraph reserved for the signature.');
  const gap=paragraphs[gapIndex][0];
  const drawing=
    '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">'+
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>`+
    `<wp:docPr id="${docPrId}" name="Tanda Tangan" descr="Tanda tangan penandatangan"/>`+
    '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>'+
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'+
    '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'+
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'+
    `<pic:nvPicPr><pic:cNvPr id="${docPrId}" name="Tanda Tangan"/><pic:cNvPicPr><a:picLocks noChangeAspect="1"/></pic:cNvPicPr></pic:nvPicPr>`+
    `<pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`+
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`+
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'+
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  const closeRunAt=gap.lastIndexOf('</w:r>');
  const patched=closeRunAt<0?gap.replace('</w:p>',`${drawing}</w:p>`):`${gap.slice(0,closeRunAt+6)}${drawing}${gap.slice(closeRunAt+6)}`;
  const start=paragraphs[gapIndex].index!;
  return xml.slice(0,start)+patched+xml.slice(start+gap.length);
}

function nextRelationshipId(rels:string):string {
  const used=[...rels.matchAll(/Id="rId(\d+)"/g)].map(m=>Number(m[1]));
  return `rId${(used.length?Math.max(...used):0)+1}`;
}

/** Rendered pixel size of a PNG, used to keep the signature's aspect ratio. */
function pngSize(bytes:Uint8Array):{width:number;height:number} {
  if(bytes.length<24||bytes[0]!==0x89||bytes[1]!==0x50)fail('The signature asset is not a valid PNG.');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const width=view.getUint32(16,false),height=view.getUint32(20,false);
  if(!width||!height)fail('The signature asset has no usable dimensions.');
  return {width,height};
}

function clonePowerPointParagraphs(xml:string,key:string,lines:string[]):string {
 const marker=`{{${key}}}`;
 const start=xml.indexOf(marker);
 if(start<0)throw new Error(`PPTX template missing ${marker}`);
 const paragraphStarts=[...xml.slice(0,start).matchAll(/<a:p(?=[\s>])[^>]*>/g)];
 const left=paragraphStarts.length?(paragraphStarts[paragraphStarts.length-1].index ?? -1):-1;
 const right=xml.indexOf('</a:p>',start)+6;
 if(left<0||right<6)throw new Error(`Invalid PowerPoint paragraph for ${marker}`);
 // The master's list paragraph carries a tail of runs with empty text. Cloning them once per item
 // multiplies dead weight, so they are dropped before duplication.
 const paragraph=xml.slice(left,right).replace(/<a:r>((?:(?!<\/a:r>)[\s\S])*?)<\/a:r>/g,run=>/<a:t>\s*<\/a:t>/.test(run)||/<a:t\/>/.test(run)?'':run);
 const output=(lines.length?lines:['']).map(line=>paragraph.replace(marker,escapeXml(line))).join('');
 return xml.slice(0,left)+output+xml.slice(right);
}
async function loadTemplate(name:string){
 const prefix=import.meta.env.BASE_URL.replace(/\/$/,'');
 const response=await fetch(`${prefix}/templates/${name}`);
 if(!response.ok)fail(`Bundled template ${name} is not available: HTTP ${response.status}`);
 return JSZip.loadAsync(await response.arrayBuffer());
}
function imageBytes(dataUrl:string):Uint8Array | null {
 if(!dataUrl)return null;
 if(!/^data:image\/png;base64,/i.test(dataUrl))throw new Error('The selected picture must be a processed PNG image.');
 const data=atob(dataUrl.split(',')[1]);
 return Uint8Array.from(data,c=>c.charCodeAt(0));
}
/**
 * Subject name reduced to ASCII with the parenthetical role and trailing descriptor dropped. Used
 * for the export file stem and the package title, so both stay short and print-safe.
 */
export function subjectName(s:SubjectRecord):string {
 return s.fullName.replace(/\([^)]*\)|\[[^\]]*\]/g,' ').split(/\s+[-–—]\s+/)[0]
  .normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z0-9\s]/g,' ')
  .replace(/\s+/g,' ').trim().slice(0,60).trim()||'Subject';
}
/** Export file stem: `Subject Jaknik <nama> <ddmmyy>`. */
export function documentStem(s:SubjectRecord,r:ReportRecord):string {
 const day=/^(\d{4})-(\d{2})-(\d{2})$/.exec(r.signedDate||r.activityDate);
 const stamp=day?`${day[3]}${day[2]}${day[1].slice(2)}`:new Date().toISOString().slice(2,10).replace(/-/g,'');
 return `Subject Jaknik ${subjectName(s)} ${stamp}`;
}
function canvasContext(width:number,height:number):CanvasRenderingContext2D {
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
 const context=canvas.getContext('2d');
 if(!context)fail('Canvas 2D is unavailable in this webview.');
 return context;
}
function canvasBytes(canvas:HTMLCanvasElement,mime:string,quality?:number):Uint8Array {
 const dataUrl=canvas.toDataURL(mime,quality),comma=dataUrl.indexOf(',');
 if(comma<0)fail('Canvas produced no image data.');
 return Uint8Array.from(atob(dataUrl.slice(comma+1)),c=>c.charCodeAt(0));
}
/** Neutral grey picture used when the subject has no photo, so the template's own never shows. */
function placeholderPng([width,height]:readonly [number,number]):Uint8Array {
 const context=canvasContext(width,height);
 context.fillStyle=PLACEHOLDER_FILL;context.fillRect(0,0,width,height);
 return canvasBytes(context.canvas,'image/png');
}
/** Cover thumbnail regenerated per export; the template's thumbnail holds the original subject. */
async function coverThumbnail(s:SubjectRecord,headline:string):Promise<Uint8Array> {
 const [width,height]=THUMB_SIZE,photo={x:10,y:41,w:41,h:49};
 const context=canvasContext(width,height);
 context.fillStyle='#ffffff';context.fillRect(0,0,width,height);
 const lines=headline?[`SUBJECT TERINDIKASI :`,`1. ${headline}`]:['SUBJECT TERINDIKASI :'];
 const image=await new Promise<HTMLImageElement|null>(resolve=>{
  if(!s.photoDataUrl)return resolve(null);
  const element=new window.Image();
  element.onload=()=>resolve(element);
  element.onerror=()=>resolve(null);
  element.src=s.photoDataUrl;
 });
 if(image){
  // Cover crop keeps the portrait filling the frame exactly like the slide does.
  const ratio=Math.max(photo.w/image.naturalWidth,photo.h/image.naturalHeight);
  const cropW=photo.w/ratio,cropH=photo.h/ratio;
  context.drawImage(image,(image.naturalWidth-cropW)/2,(image.naturalHeight-cropH)/2,cropW,cropH,photo.x,photo.y,photo.w,photo.h);
 }else{
  context.fillStyle=PLACEHOLDER_FILL;context.fillRect(photo.x,photo.y,photo.w,photo.h);
 }
 context.fillStyle='#111111';context.textBaseline='top';context.textAlign='left';
 context.font='bold 10px Arial, Helvetica, sans-serif';
 context.fillText('ANALISA SIGINT',23,12);
 context.font='6px Arial, Helvetica, sans-serif';
 lines.slice(0,2).forEach((line,index)=>context.fillText(line.slice(0,74),23,28+index*9));
 context.font='bold 6px Arial, Helvetica, sans-serif';
 context.fillText('RAHASIA',photo.x+photo.w+6,photo.y+photo.h-8);
 return canvasBytes(context.canvas,'image/jpeg',0.9);
}
function coreXml(title:string):string {
 const stamp=new Date().toISOString().replace(/\.\d+Z$/,'Z');
 return `<?xml version='1.0' encoding='UTF-8' standalone='yes'?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(title)}</dc:title><dc:creator>Hanoman Telemetri</dc:creator><cp:lastModifiedBy>Hanoman Telemetri</cp:lastModifiedBy><cp:revision>1</cp:revision><dcterms:created xsi:type="dcterms:W3CDTF">${stamp}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${stamp}</dcterms:modified></cp:coreProperties>`;
}
/** Extended properties are rewritten because the master still advertises its own fonts and time. */
function appXml(kind:'word'|'pptx'):string {
 const ext='xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"';
 const details=kind==='pptx'?'<PresentationFormat>Widescreen</PresentationFormat><Slides>5</Slides>':'<Template>Normal</Template><DocSecurity>0</DocSecurity>';
 return `<?xml version='1.0' encoding='UTF-8' standalone='yes'?>\n<Properties ${ext}><Application>Hanoman Telemetri</Application>${details}<ScaleCrop>false</ScaleCrop><Company></Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0000</AppVersion></Properties>`;
}
export function validateDocument(s:SubjectRecord,r?:ReportRecord):string[]{
 const errors:string[]=[];
 if(!s.fullName.trim())errors.push('Nama subjek wajib diisi.');
 if(s.fullName.length>160)errors.push('Nama subjek maksimal 160 karakter.');
 if(r){if(!r.activityDate)errors.push('Tanggal kegiatan wajib diisi.');if(!r.signedDate)errors.push('Tanggal penandatanganan wajib diisi.');if(!r.field.trim())errors.push('Bidang wajib diisi.');}
 for(const [value,label,limit] of [[s.summary,'Profil singkat',1250],[s.background,'Riwayat/latar belakang',1600],[s.affiliations,'Afiliasi',1000],[s.events,'Peristiwa',1000],[s.issueContext,'Keterkaitan isu',1200],[s.publicActivity,'Aktivitas publik',1200],[s.regions,'Wilayah relevan',850]] as const){if(value.length>limit)errors.push(`${label}: teks terlalu panjang (${value.length}/${limit}).`);}
 return errors;
}
export async function makeWord(s:SubjectRecord,r:ReportRecord):Promise<Blob>{
 const errors=validateDocument(s,r);if(errors.length)fail(errors.join('\n'));
 const zip=await loadTemplate('report-template.docx');const part=zip.file(XML_PART_DOC);if(!part)fail('Invalid DOCX master template.');
 const values=reportValues(s,r);
 let xml=removeEmptyWordSlots(await part.async('string'),values);
 xml=removeEmptyWordRows(xml,values);
 xml=fillTokens(xml,values);
 if(/\{\{[a-z_0-9]+\}\}/.test(xml))fail('Unfilled placeholder in Word template.');
 // Stamp the scanned signature into the reserved gap above the signer name.
 const signature=await fetch(`${import.meta.env.BASE_URL.replace(/\/$/,'')}/templates/${SIGNATURE_IMAGE}`);
 if(!signature.ok)fail(`Bundled signature is not available: HTTP ${signature.status}`);
 const signatureBytes=new Uint8Array(await signature.arrayBuffer());
 const {width,height}=pngSize(signatureBytes);
 const relsPart=zip.file(XML_PART_RELS);if(!relsPart)fail('Invalid DOCX master: relationship part missing.');
 const rels=await relsPart.async('string');
 const relId=nextRelationshipId(rels);
 xml=insertSignatureDrawing(xml,relId,9001,SIGNATURE_WIDTH_EMU,Math.round(SIGNATURE_WIDTH_EMU*height/width));
 zip.file(XML_PART_RELS,rels.replace('</Relationships>',`<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${SIGNATURE_IMAGE}"/></Relationships>`));
 zip.file(`word/media/${SIGNATURE_IMAGE}`,signatureBytes);
 zip.file(XML_PART_DOC,xml);
 zip.file(DOC_PHOTO,imageBytes(s.photoDataUrl)??placeholderPng(PHOTO_SIZE));
 zip.file(PART_CORE,coreXml(`${subjectName(s)} — ${idDate(r.signedDate)}`));
 zip.file(PART_APP,appXml('word'));
 return zip.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',compression:'DEFLATE'});
}
export async function makePowerPoint(s:SubjectRecord,r:ReportRecord):Promise<Blob>{
 const errors=validateDocument(s,r);if(errors.length)fail(errors.join('\n'));
 const zip=await loadTemplate('subject-template.pptx');
 const values=reportValues(s,r);
 for(let i=1;i<=5;i++){
  const path=`ppt/slides/slide${i}.xml`,part=zip.file(path);
  if(!part)fail(`Invalid PPTX master: missing slide ${i}.`);
  let xml=await part.async('string');
  if(i===3){for(const field of ['events','affiliations','issue_context','public_activity','regions','background']){
    const text=values[field]||'';const lines=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    // Replace a single placeholder paragraph with a short list of styled PowerPoint paragraphs.
    xml=clonePowerPointParagraphs(xml,field,lines);
    delete values[field];
   }}
  if(i===4){xml=clonePowerPointParagraphs(xml,'analysis_list',r.analysis.filter(Boolean).map((x,k)=>`${k+1}. ${x}`));}
  if(i===5){xml=clonePowerPointParagraphs(xml,'recommendations_list',r.recommendations.filter(Boolean).map((x,k)=>`${k+1}. ${x}`));}
  xml=fillTokens(xml,values);
  if(/\{\{[a-z_0-9]+\}\}/.test(xml))fail(`Unfilled placeholder on slide ${i}.`);
  zip.file(path,xml);
 }
 const photo=imageBytes(s.photoDataUrl)??placeholderPng(PHOTO_SIZE);
 const support=imageBytes(s.supportDataUrl)??placeholderPng(SUPPORT_SIZE);
 zip.file(PPT_PHOTO,photo);
 zip.file(PPT_SUPPORT,support);
 zip.file(PPT_THUMBNAIL,await coverThumbnail(s,values.subject_headline||''));
 zip.file(PART_CORE,coreXml(`${subjectName(s)} — ${idDate(r.signedDate)}`));
 zip.file(PART_APP,appXml('pptx'));
 return zip.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.presentationml.presentation',compression:'DEFLATE'});
}
export function downloadBlob(blob:Blob,fileName:string){
 const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=fileName;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

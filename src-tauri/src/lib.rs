mod db;
mod types;

use std::{collections::HashMap,fs, sync::{Arc,Mutex,atomic::{AtomicBool,Ordering}},time::{Duration,Instant}};
use reqwest::{Client,StatusCode,Url};
use rusqlite::{params,Connection};
use serde_json::{json,Value};
use futures_util::StreamExt;
use tauri::{AppHandle,Emitter,Manager,State};
use types::*;

const SERVICE:&str="com.hanoman.telemetri.keys";
const MAX_SCAN_MODELS:usize=500;
const MAX_ATTACHMENTS:usize=4;
const MAX_IMAGE_CHARS:usize=11_000_000;
const MAX_DOC_CHARS:usize=200_000;
const MAX_REPLAY_IMAGES:usize=6;
const MAX_REPLAY_DOC_CHARS:usize=60_000;
const RECENT_TURNS:usize=30;
const MAX_MEMORY_CHARS:usize=8_000;
const MEMORY_DIGEST_CHARS:usize=4_000;
struct AppState {
  db:Mutex<Connection>,
  http:Client,
  cancellations:Mutex<HashMap<String,Arc<AtomicBool>>>,
}
fn now()->String {chrono::Utc::now().to_rfc3339()}
fn new_id()->String {uuid::Uuid::new_v4().to_string()}
fn db_error<E:std::fmt::Display>(e:E)->String {e.to_string()}
fn key_entry(id:&str)->Result<keyring::Entry,String>{keyring::Entry::new(SERVICE,id).map_err(|e|format!("Credential manager unavailable: {e}"))}
fn get_secret(id:&str)->Result<String,String>{key_entry(id)?.get_password().map_err(|e|format!("Unable to read OS credential vault: {e}"))}
fn url_base(input:&str)->Result<String,String>{
 let trimmed=input.trim().trim_end_matches('/');
 let u=Url::parse(trimmed).map_err(|_|"Provide a valid absolute URL, e.g. https://provider.example/v1".to_string())?;
 let host=u.host_str().unwrap_or_default();
 if u.scheme()!="https" && !(u.scheme()=="http" && matches!(host,"127.0.0.1"|"localhost"|"[::1]"|"::1")) {return Err("HTTPS is required except for localhost development.".into());}
 if !u.username().is_empty()||u.password().is_some()||u.query().is_some()||u.fragment().is_some() {return Err("Base URL must not contain credentials, query strings or fragments.".into());}
 Ok(trimmed.to_string())
}
fn simple_status(code:StatusCode)->&'static str {match code.as_u16(){401|403=>"auth_failed",404|405|422=>"unsupported",429=>"rate_limited",500..=599=>"degraded",_=>"failed"}}
fn trim_error(body:&str,secret:&str)->String {body.replace(secret,"[REDACTED]").chars().take(220).collect()}
fn register_event(app:&AppHandle,event:StreamEvent){let _=app.emit("hanoman:stream",event);}
fn status_err(code:StatusCode,text:&str,secret:&str)->String{format!("HTTP {} — {}",code.as_u16(),trim_error(text,secret))}

fn validate_attachments(items:&[Attachment])->Result<(),String>{
 if items.len()>MAX_ATTACHMENTS {return Err(format!("Attach at most {MAX_ATTACHMENTS} files per message."));}
 for a in items {
  if a.name.trim().is_empty()||a.name.len()>160 {return Err("Attachment names must contain 1–160 characters.".into());}
  match a.kind.as_str() {
   "image"=>{
    if !a.data.starts_with("data:image/") {return Err(format!("{} is not a valid image attachment.",a.name));}
    if a.data.len()>MAX_IMAGE_CHARS {return Err(format!("{} exceeds the 8 MB image limit.",a.name));}
   }
   "document"=>{
    if a.data.len()>MAX_DOC_CHARS {return Err(format!("{} exceeds the 200k character document limit.",a.name));}
   }
   other=>return Err(format!("Unsupported attachment type: {other}")),
  }
 }
 Ok(())
}
fn document_block(a:&Attachment)->String {format!("Lampiran dokumen: {}\n<<<\n{}\n>>>",a.name,a.data.trim())}
/// OpenAI-compatible user content: a plain string, or multimodal parts when files are attached.
fn user_content(text:&str,items:&[Attachment])->Value {
 if items.is_empty() {return Value::String(text.to_string());}
 let mut prompt=text.trim().to_string();
 let docs:Vec<String>=items.iter().filter(|a|a.kind=="document").map(document_block).collect();
 if !docs.is_empty() {if !prompt.is_empty(){prompt.push_str("\n\n");}prompt.push_str(&docs.join("\n\n"));}
 let mut parts=vec![json!({"type":"text","text":prompt})];
 for a in items.iter().filter(|a|a.kind=="image") {parts.push(json!({"type":"image_url","image_url":{"url":a.data}}));}
 json!(parts)
}
fn replay_attachments(m:&ChatMessage)->Vec<Attachment> {m.attachments.clone().unwrap_or_default()}
/// Compact transcript of turns that fall outside the live replay window, newest kept first.
fn memory_digest(older:&[ChatMessage])->String {
 let mut lines:Vec<String>=Vec::new();let mut used=0usize;
 for m in older.iter().rev(){
  if m.role!="user"&&m.role!="assistant" {continue;}
  let label=if m.role=="user"{"Pengguna"}else{"Asisten"};
  let body: String=m.content.split_whitespace().collect::<Vec<_>>().join(" ");
  let excerpt:String=body.chars().take(280).collect();
  let line=format!("- {label}: {excerpt}");
  if used+line.chars().count()>MEMORY_DIGEST_CHARS {break;}
  used+=line.chars().count();
  lines.push(line);
 }
 lines.reverse();
 lines.join("\n")
}
fn memory_block(workspace:&str,conversation:&str,digest:&str)->Option<String> {
 let mut sections:Vec<String>=Vec::new();
 if !workspace.trim().is_empty(){sections.push(format!("Memori workspace (lintas percakapan):\n{}",workspace.trim()));}
 if !conversation.trim().is_empty(){sections.push(format!("Memori percakapan ini:\n{}",conversation.trim()));}
 if !digest.trim().is_empty(){sections.push(format!("Ringkasan percakapan lebih awal:\n{digest}"));}
 if sections.is_empty(){return None;}
 Some(format!("Konteks memori tersimpan. Gunakan sebagai latar belakang, jangan mengarang di luar catatan ini.\n\n{}",sections.join("\n\n")))
}

#[tauri::command]
fn save_office_export(app:AppHandle,file_name:String,data:Vec<u8>)->Result<String,String>{
 if data.is_empty()||data.len()>35_000_000 {return Err("File export must be between 1B and 35MB.".into());}
 if file_name.len()>180||file_name.is_empty()||!file_name.chars().all(|c|c.is_ascii_alphanumeric()||matches!(c,'_'|'-'|'.'))||!(file_name.ends_with(".docx")||file_name.ends_with(".pptx")){
  return Err("Invalid export filename.".into());
 }
 let folder=app.path().download_dir().or_else(|_|app.path().app_data_dir()).map_err(db_error)?;
 fs::create_dir_all(&folder).map_err(db_error)?;
 let stem=file_name.rsplit_once('.').map(|x|x.0).ok_or("Invalid filename")?;
 let ext=file_name.rsplit_once('.').map(|x|x.1).ok_or("Invalid extension")?;
 for count in 0..1000{
  let target=folder.join(if count==0{file_name.clone()}else{format!("{stem}_{count}.{ext}")});
  match std::fs::OpenOptions::new().write(true).create_new(true).open(&target){
   Ok(mut file)=>{use std::io::Write;file.write_all(&data).map_err(db_error)?;return Ok(target.to_string_lossy().to_string());}
   Err(err) if err.kind()==std::io::ErrorKind::AlreadyExists=>continue,
   Err(err)=>return Err(err.to_string()),
  }
 }
 Err("Too many export filename collisions.".into())
}

// Local document records are not sent to AI providers; users must protect this local SQLite DB.
#[tauri::command]
fn list_subject_records(state:State<'_,AppState>)->Result<Vec<Value>,String>{
 let conn=state.db.lock().map_err(db_error)?;
 let mut stmt=conn.prepare("SELECT payload FROM subject_records ORDER BY updated_at DESC").map_err(db_error)?;
 let items=stmt.query_map([],|row|row.get::<_,String>(0)).map_err(db_error)?;
 items.map(|item|serde_json::from_str::<Value>(&item.map_err(db_error)?).map_err(db_error)).collect()
}
#[tauri::command]
fn list_report_records(state:State<'_,AppState>)->Result<Vec<Value>,String>{
 let conn=state.db.lock().map_err(db_error)?;
 let mut stmt=conn.prepare("SELECT payload FROM report_records ORDER BY updated_at DESC").map_err(db_error)?;
 let items=stmt.query_map([],|row|row.get::<_,String>(0)).map_err(db_error)?;
 items.map(|item|serde_json::from_str::<Value>(&item.map_err(db_error)?).map_err(db_error)).collect()
}
#[tauri::command]
fn save_subject_record(state:State<'_,AppState>,record:Value)->Result<(),String>{
 let id=record.get("id").and_then(Value::as_str).ok_or("Missing subject ID")?;
 let name=record.get("fullName").and_then(Value::as_str).ok_or("Missing subject name")?;
 if id.len()>120||id.is_empty()||name.chars().count()>160||name.trim().is_empty(){return Err("Invalid subject ID or full name.".into());}
 let payload=serde_json::to_string(&record).map_err(db_error)?;
 if payload.len()>12_000_000{return Err("Subject record exceeds 12MB limit.".into());}
 let conn=state.db.lock().map_err(db_error)?;
 conn.execute("INSERT INTO subject_records(id,name,payload,updated_at) VALUES (?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET name=excluded.name,payload=excluded.payload,updated_at=excluded.updated_at",params![id,name,payload,now()]).map_err(db_error)?;
 Ok(())
}
#[tauri::command]
fn save_report_record(state:State<'_,AppState>,record:Value)->Result<(),String>{
 let id=record.get("id").and_then(Value::as_str).ok_or("Missing report ID")?;
 let subject_id=record.get("subjectId").and_then(Value::as_str).ok_or("Missing associated subject ID")?;
 if id.is_empty()||id.len()>120||subject_id.is_empty()||subject_id.len()>120{return Err("Invalid report/subject ID.".into());}
 let payload=serde_json::to_string(&record).map_err(db_error)?;
 if payload.len()>2_000_000{return Err("Report exceeds 2MB limit.".into());}
 let conn=state.db.lock().map_err(db_error)?;
 conn.execute("INSERT INTO report_records(id,subject_id,payload,updated_at) VALUES (?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET subject_id=excluded.subject_id,payload=excluded.payload,updated_at=excluded.updated_at",params![id,subject_id,payload,now()]).map_err(db_error)?;
 Ok(())
}
#[tauri::command]
fn delete_subject_record(state:State<'_,AppState>,subject_id:String)->Result<(),String>{
 let conn=state.db.lock().map_err(db_error)?;
 conn.execute("DELETE FROM subject_records WHERE id=?1",params![subject_id]).map_err(db_error)?;
 Ok(())
}

#[tauri::command]
fn list_providers(state:State<'_,AppState>)->Result<Vec<Provider>,String>{let conn=state.db.lock().map_err(db_error)?;db::providers(&conn).map_err(db_error)}
#[tauri::command]
fn list_keys(state:State<'_,AppState>)->Result<Vec<ApiKeyInfo>,String>{let conn=state.db.lock().map_err(db_error)?;db::keys(&conn).map_err(db_error)}
#[tauri::command]
fn list_models(state:State<'_,AppState>)->Result<Vec<ModelInfo>,String>{let conn=state.db.lock().map_err(db_error)?;db::models(&conn).map_err(db_error)}
#[tauri::command]
fn get_stats(state:State<'_,AppState>)->Result<Stats,String>{let conn=state.db.lock().map_err(db_error)?;db::stats(&conn).map_err(db_error)}
#[tauri::command]
fn list_activity(state:State<'_,AppState>)->Result<Vec<Activity>,String>{let conn=state.db.lock().map_err(db_error)?;db::activity(&conn).map_err(db_error)}
#[tauri::command]
fn list_conversations(state:State<'_,AppState>)->Result<Vec<Conversation>,String>{let conn=state.db.lock().map_err(db_error)?;db::conversations(&conn).map_err(db_error)}
#[tauri::command]
fn get_messages(state:State<'_,AppState>,conversation_id:String)->Result<Vec<ChatMessage>,String>{let conn=state.db.lock().map_err(db_error)?;db::messages(&conn,&conversation_id).map_err(db_error)}

#[tauri::command]
fn add_provider(state:State<'_,AppState>,name:String,base_url:String)->Result<Provider,String>{
 let name=name.trim();if name.is_empty()||name.chars().count()>70{return Err("Provider name must contain 1–70 characters.".into());}
 let base_url=url_base(&base_url)?;
 let id=new_id();let created_at=now();
 {let conn=state.db.lock().map_err(db_error)?;
 conn.execute("INSERT INTO providers(id,name,base_url,created_at) VALUES (?1,?2,?3,?4)",params![id,name,base_url,created_at]).map_err(db_error)?;}
 Ok(Provider{id,name:name.to_string(),base_url,created_at,last_scan:None,key_count:0,model_count:0})
}
#[tauri::command]
fn delete_provider(state:State<'_,AppState>,provider_id:String)->Result<(),String>{
 let keys:Vec<String>={let conn=state.db.lock().map_err(db_error)?;let mut stmt=conn.prepare("SELECT id FROM api_keys WHERE provider_id=?1").map_err(db_error)?;let list=stmt.query_map([&provider_id],|r|r.get(0)).map_err(db_error)?.collect::<rusqlite::Result<Vec<String>>>().map_err(db_error)?;list};
 for id in &keys {key_entry(id)?.delete_credential().map_err(|e|format!("Failed to remove credential {id}: {e}"))?;}
 let conn=state.db.lock().map_err(db_error)?;conn.execute("DELETE FROM providers WHERE id=?1",[provider_id]).map_err(db_error)?;Ok(())
}
#[tauri::command]
fn add_key(state:State<'_,AppState>,provider_id:String,label:String,secret:String)->Result<ApiKeyInfo,String>{
 let label=label.trim();let secret=secret.trim();if label.is_empty()||label.len()>60{return Err("Key profile label must contain 1–60 characters.".into());}
 if secret.is_empty()||secret.len()>10000{return Err("Invalid API key length.".into());}
 {let conn=state.db.lock().map_err(db_error)?;let exists:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM providers WHERE id=?1)",[&provider_id],|r|r.get(0)).map_err(db_error)?;if !exists{return Err("Unknown provider.".into());}}
 let id=new_id();let masked=format!("•••• {}",secret.chars().rev().take(4).collect::<String>().chars().rev().collect::<String>());
 key_entry(&id)?.set_password(secret).map_err(|e|format!("Unable to store key in OS credential vault: {e}"))?;
 let created_at=now();let result={let conn=state.db.lock().map_err(db_error)?;conn.execute("INSERT INTO api_keys(id,provider_id,label,masked,status,created_at) VALUES (?1,?2,?3,?4,'saved',?5)",params![id,provider_id,label,masked,created_at])};
 if let Err(e)=result {let _=key_entry(&id)?.delete_credential();return Err(e.to_string());}
 Ok(ApiKeyInfo{id,provider_id,label:label.to_string(),masked,status:"saved".into(),last_error:None,created_at})
}
#[tauri::command]
fn delete_key(state:State<'_,AppState>,key_id:String)->Result<(),String>{
 // Do not silently leave a credential in the vault when its SQLite index has been removed.
 key_entry(&key_id)?.delete_credential().map_err(|e|format!("Could not remove OS credential (database unchanged): {e}"))?;
 let conn=state.db.lock().map_err(db_error)?;conn.execute("DELETE FROM api_keys WHERE id=?1",[key_id]).map_err(db_error)?;Ok(())
}

#[derive(Clone)]
struct KeyTarget {provider_id:String,provider_name:String,base_url:String,key_id:String}
fn scan_targets(conn:&Connection,provider_id:Option<&str>)->Result<Vec<KeyTarget>,String>{
 let mut stmt=conn.prepare("SELECT p.id,p.name,p.base_url,k.id FROM api_keys k JOIN providers p ON p.id=k.provider_id WHERE (?1 IS NULL OR p.id=?1) ORDER BY p.name,k.created_at").map_err(db_error)?;
 let rows=stmt.query_map([provider_id],|r|Ok(KeyTarget{provider_id:r.get(0)?,provider_name:r.get(1)?,base_url:r.get(2)?,key_id:r.get(3)?})).map_err(db_error)?;
 rows.collect::<rusqlite::Result<Vec<_>>>().map_err(db_error)
}
#[tauri::command]
async fn scan_models(state:State<'_,AppState>,provider_id:Option<String>)->Result<ScanSummary,String>{
 let targets={let conn=state.db.lock().map_err(db_error)?;scan_targets(&conn,provider_id.as_deref())?};
 let mut summary=ScanSummary{scanned_keys:0,discovered_models:0,errors:vec![]};
 for target in targets {
  summary.scanned_keys+=1;let t=Instant::now();
  let secret=match get_secret(&target.key_id){Ok(s)=>s,Err(e)=>{summary.errors.push(format!("{}: {e}",target.provider_name));let conn=state.db.lock().map_err(db_error)?;conn.execute("UPDATE api_keys SET status='error',last_error=?1 WHERE id=?2",params![e,target.key_id]).map_err(db_error)?;continue;}};
  let result=state.http.get(format!("{}/models",target.base_url)).bearer_auth(&secret).timeout(Duration::from_secs(20)).send().await;
  let (status,body)=match result {Ok(response)=>{let status=response.status();let body=response.text().await.unwrap_or_default();(status,body)},Err(e)=>{let err=format!("Connection error: {e}");summary.errors.push(format!("{}: {err}",target.provider_name));let conn=state.db.lock().map_err(db_error)?;conn.execute("UPDATE api_keys SET status='error',last_error=?1 WHERE id=?2",params![err,target.key_id]).map_err(db_error)?;db::log(&conn,&target.provider_id,"—","scan",false,Some(t.elapsed().as_millis() as i64),None,None,Some(&err)).map_err(db_error)?;continue;}};
  if !status.is_success(){let err=status_err(status,&body,&secret);summary.errors.push(format!("{}: {err}",target.provider_name));let code=if status==StatusCode::UNAUTHORIZED||status==StatusCode::FORBIDDEN{"auth_failed"}else{"error"};let conn=state.db.lock().map_err(db_error)?;conn.execute("UPDATE api_keys SET status=?1,last_error=?2 WHERE id=?3",params![code,err,target.key_id]).map_err(db_error)?;conn.execute("UPDATE models SET status=?1,last_error=?2 WHERE key_id=?3",params![simple_status(status),err,target.key_id]).map_err(db_error)?;db::log(&conn,&target.provider_id,"—","scan",false,Some(t.elapsed().as_millis() as i64),None,None,Some(&err)).map_err(db_error)?;continue;}
  let parsed:Value=match serde_json::from_str(&body){Ok(v)=>v,Err(e)=>{let msg=format!("Invalid JSON model catalog: {e}");summary.errors.push(format!("{}: {msg}",target.provider_name));let conn=state.db.lock().map_err(db_error)?;db::log(&conn,&target.provider_id,"—","scan",false,Some(t.elapsed().as_millis() as i64),None,None,Some(&msg)).map_err(db_error)?;continue;}};
  let models=match parsed.get("data").and_then(Value::as_array){Some(m)=>m,None=>{summary.errors.push(format!("{}: /models returned no data array",target.provider_name));continue;}};
  let conn=state.db.lock().map_err(db_error)?;
  // Unseen model routes become unknown, not 'ready'. Freshly discovered routes always require a new probe.
  conn.execute("UPDATE models SET status='unknown',latency_ms=NULL,last_checked=NULL WHERE key_id=?1",[&target.key_id]).map_err(db_error)?;
  for row in models.iter().take(MAX_SCAN_MODELS){
   let Some(model_id)=row.get("id").and_then(Value::as_str) else {continue};
   if model_id.is_empty()||model_id.len()>500{continue;}
   let owned_by=row.get("owned_by").and_then(Value::as_str);
   let uid=format!("{}:{}",target.key_id,model_id);
   conn.execute("INSERT INTO models(uid,provider_id,key_id,model_id,owned_by,status,updated_at) VALUES (?1,?2,?3,?4,?5,'discovered',?6) ON CONFLICT(uid) DO UPDATE SET owned_by=excluded.owned_by,status='discovered',latency_ms=NULL,last_checked=NULL,last_error=NULL,updated_at=excluded.updated_at",params![uid,target.provider_id,target.key_id,model_id,owned_by,now()]).map_err(db_error)?;
   summary.discovered_models+=1;
  }
  conn.execute("UPDATE api_keys SET status='valid',last_error=NULL WHERE id=?1",[&target.key_id]).map_err(db_error)?;
  conn.execute("UPDATE providers SET last_scan=?1 WHERE id=?2",params![now(),target.provider_id]).map_err(db_error)?;
  db::log(&conn,&target.provider_id,"—","scan",true,Some(t.elapsed().as_millis() as i64),None,None,None).map_err(db_error)?;
 }
 Ok(summary)
}

fn model_route(state:&AppState,uid:&str)->Result<(ModelInfo,String),String>{
 let conn=state.db.lock().map_err(db_error)?;
 let model=db::get_model(&conn,uid).map_err(|_|"Unknown model route. Discover models first.".to_string())?;
 let url:String=conn.query_row("SELECT base_url FROM providers WHERE id=?1",[&model.provider_id],|r|r.get(0)).map_err(db_error)?;
 Ok((model,url))
}
fn last_error(status:StatusCode,body:&str,secret:&str)->String{status_err(status,body,secret)}
#[tauri::command]
async fn probe_model(state:State<'_,AppState>,model_uid:String)->Result<ModelInfo,String>{
 let (model,url)=model_route(&state,&model_uid)?;let secret=get_secret(&model.key_id)?;
 let t=Instant::now();let mut payload=json!({"model":model.model_id,"messages":[{"role":"user","content":"Reply with OK."}],"max_tokens":8,"stream":false});
 let mut reply=match state.http.post(format!("{url}/chat/completions")).bearer_auth(&secret).json(&payload).timeout(Duration::from_secs(35)).send().await { Ok(r)=>r, Err(e)=>return update_probe_result(&state,&model,"failed",Some(format!("Network error: {e}")),t.elapsed().as_millis() as i64,None,None) };
 if reply.status()==StatusCode::BAD_REQUEST {let text=reply.text().await.unwrap_or_default();if text.contains("max_tokens")&&(text.contains("max_completion_tokens")||text.contains("not supported")){payload.as_object_mut().unwrap().remove("max_tokens");payload["max_completion_tokens"]=json!(8);reply=state.http.post(format!("{url}/chat/completions")).bearer_auth(&secret).json(&payload).timeout(Duration::from_secs(35)).send().await.map_err(db_error)?;}else {return update_probe_result(&state,&model,"unsupported",Some(last_error(StatusCode::BAD_REQUEST,&text,&secret)),t.elapsed().as_millis() as i64,None,None);}}
 let status=reply.status();let body=reply.text().await.map_err(db_error)?;let ms=t.elapsed().as_millis() as i64;
 if !status.is_success(){return update_probe_result(&state,&model,simple_status(status),Some(last_error(status,&body,&secret)),ms,None,None);}
 let parsed:Value=match serde_json::from_str(&body){Ok(v)=>v,Err(e)=>return update_probe_result(&state,&model,"unsupported",Some(format!("Non-JSON completion response: {e}")),ms,None,None)};
 let valid=parsed.get("choices").and_then(Value::as_array).map(|a|!a.is_empty()).unwrap_or(false);
 let usage=parsed.get("usage");let tokens_in=usage.and_then(|v|v.get("prompt_tokens")).and_then(Value::as_i64);let tokens_out=usage.and_then(|v|v.get("completion_tokens")).and_then(Value::as_i64);
 if valid{update_probe_result(&state,&model,"ready",None,ms,tokens_in,tokens_out)}else{update_probe_result(&state,&model,"unsupported",Some("Provider returned a response without chat completion choices".into()),ms,tokens_in,tokens_out)}
}
fn update_probe_result(state:&AppState,model:&ModelInfo,status:&str,error:Option<String>,ms:i64,input:Option<i64>,output:Option<i64>)->Result<ModelInfo,String>{
 let conn=state.db.lock().map_err(db_error)?;
 conn.execute("UPDATE models SET status=?1,latency_ms=?2,last_checked=?3,last_error=?4 WHERE uid=?5",params![status,ms,now(),error,model.uid]).map_err(db_error)?;
 db::log(&conn,&model.provider_id,&model.model_id,"probe",status=="ready",Some(ms),input,output,error.as_deref()).map_err(db_error)?;
 db::get_model(&conn,&model.uid).map_err(db_error)
}

#[tauri::command]
fn create_conversation(state:State<'_,AppState>,model_uid:Option<String>)->Result<Conversation,String>{
 let id=new_id();let now=now();let conn=state.db.lock().map_err(db_error)?;
 conn.execute("INSERT INTO conversations(id,title,model_uid,created_at,updated_at) VALUES (?1,'New conversation',?2,?3,?4)",params![id,model_uid,now,now]).map_err(db_error)?;
 Ok(Conversation{id,title:"New conversation".into(),model_uid,created_at:now.clone(),updated_at:now})
}
#[tauri::command]
fn delete_conversation(state:State<'_,AppState>,conversation_id:String)->Result<(),String>{let conn=state.db.lock().map_err(db_error)?;conn.execute("DELETE FROM conversations WHERE id=?1",[conversation_id]).map_err(db_error)?;Ok(())}
#[tauri::command]
fn get_memory(state:State<'_,AppState>,conversation_id:Option<String>)->Result<MemoryInfo,String>{
 let conn=state.db.lock().map_err(db_error)?;
 let workspace=db::workspace_memory(&conn).map_err(db_error)?;
 let id=conversation_id.unwrap_or_default();
 let conversation=if id.is_empty(){String::new()}else{db::conversation_memory(&conn,&id).map_err(db_error)?};
 let messages=if id.is_empty(){0}else{db::message_count(&conn,&id).map_err(db_error)?};
 let recent=messages.min(RECENT_TURNS as i64);
 Ok(MemoryInfo{workspace,conversation,messages,recent,digest:messages-recent})
}
#[tauri::command]
fn save_memory(state:State<'_,AppState>,conversation_id:Option<String>,workspace:String,conversation:String)->Result<MemoryInfo,String>{
 if workspace.chars().count()>MAX_MEMORY_CHARS {return Err(format!("Memori workspace maksimal {MAX_MEMORY_CHARS} karakter."));}
 if conversation.chars().count()>MAX_MEMORY_CHARS {return Err(format!("Memori percakapan maksimal {MAX_MEMORY_CHARS} karakter."));}
 let id=conversation_id.unwrap_or_default();
 let conn=state.db.lock().map_err(db_error)?;
 db::set_workspace_memory(&conn,workspace.trim()).map_err(db_error)?;
 if !id.is_empty() {
  let exists:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM conversations WHERE id=?1)",[&id],|r|r.get(0)).map_err(db_error)?;
  if !exists{return Err("Conversation not found.".into());}
  db::set_conversation_memory(&conn,&id,conversation.trim()).map_err(db_error)?;
 }
 let messages=if id.is_empty(){0}else{db::message_count(&conn,&id).map_err(db_error)?};
 let recent=messages.min(RECENT_TURNS as i64);
 Ok(MemoryInfo{workspace:workspace.trim().into(),conversation:conversation.trim().into(),messages,recent,digest:messages-recent})
}
#[tauri::command]
fn stop_generation(state:State<'_,AppState>,request_id:String)->Result<(),String>{
 if let Some(flag)=state.cancellations.lock().map_err(db_error)?.get(&request_id){flag.store(true,Ordering::Relaxed);}Ok(())
}

async fn send_chat_stream(app:&AppHandle,state:&AppState,request:&ChatRequest,flag:&Arc<AtomicBool>)->Result<(),String>{
 validate_attachments(&request.attachments)?;
 if request.text.trim().is_empty()&&request.attachments.is_empty() {return Err("Message is empty or too long.".into());}
 if request.text.len()>60000 {return Err("Message is empty or too long.".into());}
 if request.system_prompt.len()>20000 {return Err("System prompt is too long.".into());}
 let (model,url)=model_route(state,&request.model_uid)?;
 if model.status!="ready" {
  return Err(format!("Model {} belum terverifikasi (status: {}). Buka Model Explorer, jalankan Test model sampai berstatus Ready, lalu ulangi chat.",model.model_id,model.status));
 }
 let secret=get_secret(&model.key_id)?;
 let (old,stored_memory,workspace_memory)={let conn=state.db.lock().map_err(db_error)?;
  let exists:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM conversations WHERE id=?1)",[&request.conversation_id],|r|r.get(0)).map_err(db_error)?;
  if !exists{return Err("Conversation not found.".into());}
  (db::messages(&conn,&request.conversation_id).map_err(db_error)?,db::conversation_memory(&conn,&request.conversation_id).map_err(db_error)?,db::workspace_memory(&conn).map_err(db_error)?)
 };
 let mut messages=Vec::<Value>::new();if !request.system_prompt.trim().is_empty(){messages.push(json!({"role":"system","content":request.system_prompt}));}
 // Memory: durable notes plus a digest of turns that fell out of the replay window.
 let older=&old[..old.len().saturating_sub(RECENT_TURNS)];
 if let Some(block)=memory_block(&workspace_memory,&stored_memory,&memory_digest(older)) {
  let block:String=block.chars().take(MAX_MEMORY_CHARS).collect();
  messages.push(json!({"role":"system","content":block}));
 }
 // Replay recent turns. Attachments are re-sent only within a small budget so long threads stay affordable.
 let mut image_budget=MAX_REPLAY_IMAGES;let mut doc_budget=MAX_REPLAY_DOC_CHARS;
 for m in old.iter().rev().take(RECENT_TURNS).rev(){
  if m.role!="user"&&m.role!="assistant" {continue;}
  let original=replay_attachments(m);
  let mut kept=Vec::<Attachment>::new();
  for a in original.iter().cloned() {
   if a.kind=="image" {if image_budget==0{continue;}image_budget-=1;kept.push(a);}
   else {if doc_budget==0{continue;}let take=a.data.chars().take(doc_budget).collect::<String>();doc_budget-=take.chars().count();kept.push(Attachment{data:take,..a});}
  }
  let omitted=original.len().saturating_sub(kept.len());
  let mut text=m.content.clone();
  if omitted>0 {text.push_str(&format!("\n\n[{omitted} lampiran sebelumnya tidak dimuat ulang untuk menghemat konteks.]"));}
  messages.push(json!({"role":m.role,"content":user_content(&text,&kept)}));
 }
 messages.push(json!({"role":"user","content":user_content(&request.text,&request.attachments)}));
 {let conn=state.db.lock().map_err(db_error)?;
  let stored=if request.attachments.is_empty(){None}else{Some(serde_json::to_string(&request.attachments).map_err(db_error)?)};
  conn.execute("INSERT INTO messages(id,conversation_id,role,content,attachments,created_at) VALUES (?1,?2,'user',?3,?4,?5)",params![new_id(),request.conversation_id,request.text,stored,now()]).map_err(db_error)?;
  let title_source=if request.text.trim().is_empty(){request.attachments.first().map(|a|a.name.clone()).unwrap_or_default()}else{request.text.clone()};
  if old.is_empty(){let title:String=title_source.chars().take(64).collect();conn.execute("UPDATE conversations SET title=?1,model_uid=?2,updated_at=?3 WHERE id=?4",params![title,request.model_uid,now(),request.conversation_id]).map_err(db_error)?;}else{conn.execute("UPDATE conversations SET model_uid=?1,updated_at=?2 WHERE id=?3",params![request.model_uid,now(),request.conversation_id]).map_err(db_error)?;}}
 let start=Instant::now();let reply=state.http.post(format!("{url}/chat/completions")).bearer_auth(&secret).json(&json!({"model":model.model_id,"messages":messages,"stream":true})).timeout(Duration::from_secs(180)).send().await;
 // Some gateways reject stream_options; this can be handled by users through a compatible gateway, no silent double-send.
 let response=reply.map_err(|e|format!("Connection failed: {e}"))?;
 if !response.status().is_success(){let status=response.status();let body=response.text().await.unwrap_or_default();let err=status_err(status,&body,&secret);let conn=state.db.lock().map_err(db_error)?;db::log(&conn,&model.provider_id,&model.model_id,"chat",false,Some(start.elapsed().as_millis() as i64),None,None,Some(&err)).map_err(db_error)?;return Err(err);}
 let mut stream=response.bytes_stream();let mut buffer=Vec::<u8>::new();let mut full=String::new();let mut input=None;let mut output=None;let mut stopped=false;let mut seen_done=false;
 loop {
  if flag.load(Ordering::Relaxed){stopped=true;break;}
  let next=tokio::select!{next=stream.next()=>next,_=tokio::time::sleep(Duration::from_millis(100))=>{continue;}};
  let Some(item)=next else {break};let bytes=item.map_err(|e|format!("Stream interrupted: {e}"))?;
  buffer.extend_from_slice(&bytes);
  if buffer.len()>4_000_000{return Err("Provider returned an excessively long SSE line.".into());}
  while let Some(pos)=buffer.iter().position(|c|*c==b'\n') {
   let chunk:Vec<u8>=buffer.drain(..=pos).collect();let line=String::from_utf8_lossy(&chunk);let line=line.trim();
   let Some(payload)=line.strip_prefix("data:") else {continue};let payload=payload.trim();
   if payload=="[DONE]" {seen_done=true;break;}
   let Ok(item)=serde_json::from_str::<Value>(payload) else {continue};
   if let Some(usage)=item.get("usage"){input=usage.get("prompt_tokens").and_then(Value::as_i64).or(input);output=usage.get("completion_tokens").and_then(Value::as_i64).or(output);}
   if let Some(err)=item.get("error"){return Err(format!("Provider SSE error: {}",err.to_string().chars().take(180).collect::<String>()));}
   if let Some(delta)=item.pointer("/choices/0/delta/content").and_then(Value::as_str){full.push_str(delta);if full.len()>2_000_000{return Err("Response exceeded the 2MB safety limit.".into());}let mut ev=StreamEvent::new(&request.request_id,"delta");ev.delta=Some(delta.to_string());register_event(app,ev);}
  }
  if seen_done {break;}
 }
 if !full.is_empty(){let conn=state.db.lock().map_err(db_error)?;conn.execute("INSERT INTO messages(id,conversation_id,role,content,created_at) VALUES (?1,?2,'assistant',?3,?4)",params![new_id(),request.conversation_id,full,now()]).map_err(db_error)?;conn.execute("UPDATE conversations SET updated_at=?1 WHERE id=?2",params![now(),request.conversation_id]).map_err(db_error)?;}
 let ms=start.elapsed().as_millis() as i64;{let conn=state.db.lock().map_err(db_error)?;db::log(&conn,&model.provider_id,&model.model_id,"chat",!stopped,Some(ms),input,output,if stopped{Some("User stopped generation")}else{None}).map_err(db_error)?;}
 let mut done=StreamEvent::new(&request.request_id,if stopped{"stopped"}else{"done"});done.latency_ms=Some(ms);done.tokens_in=input;done.tokens_out=output;register_event(app,done);Ok(())
}

#[tauri::command]
async fn stream_chat(app:AppHandle,state:State<'_,AppState>,request:ChatRequest)->Result<(),String>{
 if request.request_id.len()>120{return Err("Invalid request ID.".into());}
 let flag=Arc::new(AtomicBool::new(false));{
  let mut running=state.cancellations.lock().map_err(db_error)?;
  if running.contains_key(&request.request_id){return Err("Generation already running for this ID.".into());}
  running.insert(request.request_id.clone(),flag.clone());
 }
 let result=send_chat_stream(&app,&state,&request,&flag).await;
 {state.cancellations.lock().map_err(db_error)?.remove(&request.request_id);}
 if let Err(err)=result{
  let mut event=StreamEvent::new(&request.request_id,"error");event.error=Some(err.clone());register_event(&app,event);
  return Err(err);
 }
 Ok(())
}

pub fn run(){
 tauri::Builder::default()
  .setup(|app|{
   let data_dir=app.path().app_data_dir()?;fs::create_dir_all(&data_dir)?;
   let conn=Connection::open(data_dir.join("hanoman.sqlite3"))?;
   db::setup(&conn)?;
   let client=Client::builder().user_agent("HanomanTelemetri/0.2.0").connect_timeout(Duration::from_secs(12)).timeout(Duration::from_secs(180)).build()?;
   app.manage(AppState{db:Mutex::new(conn),http:client,cancellations:Mutex::new(HashMap::new())});
   Ok(())
  })
  .invoke_handler(tauri::generate_handler![list_providers,list_keys,list_models,get_stats,list_activity,list_conversations,get_messages,add_provider,delete_provider,add_key,delete_key,scan_models,probe_model,create_conversation,delete_conversation,get_memory,save_memory,stop_generation,stream_chat,list_subject_records,list_report_records,save_subject_record,save_report_record,delete_subject_record,save_office_export])
  .run(tauri::generate_context!())
  .expect("failed to start Hanoman Telemetri");
}

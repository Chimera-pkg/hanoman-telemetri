use rusqlite::{params, Connection, OptionalExtension, Result};
use crate::types::*;

pub fn setup(conn:&Connection)->Result<()> {
 conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS providers (id TEXT PRIMARY KEY,name TEXT NOT NULL,base_url TEXT NOT NULL,created_at TEXT NOT NULL,last_scan TEXT);
 CREATE TABLE IF NOT EXISTS api_keys (id TEXT PRIMARY KEY,provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,label TEXT NOT NULL,masked TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'saved',last_error TEXT,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS models (uid TEXT PRIMARY KEY,provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,model_id TEXT NOT NULL,owned_by TEXT,status TEXT NOT NULL DEFAULT 'discovered',latency_ms INTEGER,last_checked TEXT,last_error TEXT,updated_at TEXT NOT NULL,UNIQUE(key_id,model_id));
 CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY,title TEXT NOT NULL,model_uid TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,role TEXT NOT NULL,content TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS subject_records (id TEXT PRIMARY KEY, name TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS report_records (id TEXT PRIMARY KEY, subject_id TEXT NOT NULL REFERENCES subject_records(id) ON DELETE CASCADE, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_report_subject ON report_records(subject_id);
 CREATE TABLE IF NOT EXISTS activities (id INTEGER PRIMARY KEY AUTOINCREMENT,provider_id TEXT,model_id TEXT,event TEXT NOT NULL,success INTEGER NOT NULL,latency_ms INTEGER,tokens_in INTEGER,tokens_out INTEGER,error TEXT,created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_models_status ON models(status);
 CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id,created_at);
 CREATE INDEX IF NOT EXISTS idx_activity_date ON activities(created_at DESC);
 CREATE INDEX IF NOT EXISTS idx_conversations_date ON conversations(updated_at DESC);")?;
 // Migration: attachments column was added after the first release.
 let has_attachments:bool=conn.prepare("PRAGMA table_info(messages)")?.query_map([],|r|r.get::<_,String>(1))?.filter_map(Result::ok).any(|name|name=="attachments");
 if !has_attachments {conn.execute("ALTER TABLE messages ADD COLUMN attachments TEXT",[])?;}
 // Migration: durable memory notes (workspace-wide + per conversation).
 let has_memory:bool=conn.prepare("PRAGMA table_info(conversations)")?.query_map([],|r|r.get::<_,String>(1))?.filter_map(Result::ok).any(|name|name=="memory");
 if !has_memory {conn.execute("ALTER TABLE conversations ADD COLUMN memory TEXT",[])?;}
 let seeded:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM app_meta WHERE key='initial_seed')",[],|r|r.get(0))?;
 if !seeded {let now=chrono::Utc::now().to_rfc3339();
  conn.execute("INSERT INTO providers(id,name,base_url,created_at) VALUES (?1,?2,?3,?4)",params!["carte","CarteThyia","https://cartethyia-production-682d.up.railway.app/v1",now])?;
  conn.execute("INSERT INTO providers(id,name,base_url,created_at) VALUES (?1,?2,?3,?4)",params!["router","9Router","https://9router-production-fc96.up.railway.app/v1",now])?;
  conn.execute("INSERT INTO app_meta(key,value) VALUES ('initial_seed','1')",[])?;
 }
 // Endpoint curated after the first release: seed once per database so a user deletion stays deleted.
 let seeded_rdhx:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM app_meta WHERE key='seed_rdhx')",[],|r|r.get(0))?;
 if !seeded_rdhx {
  conn.execute("INSERT OR IGNORE INTO providers(id,name,base_url,created_at) VALUES (?1,?2,?3,?4)",params!["rdhx","RDHX Bansos","https://api.rdhx.tech/v1",chrono::Utc::now().to_rfc3339()])?;
  conn.execute("INSERT INTO app_meta(key,value) VALUES ('seed_rdhx','1')",[])?;
 }
 Ok(())
}
pub fn providers(conn:&Connection)->Result<Vec<Provider>>{let mut stmt=conn.prepare("SELECT p.id,p.name,p.base_url,p.created_at,p.last_scan,(SELECT COUNT(*) FROM api_keys k WHERE k.provider_id=p.id),(SELECT COUNT(*) FROM models m WHERE m.provider_id=p.id) FROM providers p ORDER BY p.created_at,p.name")?;let result=stmt.query_map([],|r|Ok(Provider{id:r.get(0)?,name:r.get(1)?,base_url:r.get(2)?,created_at:r.get(3)?,last_scan:r.get(4)?,key_count:r.get(5)?,model_count:r.get(6)?}))?.collect();result}
pub fn keys(conn:&Connection)->Result<Vec<ApiKeyInfo>>{let mut stmt=conn.prepare("SELECT id,provider_id,label,masked,status,last_error,created_at FROM api_keys ORDER BY created_at")?;let result=stmt.query_map([],|r|Ok(ApiKeyInfo{id:r.get(0)?,provider_id:r.get(1)?,label:r.get(2)?,masked:r.get(3)?,status:r.get(4)?,last_error:r.get(5)?,created_at:r.get(6)?}))?.collect();result}
pub fn models(conn:&Connection)->Result<Vec<ModelInfo>>{let mut stmt=conn.prepare("SELECT m.uid,m.provider_id,p.name,m.key_id,k.label,m.model_id,m.owned_by,m.status,m.latency_ms,m.last_checked,m.last_error FROM models m JOIN providers p ON m.provider_id=p.id JOIN api_keys k ON m.key_id=k.id ORDER BY CASE m.status WHEN 'ready' THEN 0 WHEN 'discovered' THEN 1 ELSE 2 END,m.model_id")?;let result=stmt.query_map([],|r|row_model(r))?.collect();result}
pub fn row_model(r:&rusqlite::Row<'_>)->Result<ModelInfo>{Ok(ModelInfo{uid:r.get(0)?,provider_id:r.get(1)?,provider_name:r.get(2)?,key_id:r.get(3)?,key_label:r.get(4)?,model_id:r.get(5)?,owned_by:r.get(6)?,status:r.get(7)?,latency_ms:r.get(8)?,last_checked:r.get(9)?,last_error:r.get(10)?})}
pub fn get_model(conn:&Connection,uid:&str)->Result<ModelInfo>{conn.query_row("SELECT m.uid,m.provider_id,p.name,m.key_id,k.label,m.model_id,m.owned_by,m.status,m.latency_ms,m.last_checked,m.last_error FROM models m JOIN providers p ON m.provider_id=p.id JOIN api_keys k ON m.key_id=k.id WHERE m.uid=?1",[uid],row_model)}
pub fn stats(conn:&Connection)->Result<Stats>{let get=|sql:&str|conn.query_row(sql,[],|r|r.get::<_,i64>(0));let avg:Option<i64>=conn.query_row("SELECT CAST(AVG(latency_ms) AS INTEGER) FROM activities WHERE success=1 AND latency_ms IS NOT NULL",[],|r|r.get(0))?;Ok(Stats{providers:get("SELECT COUNT(*) FROM providers")?,keys:get("SELECT COUNT(*) FROM api_keys")?,models:get("SELECT COUNT(*) FROM models")?,ready:get("SELECT COUNT(*) FROM models WHERE status='ready'")?,average_latency:avg,requests:get("SELECT COUNT(*) FROM activities")?,errors:get("SELECT COUNT(*) FROM activities WHERE success=0")?})}
pub fn activity(conn:&Connection)->Result<Vec<Activity>>{let mut stmt=conn.prepare("SELECT a.id,COALESCE(p.name,'Deleted provider'),COALESCE(a.model_id,'—'),a.event,a.success,a.latency_ms,a.tokens_in,a.tokens_out,a.error,a.created_at FROM activities a LEFT JOIN providers p ON p.id=a.provider_id ORDER BY a.created_at DESC LIMIT 250")?;let result=stmt.query_map([],|r|Ok(Activity{id:r.get(0)?,provider_name:r.get(1)?,model_id:r.get(2)?,event:r.get(3)?,success:r.get::<_,i64>(4)?==1,latency_ms:r.get(5)?,tokens_in:r.get(6)?,tokens_out:r.get(7)?,error:r.get(8)?,created_at:r.get(9)?}))?.collect();result}
pub fn conversations(conn:&Connection)->Result<Vec<Conversation>>{let mut stmt=conn.prepare("SELECT id,title,model_uid,created_at,updated_at FROM conversations ORDER BY updated_at DESC LIMIT 200")?;let result=stmt.query_map([],|r|Ok(Conversation{id:r.get(0)?,title:r.get(1)?,model_uid:r.get(2)?,created_at:r.get(3)?,updated_at:r.get(4)?}))?.collect();result}
pub fn messages(conn:&Connection,id:&str)->Result<Vec<ChatMessage>>{let mut stmt=conn.prepare("SELECT id,conversation_id,role,content,attachments,created_at FROM messages WHERE conversation_id=?1 ORDER BY created_at,rowid")?;let result=stmt.query_map([id],|r|{let raw:Option<String>=r.get(4)?;Ok(ChatMessage{id:r.get(0)?,conversation_id:r.get(1)?,role:r.get(2)?,content:r.get(3)?,attachments:raw.and_then(|s|serde_json::from_str(&s).ok()),created_at:r.get(5)?})})?.collect();result}
pub fn log(conn:&Connection,provider_id:&str,model_id:&str,event:&str,success:bool,ms:Option<i64>,input:Option<i64>,output:Option<i64>,error:Option<&str>)->Result<()> {conn.execute("INSERT INTO activities(provider_id,model_id,event,success,latency_ms,tokens_in,tokens_out,error,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",params![provider_id,model_id,event,success as i32,ms,input,output,error,chrono::Utc::now().to_rfc3339()])?;Ok(())}
pub fn workspace_memory(conn:&Connection)->Result<String>{conn.query_row("SELECT value FROM app_meta WHERE key='workspace_memory'",[],|r|r.get(0)).optional().map(|v:Option<String>|v.unwrap_or_default())}
pub fn set_workspace_memory(conn:&Connection,value:&str)->Result<()>{conn.execute("INSERT INTO app_meta(key,value) VALUES ('workspace_memory',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[value])?;Ok(())}
pub fn conversation_memory(conn:&Connection,id:&str)->Result<String>{conn.query_row("SELECT COALESCE(memory,'') FROM conversations WHERE id=?1",[id],|r|r.get(0)).optional().map(|v:Option<String>|v.unwrap_or_default())}
pub fn set_conversation_memory(conn:&Connection,id:&str,value:&str)->Result<()>{conn.execute("UPDATE conversations SET memory=?2 WHERE id=?1",params![id,value])?;Ok(())}
pub fn message_count(conn:&Connection,id:&str)->Result<i64>{conn.query_row("SELECT COUNT(*) FROM messages WHERE conversation_id=?1",[id],|r|r.get(0))}

use serde::{Deserialize, Serialize};
#[derive(Debug,Serialize)]
pub struct Provider { pub id:String,pub name:String,pub base_url:String,pub created_at:String,pub last_scan:Option<String>,pub key_count:i64,pub model_count:i64 }
#[derive(Debug,Serialize)]
pub struct ApiKeyInfo { pub id:String,pub provider_id:String,pub label:String,pub masked:String,pub status:String,pub last_error:Option<String>,pub created_at:String }
#[derive(Debug,Serialize)]
pub struct ModelInfo { pub uid:String,pub provider_id:String,pub provider_name:String,pub key_id:String,pub key_label:String,pub model_id:String,pub owned_by:Option<String>,pub status:String,pub latency_ms:Option<i64>,pub last_checked:Option<String>,pub last_error:Option<String> }
#[derive(Debug,Serialize)]
pub struct Stats { pub providers:i64,pub keys:i64,pub models:i64,pub ready:i64,pub average_latency:Option<i64>,pub requests:i64,pub errors:i64 }
#[derive(Debug,Serialize)]
pub struct Activity { pub id:i64,pub provider_name:String,pub model_id:String,pub event:String,pub success:bool,pub latency_ms:Option<i64>,pub tokens_in:Option<i64>,pub tokens_out:Option<i64>,pub error:Option<String>,pub created_at:String }
#[derive(Debug,Serialize)]
pub struct Conversation { pub id:String,pub title:String,pub model_uid:Option<String>,pub created_at:String,pub updated_at:String }
#[derive(Debug,Serialize)]
pub struct ChatMessage { pub id:String,pub conversation_id:String,pub role:String,pub content:String,pub attachments:Option<Vec<Attachment>>,pub created_at:String }
#[derive(Debug,Serialize)]
pub struct ScanSummary { pub scanned_keys:i64,pub discovered_models:i64,pub errors:Vec<String> }
#[derive(Debug,Serialize)]
pub struct MemoryInfo { pub workspace:String,pub conversation:String,pub messages:i64,pub recent:i64,pub digest:i64 }
/// One file the user attached to a chat turn.
/// `kind` is "image" (data = data URL) or "document" (data = extracted plain text).
#[derive(Debug,Deserialize,Serialize,Clone)]
pub struct Attachment { pub kind:String,pub name:String,pub mime:String,pub data:String }
#[derive(Debug,Deserialize)]
pub struct ChatRequest { pub request_id:String,pub conversation_id:String,pub model_uid:String,pub text:String,pub system_prompt:String,
 #[serde(default)] pub attachments:Vec<Attachment> }
#[derive(Debug,Serialize,Clone)]
#[serde(rename_all="camelCase")]
pub struct StreamEvent { pub request_id:String,pub kind:String,pub delta:Option<String>,pub error:Option<String>,pub latency_ms:Option<i64>,pub tokens_in:Option<i64>,pub tokens_out:Option<i64> }
impl StreamEvent {
 pub fn new(id:&str,kind:&str)->Self{Self{request_id:id.to_string(),kind:kind.to_string(),delta:None,error:None,latency_ms:None,tokens_in:None,tokens_out:None}}
}

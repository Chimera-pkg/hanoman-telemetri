export type ModelStatus = 'discovered' | 'ready' | 'rate_limited' | 'auth_failed' | 'unsupported' | 'degraded' | 'failed' | 'unknown';
export type KeyStatus = 'saved' | 'valid' | 'auth_failed' | 'error';
export type Page = 'overview' | 'models' | 'chat' | 'providers' | 'telemetry' | 'reports' | 'subjects' | 'settings';
export interface Provider { id: string; name: string; base_url: string; created_at: string; last_scan: string | null; key_count: number; model_count: number; }
export interface ApiKeyInfo { id: string; provider_id: string; label: string; masked: string; status: KeyStatus; last_error: string | null; created_at: string; }
export interface ModelInfo { uid: string; provider_id: string; provider_name: string; key_id: string; key_label: string; model_id: string; owned_by: string | null; status: ModelStatus; latency_ms: number | null; last_checked: string | null; last_error: string | null; }
export interface Stats { providers: number; keys: number; models: number; ready: number; average_latency: number | null; requests: number; errors: number; }
export interface Activity { id: number; provider_name: string; model_id: string; event: string; success: boolean; latency_ms: number | null; tokens_in: number | null; tokens_out: number | null; error: string | null; created_at: string; }
export interface Conversation { id: string; title: string; model_uid: string | null; created_at: string; updated_at: string; }
export interface Attachment { kind: 'image' | 'document'; name: string; mime: string; data: string; }
export interface ChatMessage { id: string; conversation_id: string; role: 'user' | 'assistant' | 'system'; content: string; attachments?: Attachment[] | null; created_at: string; }
export type StreamEvent = { requestId: string; kind: 'delta' | 'done' | 'error' | 'stopped'; delta?: string; error?: string; latencyMs?: number; tokensIn?: number; tokensOut?: number; };
export interface ScanSummary { scanned_keys: number; discovered_models: number; errors: string[]; }
export interface MemoryInfo { workspace: string; conversation: string; messages: number; recent: number; digest: number; }

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { Provider,ApiKeyInfo,ModelInfo,Stats,Activity,Conversation,ChatMessage,ScanSummary,StreamEvent,Attachment,MemoryInfo } from '../types';
import {demoProviders,demoKeys,demoModels,demoStats,demoActivities,demoConversations} from './demo';
export const isNative = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
export async function getSnapshot(): Promise<{providers:Provider[];keys:ApiKeyInfo[];models:ModelInfo[];stats:Stats;activity:Activity[];conversations:Conversation[]}> {
 if (!isNative) return {providers:demoProviders,keys:demoKeys,models:demoModels,stats:demoStats,activity:demoActivities,conversations:demoConversations};
 const [providers,keys,models,stats,activity,conversations]=await Promise.all([
   invoke<Provider[]>('list_providers'),invoke<ApiKeyInfo[]>('list_keys'),invoke<ModelInfo[]>('list_models'),invoke<Stats>('get_stats'),invoke<Activity[]>('list_activity'),invoke<Conversation[]>('list_conversations')
 ]);
 return {providers,keys,models,stats,activity,conversations};
}
const nativeOnly=()=>{throw new Error('Preview mode: install and launch the Tauri desktop app to connect real providers.');};
export const api = {
 addProvider: (name:string,baseUrl:string)=>isNative?invoke<Provider>('add_provider',{name,baseUrl}):Promise.reject(nativeOnly()),
 deleteProvider: (providerId:string)=>isNative?invoke<void>('delete_provider',{providerId}):Promise.reject(nativeOnly()),
 addKey: (providerId:string,label:string,secret:string)=>isNative?invoke<ApiKeyInfo>('add_key',{providerId,label,secret}):Promise.reject(nativeOnly()),
 deleteKey: (keyId:string)=>isNative?invoke<void>('delete_key',{keyId}):Promise.reject(nativeOnly()),
 scan: (providerId?:string)=>isNative?invoke<ScanSummary>('scan_models',{providerId:providerId??null}):Promise.reject(nativeOnly()),
 probe: (modelUid:string)=>isNative?invoke<ModelInfo>('probe_model',{modelUid}):Promise.reject(nativeOnly()),
 createChat: (modelUid:string|null)=>isNative?invoke<Conversation>('create_conversation',{modelUid}):Promise.reject(nativeOnly()),
 deleteChat: (conversationId:string)=>isNative?invoke<void>('delete_conversation',{conversationId}):Promise.reject(nativeOnly()),
 getMemory: (conversationId?:string|null)=>isNative?invoke<MemoryInfo>('get_memory',{conversationId:conversationId??null}):Promise.resolve<MemoryInfo>({workspace:'',conversation:'',messages:0,recent:0,digest:0}),
 saveMemory: (conversationId:string|null,workspace:string,conversation:string)=>isNative?invoke<MemoryInfo>('save_memory',{conversationId,workspace,conversation}):Promise.reject(nativeOnly()),
 messages: (conversationId:string)=>isNative?invoke<ChatMessage[]>('get_messages',{conversationId}):Promise.resolve([]),
 stream: (requestId:string,conversationId:string,modelUid:string,text:string,systemPrompt:string,attachments:Attachment[]=[])=>isNative?invoke<void>('stream_chat',{request:{request_id:requestId,conversation_id:conversationId,model_uid:modelUid,text,system_prompt:systemPrompt,attachments}}):Promise.reject(nativeOnly()),
 stop: (requestId:string)=>isNative?invoke<void>('stop_generation',{requestId}):Promise.resolve(),
 onStream: (fn:(e:StreamEvent)=>void):Promise<UnlistenFn>=>isNative?listen<StreamEvent>('hanoman:stream',e=>fn(e.payload)):Promise.resolve(()=>{}),
};

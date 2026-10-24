import type { Provider, ApiKeyInfo, ModelInfo, Stats, Activity, Conversation } from '../types';
// Explicitly fictional preview data; NEVER represents live validation.
const date = (n: number) => new Date(Date.now() - n * 60000).toISOString();
export const demoProviders: Provider[] = [
  { id:'carte',name:'CarteThyia',base_url:'https://cartethyia-production-682d.up.railway.app/v1',created_at:date(5000),last_scan:date(11),key_count:2,model_count:4 },
  { id:'router',name:'9Router',base_url:'https://9router-production-fc96.up.railway.app/v1',created_at:date(5000),last_scan:date(11),key_count:1,model_count:3 },
  { id:'sample',name:'Demo Gateway',base_url:'https://demo.invalid/v1',created_at:date(5000),last_scan:date(30),key_count:1,model_count:2 },
];
export const demoKeys: ApiKeyInfo[] = [
  {id:'key1',provider_id:'carte',label:'Primary',masked:'•••• 9K2m',status:'valid',last_error:null,created_at:date(5000)},
  {id:'key2',provider_id:'carte',label:'Fallback',masked:'•••• X7pt',status:'saved',last_error:null,created_at:date(5000)},
  {id:'key3',provider_id:'router',label:'Main gateway',masked:'•••• D5qa',status:'valid',last_error:null,created_at:date(5000)},
  {id:'key4',provider_id:'sample',label:'Sandbox',masked:'•••• H4ac',status:'saved',last_error:null,created_at:date(5000)}
];
export const demoModels: ModelInfo[] = [
  ['model1','carte','CarteThyia','key1','Primary','atlas/reasoning-pro','ready',842,'Sample Labs'],
  ['model2','carte','CarteThyia','key1','Primary','nova/sonnet-4','ready',612,'Sample Labs'],
  ['model3','router','9Router','key3','Main gateway','orbit/gpt-vision','ready',521,'Sample Labs'],
  ['model4','router','9Router','key3','Main gateway','meridian/flash','ready',284,'Sample Labs'],
  ['model5','carte','CarteThyia','key2','Fallback','atlas/reasoning-pro','discovered',null,'Sample Labs'],
  ['model6','carte','CarteThyia','key2','Fallback','helios/coder-32b','rate_limited',null,'Sample Labs'],
  ['model7','router','9Router','key3','Main gateway','nimbus/chat-xl','failed',null,'Sample Labs'],
  ['model8','sample','Demo Gateway','key4','Sandbox','sandbox/text-lite','discovered',null,'Sample Labs'],
  ['model9','sample','Demo Gateway','key4','Sandbox','sandbox/embedding-v2','discovered',null,'Sample Labs'],
].map(([uid,provider_id,provider_name,key_id,key_label,model_id,status,latency_ms,owned_by]) => ({uid,provider_id,provider_name,key_id,key_label,model_id,status,latency_ms,owned_by,last_checked:date(11),last_error:null} as ModelInfo));
export const demoActivities: Activity[] = [
  ['probe','atlas/reasoning-pro','CarteThyia',true,842,5],['chat','nova/sonnet-4','CarteThyia',true,1451,9],['scan','—','9Router',true,322,11],['probe','nimbus/chat-xl','9Router',false,null,15],['chat','meridian/flash','9Router',true,284,20],['probe','helios/coder-32b','CarteThyia',false,null,28],['scan','—','CarteThyia',true,412,35],
].map(([event,model_id,provider_name,success,latency_ms,mins],i) => ({id:7-i,event,model_id,provider_name,success,latency_ms,tokens_in:i%2?72:null,tokens_out:i%2?261:null,error: success?null:'Illustrative failure',created_at:date(Number(mins))} as Activity));
export const demoConversations: Conversation[] = [
  {id:'demo-chat-1',title:'Architecture review for model routing',model_uid:'model1',created_at:date(1440),updated_at:date(240)},
  {id:'demo-chat-2',title:'Rust async stream patterns',model_uid:'model2',created_at:date(2880),updated_at:date(650)}
];
export const demoStats: Stats = {providers:3,keys:4,models:9,ready:4,average_latency:565,requests:1284,errors:24};

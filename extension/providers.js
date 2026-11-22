// PROVIDERS
const BOOL_TRUE = new Set(['true','1','yes','t']);
const BOOL_FALSE = new Set(['false','0','no','f']);
const FIG_HINTS = ['see fig','figure','see the diagram','refer to the image'];
const BLANK_RE = /[_\-]{3,}/;
const MAX_Q_CHARS = 1200; const WEB_Q_CHARS = 380;
const RETRY_VARIANTS = ['','Your earlier answer was wrong. Give a DIFFERENT concept.','Your earlier answers were wrong. Answer with the FULL formal name.','Your earlier answers were wrong. Identify the broader topic.','Your earlier answers were wrong. Answer with the most standard textbook term.'];
const ACRO_RE = /^[A-Z]{2,6}$/;
const STOP_WORDS = new Set(['this','that','these','those','is','are','was','were','the','a','an','also','called','which','what','it','its','of','in','on','for','to','and','or','be','by','with','as','at','from','not','can','does']);
let _orCooldownUntil = 0; let _orWebDisabled = false; let _orDisabled = false;
let _geminiCooldownUntil = 0; let _geminiDisabled = false;
function orCooling(){return !String(cfg('OPENROUTER_API_KEY')||'').trim()||_orDisabled||Date.now()/1000<_orCooldownUntil;}
function orTriggerCooldown(){_orCooldownUntil=Date.now()/1000+(Number(cfg('OPENROUTER_COOLDOWN'))||180);}
function geminiCooling(){return !String(cfg('GEMINI_API_KEY')||'').trim()||_geminiDisabled||Date.now()/1000<_geminiCooldownUntil;}

async function bgFetch(action,payload={},timeout=60000){return new Promise((resolve,reject)=>{const id=Date.now()+'_'+Math.random().toString(36).slice(2,8);let settled=false;const timer=setTimeout(()=>{settled=true;reject(new Error(action+' timed out'));},timeout);chrome.runtime.sendMessage({action,payload,_reqId:id},(response)=>{if(settled)return;settled=true;clearTimeout(timer);if(chrome.runtime.lastError){reject(new Error(chrome.runtime.lastError.message));return;}if(!response){reject(new Error(action+' returned no response'));return;}if(response.error){const error=new Error(response.error);error.status=response.status;reject(error);return;}if(response._reqId!==id){reject(new Error(action+' returned a mismatched response'));return;}resolve(response);});});}

function _warnOpenRouter(message){console.warn('[OpenRouter] '+message);if(typeof logHUD==='function')logHUD('warn','OpenRouter: '+message);}
async function postOpenRouter(messages,opts={}){
  if(orCooling())return null;
  const model=opts.model||cfg('OPENROUTER_MODEL');
  const maxTokens=opts.maxTokens||64;
  const temperature=opts.temperature??0.1;
  const timeoutSeconds=opts.timeout||25;
  const body={model,messages,temperature,max_tokens:maxTokens};
  if(opts.plugins)body.plugins=opts.plugins;
  if(!String(cfg('OPENROUTER_API_KEY')||'').trim())return null;
  const webPlugin=Boolean(opts.plugins&&opts.plugins.some((plugin)=>plugin.id==='web'));
  for(let attempt=0;attempt<2;attempt++){
    try{
      const response=await bgFetch('postOpenRouter',{body,timeout:timeoutSeconds*1000},(timeoutSeconds+5)*1000);
      if(response.error||[400,401,402,429].includes(response.status)){
        const error=new Error(typeof response.error==='string'?response.error:JSON.stringify(response.error||'OpenRouter request failed'));
        error.status=response.status;
        throw error;
      }
      return response;
    }catch(error){
      const status=error.status||Number((error.message.match(/\bHTTP\s+(\d{3})\b/i)||[])[1])||0;
      const reason=error.message||'Unknown OpenRouter error';
      if(status===401){
        _orDisabled=true;
        _orWebDisabled=true;
        _warnOpenRouter(`Invalid API key (${reason}); OpenRouter disabled for this session.`);
        return null;
      }
      if(status===402){
        _orDisabled=true;
        _orWebDisabled=true;
        _warnOpenRouter(`Insufficient credits (${reason}); OpenRouter disabled for this session.`);
        return null;
      }
      if(webPlugin&&status===400){
        _orWebDisabled=true;
        _warnOpenRouter(`web plugin failed (${reason}); disabling it and falling back to standard OpenRouter.`);
        return null;
      }
      if(status===429){
        if(attempt===0){
          _warnOpenRouter(`Rate limited (${reason}); retrying once in 2.5 seconds.`);
          await new Promise((resolve)=>setTimeout(resolve,2500));
          continue;
        }
        orTriggerCooldown();
        _warnOpenRouter(`Still rate limited (${reason}); cooling down and falling back to local Ollama.`);
        return null;
      }
      if(status===503){
        orTriggerCooldown();
        _warnOpenRouter(`Service unavailable (${reason}); cooling down and falling back to local Ollama.`);
        return null;
      }
      _warnOpenRouter(reason);
      return null;
    }
  }
  return null;
}
async function postGemini(messages,opts={}){
  if(geminiCooling())return null;
  const contents=[];
  for(const message of messages){
    const parts=[];
    const items=Array.isArray(message.content)?message.content:[{type:'text',text:message.content||''}];
    for(const item of items){
      if(item.type==='image_url'){
        const url=item.image_url&&item.image_url.url||'';
        const image=url.match(/^data:([^;]+);base64,(.+)$/);
        if(image)parts.push({inlineData:{mimeType:image[1],data:image[2]}});
      }else if(item.text)parts.push({text:item.text});
    }
    if(parts.length)contents.push({role:message.role==='assistant'?'model':'user',parts});
  }
  try{
    const timeoutSeconds=opts.timeout||30;
    const response=await bgFetch('postGemini',{
      model:cfg('GEMINI_MODEL'),
      contents,
      generationConfig:{temperature:opts.temperature??0.1,maxOutputTokens:opts.maxTokens||128},
      timeout:timeoutSeconds*1000,
    },(timeoutSeconds+5)*1000);
    return {choices:[{message:{content:response.text||''}}]};
  }catch(error){
    const status=error.status||Number((error.message.match(/\bHTTP\s+(\d{3})\b/i)||[])[1])||0;
    if(status===401||status===402)_geminiDisabled=true;
    if(status===429||status===503)_geminiCooldownUntil=Date.now()/1000+(Number(cfg('OPENROUTER_COOLDOWN'))||180);
    const fallback=status===401||status===402
      ? ' Gemini disabled for this session; trying the next fallback.'
      : status===429||status===503
        ? ' Gemini cooling down; trying the next fallback.'
        : '';
    console.warn('[Gemini] '+error.message+fallback);
    if(typeof logHUD==='function')logHUD('warn','Gemini: '+error.message+fallback);
    return null;
  }
}
async function postOllama(prompt,opts={}){const model=opts.model||cfg('OLLAMA_MODEL');const numPredict=opts.numPredict||120;const temperature=Number(opts.temperature??0.1)||0.1;const rawTimeout = Number(cfg('OLLAMA_TIMEOUT_MS'));const to = rawTimeout < 1000 ? Math.max(rawTimeout * 1000, 30000) : Math.max(rawTimeout, 30000);const numCtx = parseInt(cfg('OLLAMA_NUM_CTX'), 10) || 4096;const images=opts.images||[];const payload={model,prompt,stream:false,keep_alive:cfg('OLLAMA_KEEP_ALIVE'),options:{temperature, num_ctx:numCtx, num_predict:numPredict}};if(images.length)payload.images=images;try{return await bgFetch('postOllama',{payload,timeout:to});}catch(e){console.warn('[Ollama] '+e.message);if(typeof logHUD==='function')logHUD('warn','Ollama fallback: '+e.message);return null;}}

let _customCooldownUntil = 0; let _customDisabled = false;
function customCooling(){return !String(cfg('CUSTOM_API_KEY')||'').trim()||_customDisabled||Date.now()/1000<_customCooldownUntil;}
function customTriggerCooldown(){_customCooldownUntil=Date.now()/1000+(Number(cfg('OPENROUTER_COOLDOWN'))||180);}

async function postCustomApi(messages,opts={}){
  if(customCooling())return null;
  const customModel = opts.model || cfg('CUSTOM_MODEL') || 'auto';
  const maxTokens = opts.maxTokens || 64;
  const temperature = opts.temperature ?? 0.1;
  const timeoutSeconds = opts.timeout || 25;
  const baseUrl = cfg('CUSTOM_API_BASE_URL') || 'https://api.freellmapi.com/v1';
  const body = {model: customModel, messages, temperature, max_tokens: maxTokens};
  const isAutoModel = (customModel === 'auto' || !customModel);
  if(typeof logHUD==='function') logHUD('info', 'FreeLLMAPI: querying '+baseUrl+' (model: '+(isAutoModel?'auto':customModel)+')...');
  for(let attempt=0; attempt<2; attempt++){
    try{
      const response = await bgFetch('postCustomApi',{body,timeout:timeoutSeconds*1000},(timeoutSeconds+5)*1000);
      if(response.error || [400,401,402,429].includes(response.status)){
        const status = response.status || 0;
        const errorText = response.error ? (typeof response.error==='string'?response.error:JSON.stringify(response.error)) : 'Custom API request failed';
        const error = new Error(errorText);
        error.status = status;
        error.body = response.body;
        throw error;
      }
      return response;
    }catch(error){
      const status = error.status || Number((error.message.match(/\bHTTP\s+(\d{3})\b/i)||[])[1]) || 0;
      const reason = error.message || 'Unknown Custom API error';
      if(typeof logHUD==='function') logHUD('warn', 'FreeLLMAPI error: HTTP '+status+' - '+reason+(error.body?' | '+error.body:''));
      if(status===401){
        _customDisabled=true;
        console.warn('[CustomAPI] Invalid API key ('+reason+'); Custom API disabled for this session.');
        return null;
      }
      if(status===402){
        _customDisabled=true;
        console.warn('[CustomAPI] Insufficient credits ('+reason+'); Custom API disabled for this session.');
        return null;
      }
      if(status===429){
        if(attempt===0){
          console.warn('[CustomAPI] Rate limited ('+reason+'); retrying once in 2.5 seconds.');
          await new Promise((resolve)=>setTimeout(resolve,2500));
          continue;
        }
        customTriggerCooldown();
        console.warn('[CustomAPI] Still rate limited ('+reason+'); cooling down and falling back.');
        return null;
      }
      if(status===503){
        customTriggerCooldown();
        console.warn('[CustomAPI] Service unavailable ('+reason+'); cooling down and falling back.');
        return null;
      }
      if(isAutoModel && (status===400 || status===404)){
        if(typeof logHUD==='function') logHUD('info', 'FreeLLMAPI: "auto" model failed, will try to resolve model from /models endpoint');
        const resolved = await resolveCustomModel();
        if(resolved){
          body.model = resolved;
          if(typeof logHUD==='function') logHUD('info', 'FreeLLMAPI: resolved model to '+resolved+', retrying...');
          continue;
        }
      }
      console.warn('[CustomAPI] '+reason);
      return null;
    }
  }
  return null;
}

async function resolveCustomModel(){
  const baseUrl = (cfg('CUSTOM_API_BASE_URL') || 'https://api.freellmapi.com/v1').replace(/\/+$/,'');
  const url = baseUrl + '/models';
  const apiKey = cfg('CUSTOM_API_KEY');
  const headers = { 'Content-Type': 'application/json' };
  if(apiKey) headers['Authorization'] = 'Bearer ' + apiKey;
  try{
    const response = await fetch(url, { headers, timeout: 10000 });
    if(!response.ok) return null;
    const data = await response.json();
    const models = data?.data || data?.models || [];
    for(const m of models){
      const id = m.id || m.name || m.model;
      if(id && typeof id === 'string') return id;
    }
    return null;
  }catch(e){
    console.warn('[CustomAPI] Failed to resolve model from /models:', e.message);
    return null;
  }
}

function _optionNorm(text){text=(text||'').toLowerCase().replace(/[^a-z0-9 ]/g,' ');return text.replace(/\s+/g,' ').trim();}
function _wrongOptionIndices(options,wrongAnswers){const n=new Set((wrongAnswers||[]).map(a=>_optionNorm(a)).filter(Boolean));if(!n.size)return new Set();const idx=[];for(let i=0;i<options.length;i++)if(n.has(_optionNorm(options[i])))idx.push(i);return new Set(idx);}
function _readBool(raw){const text=(raw||'').trim().toLowerCase();if(/\b(true|yes|correct)\b/.test(text))return true;if(/\b(false|no|incorrect)\b/.test(text))return false;return null;}
function _boolIndex(options,wantTrue){const wanted=wantTrue?BOOL_TRUE:BOOL_FALSE;return options.findIndex((option)=>wanted.has((option||'').trim().toLowerCase()));}
function _isBoolQuestion(options){return options.length===2&&options.every((option)=>BOOL_TRUE.has(option.trim().toLowerCase())||BOOL_FALSE.has(option.trim().toLowerCase()));}
function _interpretFilteredAnswer(raw,options,originalIndices){const index=_interpretAnswer(raw,options);if(index!==-1)return index;const match=(raw||'').match(/^\s*(?:option\s*)?(\d{1,2})\s*[.)]?\s*$/i);if(!match)return-1;const originalIndex=parseInt(match[1],10)-1;return originalIndices.indexOf(originalIndex);}
function _interpretMulti(raw,options,excluded){if(!raw)return[];const blocked=new Set(excluded||[]),picked=new Set();for(const match of raw.matchAll(/\b(\d{1,2})\b/g)){const index=parseInt(match[1],10)-1;if(index>=0&&index<options.length&&!blocked.has(index))picked.add(index);}if(!picked.size){for(const match of raw.matchAll(/(?<![A-Za-z])([A-Za-z])(?![A-Za-z])/g)){const index=match[1].toUpperCase().charCodeAt(0)-65;if(index>=0&&index<options.length&&!blocked.has(index))picked.add(index);}}if(!picked.size){const text=raw.toLowerCase();for(let i=0;i<options.length;i++)if(!blocked.has(i)&&options[i]&&text.includes(options[i].toLowerCase()))picked.add(i);}return[...picked].sort((a,b)=>a-b);}
function _domainNote(question){const text=(question||'').toLowerCase();if(/\b(computer|network|software|database|program|technical|server|internet|protocol)\b/.test(text))return'This is a technical/IT item — use precise technical terminology.';if(/\b(history|society|culture|politic|economic|philosoph|psycholog|sociolog|humanit)\b/.test(text))return'This is a social/humanities item — use the standard scholarly term.';return'Use the standard textbook term or phrase.';}
function _cleanTyped(raw,blank){let text=(raw||'').trim().replace(/^```[a-zA-Z]*\s*|\s*```$/g,'').trim().split('\n')[0]||'';text=text.replace(/^(answer|ans|correct answer)\s*[:-]\s*/i,'').replace(/^[*\-\u2022]\s+/,'').replace(/^\d+[.)]\s+/,'').trim().replace(/^["'`*]+|["'`*]+$/g,'').replace(/\s+/g,' ');if(blank){text=text.replace(/\s\([^)]*\)\s*$/,'').trim();if(text.length>40)text=text.replace(/\s*[-–—/]\s*.*$/,'').trim();}if(text.length>160)text=text.split(/(?<=[.!?])\s/)[0]||text.slice(0,160);text=text.replace(/[.]$/,'').trim();return /^(none|unknown|n\/a)$/i.test(text)?'':text;}
function _echoesQuestion(answer,question){const text=(answer||'').trim();if(!/^[A-Z]{2,6}$/.test(text))return false;const initials=(question||'').match(/[A-Za-z]+/g)||[];return initials.map((word)=>word[0].toUpperCase()).join('').includes(text);}
function _searchQuery(question){const text=(question||'').replace(/[_-]{2,}/g,' ').replace(/\b(select one|select one or more|choose\.{0,3}|true or false|answer\s*\d+\s*[.)]?\s*question\s*\d+)\b/gi,' ');const words=(text.match(/[A-Za-z0-9-]+/g)||[]).filter((word)=>!STOP_WORDS.has(word.toLowerCase()));return words.slice(0,14).join(' ').slice(0,120)||text.replace(/\s+/g,' ').trim().slice(0,120);}
async function ollamaWebSearch(query){const clean=_searchQuery(query);if(!clean)return'';const key=normText(clean);const cached=await searchGet(key);if(cached)return cached;const result=await bgFetch('searchWeb',{query:clean,maxResults:cfg('WEB_SEARCH_MAX_RESULTS')});const text=result.text||'';if(text)await searchPut(key,text);return text;}
function _normalizeBankHits(value,question){
  if(value===null||value===undefined)return[];
  let rawHits=value;
  if(Array.isArray(value)&&value.length===2&&typeof value[0]==='number'&&Array.isArray(value[1]))rawHits=value[1];
  else if(!Array.isArray(value))rawHits=[value];
  const hits=[];
  for(const rawHit of rawHits){
    const hit=typeof rawHit==='string'?{answer:rawHit}:rawHit;
    if(!hit||typeof hit.answer!=='string'||!hit.answer.trim())continue;
    hits.push({question:typeof hit.question==='string'&&hit.question.trim()?hit.question:question,answer:hit.answer,course:hit.course||'imported'});
  }
  return hits;
}
async function localBankAnswerHits(question){
  const key=normText(question);
  if(!key)return null;
  const direct=await answerKeyGet(key);
  const directHits=_normalizeBankHits(direct,question);
  if(directHits.length)return directHits;
  const all=await answerKeyGetAll();
  let bestHits=null,bestScore=0;
  for(const [storedKey,value] of Object.entries(all)){
    const score=similarity(key,normText(storedKey));
    if(score<0.80||score<=bestScore)continue;
    const hits=_normalizeBankHits(value,storedKey);
    if(!hits.length)continue;
    bestHits=hits;
    bestScore=score;
  }
  if(bestHits)return bestHits;
  return direct!==null?[]:null;
}
async function localBankOptionMatches(question,options){
  const hits=await localBankAnswerHits(question);
  if(!hits||!options||!options.length)return[];
  const matches=[];
  const used=new Set();
  for(const hit of hits){
    const answer=normText(hit.answer);
    let bestIndex=-1,bestScore=0;
    for(let i=0;i<options.length;i++){
      if(used.has(i))continue;
      const option=normText(options[i]);
      const score=answer&&option?similarity(answer,option):0;
      if(score>bestScore){bestScore=score;bestIndex=i;}
    }
    if(bestIndex!==-1&&bestScore>=0.75){
      used.add(bestIndex);
      matches.push({index:bestIndex,option:options[bestIndex],answer:hit.answer});
    }
  }
  return matches;
}
async function _keyHits(question,options){
  const key=normText(question);
  if(!key)return[];
  const local=await localBankAnswerHits(question);
  if(local!==null)return local;
  if(key.length<8||FIG_HINTS.some((hint)=>(question||'').toLowerCase().includes(hint)))return[];
  try{
    const result=await bgFetch('getAnswerKey',{question:(question||'').slice(0,300),options:options||[]},(cfg('ANSWER_KEY_TIMEOUT')||4)*1000+5000);
    const hits=result.hits||[];
    await answerKeyPut(key,hits);
    return hits;
  }catch(error){
    console.warn('[providers] Answer-key lookup failed:',error.message);
    if(typeof logHUD==='function')logHUD('warn','Answer-key lookup failed: '+error.message);
    return[];
  }
}
function _answerOptionScore(answer,options){const value=normText(answer);let score=0;for(const option of options||[]){const candidate=normText(option);if(candidate&&(value===candidate))score=Math.max(score,1);else if(candidate&&(value.includes(candidate)||candidate.includes(value)))score=Math.max(score,0.85);}return score;}
function _bestKeyHit(question,hits,minScore,options){const query=normText(question);let best=null,bestQuestionScore=0,bestRank=-1;for(const hit of hits||[]){const questionScore=similarity(query,normText(hit.question));const optionScore=Math.max(hit.optionScore||0,_answerOptionScore(hit.answer,options));const qualifies=questionScore>=minScore||(options&&optionScore>=0.95&&questionScore>=minScore*0.65);const rank=questionScore+optionScore*0.15;if(qualifies&&rank>bestRank){best=hit;bestQuestionScore=questionScore;bestRank=rank;}}return best&&bestQuestionScore>=minScore?best:best&&options&&_answerOptionScore(best.answer,options)>=0.95?best:null;}
function _pickKeyAnswer(answer,options){const value=normText(answer);if(!value)return-1;if(BOOL_TRUE.has(value)||BOOL_FALSE.has(value)){const index=_boolIndex(options,BOOL_TRUE.has(value));if(index!==-1)return index;}let best=-1,score=0;for(let i=0;i<options.length;i++){const candidate=similarity(value,normText(options[i]));if(candidate>score){best=i;score=candidate;}}return score>=0.6?best:-1;}
async function keyIndex(question,options,minScore){const hits=await _keyHits(question,options);const hit=_bestKeyHit(question,hits,minScore===undefined?cfg('ANSWER_KEY_MIN_SCORE'):minScore,options);if(!hit)return-1;const answer=normText(hit.answer);const wrong=await getWrongAnswers(question);if(wrong.some((item)=>answer===normText(item)||similarity(answer,normText(item))>=0.9))return-1;return _pickKeyAnswer(hit.answer,options);}
async function keyAnswer(question){const hits=await _keyHits(question);const hit=_bestKeyHit(question,hits,cfg('ANSWER_KEY_TEXT_MIN_SCORE'));if(!hit)return'';const answer=_cleanTyped(hit.answer);const wrong=await getWrongAnswers(question);return wrong.some((item)=>normText(item)===normText(answer)||similarity(normText(item),normText(answer))>=0.9)?'':answer;}
async function keyMatchAnswer(question){const hits=await _keyHits(question);const hit=_bestKeyHit(question,hits,cfg('ANSWER_KEY_MATCH_MIN_SCORE'));return hit?_cleanTyped(hit.answer):'';}
async function hintText(question){const hits=await _keyHits(question);if(!_bestKeyHit(question,hits,0.35))return'';const lines=hits.slice(0,3).map((hit)=>'- '+(hit.question||'').slice(0,200)+'\n  KEY: '+(hit.answer||''));return'REFERENCE KEYS from amauoed.com (user-submitted, may be wrong — prefer them only if they fit the question):\n'+lines.join('\n');}
function _interpretAnswer(raw,options,excluded){if(!raw)return-1;const t=raw.trim(),n=options.length,e=new Set(excluded||[]),el=[];for(let i=0;i<n;i++)if(!e.has(i))el.push(i);const ue=el.length?el:[...Array(n).keys()];const m=t.match(/\b(\d{1,2})\b/);if(m){const i=parseInt(m[1],10)-1;if(i>=0&&i<n&&ue.includes(i))return i;}let lm=t.match(/^\s*[\(\[\{]?\s*([A-Za-z])\s*[\)\]\.:\-]/);if(!lm)lm=t.match(/^\s*([A-Za-z])\s*$/);if(lm){const i=lm[1].toUpperCase().charCodeAt(0)-65;if(i>=0&&i<n&&ue.includes(i))return i;}const lw=t.toLowerCase();let b=-1,s=0;for(let i=0;i<n;i++){if(e.has(i))continue;const o=options[i].toLowerCase().trim();if(!o)continue;if(o===lw)return i;let sc=similarity(lw,o);if(o.includes(lw)||lw.includes(o))sc=Math.max(sc,0.85);if(sc>s){b=i;s=sc;}}return s>=0.6?b:-1;}async function askBoolClaim(q,o,ex){const p='Decide whether the statement below is TRUE or FALSE.\nJudge it on the standard definition.\n\nStatement: '+q+'\n\nReply with ONLY TRUE or FALSE.';if(cfg('OPENROUTER_API_KEY')&&!orCooling()){const r=await postOpenRouter([{role:'user',content:p}],{maxTokens:64,temperature:0.1,timeout:25});if(r){const m=r.choices?.[0]?.message||{};const ra=((m.content||m.reasoning||'')).trim();const v=_readBool(ra);if(v!==null){const i=_boolIndex(o,v);const ee=new Set(ex||[]);if(i!==-1&&(ee.size>=o.length||!ee.has(i)))return i;}}}try{const r=await postOllama(p,{numPredict:16,temperature:0.1,timeout:30});if(r&&r.response){const v=_readBool(r.response.trim());if(v!==null){const i=_boolIndex(o,v);const ee=new Set(ex||[]);if(i!==-1&&(ee.size>=o.length||!ee.has(i)))return i;}}}catch(e){}return-1;}
async function _askGeminiPrompt(prompt,opts={}){const response=await postGemini([{role:'user',content:prompt}],opts);return response&&response.choices?.[0]?.message?.content||'';}
async function askGemini(q,o,ex,oi){if(!cfg('GEMINI_API_KEY'))return-1;const options=o.map((option,i)=>`${i+1}. ${option}`).join('\n');const prompt='You are an expert tutor answering an exam question. Select the BEST answer.\n\nQuestion: '+q+'\n\nOptions:\n'+options+'\n\nReply with ONLY the number.';const raw=await _askGeminiPrompt(prompt,{maxTokens:64,temperature:0.2,timeout:30});return oi?_interpretFilteredAnswer(raw,o,oi):_interpretAnswer(raw,o,ex);}
async function askGeminiVision(q,o,images){if(!cfg('GEMINI_API_KEY')||!images.length)return-1;const content=[{type:'text',text:_visionPrompt(q,o)},...images.map((image)=>({type:'image_url',image_url:{url:'data:image/png;base64,'+image}}))];const response=await postGemini([{role:'user',content}],{maxTokens:64,temperature:0.1,timeout:45});const raw=response?.choices?.[0]?.message?.content||'';return _interpretAnswer(raw,o,_wrongOptionIndices(o,await getWrongAnswers(q)));}
async function askGeminiMulti(q,o,excluded,note){if(!cfg('GEMINI_API_KEY'))return[];const forbidden=(excluded||[]).map((index)=>o[index]).filter(Boolean);const raw=await _askGeminiPrompt(_multiPrompt(q,o,note,forbidden),{maxTokens:64,temperature:0.2,timeout:30});return _interpretMulti(raw,o,excluded);}
async function askGeminiText(q,blank,forbidden,temperature,variant,note,force,courseContext){if(!cfg('GEMINI_API_KEY'))return'';const raw=await _askGeminiPrompt(_textPrompt(q,forbidden,variant,note,force,courseContext),{maxTokens:80,temperature:temperature??0.1,timeout:30});return _cleanTyped(raw,blank);}
async function askBoolClaim(q,o,ex){const p='Decide whether the statement below is TRUE or FALSE.\nJudge it on the standard definition.\n\nStatement: '+q+'\n\nReply with ONLY TRUE or FALSE.';if(cfg('GEMINI_API_KEY')){const raw=await _askGeminiPrompt(p,{maxTokens:32,temperature:0.1,timeout:30});const verdict=_readBool(raw);if(verdict!==null){const index=_boolIndex(o,verdict);const excluded=new Set(ex||[]);if(index!==-1&&(excluded.size>=o.length||!excluded.has(index)))return index;}}if(cfg('OPENROUTER_API_KEY')&&!orCooling()){const r=await postOpenRouter([{role:'user',content:p}],{maxTokens:64,temperature:0.1,timeout:25});if(r){const m=r.choices?.[0]?.message||{};const ra=((m.content||m.reasoning||'')).trim();const v=_readBool(ra);if(v!==null){const i=_boolIndex(o,v);const ee=new Set(ex||[]);if(i!==-1&&(ee.size>=o.length||!ee.has(i)))return i;}}}try{const r=await postOllama(p,{numPredict:16,temperature:0.1,timeout:30});if(r&&r.response){const v=_readBool(r.response.trim());if(v!==null){const i=_boolIndex(o,v);const ee=new Set(ex||[]);if(i!==-1&&(ee.size>=o.length||!ee.has(i)))return i;}}}catch(e){}return-1;}
async function askOpenRouter(q,o,ex,oi){if(!cfg('OPENROUTER_API_KEY')||orCooling())return-1;const ot=o.map((x,i)=>`${i+1}. ${x}`).join('\n');const p='You are an expert tutor answering an exam question. Select the BEST answer.\n\nQuestion: '+q+'\n\nOptions:\n'+ot+'\n\nReply with ONLY the number.';try{const r=await postOpenRouter([{role:'user',content:p}],{maxTokens:64,temperature:0.3,timeout:25});if(!r)return-1;const m=r.choices?.[0]?.message||{};const t=((m.content||m.reasoning||'')).trim();const idx=oi?_interpretFilteredAnswer(t,o,oi):_interpretAnswer(t,o,ex);if(idx!==-1)return idx;return-1;}catch(e){return-1;}}
async function askOpenRouterWeb(q,o,oi){if(!cfg('OPENROUTER_API_KEY')||_orWebDisabled||orCooling())return-1;const options=o.map((option,index)=>`${index+1}. ${option}`).join('\n');const prompt='Use web search results to answer this exam question.\n\nQuestion: '+q.slice(0,WEB_Q_CHARS)+'\n\nOptions:\n'+options+'\n\nReply with ONLY the option number.';const response=await postOpenRouter([{role:'user',content:prompt}],{plugins:[{id:'web',engine:'exa',max_results:cfg('WEB_SEARCH_MAX_RESULTS'),search_prompt:'Exact question and answer.'}],maxTokens:100,temperature:0.1,timeout:45});if(!response)return-1;const message=response.choices?.[0]?.message||{};const first=((message.content||message.reasoning||'').trim().split('\n')[0]||'');return oi?_interpretFilteredAnswer(first,o,oi):_interpretAnswer(first,o);}
async function askOllama(q,o,ex,oi){const ot=o.map((x,i)=>`${i+1}. ${x}`).join('\n');const p='You are an expert tutor answering an exam question accurately.\n\nQuestion: '+q+'\n\nOptions:\n'+ot+'\n\nReply with ONLY the number.';try{const r=await postOllama(p,{numPredict:32,temperature:0.1,timeout:60});if(r&&r.response){const t=r.response.trim();const idx=oi?_interpretFilteredAnswer(t,o,oi):_interpretAnswer(t,o,ex);if(idx!==-1)return idx;}return-1;}catch(e){return-1;}}
async function askCustomApi(q,o,ex,oi){if(!cfg('CUSTOM_API_KEY')||customCooling())return-1;const ot=o.map((x,i)=>`${i+1}. ${x}`).join('\n');const p='You are an expert tutor answering an exam question. Select the BEST answer.\n\nQuestion: '+q+'\n\nOptions:\n'+ot+'\n\nReply with ONLY the number.';try{const r=await postCustomApi([{role:'user',content:p}],{maxTokens:64,temperature:0.1,timeout:25});if(!r)return-1;const m=r.choices?.[0]?.message||{};const t=((m.content||m.reasoning||'')).trim();const idx=oi?_interpretFilteredAnswer(t,o,oi):_interpretAnswer(t,o,ex);if(idx!==-1)return idx;return-1;}catch(e){return-1;}}
function _visionPrompt(q,o){const ot=o.map((x,i)=>`${i+1}. ${x}`).join('\n');return'You are an expert tutor. The question refers to image(s).\n\nQuestion: '+q+'\n\nOptions:\n'+ot+'\n\nReply with ONLY the number.';}
async function askOpenRouterVision(q,o,im){if(!(cfg('OPENROUTER_API_KEY')&&im.length)||orCooling())return-1;const m=cfg('OPENROUTER_VISION_MODEL').trim()||cfg('OPENROUTER_MODEL');const c=[{type:'text',text:_visionPrompt(q,o)}];for(const b64 of im)c.push({type:'image_url',image_url:{url:'data:image/png;base64,'+b64}});try{const r=await postOpenRouter([{role:'user',content:c}],{model:m,maxTokens:64,temperature:0.1,timeout:45});if(!r)return-1;const msg=r.choices?.[0]?.message||{};const raw=((msg.content||msg.reasoning||'')).trim();const w=await getWrongAnswers(q);const ex=_wrongOptionIndices(o,w);return _interpretAnswer(raw,o,ex);}catch(e){return-1;}}



async function askOllamaVision(q,o,im){if(!im.length)return -1;try{const r=await postOllama(_visionPrompt(q,o),{model:cfg('OLLAMA_VISION_MODEL')||cfg('OLLAMA_MODEL'),numPredict:40,temperature:0.1,images:im,timeout:45});if(r&&r.response){const raw=r.response.trim();const w=await getWrongAnswers(q);const ex=_wrongOptionIndices(o,w);return _interpretAnswer(raw,o,ex);}return -1;}catch(e){return -1;}}
async function askVision(q,o,im){if(!(cfg('VISION_ENABLED')&&im.length))return -1;console.log('Vision');if(cfg('GEMINI_API_KEY')){const i=await askGeminiVision(q,o,im);if(i!==-1)return i;}if(cfg('OPENROUTER_API_KEY')&&!orCooling()){const i=await askOpenRouterVision(q,o,im);if(i!==-1)return i;}const i=await askOllamaVision(q,o,im);if(i!==-1)return i;return -1;}
function _multiPrompt(q,o,n,f){const ot=o.map((x,i)=>(i+1)+'. '+x).join('\n');let p='';if(f&&f.length)p+='Do NOT pick these, already wrong: '+[...f].sort().join(', ')+'\n\n';if(n)p+=n+'\n\n';return p+'You are an expert tutor answering a multiple-answer question. MORE THAN ONE is correct.\n\nQuestion: '+q+'\n\nOptions:\n'+ot+'\n\nReply with ONLY numbers separated by commas.';}
async function askOpenRouterMulti(q,o,ex,n){if(!cfg('OPENROUTER_API_KEY')||orCooling())return[];const f=(ex||[]).map(i=>o[i]).filter(Boolean);try{const r=await postOpenRouter([{role:'user',content:_multiPrompt(q,o,n,f)}],{maxTokens:64,temperature:0.2,timeout:25});if(!r)return[];const m=r.choices?.[0]?.message||{};const ra=((m.content||m.reasoning||'')).trim();let p=_interpretMulti(ra,o,ex);if(!p.length)p=_interpretMulti(ra,o);return p;}catch(e){return[];}}
async function askOpenRouterWebMulti(q,o,ex){if(!cfg('OPENROUTER_API_KEY')||_orWebDisabled||orCooling())return[];const excluded=(ex||[]).map((index)=>o[index]).filter(Boolean);const prompt=_multiPrompt(q,o,'Use web search results to select the correct options.',excluded);const response=await postOpenRouter([{role:'user',content:prompt}],{plugins:[{id:'web',engine:'exa',max_results:cfg('WEB_SEARCH_MAX_RESULTS'),search_prompt:'Exact question and answers.'}],maxTokens:100,temperature:0.1,timeout:45});if(!response)return[];const message=response.choices?.[0]?.message||{};const first=((message.content||message.reasoning||'').trim().split('\n')[0]||'');return _interpretMulti(first,o,ex);}
async function askOllamaMulti(q,o,ex,n){const f=(ex||[]).map(i=>o[i]).filter(Boolean);try{const r=await postOllama(_multiPrompt(q,o,n,f),{numPredict:48,temperature:0.1,timeout:45});if(r&&r.response){const ra=r.response.trim();let p=_interpretMulti(ra,o,ex);if(!p.length)p=_interpretMulti(ra,o);return p;}return[];}catch(e){return[];}}
async function askCustomApiMulti(q,o,ex,n){if(!cfg('CUSTOM_API_KEY')||customCooling())return[];const f=(ex||[]).map(i=>o[i]).filter(Boolean);try{const r=await postCustomApi([{role:'user',content:_multiPrompt(q,o,n,f)}],{maxTokens:64,temperature:0.2,timeout:25});if(!r)return[];const m=r.choices?.[0]?.message||{};const ra=((m.content||m.reasoning||'')).trim();let p=_interpretMulti(ra,o,ex);if(!p.length)p=_interpretMulti(ra,o);return p;}catch(e){return[];}}
async function askWebMulti(q,o,ex){
  if(!cfg('WEB_SEARCH_ENABLED'))return[];
  try{
    const searchResults=await ollamaWebSearch(_searchQuery(q));
    if(!searchResults)return[];
    const text=' '+_optionNorm(searchResults)+' ';
    return o.map((option,index)=>({option,index})).filter(({option})=>{
      const normalized=_optionNorm(option);
      return normalized.length>=3&&text.includes(' '+normalized+' ');
    }).map(({index})=>index).filter((index)=>!(ex||[]).includes(index));
  }catch(error){console.warn('[providers] Non-AI multi-answer search failed:',error.message);return[];}
}
async function askAiMulti(q,o,im){im=im||[];const local=await localBankOptionMatches(q,o);if(local.length)return local.map((match)=>match.index);const w=await getWrongAnswers(q);const b=new Set(w.map(x=>normText(x)));const vp=[];for(let i=0;i<o.length;i++){const on=normText(o[i]);if(!(b.has(on)||[...b].some(x=>similarity(on,x)>=0.9)))vp.push(i);}if(!vp.length)for(let i=0;i<o.length;i++)vp.push(i);const fo=vp.map(i=>o[i]);const kp=[];if(cfg('ANSWER_KEY_ENABLED')){const ki=await keyIndex(q,fo,0.72);if(ki!==-1)kp.push(ki);const e=await keyAnswer(q);if(e){for(const i of _interpretMulti(e,fo))if(!kp.includes(i))kp.push(i);}}if(cfg('WEB_SEARCH_ENABLED')){const wp=await askWebMulti(q,fo);if(wp.length)return wp.map(p=>vp[p]).filter(p=>p<vp.length);}let nt='';if(kp.length)nt='Key suggests '+kp.map(p=>String(p+1)).join(', ')+'.';if(cfg('CUSTOM_API_KEY')&&!customCooling()){const picks=await askCustomApiMulti(q,fo,null,nt);if(picks.length)return picks.map(p=>vp[p]).filter(p=>p<vp.length);}if(cfg('GEMINI_API_KEY')){const picks=await askGeminiMulti(q,fo,null,nt);if(picks.length)return picks.map(p=>vp[p]).filter(p=>p<vp.length);}if(cfg('OPENROUTER_API_KEY')&&!_orWebDisabled&&!orCooling()){const webPicks=await askOpenRouterWebMulti(q,fo);if(webPicks.length)return webPicks.map(p=>vp[p]).filter(p=>p<vp.length);}if(cfg('OPENROUTER_API_KEY')&&!orCooling()){const pk=await askOpenRouterMulti(q,fo,null,nt);if(pk.length)return pk.map(p=>vp[p]).filter(p=>p<vp.length);}try{const pk=await askOllamaMulti(q,fo,null,nt);if(pk.length)return pk.map(p=>vp[p]).filter(p=>p<vp.length);}catch(e){}if(kp.length)return kp.map(p=>vp[p]).filter(p=>p<vp.length);return[];}
async function askWeb(q,o,oi){
  if(!cfg('WEB_SEARCH_ENABLED'))return-1;
  try{
    const searchResults=await ollamaWebSearch(_searchQuery((q||'').slice(0,WEB_Q_CHARS)));
    if(!searchResults)return-1;
    const text=' '+_optionNorm(searchResults)+' ';
    const matches=o.map((option,index)=>({option,index})).filter(({option})=>{
      const normalized=_optionNorm(option);
      return normalized.length>=3&&text.includes(' '+normalized+' ');
    });
    if(matches.length!==1)return-1;
    return matches[0].index;
  }catch(error){console.warn('[providers] Non-AI web search failed:',error.message);return-1;}
}
function _textPrompt(q,f,v,n,force,courseContext){
  const hasBlank=BLANK_RE.test(q);
  let prompt='';
  if(f&&f.length)prompt+='CRITICAL: Do NOT answer with: '+[...new Set(f)].sort().join(', ')+'.\n\n';
  if(v)prompt+=RETRY_VARIANTS[Math.min(v,RETRY_VARIANTS.length-1)]+'\n\n';
  if(n)prompt=n+'\n\n'+prompt;
  const blankRules=hasBlank
    ? '\nTHE QUESTION HAS A ______ BLANK.\nReturn ONLY the exact missing word or shortest correct phrase. Do not write a full sentence, quotation marks, or an explanation.\n'
    : '\nReturn ONLY the exact answer word or short phrase (1-5 words). Never write sentences or explanations.\n';
  const unknownRule=force?'- NONE is not allowed.\n':'- If unknown, reply NONE\n';
  const contextLine = courseContext ? '\nCourse/Subject: '+courseContext+'\n' : '';
  return prompt+'You are an expert tutor.\n'+_domainNote(q)+contextLine+'\n'+unknownRule+blankRules+'Question: '+q+'\n\nReply with ONLY the exact answer.';
}
async function askOpenRouterText(q,bl,f,t,v,n,force,courseContext){if(!cfg('OPENROUTER_API_KEY')||orCooling())return'';try{const r=await postOpenRouter([{role:'user',content:_textPrompt(q,f,v,n,force,courseContext)}],{maxTokens:80,temperature:t??0.1,timeout:25});if(!r)return'';const m=r.choices?.[0]?.message||{};const ra=((m.content||m.reasoning||'')).trim();return _cleanTyped(ra,bl);}catch(e){return'';}}
async function askOllamaText(q,bl,f,t,v,n,force,courseContext){try{const r=await postOllama(_textPrompt(q,f,v,n,force,courseContext),{numPredict:60,temperature:t??0.1,timeout:35});if(r&&r.response)return _cleanTyped(r.response.trim(),bl);return'';}catch(e){return'';}}
async function askCustomApiText(q,bl,f,t,v,n,force,courseContext){if(!cfg('CUSTOM_API_KEY')||customCooling())return'';try{const r=await postCustomApi([{role:'user',content:_textPrompt(q,f,v,n,force,courseContext)}],{maxTokens:80,temperature:t??0.1,timeout:25});if(!r)return'';const m=r.choices?.[0]?.message||{};const ra=((m.content||m.reasoning||'')).trim();return _cleanTyped(ra,bl);}catch(e){return'';}}
async function askWebText(q){
  if(!cfg('WEB_SEARCH_ENABLED'))return'';
  try{
    const question=(q||'').includes('\n\n')?(q||'').split('\n\n').pop():q;
    return await ollamaWebSearch(_searchQuery(question));
  }catch(error){console.warn('[providers] Non-AI text search failed:',error.message);return'';}
}

// -- matching + askAiText + askAi --

async function askAiText(q){
  const local=await localBankAnswerHits(q);
  if(local&&local.length)return _cleanTyped(local[0].answer,BLANK_RE.test(q));
  const bl=BLANK_RE.test(q);
  const w=await getWrongAnswers(q);
  const b=new Set(w.map(x=>normText(x)));
  const chq=(q||'').replace(/[_\-]{2,}/g,' ').replace(/\s+/g,' ').trim();
  if(cfg('ANSWER_KEY_ENABLED')){const ka=await keyAnswer(chq);if(ka&&!b.has(normText(ka)))return ka;}
  if(cfg('WEB_SEARCH_ENABLED')){const results=await askWebText(q);if(results)q+='\n\nNon-AI web search snippets (reference only):\n'+results.slice(0,2000);}
  if(cfg('ANSWER_KEY_ENABLED')){const h=await hintText(chq);if(h)q+='\n\n'+h;}

  const courseContext = getCourseContext();
  let lg='',nt='';
  const tp=async(name,fn)=>{
    const ep=[...b].some(x=>_echoesQuestion(x,q))?1:0;
    for(let r=0;r<cfg('MAX_TEXT_RETRIES');r++){
      const v=Math.min(ep+r,RETRY_VARIANTS.length-1);
      const temps=[0.1,0.5,0.75,0.95];
      const a=await fn(q,bl,b.size?[...b]:null,temps[r%4],v,nt,false,courseContext);
      if(!a)continue;
      if(isConversationalFiller(a) || a.length > 60){
        if(typeof logHUD==='function') logHUD('warn', name+': rejected conversational/long answer ('+a.length+' chars): '+a.slice(0,80));
        continue;
      }
      lg=a;
      if(b.has(normText(a))){nt='Do NOT answer: '+[...b].sort().join(', ')+'.';continue;}
      if(_echoesQuestion(a,q)&&r<cfg('MAX_TEXT_RETRIES')-1){nt='The answer echoes the question.';b.add(normText(a));continue;}
      return a;
    }
    return '';
  };
  if(cfg('CUSTOM_API_KEY')&&!customCooling()){const a=await tp('CustomAPI',askCustomApiText);if(a)return a;}
  if(cfg('GEMINI_API_KEY')){const a=await tp('Gemini',askGeminiText);if(a)return a;}
  if(cfg('OPENROUTER_API_KEY')&&!orCooling()){const a=await tp('OR',askOpenRouterText);if(a)return a;}
  const a=await tp('Ollama',askOllamaText);if(a)return a;
  try{const f=await askOllamaText(q,bl,b.size?[...b]:null,0.3,RETRY_VARIANTS.length-1,nt,true,courseContext);if(f&&!b.has(normText(f))&&!isConversationalFiller(f)&&f.length<=60)return f;}catch(e){}
  if(cfg('TYPE_ON_FAILURE')&&lg&&!b.has(normText(lg))&&!isConversationalFiller(lg)&&lg.length<=60)return lg;
  return '';
}

function getCourseContext(){
  if(typeof document==='undefined') return '';
  const breadcrumb = document.querySelector('.breadcrumb a[href*="/course/view.php"]');
  const heading = document.querySelector('.page-header-headings h1, h1');
  const parts = [];
  if(breadcrumb && breadcrumb.textContent) parts.push(breadcrumb.textContent.trim());
  if(heading && heading.textContent) parts.push(heading.textContent.trim());
  if(document.title) parts.push(document.title.trim());
  const ctx = parts.filter(Boolean).join(' > ');
  return ctx.slice(0, 120);
}

function isConversationalFiller(text){
  const t = (text||'').toLowerCase();
  const phrases = ["user's request","cannot","sorry","as an ai","i cannot","i'm unable","i am unable","i'm not able","i am not able","we need","please provide","let me know","happy to help","how can i","here is","here's the","the answer is","answer:","response:","explanation:"];
  return phrases.some(p => t.includes(p));
}
const _LINE_RE=/^\s*(\d{1,2})\s*[.)-:]?\s*(.+)$/;const _PROSE_LETTER_RE=/(?<![.\d])(\d{1,2})\s*[.)-:]\s*([A-Z])(?![A-Za-z])/g;
function _parseMapping(raw,options,n,skip,used){
  used=new Set(used||[]);
  const skipped=new Set(skip||[]);
  const idxs=new Array(n).fill(-1);
  let matched=0;
  const letters={};
  for(let i=0;i<options.length;i++)letters[String.fromCharCode(65+i)]=i;
  const take=(i,j)=>{if(j===-1||used.has(j)||idxs[i]!==-1)return false;idxs[i]=j;used.add(j);matched++;return true;};
  for(const rawLine of(raw||'').split('\n')){
    const line=rawLine.trim().replace(/[*_]/g,'').trim();
    if(!line)continue;
    const match=line.match(_LINE_RE);
    if(!match)continue;
    const i=parseInt(match[1],10)-1;
    if(i<0||i>=n||idxs[i]!==-1||skipped.has(i))continue;
    const rest=match[2].trim().replace(/[*' ]/g,'').trim();
    if(!rest||/^NONE/i.test(rest))continue;
    let j=-1;
    const token=rest.replace(/[ .)\-:]/g,'').trim();
    if(token.length===1&&token.toUpperCase()in letters&&!used.has(letters[token.toUpperCase()]))j=letters[token.toUpperCase()];
    if(j===-1){
      let best=-1,score=0;
      for(let k=0;k<options.length;k++){if(used.has(k))continue;const candidate=similarity(rest.toLowerCase(),options[k].toLowerCase());if(candidate>score){best=k;score=candidate;}}
      if(best!==-1&&score>=0.45)j=best;
    }
    take(i,j);
  }
  if(matched===0){
    let match;
    _PROSE_LETTER_RE.lastIndex=0;
    while((match=_PROSE_LETTER_RE.exec(raw||''))!==null){
      const i=parseInt(match[1],10)-1;
      if(i<0||i>=n||skipped.has(i)||idxs[i]!==-1)continue;
      const candidate=letters[match[2]];
      if(candidate!==undefined)take(i,candidate);
    }
  }
  if(matched===0){
    const bare=(raw||'').split('\n').map((line)=>line.trim().replace(/[*`']/g,'').trim()).filter(Boolean);
    if(bare.length===n){
      for(let i=0;i<n;i++){
        if(skipped.has(i))continue;
        let best=-1,score=0;
        for(let k=0;k<options.length;k++){if(used.has(k))continue;const candidate=similarity(bare[i].toLowerCase(),options[k].toLowerCase());if(candidate>score){best=k;score=candidate;}}
        if(best!==-1&&score>=0.5)take(i,best);
      }
    }
  }
  return{idxs,matched};
}
function _matchingOk(matched,remaining){if(remaining<=0)return true;return matched>=Math.max(1,Math.round(remaining*cfg('MATCHING_MIN_MATCHED')));}
function _bestOptionIndex(text,options,used){let best=-1,score=0;const t=(text||'').toLowerCase().trim();if(!t)return -1;for(let k=0;k<options.length;k++){if(used.has(k))continue;const o=options[k].toLowerCase();let s=similarity(t,o);if(t===o)s=1;else if(t.includes(o)||o.includes(t))s=Math.max(s,0.9);if(s>score){best=k;score=s;}}return score>=cfg('MATCHING_OPTION_FLOOR')?best:-1;}
function _matchingPrompt(header,statements,options,n,locked){const letters=options.map((_,i)=>String.fromCharCode(65+i));const items=letters.map((l,i)=>l+'. '+options[i]).join('\n');const numbered=statements.map((s,i)=>i+1+'. '+(s||'[blank]')).join('\n');let fixed='';if(locked&&locked.length)fixed='\nALREADY ANSWERED:\n'+locked.map(([i,j])=>i+1+'. '+String.fromCharCode(65+j)).join('\n')+'\n';const head=header?header+'\n\n':'';return 'You are completing a matching exam question.\n\n'+head+'STATEMENTS:\n'+numbered+'\n\nITEMS:\n'+items+fixed+'\nReply with exactly '+n+' lines using ONLY letters.\n1. B\n2. E\n...';}
async function askAiMatching(header,statements,options,n,locked,used){used=new Set(used||[]);const skip=new Set((locked||[]).map(x=>x[0]));const remaining=n-skip.size;let prompt=_matchingPrompt(header,statements,options,n,locked);if(cfg('WEB_SEARCH_ENABLED')){try{const context=await ollamaWebSearch(_searchQuery([header,...statements,...options].join(' ')));if(context)prompt+='\n\nNon-AI web search snippets (reference only):\n'+context.slice(0,2000);}catch(error){console.warn('[providers] Matching web search failed:',error.message);}}let bestIdxs=null,bestMatched=0;const consider=(idxs,matched)=>{if(matched>bestMatched){bestIdxs=idxs;bestMatched=matched;}};if(cfg('GEMINI_API_KEY')){const raw=await _askGeminiPrompt(prompt,{maxTokens:260,temperature:0.1,timeout:30});if(raw){const result=_parseMapping(raw,options,n,skip,used);if(_matchingOk(result.matched,remaining))return result;consider(result.idxs,result.matched);}}if(cfg('OPENROUTER_API_KEY')&&!orCooling()){try{const r=await postOpenRouter([{role:'user',content:prompt}],{maxTokens:260,temperature:0.1,timeout:30});if(r){const msg=r.choices?.[0]?.message||{};const raw=((msg.content||msg.reasoning||'')).trim();const result=_parseMapping(raw,options,n,skip,used);if(_matchingOk(result.matched,remaining))return result;consider(result.idxs,result.matched);}}catch(e){}}try{const r=await postOllama(prompt,{numPredict:300,temperature:0.1,timeout:45});if(r&&r.response){const result=_parseMapping(r.response.trim(),options,n,skip,used);if(_matchingOk(result.matched,remaining))return result;consider(result.idxs,result.matched);}}catch(e){}if(bestIdxs!==null&&bestMatched>0)return{idxs:bestIdxs,matched:bestMatched};return{idxs:new Array(n).fill(-1),matched:0};}
async function resolveMatching(header,statements,options,n){const idxs=new Array(n).fill(-1);const src=new Array(n).fill('');const used=new Set();let keyed=0;for(let i=0;i<n;i++){if(!statements[i])continue;const matches=await localBankOptionMatches(statements[i],options);const match=matches.find((item)=>!used.has(item.index));if(!match)continue;idxs[i]=match.index;src[i]='key';used.add(match.index);keyed++;}if(cfg('ANSWER_KEY_ENABLED')){for(let i=0;i<n;i++){if(idxs[i]!==-1||!statements[i])continue;const ans=await keyMatchAnswer(statements[i]);if(!ans)continue;const j=_bestOptionIndex(ans,options,used);if(j===-1)continue;idxs[i]=j;src[i]='key';used.add(j);keyed++;}}if(keyed===n)return{idxs,src,keyed,aiMatched:0};const openBlanks=[];for(let i=0;i<n;i++)if(idxs[i]===-1)openBlanks.push(i);const locked=[];for(let i=0;i<n;i++)if(idxs[i]!==-1)locked.push([i,idxs[i]]);let aiMatched=0;if(openBlanks.length&&used.size<options.length){const res=await askAiMatching(header,statements,options,n,locked,used);for(const i of openBlanks){if(res.idxs[i]!==-1&&!used.has(res.idxs[i])){idxs[i]=res.idxs[i];src[i]='ai';used.add(res.idxs[i]);aiMatched++;}}}const unused=[];for(let j=0;j<options.length;j++)if(!used.has(j))unused.push(j);for(let i=0;i<n;i++)if(idxs[i]===-1&&unused.length){idxs[i]=unused.shift();src[i]='elim';}return{idxs,src,keyed,aiMatched};}
async function askAiMatching(header,statements,options,n,locked,used){used=new Set(used||[]);const skip=new Set((locked||[]).map(x=>x[0]));const remaining=n-skip.size;let prompt=_matchingPrompt(header,statements,options,n,locked);if(cfg('WEB_SEARCH_ENABLED')){try{const context=await ollamaWebSearch(_searchQuery([header,...statements,...options].join(' ')));if(context)prompt+='\n\nNon-AI web search snippets (reference only):\n'+context.slice(0,2000);}catch(error){console.warn('[providers] Matching web search failed:',error.message);}}let bestIdxs=null,bestMatched=0;const consider=(idxs,matched)=>{if(matched>bestMatched){bestIdxs=idxs;bestMatched=matched;}};if(cfg('CUSTOM_API_KEY')&&!customCooling()){try{const r=await postCustomApi([{role:'user',content:prompt}],{maxTokens:260,temperature:0.1,timeout:30});if(r){const msg=r.choices?.[0]?.message||{};const raw=((msg.content||msg.reasoning||'')).trim();const result=_parseMapping(raw,options,n,skip,used);if(_matchingOk(result.matched,remaining))return result;consider(result.idxs,result.matched);}}catch(e){}}if(cfg('GEMINI_API_KEY')){const raw=await _askGeminiPrompt(prompt,{maxTokens:260,temperature:0.1,timeout:30});if(raw){const result=_parseMapping(raw,options,n,skip,used);if(_matchingOk(result.matched,remaining))return result;consider(result.idxs,result.matched);}}if(cfg('OPENROUTER_API_KEY')&&!orCooling()){try{const r=await postOpenRouter([{role:'user',content:prompt}],{maxTokens:260,temperature:0.1,timeout:30});if(r){const msg=r.choices?.[0]?.message||{};const raw=((msg.content||msg.reasoning||'')).trim();const result=_parseMapping(raw,options,n,skip,used);if(_matchingOk(result.matched,remaining))return result;consider(result.idxs,result.matched);}}catch(e){}}try{const r=await postOllama(prompt,{numPredict:300,temperature:0.1,timeout:45});if(r&&r.response){const result=_parseMapping(r.response.trim(),options,n,skip,used);if(_matchingOk(result.matched,remaining))return result;consider(result.idxs,result.matched);}}catch(e){}if(bestIdxs!==null&&bestMatched>0)return{idxs:bestIdxs,matched:bestMatched};return{idxs:new Array(n).fill(-1),matched:0};}
async function askAi(q,o,im){const local=await localBankOptionMatches(q,o);if(local.length)return local[0].index;im=im||[];const bq=_isBoolQuestion(o);const w=await getWrongAnswers(q);const b=new Set(w.map(x=>normText(x)));const vp=[];for(let i=0;i<o.length;i++){const on=normText(o[i]);if(!(b.has(on)||[...b].some(x=>similarity(on,x)>=0.9)))vp.push({origIdx:i,opt:o[i]});}if(!vp.length)for(let i=0;i<o.length;i++)vp.push({origIdx:i,opt:o[i]});if(vp.length===1){console.log('Only 1 untried option');return vp[0].origIdx;}const fo=vp.map(p=>p.opt);if(cfg('ANSWER_KEY_ENABLED')){const ki=await keyIndex(q,fo,cfg('BOOL_QUESTION_MIN_SCORE'));if(ki!==-1)return vp[ki].origIdx;}if(cfg('WEB_SEARCH_ENABLED')){const wi=await askWeb(q,fo,vp.map(p=>p.origIdx));if(wi!==-1)return vp[wi].origIdx;}if(bq){const i=await askBoolClaim(q,fo);if(i!==-1)return vp[i].origIdx;}if(im.length){const i=await askVision(q,fo,im);if(i!==-1)return vp[i].origIdx;}let eq=q;if(cfg('ANSWER_KEY_ENABLED')){const h=await hintText(q);if(h)eq+='\n\n'+h;}if(cfg('CUSTOM_API_KEY')&&!customCooling()){const r=await askCustomApi(eq,fo,null,vp.map(p=>p.origIdx));if(r!==-1)return vp[r].origIdx;}if(cfg('GEMINI_API_KEY')){const r=await askGemini(eq,fo,null,vp.map(p=>p.origIdx));if(r!==-1)return vp[r].origIdx;}if(cfg('OPENROUTER_API_KEY')&&!_orWebDisabled&&!orCooling()){const web=await askOpenRouterWeb(eq,fo,vp.map(p=>p.origIdx));if(web!==-1)return vp[web].origIdx;}if(cfg('OPENROUTER_API_KEY')&&!orCooling()){const r=await askOpenRouter(eq,fo,null,vp.map(p=>p.origIdx));if(r!==-1)return vp[r].origIdx;}try{const r=await askOllama(eq,fo,null,vp.map(p=>p.origIdx));if(r!==-1)return vp[r].origIdx;}catch(e){}return -1;}


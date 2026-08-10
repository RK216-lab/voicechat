
/**
 * Restee スキャン - iOS完全対応 / LLM & レポート修正版
 */
const BACKEND_URL = "https://voicechat-gz4j.onrender.com";
const MODEL_ID = "wmoto-ai/moonshine-tiny-ja-ONNX";
const EMBED_MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
const LOCAL_TTS_MODEL = "Xenova/mms-tts-jpn";
const SILENCE_THRESHOLD = 0.011;
const SILENCE_MS = 2200;
const POST_TTS_GAP_MS = 500;
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let model=null,processor=null,tokenizer=null,extractor=null,defVectors=null,localTTSPipeline=null;
let isModelReady=false,isEmbedReady=false,isLocalTTSReady=false,isRecording=false,isSpeaking=false;
let mediaRecorder=null,audioChunks=[],audioContext=null,analyser=null,silenceStart=null,waveRaf=null;
let currentTurn=0,allUserTexts=[],lastAudioBlob=null,conversationLog=[],lastAcoustic={},currentOpening="",loadCopyTimer=null;
let recognition=null,iosLastTranscript="",audioUnlocked=false,openingSpoken=false,firstInteractionDone=false;
const DOM={};
function bindDOM(){DOM.statusText=document.getElementById("statusText");DOM.aiPromptText=document.getElementById("aiPromptText");DOM.progressBar=document.getElementById("progressBar");DOM.progressText=document.getElementById("progressText");DOM.micBtn=document.getElementById("micBtn");DOM.micHint=document.getElementById("micHint");DOM.micInnerIcon=document.getElementById("micInnerIcon");DOM.waveContainer=document.getElementById("waveContainer");DOM.waveDots=DOM.waveContainer?[...DOM.waveContainer.querySelectorAll(".wave-dot")]:[];DOM.viewResultBtn=document.getElementById("viewResultBtn");DOM.recoveryList=document.getElementById("recoveryList");DOM.scanScreen=document.getElementById("scanScreen");DOM.resultScreen=document.getElementById("resultScreen");}
function getSupportedMimeType(){const types=['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/aac','audio/wav'];for(const t of types){if(typeof MediaRecorder!=='undefined'&&MediaRecorder.isTypeSupported&&MediaRecorder.isTypeSupported(t)) return t;}return '';}
function unlockAudioContext(){if(audioUnlocked) return;try{const ctx=new (window.AudioContext||window.webkitAudioContext)();const buffer=ctx.createBuffer(1,1,22050);const source=ctx.createBufferSource();source.buffer=buffer;source.connect(ctx.destination);source.start(0);if(ctx.state==='suspended') ctx.resume();audioUnlocked=true;setTimeout(()=>{try{ctx.close();}catch{}}, 800);}catch(e){}}
const OPENINGS=["こんにちは。今日はどんな一日でしたか？楽しかったことや、疲れたことなど教えてください。","お疲れさまです。今の調子はいかがですか？元気、眠い、少しだるいなど、近いものを教えてください。","今日は体の調子、いかがでしたか？重い、眠い、元気など、感じたことを教えてください。","今日は頭の調子、どうでしたか？集中できた、ぼーっとしたなど、思ったことを教えてください。","今日は気分、どうでしたか？楽しい、落ち着く、ちょっとモヤモヤするなど、聞かせてください。","今日、一番疲れたのはどんなときでしたか？勉強、仕事、人とのやりとりなど、何でも大丈夫です。","今日は何か頑張ったこと、ありましたか？勉強や部活、家のことなど、何でも大丈夫です。","今日、いつもよりしんどいと感じたことはありましたか？眠気やだるさなど、気になることを教えてください。","今いちばん気になるのはどこですか？体、頭、気分のことなど、何でも大丈夫です。","今日をひとことで言うと、どんな日でしたか？『疲れた』『元気だった』くらいでも大丈夫です。"];
const LOAD_COPIES=IS_IOS?["iPhone向け軽量モードで準備中…","声を聴く準備をしています…","まもなくお話しできます…"]:["耳を澄ます準備をしています…","言葉のニュアンスを読み解く準備中…","あなたの声を聴く準備をしています…","声の特徴を受け取る準備中…","まもなくお話しできます…"];
const SYSTEM_BASE=`あなたはユーザーの疲れに寄り添う、自然でやわらかい聞き手です。\n厳守ルール:\n- 出力は自然な日本語。全体で60文字以内。1〜2文だけ。\n- まず相手の言い方を受け止め、必要なら少し言い換えてから共感する。\n- 質問は最大1つ。箇条書き・説明・診断名・スコア・医学的断定は禁止。\n- 会話として自然に。短く答えても責めない。`;
function buildTurnSystem(phase,openingText){if(phase==="followup"){return `${SYSTEM_BASE}\n今は2回目の発話です。最初の問いかけは次でした:「${openingText}」\n手順: ①ユーザーの言葉を自然に受け止める ②最初の質問と違う角度で、やさしく1つだけ深掘りする。\n禁止: 「調子はどうですか？」など最初と同じ聞き直し。`;}return `${SYSTEM_BASE}\n最後の発話です。これまでの内容を自然に1文で受け止め、「話してくれてありがとう」と伝えて終えてください。\n新しい質問は禁止。診断やスコアには触れない。40文字以内。`;}
const FATIGUE_DEFS={body:["体が重い、だるい、肩や首や腰が張って動くのがつらい","朝起きたときに体が軽く感じられない","目がしょぼしょぼする、まぶたが重い","いつもより動くことが負担","筋肉の張りや違和感","眠いというより体が鉛のよう","頭痛や肩こりが続いている"],brain:["頭がぼんやりして集中できない","情報を整理したり思い出す作業が難しい","何も考えたくない","画面を見続けるとすぐ疲れる","判断にいつもより時間がかかる","言葉が出にくい","同じことを何度も確認してしまう","頭の回転が遅い感じ"],mental:["気持ちが休まらない、イライラする","プレッシャーを感じて心が疲れている","やる気が出ない","不安が続きリラックスできない","人と話すのが少し負担","些細なことで腹が立つ","落ち込みやすく","心がざわついて落ち着かない"],healthy:["特に疲れはなく調子がよい","集中できて気分も安定している","睡眠も食欲も問題なく","ストレスはあるがコントロールできて","体も気持ちもすっきり"]};
const RECOVERY={body:[{icon:"self_improvement",color:"#ea580c",bg:"bg-orange-100",title:"軽いストレッチ",desc:"座ったまま肩・首をゆっくり回す（3分）"},{icon:"hot_tub",color:"#0284c7",bg:"bg-sky-100",title:"温活",desc:"ぬるめのお湯で体の芯を温める"},{icon:"hotel",color:"#7c3aed",bg:"bg-violet-100",title:"短い仮眠",desc:"15〜20分の昼寝で体を休める"}],brain:[{icon:"visibility",color:"#0891b2",bg:"bg-cyan-100",title:"画面から離れる",desc:"5〜10分、遠くを見て目と頭を休める"},{icon:"directions_walk",color:"#16a34a",bg:"bg-green-100",title:"短い散歩",desc:"外の空気を吸って頭を切り替える"},{icon:"timer",color:"#64748b",bg:"bg-slate-100",title:"ポモドーロ休息",desc:"25分集中したら5分完全に休む"}],mental:[{icon:"air",color:"#2563eb",bg:"bg-blue-100",title:"深呼吸",desc:"4秒吸って6秒吐く呼吸を5回"},{icon:"edit_note",color:"#db2777",bg:"bg-pink-100",title:"気持ちの書き出し",desc:"今気になっていることをメモに出すだけ"},{icon:"music_note",color:"#9333ea",bg:"bg-purple-100",title:"好きな休息",desc:"何もしない時間を10分つくる"}],general:[{icon:"local_drink",color:"#0d9488",bg:"bg-teal-100",title:"水分補給",desc:"常温の水をゆっくり飲む"},{icon:"bedtime",color:"#4f46e5",bg:"bg-indigo-100",title:"早めの就寝準備",desc:"いつもより30分早く寝る準備を始める"}]};
function preprocessText(raw){if(!raw) return "";let t=String(raw).normalize("NFKC").trim();t=t.replace(/^(えっと|えー|あの|その|まあ|なんか|こう|はい|うん|うーん)+/g,"");return t;}
function analyzeModifiers(text){const t=text||"";let scale=1.0,negated=false;if(/(つらくない|疲れてない|大丈夫|問題ない|平気|別につら|そんなに(疲れ|つら)|特に(ない|疲れ))/.test(t)){negated=true;scale*=0.45;}if(/(少し|ちょっと|やや)/.test(t)){scale*=0.75;}if(/(かなり|とても|すごく|めっちゃ|本当に|ひどく|限界|もう無理)/.test(t)){scale*=1.28;}scale=Math.max(0.4,Math.min(1.35,scale));return{scale,negated};}
async function loadEmbedder(){try{const {pipeline}=await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.0");extractor=await pipeline("feature-extraction",EMBED_MODEL,{dtype:"q8",device:"wasm"});defVectors={};const limit=IS_IOS?3:999;for(const [key,texts] of Object.entries(FATIGUE_DEFS)){const vecs=[];for(const t of texts.slice(0,limit)){const out=await extractor(t,{pooling:"mean",normalize:true});vecs.push(Array.from(out.data));}defVectors[key]=vecs;}isEmbedReady=true;}catch(e){isEmbedReady=false;}}
async function loadLocalTTS(){if(isLocalTTSReady) return;try{const {pipeline}=await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.0");localTTSPipeline=await pipeline("text-to-speech",LOCAL_TTS_MODEL,{dtype:"q8",device:"wasm"});isLocalTTSReady=true;}catch(e){isLocalTTSReady=false;}}
function cosine(a,b){let s=0;const n=Math.min(a.length,b.length);for(let i=0;i<n;i++) s+=a[i]*b[i];return s;}
function simToCategory(v,p){if(!p||!p.length) return 0.5;const sims=p.map(x=>cosine(v,x));return 0.7*Math.max(...sims)+0.3*sims.reduce((a,b)=>a+b,0)/sims.length;}
function heuristicTextScores(t){let physical=42,brain=42,mental=42;if(/だる|重い|肩こり|腰痛|眠い|体力|こわば|目が疲/.test(t)) physical+=22;if(/集中|ぼんやり|ミス|頭|忘れ|整理|判断|モヤ/.test(t)) brain+=22;if(/イライラ|落ち[込こ]|不安|ストレス|つらい|気[がも]重|やる気|ざわ/.test(t)) mental+=20;if(/元気|調子いい|大丈夫|問題ない|すっきり/.test(t)){physical-=18;brain-=18;mental-=18;}const mod=analyzeModifiers(t);physical=Math.max(15,Math.min(92,Math.round(physical*mod.scale)));brain=Math.max(15,Math.min(92,Math.round(brain*mod.scale)));mental=Math.max(15,Math.min(92,Math.round(mental*mod.scale)));if(mod.negated){physical=Math.min(physical,40);brain=Math.min(brain,40);mental=Math.min(mental,40);}const total=Math.round(100-(physical+brain+mental)/3*0.88);return{physical,brain,mental,total:Math.max(22,Math.min(92,total))};}
async function scoreFromText(userText,acoustic){const cleaned=preprocessText(userText);const mod=analyzeModifiers(userText||cleaned);let embedScores;if(!isEmbedReady||!extractor||!defVectors){embedScores=heuristicTextScores(cleaned);}else{try{const out=await extractor(cleaned||"特になし",{pooling:"mean",normalize:true});const v=Array.from(out.data);const raw={body:simToCategory(v,defVectors.body),brain:simToCategory(v,defVectors.brain),mental:simToCategory(v,defVectors.mental),healthy:simToCategory(v,defVectors.healthy)};const toPct=(c)=>Math.max(12,Math.min(93,Math.round(48+c*160)));let physical=toPct(raw.body-raw.healthy);let brain=toPct(raw.brain-raw.healthy);let mental=toPct(raw.mental-raw.healthy);physical=Math.max(12,Math.min(93,Math.round(physical*mod.scale)));brain=Math.max(12,Math.min(93,Math.round(brain*mod.scale)));mental=Math.max(12,Math.min(93,Math.round(mental*mod.scale)));if(mod.negated){physical=Math.min(physical,38);brain=Math.min(brain,38);mental=Math.min(mental,38);}const avg=(physical+brain+mental)/3;const total=Math.max(18,Math.min(95,Math.round(100-avg*0.88)));embedScores={physical,brain,mental,total,raw};}catch(e){embedScores=heuristicTextScores(cleaned);}}if(["疲れ","だるい","眠い","しんどい","重い","肩","首"].some(kw=>(userText||"").includes(kw))){embedScores.physical=Math.min(93,embedScores.physical+18);embedScores.brain=Math.min(93,embedScores.brain+14);embedScores.mental=Math.min(93,embedScores.mental+16);const avg=(embedScores.physical+embedScores.brain+embedScores.mental)/3;embedScores.total=Math.max(18,Math.min(95,Math.round(100-avg*0.88)));}return embedScores;}
async function scoreFromBackend(blob,text){if(!blob) throw new Error("no audio");const form=new FormData();const ext=IS_IOS?"m4a":"webm";form.append("file",blob,`recording.${ext}`);form.append("text",text||"");if(window.lastEmbedRaw){const er=window.lastEmbedRaw;if(er.body!==undefined) form.append("sim_body",String(er.body));if(er.brain!==undefined) form.append("sim_brain",String(er.brain));if(er.mental!==undefined) form.append("sim_mental",String(er.mental));if(er.healthy!==undefined) form.append("sim_healthy",String(er.healthy));}const res=await fetch(`${BACKEND_URL}/predict-fatigue`,{method:"POST",body:form});if(!res.ok) throw new Error(await res.text());const data=await res.json();if(data.final){return{physical:Math.round(data.final.physical),brain:Math.round(data.final.brain),mental:Math.round(data.final.mental),total:Math.round(data.final.total),raw:data,source:"ensemble"};}else{return{physical:Math.round(data.physical),brain:Math.round(data.brain),mental:Math.round(data.mental),total:Math.round(data.total),raw:data,source:"lightgbm"};}}
async function scoreWithFallback(userText,acoustic,blob){try{if(isEmbedReady&&extractor&&defVectors){const out=await extractor(userText||"特になし",{pooling:"mean",normalize:true});const v=Array.from(out.data);window.lastEmbedRaw={body:simToCategory(v,defVectors.body),brain:simToCategory(v,defVectors.brain),mental:simToCategory(v,defVectors.mental),healthy:simToCategory(v,defVectors.healthy)};}}catch(e){}if(blob){try{DOM.statusText.textContent="分析中...";return await scoreFromBackend(blob,userText);}catch(e){console.warn("backend fallback",e);}}return await scoreFromText(userText,acoustic);}
function pickRecovery(scores){const entries=[["body",scores.physical],["brain",scores.brain],["mental",scores.mental]].sort((a,b)=>b[1]-a[1]);const list=[];const [topKey]=entries[0];const [secKey,secVal]=entries[1];list.push(...RECOVERY[topKey].slice(0,2));if(secVal>=55) list.push(RECOVERY[secKey][0]);const avg=(scores.physical+scores.brain+scores.mental)/3;list.push(avg>=60?RECOVERY.general[1]:RECOVERY.general[0]);const seen=new Set();const uniq=[];for(const it of list){if(!seen.has(it.title)){seen.add(it.title);uniq.push(it);}}return{topKey,suggestions:uniq.slice(0,4)};}
function renderRecovery(sugs){if(!DOM.recoveryList) return;DOM.recoveryList.innerHTML=sugs.map((s,i)=>`<div class="bg-white rounded-2xl p-3 shadow-sm border border-slate-100 flex items-center gap-3 slide-up" style="animation-delay:${0.05*i}s"><div class="w-12 h-12 rounded-xl ${s.bg} flex items-center justify-center shrink-0"><span class="material-icons-outlined" style="color:${s.color}">${s.icon}</span></div><div class="min-w-0"><p class="text-xs font-bold text-slate-700">${s.title}</p><p class="text-[11px] text-slate-400">${s.desc}</p></div></div>`).join("");}
function titleFromScores(scores){const entries=[["身体",scores.physical],["脳",scores.brain],["精神",scores.mental]].sort((a,b)=>b[1]-a[1]);const [name,val]=entries[0];if(val>=72) return `${name}の強い疲れ`;if(val>=55) return `${name}寄りの疲れ`;if(scores.total>=72) return "比較的すっきりした状態";return "総合的な疲れ";}
function applyScoreUI(scores){const totalEl=document.getElementById("scoreTotalVal");if(totalEl) totalEl.textContent=scores.total;const hintEl=document.getElementById("scoreHint");if(hintEl){const hint=scores.total>=70?"比較的コンディションは良好です":scores.total>=50?"無理をせず、ペースを落として大丈夫です":"休息を優先してあげてください";hintEl.textContent=hint;}const b=document.getElementById("scoreBrainVal"),m=document.getElementById("scoreMentalVal"),p=document.getElementById("scorePhysicalVal");if(b) b.innerHTML=`${scores.brain}<span class="text-xs font-normal">%</span>`;if(m) m.innerHTML=`${scores.mental}<span class="text-xs font-normal">%</span>`;if(p) p.innerHTML=`${scores.physical}<span class="text-xs font-normal">%</span>`;requestAnimationFrame(()=>{const bb=document.getElementById("barBrain"),mb=document.getElementById("barMental"),pb=document.getElementById("barPhysical");if(bb) bb.style.width=scores.brain+"%";if(mb) mb.style.width=scores.mental+"%";if(pb) pb.style.width=scores.physical+"%";});}
function startLoadCopyRotation(){let i=0;if(DOM.statusText) DOM.statusText.textContent=LOAD_COPIES[0];loadCopyTimer=setInterval(()=>{i=(i+1)%LOAD_COPIES.length;if(DOM.statusText) DOM.statusText.textContent=LOAD_COPIES[i];},2200);}
function stopLoadCopyRotation(){if(loadCopyTimer){clearInterval(loadCopyTimer);loadCopyTimer=null;}}
function updateProgress(p,label){const c=Math.max(0,Math.min(100,p));if(DOM.progressBar) DOM.progressBar.style.width=c+"%";if(DOM.progressText) DOM.progressText.textContent=label||(c+"%");}
function setupIOSRecognition(){const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR) return null;const rec=new SR();rec.lang='ja-JP';rec.interimResults=false;rec.continuous=false;rec.maxAlternatives=1;rec.onresult=(e)=>{iosLastTranscript=e.results[0][0].transcript;};rec.onerror=(e)=>{console.warn("SR error",e);};return rec;}
async function loadModel(){try{bindDOM();startLoadCopyRotation();updateProgress(5,"5%");if(IS_IOS){recognition=setupIOSRecognition();updateProgress(30,"30%");await loadEmbedder().catch(()=>{});updateProgress(85,"85%");loadLocalTTS().catch(()=>{});}else{let transformers=null;for(const url of ["https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.0","https://unpkg.com/@huggingface/transformers@3.5.0"]){try{transformers=await import(url);break;}catch(e){}}if(transformers){const {MoonshineForConditionalGeneration,AutoProcessor,AutoTokenizer,env}=transformers;env.allowLocalModels=false;env.useBrowserCache=true;updateProgress(20,"20%");let embedP=loadEmbedder().catch(()=>{});updateProgress(30,"30%");try{[model,processor,tokenizer]=await Promise.all([MoonshineForConditionalGeneration.from_pretrained(MODEL_ID,{dtype:"fp32",device:"wasm"}),AutoProcessor.from_pretrained(MODEL_ID),AutoTokenizer.from_pretrained(MODEL_ID),]);}catch(e){console.warn("Moonshine skip",e);}updateProgress(70,"70%");await embedP;loadLocalTTS().catch(()=>{});}else{await loadEmbedder().catch(()=>{});}}updateProgress(95,"95%");stopLoadCopyRotation();isModelReady=true;if(DOM.statusText) DOM.statusText.textContent="準備完了";currentOpening=OPENINGS[Math.floor(Math.random()*OPENINGS.length)];if(DOM.aiPromptText) DOM.aiPromptText.innerHTML=currentOpening.replace(/。/g,"。<br>");conversationLog=[{role:"assistant",content:currentOpening}];if(DOM.micBtn){DOM.micBtn.disabled=false;DOM.micBtn.classList.remove("opacity-50");}setMicUI(false);updateProgress(5,"5%");if(IS_IOS){DOM.statusText.textContent="タップして会話を開始";DOM.micHint.textContent="タップして音声を開始";openingSpoken=false;firstInteractionDone=false;}else{speakAI(currentOpening,()=>{openingSpoken=true;firstInteractionDone=true;DOM.statusText.textContent="タップして話す";DOM.micHint.textContent="マイクを押してください";});}}catch(e){console.error(e);stopLoadCopyRotation();if(DOM.statusText) DOM.statusText.textContent="タップで再試行";if(DOM.aiPromptText) DOM.aiPromptText.innerHTML="読み込み失敗。タップで再試行してください。";if(DOM.micBtn){DOM.micBtn.disabled=false;DOM.micBtn.classList.remove("opacity-50");DOM.micBtn.onclick=()=>{ location.reload(); };}}}
async function blobToFloat32(blob){try{const ab=await blob.arrayBuffer();const ctx=new (window.AudioContext||window.webkitAudioContext)({sampleRate:16000});const buf=await ctx.decodeAudioData(ab);let data=buf.getChannelData(0);if(buf.sampleRate!==16000){const offline=new OfflineAudioContext(1,Math.ceil(buf.duration*16000),16000);const src=offline.createBufferSource();src.buffer=buf;src.connect(offline.destination);src.start();const rendered=await offline.startRendering();data=rendered.getChannelData(0);}return new Float32Array(data);}catch(e){return new Float32Array(0);}}
async function transcribe(float32){if(IS_IOS){return iosLastTranscript||"（聞き取れませんでした）";}if(!model||!processor||!tokenizer) return iosLastTranscript||"（聞き取れませんでした）";const inputs=await processor(float32);const outputs=await model.generate({...inputs,max_new_tokens:96});return tokenizer.decode(outputs[0],{skip_special_tokens:true}).trim()||"（聞き取れませんでした）";}
async function callLLM(messages){
  const endpoints=["/api/chat",`${BACKEND_URL}/api/chat`,`${BACKEND_URL}/chat`,"/chat"];
  for(const url of endpoints){
    try{
      const controller=new AbortController(); const to=setTimeout(()=>controller.abort(),12000);
      const res=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages}),signal:controller.signal});
      clearTimeout(to);
      if(!res.ok) continue;
      const data=await res.json();
      if(data.text && data.text.trim()) return data.text.trim();
      if(data.choices && data.choices[0]?.message?.content) return data.choices[0].message.content.trim();
    }catch(e){ console.warn("LLM fail",url,e.message); }
  }
  const userCount=messages.filter(m=>m.role==="user").length;
  const lastUser=messages.filter(m=>m.role==="user").pop()?.content||"";
  if(userCount<=1){
    if(/疲|だる|眠|しんど|重/.test(lastUser)) return "そっか、疲れを感じてるんだね。どんな時に一番そう感じるか教えてくれる？";
    if(/元気|大丈夫|平気|調子いい/.test(lastUser)) return "元気そうでよかった。その調子の良さ、何か理由はある？";
    return "そうなんだね。もう少しだけ詳しく教えてくれる？例えば今日どんなことがあった？";
  }else{
    return "話してくれてありがとう。少しゆっくり休んでみてもいいかもしれないね。";
  }
}
async function getAcoustic(blob){try{const fd=new FormData();const ext=IS_IOS?"m4a":"webm";fd.append("file",blob,`speech.${ext}`);const res=await fetch(`${BACKEND_URL}/extract-features`,{method:"POST",body:fd});return res.ok?await res.json():{};}catch{return {};}}
function parseDiagnosisJSON(raw,scores){
  const fallbackTitle=titleFromScores(scores);
  const fallbackDetail="今日のお話を聞いて、少し疲れが溜まっているように感じました。無理せず、できる範囲で休んでみてください。";
  if(!raw) return {title:fallbackTitle,detail:fallbackDetail};
  let s=String(raw).trim();
  s=s.replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/i,"").trim();
  const jsonMatch=s.match(/\{[\s\S]*\}/);
  if(jsonMatch){
    try{
      const obj=JSON.parse(jsonMatch[0]);
      let title=(obj.title||obj.タイトル||"").toString().trim();
      let detail=(obj.detail||obj.詳細||obj.content||"").toString().trim();
      title=title.replace(/["{}]/g,"").trim();
      detail=detail.replace(/^["\s]+|["\s]+$/g,"").replace(/\\n/g,"。");
      if(!title) title=fallbackTitle;
      if(!detail) detail=fallbackDetail;
      if(detail.includes('"title"')||detail.includes("{")) detail=fallbackDetail;
      return {title,detail};
    }catch(e){
      try{
        const tMatch=s.match(/"title"\s*:\s*"([^"]+)"/) || s.match(/タイトル[":\s]*"([^"]+)"/);
        const dMatch=s.match(/"detail"\s*:\s*"([^"]+)"/) || s.match(/詳細[":\s]*"([^"]+)"/);
        let title=tMatch?tMatch[1]:fallbackTitle;
        let detail=dMatch?dMatch[1]:fallbackDetail;
        return {title,detail};
      }catch{}
    }
  }
  if(s.length>10 && !s.trim().startsWith("{")){
    return {title:fallbackTitle, detail: s.slice(0,200)};
  }
  return {title:fallbackTitle, detail:fallbackDetail};
}
function setMicUI(rec){if(!DOM.micBtn) return;if(rec){DOM.micInnerIcon.textContent="stop";DOM.micInnerIcon.className="material-icons stop-icon";DOM.micHint.textContent="タップして停止";DOM.micBtn.classList.add("mic-pulse");}else{DOM.micInnerIcon.textContent="mic";DOM.micInnerIcon.className="material-icons mic-icon";DOM.micHint.textContent=firstInteractionDone?"タップして話す":"タップして音声を開始";DOM.micBtn.classList.remove("mic-pulse");}}
function updateWaveFromRms(rms){const level=Math.min(1,Math.max(0,(rms-0.004)/0.08));DOM.waveDots.forEach((dot,i)=>{const center=(DOM.waveDots.length-1)/2;const dist=Math.abs(i-center)/center;const h=6+level*(22-dist*10);const op=0.35+level*0.65;dot.style.transform=`scaleY(${h/6})`;dot.style.opacity=String(op);});}
function stopWaveAnim(){if(waveRaf){cancelAnimationFrame(waveRaf);waveRaf=null;}DOM.waveDots.forEach(d=>{d.style.transform="scaleY(1)";d.style.opacity="0.45";});}
async function startRecording(){
  if(!isModelReady||isRecording||isSpeaking) return;
  unlockAudioContext();
  if(IS_IOS && !openingSpoken){
    firstInteractionDone=true; openingSpoken=true;
    DOM.statusText.textContent="AIが話しています...";
    speakAI(currentOpening,()=>{
      DOM.statusText.textContent="タップして話す";
      DOM.micHint.textContent="マイクを押してください";
      setMicUI(false);
    });
    return;
  }
  try{
    const mimeType=getSupportedMimeType();
    const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
    audioChunks=[]; iosLastTranscript="";
    const options=mimeType?{mimeType}:{};
    mediaRecorder=new MediaRecorder(stream, options);
    mediaRecorder.ondataavailable=e=>{if(e.data.size>0) audioChunks.push(e.data);};
    mediaRecorder.onstop=async()=>{
      stream.getTracks().forEach(t=>t.stop()); stopWaveAnim();
      if(audioContext){try{await audioContext.close();}catch{} audioContext=null;}
      if(recognition){try{recognition.stop();}catch{}}
      await processTurn();
    };
    audioContext=new (window.AudioContext||window.webkitAudioContext)();
    const source=audioContext.createMediaStreamSource(stream); analyser=audioContext.createAnalyser(); analyser.fftSize=512; source.connect(analyser);
    mediaRecorder.start(200); isRecording=true; silenceStart=null;
    DOM.waveContainer.classList.remove("hidden"); DOM.statusText.textContent="あなたのお話を聞いています..."; setMicUI(true);
    if(IS_IOS&&recognition){ try{ recognition.start(); }catch(e){} }
    loopMonitor();
  }catch(e){ console.error(e); DOM.statusText.textContent="マイクの許可が必要です。設定を確認してください"; }
}
function stopRecording(){if(!isRecording||!mediaRecorder) return;isRecording=false;DOM.waveContainer.classList.add("hidden");DOM.statusText.textContent="認識中...";setMicUI(false);mediaRecorder.stop();}
function loopMonitor(){if(!isRecording||!analyser) return;const data=new Uint8Array(analyser.fftSize);analyser.getByteTimeDomainData(data);let sum=0;for(let i=0;i<data.length;i++){const v=(data[i]-128)/128;sum+=v*v;}const rms=Math.sqrt(sum/data.length);updateWaveFromRms(rms);if(!IS_IOS){if(rms<SILENCE_THRESHOLD){if(!silenceStart) silenceStart=Date.now();else if(Date.now()-silenceStart>SILENCE_MS){stopRecording();return;}}else{silenceStart=null;}}waveRaf=requestAnimationFrame(loopMonitor);}
function afterSpeakThenRecord(){setTimeout(()=>{if(isModelReady&&currentTurn<2&&DOM.viewResultBtn.classList.contains("hidden")){DOM.statusText.textContent="タップして話す";DOM.micHint.textContent="マイクを押してください";DOM.micBtn.disabled=false;DOM.micBtn.classList.remove("opacity-50");setMicUI(false);}},POST_TTS_GAP_MS);}
async function processTurn(){
  try{
    const mimeType=getSupportedMimeType(); const ext=mimeType.includes('mp4')?'mp4':'webm'; const blob=new Blob(audioChunks,{type:mimeType||`audio/${ext}`}); lastAudioBlob=blob;
    DOM.statusText.textContent="文字起こし中..."; let userText=""; if(IS_IOS){ await new Promise(r=>setTimeout(r,300)); userText=iosLastTranscript||"今日は少し疲れました"; }else{ const float32=await blobToFloat32(blob); userText=await transcribe(float32); }
    console.log("認識:",userText); allUserTexts.push(userText); conversationLog.push({role:"user",content:userText}); const acousticP=getAcoustic(blob); currentTurn++;
    if(currentTurn===1){
      DOM.statusText.textContent="AIが考えています..."; updateProgress(35,"35%");
      const messages=[{role:"system",content:buildTurnSystem("followup",currentOpening)},...conversationLog];
      const reply=(await callLLM(messages)).trim()||"そうなんですね。もう少し詳しく教えてもらえますか？";
      conversationLog.push({role:"assistant",content:reply}); DOM.aiPromptText.innerHTML=reply.replace(/\n/g,"<br>"); speakAI(reply,afterSpeakThenRecord);
    }else if(currentTurn===2){
      DOM.statusText.textContent="AIが考えています..."; updateProgress(65,"65%");
      const closeMessages=[{role:"system",content:buildTurnSystem("close",currentOpening)},...conversationLog];
      const summary=(await callLLM(closeMessages)).trim()||"話してくれてありがとう。";
      conversationLog.push({role:"assistant",content:summary}); DOM.aiPromptText.innerHTML=summary.replace(/\n/g,"<br>"); lastAcoustic=await acousticP;
      DOM.statusText.textContent="内容を分析中..."; updateProgress(85,"85%");
      const joined=allUserTexts.join("。"); const scores=await scoreWithFallback(joined,lastAcoustic,lastAudioBlob);
      const recovery=pickRecovery(scores);
      const diagnosisMessages=[{role:"system",content:`あなたは優しいアドバイザーです。発言と疲労スコアに一貫した短いアドバイスを出してください。\n出力は必ず次のJSONのみ（前置き・後書き・コードフェンス禁止）:\n{"title":"〇〇な疲れ","detail":"ユーザーに語りかける2〜3文。〜かもしれません／〜してみてください を使う"}\ntitleはスコアの一番高い軸と矛盾しないこと。`},{role:"user",content:`【疲労スコア】身体:${scores.physical} 脳:${scores.brain} 精神:${scores.mental} 総合ウェルビーイング:${scores.total}\n【会話】\n${conversationLog.map(m=>(m.role==="user"?"ユーザー":"AI")+"："+m.content).join("\n")}`}];
      const diagnosisRaw=await callLLM(diagnosisMessages);
      const {title,detail}=parseDiagnosisJSON(diagnosisRaw,scores);
      document.getElementById("fatigueTitle").textContent=title;
      document.getElementById("fatigueDetailText").textContent=detail;
      applyScoreUI(scores); renderRecovery(recovery.suggestions);
      const saveData={...scores,fatigueTitle:title,fatigueDetail:detail,conversation:conversationLog,final:scores};
      if(window.ResteeApp&&window.ResteeApp.saveScanResult){ window.ResteeApp.saveScanResult(saveData); }else{ localStorage.setItem('restee_last_scan',JSON.stringify({...saveData,timestamp:new Date().toISOString(),dateStr:new Date().toLocaleString('ja-JP')})); }
      updateProgress(100,"100%"); DOM.statusText.textContent="スキャン完了"; DOM.micBtn.classList.add("hidden"); DOM.viewResultBtn.classList.remove("hidden"); speakAI(summary+"。結果をご覧ください。");
    }
  }catch(e){ console.error(e); DOM.statusText.textContent="エラーが発生しました。もう一度どうぞ"; setMicUI(false); isRecording=false; }
}
async function speakWithBackend(text){
  const url=`${BACKEND_URL}/tts?text=${encodeURIComponent(text)}&voice=ja-JP-NanamiNeural`;
  const controller=new AbortController(); const timeoutId=setTimeout(()=>controller.abort(),15000);
  try{
    const res=await fetch(url,{signal:controller.signal}); clearTimeout(timeoutId);
    if(!res.ok) throw new Error("TTS backend failed");
    const blob=await res.blob(); if(blob.size<500) throw new Error("empty");
    const audioUrl=URL.createObjectURL(blob); const audio=new Audio(audioUrl); audio.playsInline=true; audio.preload='auto';
    return await new Promise((resolve,reject)=>{ audio.onended=()=>{URL.revokeObjectURL(audioUrl); resolve();}; audio.onerror=(e)=>{URL.revokeObjectURL(audioUrl); reject(e);}; audio.play().catch(reject); });
  }catch(e){ clearTimeout(timeoutId); throw e; }
}
async function speakWithLocalMMS(text){
  if(!isLocalTTSReady){ await loadLocalTTS(); }
  if(!localTTSPipeline) throw new Error("local TTS not ready");
  const chunks=text.match(/.{1,120}(。|、|．|！|？|$)/g)||[text];
  for(const chunk of chunks){
    if(!chunk.trim()) continue;
    const out=await localTTSPipeline(chunk);
    const ctx=new (window.AudioContext||window.webkitAudioContext)({sampleRate:out.sampling_rate});
    const buffer=ctx.createBuffer(1,out.audio.length,out.sampling_rate); buffer.getChannelData(0).set(out.audio);
    const source=ctx.createBufferSource(); source.buffer=buffer; source.connect(ctx.destination);
    await new Promise(res=>{ source.onended=()=>{ ctx.close(); res(); }; source.start(); });
  }
}
async function speakAI(text,onEnd,retries=1){
  if(!text||!String(text).trim()){ if(onEnd) onEnd(); return; }
  isSpeaking=true; const prevStatus=DOM.statusText.textContent; DOM.statusText.textContent="AIが話しています..."; DOM.micBtn.disabled=true; DOM.micBtn.classList.add("opacity-50");
  try{
    try{ await speakWithBackend(text); finish(); return; }catch(be){ console.warn("[TTS] backend fail",be.message); if(IS_IOS) DOM.statusText.textContent="音声を準備中...(ローカル)"; }
    await speakWithLocalMMS(text); finish();
  }catch(e){
    console.warn("TTS all failed",e);
    if(retries>0){ await new Promise(r=>setTimeout(r,800)); return speakAI(text,onEnd,retries-1); }
    DOM.statusText.textContent=prevStatus; isSpeaking=false;
    if(isModelReady){ DOM.micBtn.disabled=false; DOM.micBtn.classList.remove("opacity-50"); }
    if(onEnd) setTimeout(onEnd,400);
  }
  function finish(){ DOM.statusText.textContent=prevStatus; isSpeaking=false; if(isModelReady&&DOM.viewResultBtn.classList.contains("hidden")){DOM.micBtn.disabled=false; DOM.micBtn.classList.remove("opacity-50");} if(onEnd) onEnd(); }
}
function initScan(){
  bindDOM(); if(!DOM.micBtn) return;
  DOM.micBtn.addEventListener('touchstart',unlockAudioContext,{once:true});
  DOM.micBtn.addEventListener('click',()=>{
    unlockAudioContext();
    if(!isModelReady||isSpeaking) return;
    if(IS_IOS && !firstInteractionDone){
      firstInteractionDone=true;
      if(!openingSpoken){
        openingSpoken=true;
        DOM.statusText.textContent="AIが話しています...";
        speakAI(currentOpening,()=>{
          DOM.statusText.textContent="タップして話す";
          DOM.micHint.textContent="マイクを押してください";
          setMicUI(false);
        });
        return;
      }
    }
    if(isRecording) stopRecording(); else startRecording();
  });
  if(DOM.viewResultBtn) DOM.viewResultBtn.addEventListener('click',()=>{ DOM.scanScreen.classList.add("hidden"); DOM.resultScreen.classList.remove("hidden"); DOM.resultScreen.classList.add("entering"); });
  loadModel();
}
document.addEventListener("DOMContentLoaded",initScan);

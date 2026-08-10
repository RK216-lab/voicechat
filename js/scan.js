/**
 * Restee v7 - 会話優先 + Moonshine日本語 確実版
 * 1. 起動直後にボタン有効化（Moonshine待たない）
 * 2. Moonshineは裏で3CDNリトライ + q8優先で読む
 * 3. TTSは backend -> speechSynthesis フォールバックで必ず鳴る
 * 4. 録音は MediaRecorder だけで OpenSMILE用Blob保持
 * 5. 文字起こしは Moonshine日本語があればそれ、なければ /transcribe(Whisper)
 */
const BACKEND_URL = "https://voicechat-gz4j.onrender.com";
const MODEL_ID = "wmoto-ai/moonshine-tiny-ja-ONNX";
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

let transformersAPI=null, model=null, processor=null, tokenizer=null, extractor=null, defVectors=null;
let isModelReady=true, isMoonshineReady=false, isEmbedReady=false, isRecording=false, isSpeaking=false;
let mediaRecorder=null, audioChunks=[], audioContext=null, analyser=null, silenceStart=null, waveRaf=null, fakeWaveTimer=null;
let currentTurn=0, allUserTexts=[], lastAudioBlob=null, conversationLog=[], currentOpening="", loadCopyTimer=null;
let audioUnlocked=false, openingSpoken=false, firstInteractionDone=false;

const DOM={};
function bindDOM(){
  DOM.statusText=document.getElementById("statusText");
  DOM.aiPromptText=document.getElementById("aiPromptText");
  DOM.progressBar=document.getElementById("progressBar");
  DOM.progressText=document.getElementById("progressText");
  DOM.micBtn=document.getElementById("micBtn");
  DOM.micHint=document.getElementById("micHint");
  DOM.micInnerIcon=document.getElementById("micInnerIcon");
  DOM.waveContainer=document.getElementById("waveContainer");
  DOM.waveDots=DOM.waveContainer?[...DOM.waveContainer.querySelectorAll(".wave-dot")]:[];
  DOM.viewResultBtn=document.getElementById("viewResultBtn");
  DOM.recoveryList=document.getElementById("recoveryList");
  DOM.scanScreen=document.getElementById("scanScreen");
  DOM.resultScreen=document.getElementById("resultScreen");
  DOM.recognizedBox=document.getElementById("recognizedBox");
  DOM.recognizedText=document.getElementById("recognizedText");
  DOM.textFallback=document.getElementById("textFallback");
  DOM.textInput=document.getElementById("textInput");
  DOM.textSendBtn=document.getElementById("textSendBtn");
}
function getSupportedMimeType(){
  const iosTypes=['audio/mp4','audio/aac','audio/wav'];
  const otherTypes=['audio/webm;codecs=opus','audio/webm','audio/mp4'];
  const list = IS_IOS ? iosTypes.concat(otherTypes) : otherTypes.concat(iosTypes);
  for(const t of list){ if(typeof MediaRecorder!=='undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) return t; }
  return '';
}
function unlockAudioContext(){
  try{
    const ctx=new (window.AudioContext||window.webkitAudioContext)();
    const buf=ctx.createBuffer(1,1,22050);
    const src=ctx.createBufferSource(); src.buffer=buf; src.connect(ctx.destination); src.start(0);
    if(ctx.state==='suspended') ctx.resume();
    audioUnlocked=true;
    setTimeout(()=>{try{ctx.close();}catch{}},800);
  }catch(e){}
}
const OPENINGS=[
"こんにちは。今日はどんな一日でしたか？楽しかったことや、疲れたことなど教えてください。",
"お疲れさまです。今の調子はいかがですか？元気、眠い、少しだるいなど、近いものを教えてください。",
"今日は体の調子、いかがでしたか？重い、眠い、元気など、感じたことを教えてください。"
];
const RECOVERY={
  body:[{icon:"self_improvement",color:"#ea580c",bg:"bg-orange-100",title:"軽いストレッチ",desc:"肩首を回す"}],
  brain:[{icon:"visibility",color:"#0891b2",bg:"bg-cyan-100",title:"画面から離れる",desc:"遠くを見る"}],
  mental:[{icon:"air",color:"#2563eb",bg:"bg-blue-100",title:"深呼吸",desc:"4秒吸って6秒吐く"}],
  general:[{icon:"local_drink",color:"#0d9488",bg:"bg-teal-100",title:"水分補給",desc:"水を飲む"}]
};
function heuristicScores(t){ let p=42,b=42,m=42; if(/だる|重い|眠い/.test(t)) p+=22; if(/集中|ぼんやり|頭/.test(t)) b+=22; if(/イライラ|不安|つらい/.test(t)) m+=22; if(/元気|大丈夫/.test(t)){p-=10;b-=10;m-=10;} const total=Math.round(100-(p+b+m)/3*0.88); return {physical:Math.max(15,Math.min(90,p)),brain:Math.max(15,Math.min(90,b)),mental:Math.max(15,Math.min(90,m)),total:Math.max(22,Math.min(90,total))}; }
function pickRecovery(s){ const e=[["body",s.physical],["brain",s.brain],["mental",s.mental]].sort((a,b)=>b[1]-a[1]); return {suggestions:[RECOVERY[e[0][0]][0],RECOVERY.general[0]]}; }
function renderRecovery(sugs){ if(!DOM.recoveryList) return; DOM.recoveryList.innerHTML=sugs.map(s=>`<div class="bg-white rounded-2xl p-3 flex gap-3"><div class="w-12 h-12 rounded-xl ${s.bg} flex items-center justify-center"><span class="material-icons-outlined" style="color:${s.color}">${s.icon}</span></div><div><p class="text-xs font-bold">${s.title}</p><p class="text-[11px] text-slate-400">${s.desc}</p></div></div>`).join(""); }
function titleFromScores(s){ const e=[["身体",s.physical],["脳",s.brain],["精神",s.mental]].sort((a,b)=>b[1]-a[1]); return e[0][1]>=55?`${e[0][0]}寄りの疲れ`:"総合的な疲れ"; }
function applyScoreUI(s){ const el=(id)=>document.getElementById(id); if(el("scoreTotalVal")) el("scoreTotalVal").textContent=s.total; if(el("scoreBrainVal")) el("scoreBrainVal").textContent=s.brain+"%"; if(el("scoreMentalVal")) el("scoreMentalVal").textContent=s.mental+"%"; if(el("scorePhysicalVal")) el("scorePhysicalVal").textContent=s.physical+"%"; if(el("barBrain")) el("barBrain").style.width=s.brain+"%"; if(el("barMental")) el("barMental").style.width=s.mental+"%"; if(el("barPhysical")) el("barPhysical").style.width=s.physical+"%"; }
function updateProgress(p,l){ if(DOM.progressBar) DOM.progressBar.style.width=p+"%"; if(DOM.progressText) DOM.progressText.textContent=l||p+"%"; }
async function speakWithBackend(text){
  const url=`${BACKEND_URL}/tts?text=${encodeURIComponent(text)}`;
  const ctrl=new AbortController(); const to=setTimeout(()=>ctrl.abort(),8000);
  try{
    const res=await fetch(url,{signal:ctrl.signal});
    clearTimeout(to);
    if(!res.ok) throw new Error("tts backend fail "+res.status);
    const blob=await res.blob();
    if(blob.size<500) throw new Error("tts empty");
    const au=URL.createObjectURL(blob);
    const a=new Audio(au);
    a.playsInline=true;
    await new Promise((resolve,reject)=>{
      a.onended=()=>{ URL.revokeObjectURL(au); resolve(); };
      a.onerror=(e)=>{ URL.revokeObjectURL(au); reject(e); };
      a.play().catch(reject);
    });
    return true;
  }catch(e){ clearTimeout(to); throw e; }
}
function speakWithBrowser(text){
  return new Promise((resolve)=>{
    try{
      if(!('speechSynthesis' in window)){ resolve(false); return; }
      window.speechSynthesis.cancel();
      const u=new SpeechSynthesisUtterance(text);
      u.lang='ja-JP'; u.rate=1.0;
      u.onend=()=>resolve(true);
      u.onerror=()=>resolve(false);
      const voices=window.speechSynthesis.getVoices();
      const ja=voices.find(v=>v.lang.includes('ja')||v.name.includes('Kyoko')||v.name.includes('Otoya'));
      if(ja) u.voice=ja;
      window.speechSynthesis.speak(u);
      setTimeout(()=>resolve(true),10000);
    }catch{ resolve(false); }
  });
}
async function speakAI(text,onEnd){
  if(!text){ if(onEnd) onEnd(); return; }
  isSpeaking=true;
  const prev=DOM.statusText ? DOM.statusText.textContent : "";
  if(DOM.statusText) DOM.statusText.textContent="AIが話しています...";
  if(DOM.micBtn){ DOM.micBtn.disabled=true; DOM.micBtn.classList.add("opacity-50"); }
  try{ try{ await speakWithBackend(text); }catch{ await speakWithBrowser(text); } }catch(e){}
  isSpeaking=false;
  if(DOM.statusText) DOM.statusText.textContent=prev || "タップして話す";
  if(DOM.micBtn){ DOM.micBtn.disabled=false; DOM.micBtn.classList.remove("opacity-50"); }
  if(onEnd) onEnd();
}
async function importTransformersWithFallback(){
  const cdns=[
    "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.0",
    "https://unpkg.com/@huggingface/transformers@3.5.0",
    "https://esm.sh/@huggingface/transformers@3.5.0"
  ];
  for(let i=0;i<cdns.length;i++){
    try{
      if(DOM.statusText) DOM.statusText.textContent=`Moonshine準備中... CDN ${i+1}/3`;
      const mod=await import(cdns[i]);
      return mod;
    }catch(e){ console.warn(`CDN fail ${cdns[i]}`,e); }
  }
  throw new Error("transformers all CDN fail");
}
async function loadMoonshineBackground(){
  try{
    transformersAPI = await importTransformersWithFallback();
    const {env, MoonshineForConditionalGeneration, AutoProcessor, AutoTokenizer, pipeline} = transformersAPI;
    env.allowLocalModels=false; env.allowRemoteModels=true; env.useBrowserCache=true;
    try{ env.backends.onnx.wasm.wasmPaths="https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/"; }catch{}
    if(DOM.statusText) DOM.statusText.textContent="Moonshine日本語モデル取得中... (q8)";
    const [proc, tok] = await Promise.all([
      AutoProcessor.from_pretrained(MODEL_ID),
      AutoTokenizer.from_pretrained(MODEL_ID)
    ]);
    const m = await MoonshineForConditionalGeneration.from_pretrained(MODEL_ID, {dtype:"q8", device:"wasm"});
    model=m; processor=proc; tokenizer=tok;
    isMoonshineReady=true;
    if(DOM.statusText) DOM.statusText.textContent="Moonshine日本語 準備完了！";
    updateProgress(100,"Moonshine準備完了");
    try{
      const pipe=await pipeline("feature-extraction","Xenova/paraphrase-multilingual-MiniLM-L12-v2",{dtype:"q8",device:"wasm"});
      extractor=pipe; isEmbedReady=true;
    }catch(e){}
  }catch(e){
    console.error("[Moonshine] background load failed",e);
    if(DOM.statusText) DOM.statusText.textContent="Moonshine読込失敗、Whisperで代用中";
    isMoonshineReady=false;
  }
}
async function blobToFloat32(blob){
  try{
    const ab=await blob.arrayBuffer();
    const ctx=new (window.AudioContext||window.webkitAudioContext)({sampleRate:16000});
    const buf=await ctx.decodeAudioData(ab);
    let data=buf.getChannelData(0);
    if(buf.sampleRate!==16000){
      const offline=new OfflineAudioContext(1, Math.ceil(buf.duration*16000), 16000);
      const tmp=offline.createBuffer(1, buf.length, buf.sampleRate);
      tmp.getChannelData(0).set(buf.getChannelData(0));
      const src=offline.createBufferSource(); src.buffer=tmp; src.connect(offline.destination); src.start();
      const rendered=await offline.startRendering();
      data=rendered.getChannelData(0);
    }
    return data;
  }catch(e){ console.error("blobToFloat32",e); return new Float32Array(0); }
}
async function transcribeWithMoonshine(blob){
  if(!isMoonshineReady||!model||!processor||!tokenizer) return "";
  try{
    const f32=await blobToFloat32(blob);
    if(f32.length===0) return "";
    if(DOM.statusText) DOM.statusText.textContent="Moonshine日本語で認識中...";
    const inputs=await processor(f32);
    const outputs=await model.generate({...inputs, max_new_tokens:128});
    const text=tokenizer.decode(outputs[0],{skip_special_tokens:true}).trim();
    return text;
  }catch(e){ console.error("Moonshine transcribe fail",e); return ""; }
}
async function transcribeWithBackend(blob){
  const ext=IS_IOS?"m4a":"webm";
  const form=new FormData(); form.append("file",blob,`audio.${ext}`); form.append("language","ja");
  try{
    const res=await fetch(`${BACKEND_URL}/transcribe`,{method:"POST",body:form});
    if(!res.ok) return "";
    const data=await res.json();
    return (data.text||"").trim();
  }catch{ return ""; }
}
async function scoreFromBackend(blob,text){
  if(!blob) return null;
  const form=new FormData(); form.append("file",blob,`recording.${IS_IOS?"m4a":"webm"}`); form.append("text",text||"");
  try{
    const res=await fetch(`${BACKEND_URL}/predict-fatigue`,{method:"POST",body:form});
    if(!res.ok) return null;
    const data=await res.json();
    if(data.final) return {physical:Math.round(data.final.physical),brain:Math.round(data.final.brain),mental:Math.round(data.final.mental),total:Math.round(data.final.total)};
    return {physical:Math.round(data.physical),brain:Math.round(data.brain),mental:Math.round(data.mental),total:Math.round(data.total)};
  }catch{ return null; }
}
async function scoreWithFallback(text,blob){
  if(blob){ const s=await scoreFromBackend(blob,text); if(s) return s; }
  return heuristicScores(text);
}
function startFakeWave(){ stopFakeWave(); let t=0; fakeWaveTimer=setInterval(()=>{ t++; if(DOM.waveDots) DOM.waveDots.forEach((d,i)=>{ const v=Math.sin(t*0.3+i)*0.5+0.5; d.style.transform=`scaleY(${1+v*1.5})`; }); },80); }
function stopFakeWave(){ if(fakeWaveTimer){clearInterval(fakeWaveTimer); fakeWaveTimer=null;} }
function updateWaveFromRms(rms){ const level=Math.min(1,Math.max(0,(rms-0.004)/0.08)); if(DOM.waveDots) DOM.waveDots.forEach((dot)=>{ dot.style.transform=`scaleY(${6+level*22/6})`; }); }
function setMicUI(rec){ if(!DOM.micBtn) return; if(rec){ DOM.micInnerIcon.textContent="stop"; DOM.micHint.textContent="タップして停止"; DOM.micBtn.classList.add("mic-pulse"); } else{ DOM.micInnerIcon.textContent="mic"; DOM.micHint.textContent=firstInteractionDone?"タップして話す":"タップして音声を開始"; DOM.micBtn.classList.remove("mic-pulse"); } }
function showTextFallback(msg){ if(DOM.textFallback){ DOM.textFallback.classList.remove("hidden"); if(msg) DOM.textFallback.querySelector("p").textContent=msg; } }
function startWaveLoop(){
  stopWaveLoop();
  if(IS_IOS){ startFakeWave(); }
  else{
    const loop=()=>{
      if(!isRecording||!analyser) return;
      const data=new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(data);
      let sum=0; for(let i=0;i<data.length;i++){ const v=(data[i]-128)/128; sum+=v*v; }
      const rms=Math.sqrt(sum/data.length);
      updateWaveFromRms(rms);
      if(rms<0.011){
        if(!silenceStart) silenceStart=Date.now();
        else if(Date.now()-silenceStart>2200){ stopRecording(); return; }
      }else{ silenceStart=null; }
      waveRaf=requestAnimationFrame(loop);
    };
    waveRaf=requestAnimationFrame(loop);
  }
}
function stopWaveLoop(){ if(waveRaf){cancelAnimationFrame(waveRaf); waveRaf=null;} stopFakeWave(); }
function stopWave(){ stopWaveLoop(); if(audioContext){try{audioContext.close();}catch{} audioContext=null;} if(DOM.waveDots) DOM.waveDots.forEach(d=>{d.style.transform="scaleY(1)";}); }
async function initScan(){
  bindDOM();
  if(!DOM.micBtn){ console.error("micBtn not found"); return; }
  if(DOM.textSendBtn){
    DOM.textSendBtn.addEventListener('click', async ()=>{
      const txt=DOM.textInput.value.trim(); if(!txt) return;
      DOM.textFallback.classList.add("hidden");
      if(DOM.recognizedBox){ DOM.recognizedBox.classList.remove("hidden"); DOM.recognizedText.textContent=txt; }
      await processCommon(txt, lastAudioBlob);
    });
    DOM.textInput.addEventListener('keydown',e=>{ if(e.key==='Enter') DOM.textSendBtn.click(); });
  }
  currentOpening=OPENINGS[Math.floor(Math.random()*OPENINGS.length)];
  if(DOM.aiPromptText) DOM.aiPromptText.innerHTML=currentOpening;
  conversationLog=[{role:"assistant",content:currentOpening}];
  if(DOM.micBtn){ DOM.micBtn.disabled=false; DOM.micBtn.classList.remove("opacity-50"); }
  if(DOM.statusText) DOM.statusText.textContent="タップして会話を開始";
  if(DOM.micHint) DOM.micHint.textContent="タップして音声を開始";
  updateProgress(5,"5%");
  isModelReady=true;
  loadMoonshineBackground();
  DOM.micBtn.addEventListener('touchstart',unlockAudioContext,{once:true});
  DOM.micBtn.addEventListener('click',()=>{
    unlockAudioContext();
    if(isSpeaking) return;
    if(!firstInteractionDone){
      firstInteractionDone=true;
      if(!openingSpoken){
        openingSpoken=true;
        if(DOM.statusText) DOM.statusText.textContent="AIが話しています...";
        speakAI(currentOpening,()=>{
          if(DOM.statusText) DOM.statusText.textContent="タップして話す";
          if(DOM.micHint) DOM.micHint.textContent="マイクを押して話してください";
          setMicUI(false);
        });
        return;
      }
    }
    if(isRecording) stopRecording(); else startRecording();
  });
  if(DOM.viewResultBtn) DOM.viewResultBtn.addEventListener('click',()=>{ DOM.scanScreen.classList.add("hidden"); DOM.resultScreen.classList.remove("hidden"); });
}
async function startRecording(){
  unlockAudioContext();
  try{
    const mimeType=getSupportedMimeType();
    if(!mimeType){ showTextFallback("録音非対応、テキストで入力してください"); return; }
    const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
    audioChunks=[];
    mediaRecorder=new MediaRecorder(stream,{mimeType});
    mediaRecorder.ondataavailable=e=>{ if(e.data.size>0) audioChunks.push(e.data); };
    mediaRecorder.onstop=async()=>{
      stream.getTracks().forEach(t=>t.stop());
      stopWave();
      const blob=new Blob(audioChunks,{type:mimeType});
      lastAudioBlob=blob;
      await processAfterRecord(blob);
    };
    try{
      audioContext=new (window.AudioContext||window.webkitAudioContext)();
      const src=audioContext.createMediaStreamSource(stream);
      analyser=audioContext.createAnalyser(); analyser.fftSize=512; src.connect(analyser);
    }catch{ analyser=null; }
    mediaRecorder.start(200);
    isRecording=true; silenceStart=null;
    if(DOM.waveContainer) DOM.waveContainer.classList.remove("hidden");
    if(DOM.recognizedBox) DOM.recognizedBox.classList.add("hidden");
    if(DOM.textFallback) DOM.textFallback.classList.add("hidden");
    if(DOM.statusText) DOM.statusText.textContent="聞いています...";
    setMicUI(true);
    startWaveLoop();
    if(IS_IOS) setTimeout(()=>{ if(isRecording) stopRecording(); },8000);
  }catch(e){
    console.error(e);
    showTextFallback("マイク許可が必要です。テキストで入力してください");
  }
}
function stopRecording(){
  if(!isRecording||!mediaRecorder) return;
  isRecording=false;
  if(DOM.waveContainer) DOM.waveContainer.classList.add("hidden");
  if(DOM.statusText) DOM.statusText.textContent=isMoonshineReady?"Moonshine日本語で認識中...":"認識中...";
  setMicUI(false);
  try{ mediaRecorder.stop(); }catch{}
}
async function processAfterRecord(blob){
  let userText = "";
  if(isMoonshineReady){ userText = await transcribeWithMoonshine(blob); }
  if(!userText){ userText = await transcribeWithBackend(blob); }
  if(!userText){
    showTextFallback("聞き取れませんでした。テキストで入力してください");
    if(DOM.statusText) DOM.statusText.textContent="タップして話す";
    return;
  }
  if(DOM.recognizedText){ DOM.recognizedText.textContent=userText; DOM.recognizedBox.classList.remove("hidden"); }
  await processCommon(userText, blob);
}
async function processCommon(userText, audioBlob){
  if(!userText) return;
  allUserTexts.push(userText);
  conversationLog.push({role:"user",content:userText});
  currentTurn++;
  if(currentTurn===1){
    if(DOM.statusText) DOM.statusText.textContent="AIが考えています..."; updateProgress(35,"35%");
    const reply=await callLLM([{role:"system",content:`あなたは疲れに寄り添う聞き手。60文字以内、質問1つ。最初の問い:「${currentOpening}」`},...conversationLog]);
    conversationLog.push({role:"assistant",content:reply});
    if(DOM.aiPromptText) DOM.aiPromptText.innerHTML=reply.replace(/\n/g,"<br>");
    speakAI(reply,()=>{
      if(DOM.statusText) DOM.statusText.textContent="タップして話す";
      if(DOM.micBtn){ DOM.micBtn.disabled=false; setMicUI(false); }
    });
  }else if(currentTurn===2){
    if(DOM.statusText) DOM.statusText.textContent="AIが考えています..."; updateProgress(65,"65%");
    const summary=await callLLM([{role:"system",content:"最後。1文で受け止め「ありがとう」。質問禁止、40文字以内"},...conversationLog]);
    conversationLog.push({role:"assistant",content:summary});
    if(DOM.aiPromptText) DOM.aiPromptText.innerHTML=summary.replace(/\n/g,"<br>");
    if(DOM.statusText) DOM.statusText.textContent="声と内容を分析中..."; updateProgress(85,"85%");
    const joined=allUserTexts.join("。");
    const scores=await scoreWithFallback(joined, audioBlob);
    const recovery=pickRecovery(scores);
    const raw=await callLLM([{role:"system",content:'{"title":"〇〇な疲れ","detail":"2文アドバイス"}のJSONのみ'},{role:"user",content:`スコア 身体:${scores.physical} 脳:${scores.brain} 精神:${scores.mental} 会話:${joined}`}]);
    let title=titleFromScores(scores), detail="少し疲れが溜まっているようです。無理せず休んでみてください。";
    try{
      let s=String(raw).trim().replace(/```json/gi,"").replace(/```/g,"").trim();
      const m=s.match(/\{[\s\S]*\}/);
      if(m){ const o=JSON.parse(m[0]); if(o.title) title=o.title; if(o.detail) detail=o.detail; }
      else if(s.length>10 && !s.startsWith("{")){ detail=s.slice(0,200); }
    }catch{}
    const elT=document.getElementById("fatigueTitle"); if(elT) elT.textContent=title;
    const elD=document.getElementById("fatigueDetailText"); if(elD) elD.textContent=detail;
    applyScoreUI(scores); renderRecovery(recovery.suggestions);
    const saveData={...scores,fatigueTitle:title,fatigueDetail:detail,conversation:conversationLog};
    localStorage.setItem('restee_last_scan', JSON.stringify({...saveData,timestamp:new Date().toISOString()}));
    if(window.ResteeApp) window.ResteeApp.saveScanResult(saveData);
    updateProgress(100,"100%"); if(DOM.statusText) DOM.statusText.textContent="スキャン完了"; if(DOM.micBtn) DOM.micBtn.classList.add("hidden"); if(DOM.viewResultBtn) DOM.viewResultBtn.classList.remove("hidden");
    speakAI(summary+"。結果をご覧ください。");
  }
}
async function callLLM(messages){
  const endpoints=["/api/chat",`${BACKEND_URL}/api/chat`,`${BACKEND_URL}/chat`];
  for(const url of endpoints){
    try{
      const res=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages})});
      if(!res.ok) continue;
      const data=await res.json();
      if(data.text) return data.text.trim();
    }catch{}
  }
  const last=messages.filter(m=>m.role==="user").pop()?.content||"";
  return /疲|だる|眠/.test(last)?"そっか、疲れてるんだね。どんな時に一番そう感じる？":"そうなんだね。もう少し詳しく教えてくれる？";
}
document.addEventListener("DOMContentLoaded",initScan);

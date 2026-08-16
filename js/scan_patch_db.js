// js/scan_patch_db.js
async function renderRecoveryFromDB(scores){
  const listEl=document.getElementById('recoveryList'); if(!listEl) return;
  listEl.innerHTML='<p class="text-[11px] text-slate-400">あなたに合うケアを探しています...</p>';
  let methods=[]; try{ methods=await RestDB.load({type:"all"});}catch(e){ const {suggestions}=pickRecovery(scores); return renderRecovery(suggestions); }
  const picks=RestDB.pickForResult(scores, methods);
  listEl.innerHTML='';
  picks.forEach((m,i)=>{
    const card=document.createElement('div');
    card.className='bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden slide-up cursor-pointer';
    card.style.animationDelay=`${0.05*i}s`;
    card.innerHTML=`<div class="flex gap-3 p-3"><div class="w-20 h-20 rounded-xl overflow-hidden shrink-0 relative bg-slate-100"><img src="${m.youtubeId ? `https://img.youtube.com/vi/${m.youtubeId}/mqdefault.jpg` : m.imageUrl}" class="w-full h-full object-cover" loading="lazy">${m.youtubeId ? '<div class="absolute inset-0 flex items-center justify-center"><div class="w-6 h-6 bg-white/90 rounded-full flex items-center justify-center"><span class="material-icons-outlined text-[14px] text-red-600 ml-[1px]">play_arrow</span></div></div>' : ''}</div><div class="flex-1 min-w-0"><div class="flex items-center gap-1.5 mb-1"><span class="text-[9px] px-1.5 py-0.5 rounded-full font-bold ${m.category==='body'?'bg-orange-100 text-orange-600':m.category==='brain'?'bg-blue-100 text-blue-600':'bg-purple-100 text-purple-600'}">${m.category}</span><span class="text-[9px] text-slate-400">${m.timeMin}分</span></div><p class="text-[12px] font-bold text-slate-700 leading-tight">${m.title}</p><p class="text-[11px] text-slate-400 mt-0.5 line-clamp-2">${m.description}</p></div><span class="material-icons-outlined text-slate-300 text-[18px] self-center">chevron_right</span></div>`;
    card.addEventListener('click',()=>expandInlineDetail(card,m));
    listEl.appendChild(card);
  });
}
function expandInlineDetail(anchorEl,m){
  const ex=anchorEl.nextElementSibling; if(ex && ex.classList.contains('inline-detail')){ ex.remove(); return; }
  document.querySelectorAll('.inline-detail').forEach(el=>el.remove());
  const d=document.createElement('div'); d.className='inline-detail bg-white rounded-2xl p-4 border border-green-100 -mt-1 mb-2 space-y-3';
  d.innerHTML=`<p class="text-[12px] text-slate-600">${m.detail||m.description}</p>${m.steps?.length?`<ol class="list-decimal pl-4 text-[11px] text-slate-600 space-y-1">${m.steps.map(s=>`<li>${s}</li>`).join('')}</ol>`:''}${m.youtubeId?`<div class="aspect-video rounded-xl overflow-hidden bg-black"><iframe src="https://www.youtube-nocookie.com/embed/${m.youtubeId}?rel=0" class="w-full h-full" frameborder="0" allowfullscreen loading="lazy"></iframe></div>`:''}${m.imageUrl?`<img src="${m.imageUrl}" class="w-full rounded-xl max-h-40 object-cover">`:''}<div class="flex gap-2 text-[10px] text-slate-400"><span>${m.license||''}</span>${m.sourceUrl?`<a href="${m.sourceUrl}" target="_blank" class="underline">出典</a>`:''}</div>`;
  anchorEl.insertAdjacentElement('afterend',d);
}

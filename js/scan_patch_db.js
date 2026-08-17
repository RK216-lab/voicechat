// js/scan_patch_db.js
// js/scan_patch_db.js (または js/scan.js) の renderRecoveryFromDB 関数を差し替え

async function renderRecoveryFromDB(scores) {
  const listEl = DOM.recoveryList || document.getElementById("recoveryList");
  if (!listEl) return;
  listEl.innerHTML = '<p class="text- text-slate-400 px-1 py-2">あなたに合うケアをデータベースから探しています...</p>';
  let methods = [];
  try {
    methods = await RestDB.load({ type: "all" });
    if (!methods.length) throw new Error("empty");
  } catch (e) {
    console.warn("[DB] load failed, fallback to RECOVERY", e);
    const { suggestions } = pickRecovery(scores);
    renderRecovery(suggestions);
    return;
  }
  const picks = RestDB.pickForResult(scores, methods);
  listEl.innerHTML = "";
  // クリックを潰さないための保険
  listEl.style.position = "relative";
  listEl.style.zIndex = "20";

  picks.forEach((m, i) => {
    const thumb = m.youtubeId? `https://img.youtube.com/vi/${m.youtubeId}/hqdefault.jpg` : m.imageUrl;
    const card = document.createElement("div");
    // スクショと同じ action-card に変更
    card.className = "action-card slide-up";
    card.style.animationDelay = `${0.05 * i}s`;
    card.style.pointerEvents = "auto";

    card.innerHTML = `
      <div class="action-thumb-container">
        <img src="${thumb || ''}" alt="${m.title}" class="action-thumb" loading="lazy" onerror="this.style.display='none'">
        ${m.youtubeId? '<div class="play-overlay"><div class="play-icon-bg"><span class="material-icons-outlined text- text-red-600">play_arrow</span></div></div>' : ''}
      </div>
      <div class="action-info">
        <div class="flex items-center gap-1.5 mb-1">
          <span class="text- px-1.5 py-0.5 rounded-full font-bold ${m.category==='body'?'bg-orange-100 text-orange-600':m.category==='brain'?'bg-blue-100 text-blue-600':'bg-purple-100 text-purple-600'}">${m.category==='body'?'身体':m.category==='brain'?'脳':'精神'}</span>
          <span class="text- text-slate-400">${m.timeMin}分</span>
        </div>
        <p class="action-title">${m.title}</p>
        <p class="action-desc">${m.description||''}</p>
      </div>
      <span class="material-icons-outlined action-chevron">chevron_right</span>
    `;

    const handler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      openCareModal(m);
    };
    card.addEventListener("click", handler);
    card.addEventListener("touchend", handler, {passive:false});
    listEl.appendChild(card);
  });

  const more = document.createElement("a");
  more.href = "care.html";
  more.className = "block text-center text- text-green-600 font-bold mt-3 underline relative z-20";
  more.textContent = "もっとケアを見る →";
  listEl.appendChild(more);
}
function expandInlineDetail(anchorEl,m){
  const ex=anchorEl.nextElementSibling; if(ex && ex.classList.contains('inline-detail')){ ex.remove(); return; }
  document.querySelectorAll('.inline-detail').forEach(el=>el.remove());
  const d=document.createElement('div'); d.className='inline-detail bg-white rounded-2xl p-4 border border-green-100 -mt-1 mb-2 space-y-3';
  d.innerHTML=`<p class="text-[12px] text-slate-600">${m.detail||m.description}</p>${m.steps?.length?`<ol class="list-decimal pl-4 text-[11px] text-slate-600 space-y-1">${m.steps.map(s=>`<li>${s}</li>`).join('')}</ol>`:''}${m.youtubeId?`<div class="aspect-video rounded-xl overflow-hidden bg-black"><iframe src="https://www.youtube-nocookie.com/embed/${m.youtubeId}?rel=0" class="w-full h-full" frameborder="0" allowfullscreen loading="lazy"></iframe></div>`:''}${m.imageUrl?`<img src="${m.imageUrl}" class="w-full rounded-xl max-h-40 object-cover">`:''}<div class="flex gap-2 text-[10px] text-slate-400"><span>${m.license||''}</span>${m.sourceUrl?`<a href="${m.sourceUrl}" target="_blank" class="underline">出典</a>`:''}</div>`;
  anchorEl.insertAdjacentElement('afterend',d);
}

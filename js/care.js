// js/care.js - wavy-cardをDB化
document.addEventListener('DOMContentLoaded', async () => {
  const listEl = document.getElementById('care-list');
  const badgeEl = document.getElementById('dominant-badge');
  const searchInput = document.querySelector('input[placeholder*="検索"]');
  if (!listEl) return;
  const modal = document.getElementById('care-modal');
  const modalImg = document.getElementById('modal-image');
  const modalTag = document.getElementById('modal-tag');
  const modalTitle = document.getElementById('modal-title');
  const modalDesc = document.getElementById('modal-description');
  let extraArea = document.getElementById('modal-extra');
  if (!extraArea && modal) {
    const p6 = modal.querySelector('.p-6');
    if (p6) {
      extraArea = document.createElement('div');
      extraArea.id = 'modal-extra';
      extraArea.className = 'space-y-4 mb-6';
      p6.insertBefore(extraArea, p6.querySelector('.border-t'));
    }
  }
  let allMethods = [];
  try { allMethods = await RestDB.load({ type: "all" }); } catch (e) { listEl.innerHTML = '<p class="text-xs text-gray-400">読み込み失敗</p>'; return; }
  let dominantType = null;
  try {
    const last = window.ResteeApp?.loadLastScan?.();
    if (last) {
      dominantType = window.ResteeApp.getDominantType(last.final || last);
      const label = { body: '身体ケア', brain: '脳ケア', mental: 'メンタルケア' }[dominantType] || '';
      if (badgeEl && label) badgeEl.textContent = label + 'をおすすめ中';
    }
  } catch {}
  function render(methods) {
    listEl.innerHTML = '';
    if (dominantType) methods.sort((a,b)=>{ const aM=(a.fatigueTypes||[]).includes(dominantType)?0:1; const bM=(b.fatigueTypes||[]).includes(dominantType)?0:1; return aM-bM; });
    methods.forEach(m => {
      const borderColor = m.category === 'body' ? 'border-l-orange-300' : m.category === 'brain' ? 'border-l-blue-400' : 'border-l-purple-400';
      const tagColor = m.category === 'body' ? 'bg-orange-500/80' : m.category === 'brain' ? 'bg-blue-500/80' : 'bg-purple-500/80';
      const thumb = m.youtubeId ? `https://img.youtube.com/vi/${m.youtubeId}/hqdefault.jpg` : m.imageUrl;
      const card = document.createElement('div');
      card.className = `wavy-card bg-white/80 flex flex-col group cursor-pointer border-l-[6px] ${borderColor} overflow-hidden`;
      card.innerHTML = `<div class="h-40 w-full relative overflow-hidden"><img src="${thumb}" alt="${m.title}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy"><div class="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>${m.youtubeId ? '<div class="absolute inset-0 flex items-center justify-center"><div class="w-12 h-12 bg-white/85 rounded-full flex items-center justify-center shadow-lg"><span class="material-icons-outlined text-red-600 text-2xl ml-0.5">play_arrow</span></div></div>' : ''}<div class="absolute bottom-3 left-3 right-3 text-white"><div class="flex items-center gap-1.5 mb-1.5 flex-wrap"><span class="${tagColor} px-2 py-0.5 rounded text-[10px] font-bold inline-block"># ${m.tags?.[0] || m.category}</span><span class="bg-black/30 px-2 py-0.5 rounded text-[10px]">${m.timeMin}分 • ${m.level}</span></div><h3 class="font-bold text-sm leading-snug">${m.title}</h3></div></div>`;
      card.addEventListener('click', () => openModal(m));
      listEl.appendChild(card);
    });
  }
  function openModal(m) {
    if (!modal) return;
    if (modalImg) modalImg.src = m.imageUrl || (m.youtubeId ? `https://img.youtube.com/vi/${m.youtubeId}/hqdefault.jpg` : '');
    if (modalTag) { modalTag.textContent = `# ${m.tags?.[0] || m.category} • ${m.timeMin}分`; modalTag.className = `inline-block px-2.5 py-1 rounded-md text-xs font-bold text-white mb-2 ${m.category==='body'?'bg-orange-400':m.category==='brain'?'bg-blue-400':'bg-purple-400'}`; }
    if (modalTitle) modalTitle.textContent = m.title;
    if (modalDesc) modalDesc.textContent = m.detail || m.description;
    if (extraArea) {
      extraArea.innerHTML = `${m.steps?.length ? `<div><h4 class="text-xs font-bold text-gray-700 mb-2">手順</h4><ol class="list-decimal pl-4 space-y-1 text-[13px] text-gray-600">${m.steps.map(s=>`<li>${s}</li>`).join('')}</ol></div>` : ''}${m.youtubeId ? `<div><h4 class="text-xs font-bold text-gray-700 mb-2">動画で見る</h4><div class="relative w-full aspect-video rounded-xl overflow-hidden bg-black"><iframe src="https://www.youtube-nocookie.com/embed/${m.youtubeId}?rel=0" class="absolute inset-0 w-full h-full" frameborder="0" allowfullscreen loading="lazy"></iframe></div><p class="text-[10px] text-gray-400 mt-1">出典: ${m.sourceName||'YouTube'} • <a href="${m.youtubeUrl}" target="_blank" class="underline">YouTubeで開く</a></p></div>` : ''}<div class="bg-gray-50 rounded-xl p-3 space-y-1">${m.imageCredit ? `<p class="text-[10px] text-gray-400">画像: ${m.imageCredit} • ${m.license}</p>` : ''}${m.sourceName ? `<p class="text-[10px] text-gray-400">出典: ${m.sourceName} ${m.sourceUrl ? `<a href="${m.sourceUrl}" target="_blank" class="underline">リンク</a>` : ''}</p>` : ''}${m.contraindication ? `<p class="text-[11px] text-orange-600 bg-orange-50 p-2 rounded">⚠️ ${m.contraindication}</p>` : ''}</div>`;
    }
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
  window.closeModal = function() { modal.classList.remove('active'); document.body.style.overflow=''; const ifr=modal.querySelector('iframe'); if(ifr) ifr.src=ifr.src; };
  window.rate = function(n){ console.log(n); window.closeModal(); };
  render(allMethods);
  if (searchInput) searchInput.addEventListener('input', e => { const q=e.target.value.toLowerCase().trim(); if(!q) return render(allMethods); render(allMethods.filter(m => (m.title+m.description+(m.tags||[]).join('')).toLowerCase().includes(q))); });
});

// js/home.js - home.htmlのおすすめケアをDBから動的生成 + モーダル対応
document.addEventListener('DOMContentLoaded', async () => {
  let listEl = document.getElementById('home-recommended-list');
  if (!listEl) {
    listEl = document.querySelector('.grid.grid-cols-1.gap-3.mb-8');
    if (!listEl) return;
  }

  const modal = document.getElementById('care-modal');
  const modalImg = document.getElementById('modal-image');
  const modalTag = document.getElementById('modal-tag');
  const modalTitle = document.getElementById('modal-title');
  const modalDesc = document.getElementById('modal-description');
  let extraArea = document.getElementById('modal-extra');

  let methods = [];
  try {
    if (typeof RestDB === 'undefined') {
      console.warn('[home] RestDB not found');
      return;
    }
    methods = await RestDB.load({ type: "all" });
  } catch (e) {
    console.warn('[home] load failed', e);
    listEl.innerHTML = '<p class="text-xs text-gray-400">読み込み失敗</p>';
    return;
  }

  let dominantType = null;
  try {
    const last = window.ResteeApp?.loadLastScan?.();
    if (last) dominantType = window.ResteeApp.getDominantType(last.final || last);
  } catch {}

  let picks = methods;
  if (dominantType) {
    picks = methods.filter(m => (m.fatigueTypes||[]).includes(dominantType));
  }
  if (picks.length < 2) picks = [...picks, ...methods];
  picks = [...new Map(picks.map(m=>[m.id,m])).values()].slice(0, 2);

  listEl.innerHTML = '';
  picks.forEach(m => {
    const border = m.category==='body'?'border-l-orange-300':m.category==='brain'?'border-l-blue-400':'border-l-green-400';
    const tagBg = m.category==='body'?'bg-orange-500/80':m.category==='brain'?'bg-blue-500/80':'bg-green-500/80';
    const thumb = m.youtubeId ? `https://img.youtube.com/vi/${m.youtubeId}/hqdefault.jpg` : m.imageUrl;
    const card = document.createElement('div');
    card.className = `wavy-card bg-white/90 flex flex-col group cursor-pointer border-l-[6px] ${border} shadow-sm overflow-hidden`;
    card.innerHTML = `
      <div class="h-32 w-full relative overflow-hidden">
        <img src="${thumb}" alt="${m.title}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" referrerpolicy="no-referrer">
        <div class="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>
        ${m.youtubeId ? '<div class="absolute top-2 right-2 w-6 h-6 bg-white/90 rounded-full flex items-center justify-center shadow"><span class="material-icons-outlined text-[14px] text-red-600">play_arrow</span></div>' : ''}
        <div class="absolute bottom-3 left-3 right-3 text-white">
          <span class="${tagBg} backdrop-blur-sm px-2.5 py-1 rounded text-xs font-bold mb-1 inline-block shadow-sm"># ${m.tags?.[0] || m.category} • ${m.timeMin}分</span>
          <h3 class="font-bold text-[14px] leading-snug drop-shadow-md line-clamp-2">${m.title}</h3>
        </div>
      </div>
    `;
    card.addEventListener('click', () => openModal(m));
    listEl.appendChild(card);
  });

  function openModal(m) {
    if (!modal) { location.href = 'care.html'; return; }
    if (modalImg) modalImg.src = m.imageUrl || (m.youtubeId ? `https://img.youtube.com/vi/${m.youtubeId}/hqdefault.jpg` : '');
    if (modalTag) {
      modalTag.textContent = `# ${m.tags?.[0] || m.category} • ${m.timeMin}分`;
      modalTag.className = `inline-block px-2.5 py-1 rounded-md text-xs font-bold text-white mb-1 shadow-sm ${m.category==='body'?'bg-orange-400':m.category==='brain'?'bg-blue-400':'bg-purple-400'}`;
    }
    if (modalTitle) modalTitle.textContent = m.title;
    if (modalDesc) modalDesc.textContent = m.detail || m.description;
    if (extraArea) {
      extraArea.innerHTML = `
        ${m.steps?.length ? `<div><h4 class="text-xs font-bold text-gray-700 mb-2">手順</h4><ol class="list-decimal pl-4 space-y-1 text-[13px] text-gray-600">${m.steps.map(s=>`<li>${s}</li>`).join('')}</ol></div>` : ''}
        ${m.youtubeId ? `<div><h4 class="text-xs font-bold text-gray-700 mb-2">動画で見る</h4><div class="relative w-full aspect-video rounded-xl overflow-hidden bg-black"><iframe src="https://www.youtube-nocookie.com/embed/${m.youtubeId}?rel=0" class="absolute inset-0 w-full h-full" frameborder="0" allowfullscreen loading="lazy"></iframe></div></div>` : ''}
        <div class="bg-gray-50 rounded-xl p-3 space-y-1">
          ${m.imageCredit ? `<p class="text-[10px] text-gray-400">画像: ${m.imageCredit} • ${m.license}</p>` : ''}
          ${m.contraindication ? `<p class="text-[11px] text-orange-600 bg-orange-50 p-2 rounded">⚠️ ${m.contraindication}</p>` : ''}
        </div>
      `;
    }
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  window.closeModal = window.closeModal || function() {
    if (!modal) return;
    modal.classList.remove('active');
    document.body.style.overflow = '';
    const ifr = modal.querySelector('iframe');
    if (ifr) ifr.src = ifr.src;
  };
});

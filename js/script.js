/* Restee 共通スクリプト - モーダル & ケアカード */
function openModal(title, tag, colorClass, image, desc) {
    const modal = document.getElementById('care-modal');
    if (!modal) return;
    const titleEl = document.getElementById('modal-title');
    const tagEl = document.getElementById('modal-tag');
    const imageEl = document.getElementById('modal-image');
    const descEl = document.getElementById('modal-description');
    if (titleEl) titleEl.innerText = title;
    if (tagEl) {
        tagEl.innerText = tag;
        tagEl.className = `inline-block px-2.5 py-1 rounded-md text-[10px] font-bold text-white mb-2 shadow-sm ${colorClass}`;
    }
    if (imageEl) imageEl.src = image;
    if (descEl) descEl.innerText = desc || "このケアを実践して、心身をリセットしましょう。ゆったりとした呼吸を意識するのがコツです。";
    modal.classList.add('active');
    resetStars();
}
function closeModal() {
    const modal = document.getElementById('care-modal');
    if (modal) modal.classList.remove('active');
}
function rate(n) {
    const stars = document.querySelectorAll('.star-rating .material-icons-outlined');
    stars.forEach((s, i) => {
        if (i < n) s.classList.add('active');
        else s.classList.remove('active');
    });
}
function resetStars() {
    const stars = document.querySelectorAll('.star-rating .material-icons-outlined');
    stars.forEach(s => s.classList.remove('active'));
}
document.addEventListener('DOMContentLoaded', () => {
    const careItems = document.querySelectorAll('.wavy-card.group.cursor-pointer');
    careItems.forEach(item => {
        item.addEventListener('click', () => {
            const title = item.querySelector('h3') ? item.querySelector('h3').innerText : "";
            const tagEl = item.querySelector('span.bg-purple-500\\/80, span.bg-green-500\\/80, span.bg-blue-500\\/80, span.bg-orange-500\\/80, span.bg-amber-600, span[class*=\"bg-\"]');
            let tag = "";
            if (tagEl) tag = tagEl.innerText;
            else {
                const firstSpan = item.querySelector('span');
                tag = firstSpan ? firstSpan.innerText : "# ケア";
            }
            const imageEl = item.querySelector('img');
            const image = imageEl ? imageEl.src : "";
            let colorClass = 'bg-blue-500';
            if (item.classList.contains('border-l-orange-400') || tag.includes('食事')) colorClass = 'bg-orange-600';
            if (tag.includes('睡眠')) colorClass = 'bg-blue-600';
            if (tag.includes('マインドフルネス')) colorClass = 'bg-purple-600';
            if (tag.includes('自然音') || tag.includes('運動') || tag.includes('ストレッチ')) colorClass = 'bg-emerald-600';
            if (tag.includes('ジャーナル')) colorClass = 'bg-amber-600';
            const pEl = item.querySelector('p.hidden, p.line-clamp-2, p');
            let desc = pEl ? pEl.innerText : "";
            if (!desc || desc.length < 10) {
                if (title.includes('ストレッチ')) desc = "座ったままできる簡単なストレッチです。デスクワークの合間に1分間行うだけで、血流が改善し集中力がアップします。";
                else if (title.includes('入浴')) desc = "ぬるめのお湯にゆっくり浸かることで、副交感神経が優位になり、深い眠りへと誘います。アロマオイルを垂らすのもおすすめです。";
                else if (title.includes('瞑想')) desc = "静かな場所で目を閉じ、呼吸に意識を向けます。雑念が浮かんでも否定せず、ただ呼吸に戻ることで心が落ち着きます。";
                else desc = "このケアで心身をリセットしましょう。";
            }
            openModal(title, tag, colorClass, image, desc);
        });
    });
});

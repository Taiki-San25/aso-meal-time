/* report.js — 帳票(1日分の詳細): 上に項目別の人数・単価・金額、下に予約ごとの明細(#report[data-meal]) */
(function () {
  const root = document.getElementById('report');
  const MEAL = root.dataset.meal;
  const MEAL_LABEL = { dinner: '夕食', breakfast: '朝食' }[MEAL];
  const { esc, api } = AMT;

  const pad = n => String(n).padStart(2, '0');
  const fmtDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return fmtDate(d); };
  const yen = n => Number(n).toLocaleString('ja-JP');
  const slash = s => s.replace(/-/g, '/');
  // 明細の人数列(見出しは短く、ホバーで正式名称)
  const SHORT = { adults: '大人', children: '子供', infants: '幼児', adult_coupon: '大人CP', child_coupon: '子供CP',
    free_adult: 'フリー大人', free_child: 'フリー子供', outside: '外来大人', outside_child: '外来子供' };

  const params = new URLSearchParams(location.search);
  const state = { date: /^\d{4}-\d{2}-\d{2}$/.test(params.get('d') || '') ? params.get('d') : fmtDate(new Date()), data: null };

  root.innerHTML = `
    <div class="rpBar noPrint">
      <button class="iconBtn" data-act="prev" aria-label="前日"><i class="ti ti-chevron-left"></i></button>
      <input type="date" id="rpDate" aria-label="日付">
      <span class="dow" id="rpDow"></span>
      <button class="iconBtn" data-act="next" aria-label="翌日"><i class="ti ti-chevron-right"></i></button>
      <button class="btn" data-act="today">今日</button>
      <a class="btn" id="rpLedger"><i class="ti ti-table"></i>この日の管理表</a>
      <div class="barRight">
        <button class="btn" data-act="print"><i class="ti ti-printer"></i>印刷</button>
        <button class="btn primary" data-act="excel"><i class="ti ti-file-spreadsheet"></i>Excel出力</button>
      </div>
    </div>
    <h2 class="printTitle" id="rpTitle"></h2>
    <p class="muted rpNote">削除済みの予約は含みません。単価はこの日に有効なもの(店舗マスタ)で計算しています。</p>
    <section class="rpSec">
      <h3>項目別集計</h3>
      <div class="tableWrap rpItemsWrap"><table class="grid rpItems">
        <thead><tr><th>項目</th><th class="num">人数</th><th class="num">単価</th><th class="num">金額</th></tr></thead>
        <tbody id="rpItems"></tbody>
      </table></div>
    </section>
    <section class="rpSec">
      <h3>予約明細 <span class="muted" id="rpCount"></span></h3>
      <div class="tableWrap"><table class="grid rpRows">
        <thead id="rpHead"></thead><tbody id="rpRows"></tbody>
      </table></div>
    </section>`;

  const $ = id => document.getElementById(id);

  async function load() {
    const u = new URL(location.href);
    u.searchParams.set('d', state.date);
    history.replaceState(null, '', u);
    $('rpDate').value = state.date;
    state.data = await api(`/api/${MEAL}/report?d=${state.date}`);
    render();
  }

  function render() {
    const d = state.data;
    $('rpDow').textContent = `(${d.weekday})`;
    $('rpDow').className = 'dow' + ({ 土: ' sat', 日: ' sun' }[d.weekday] || '');
    $('rpTitle').textContent = `${MEAL_LABEL}帳票　${slash(d.date)}(${d.weekday})`;
    $('rpLedger').href = `/${MEAL}?d=${d.date}`;

    // 項目別集計(大人・子供・幼児と内訳の間に区切り線)
    $('rpItems').innerHTML = d.items.map((it, i) => `<tr class="${i === 3 ? 'group' : ''}${it.count ? '' : ' zero'}">
        <td>${esc(it.label)}</td><td class="num">${it.count}</td>
        <td class="num">${yen(it.price)}</td><td class="num amt">${yen(it.amount)}</td></tr>`).join('') +
      `<tr class="totalRow"><td>合計</td><td></td><td></td><td class="num amt">${yen(d.total.amount)}</td></tr>`;

    // 予約明細
    const keys = d.items.map(it => it.key);
    $('rpHead').innerHTML = `<tr><th>時間</th><th>部屋</th><th>代表者名</th>
      ${d.items.map(it => `<th class="num" title="${esc(it.label)}">${SHORT[it.key] || esc(it.label)}</th>`).join('')}
      <th class="num">金額</th><th>アレルギー</th><th>備考</th></tr>`;
    $('rpCount').textContent = `${d.total.groups}組`;
    if (!d.rows.length) {
      $('rpRows').innerHTML = `<tr><td colspan="${keys.length + 6}" class="empty">この日の予約はありません</td></tr>`;
      return;
    }
    $('rpRows').innerHTML = d.rows.map(r => `<tr>
        <td>${r.time_slot || '<span class="muted">未定</span>'}</td>
        <td class="room">${esc(r.room)}</td>
        <td>${r.vip ? '<span class="vipStar" title="VIP">★</span>' : ''}${esc(r.guest_name)}</td>
        ${keys.map(k => `<td class="num">${r[k] || '<span class="z">0</span>'}</td>`).join('')}
        <td class="num amt">${yen(r.amount)}</td>
        <td class="allergy">${esc(r.allergy)}</td>
        <td class="note">${esc(r.note)}</td></tr>`).join('') +
      `<tr class="totalRow"><td colspan="3">合計</td>${keys.map(k => `<td class="num">${d.total[k]}</td>`).join('')}
        <td class="num amt">${yen(d.total.amount)}</td><td></td><td></td></tr>`;
  }

  const setDate = v => { state.date = v; load().catch(() => {}); };
  root.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'prev') setDate(addDays(state.date, -1));
    else if (act === 'next') setDate(addDays(state.date, 1));
    else if (act === 'today') setDate(fmtDate(new Date()));
    else if (act === 'print') window.print();
    else if (act === 'excel') location.href = `/api/${MEAL}/report.xlsx?d=${state.date}`;
  });
  $('rpDate').addEventListener('change', e => { if (e.target.value) setDate(e.target.value); });

  load().catch(() => {});
})();

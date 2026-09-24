/* summary.js — 期間を指定した日別集計(#summary[data-meal] に描画) */
(function () {
  const root = document.getElementById('summary');
  const MEAL = root.dataset.meal;
  const MEAL_LABEL = { dinner: '夕食', breakfast: '朝食' }[MEAL];
  const { esc, api, toast } = AMT;

  const pad = n => String(n).padStart(2, '0');
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const monthRange = (y, m) => [fmt(new Date(y, m, 1)), fmt(new Date(y, m + 1, 0))];
  const slash = s => s.replace(/-/g, '/');

  const params = new URLSearchParams(location.search);
  const now = new Date();
  const [defStart, defEnd] = monthRange(now.getFullYear(), now.getMonth());
  const valid = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  const state = {
    start: valid(params.get('start')) ? params.get('start') : defStart,
    end: valid(params.get('end')) ? params.get('end') : defEnd,
    data: null,
  };

  root.innerHTML = `
    <div class="sumBar noPrint">
      <button class="iconBtn" data-act="prevMonth" aria-label="前月"><i class="ti ti-chevron-left"></i></button>
      <input type="date" id="smStart" aria-label="開始日">
      <span class="muted">〜</span>
      <input type="date" id="smEnd" aria-label="終了日">
      <button class="iconBtn" data-act="nextMonth" aria-label="翌月"><i class="ti ti-chevron-right"></i></button>
      <button class="btn" data-act="thisMonth">今月</button>
      <div class="barRight">
        <button class="btn" data-act="print"><i class="ti ti-printer"></i>印刷</button>
        <button class="btn primary" data-act="excel"><i class="ti ti-file-spreadsheet"></i>Excel出力</button>
      </div>
    </div>
    <h2 class="printTitle" id="smTitle"></h2>
    <p class="muted smNote">削除済みの予約は集計に含みません。</p>
    <div class="tableWrap"><table class="grid sumTable">
      <thead id="smHead"></thead><tbody id="smBody"><tr><td class="empty">読み込み中…</td></tr></tbody><tfoot id="smFoot"></tfoot>
    </table></div>`;

  const $ = id => document.getElementById(id);

  async function load() {
    const u = new URL(location.href);
    u.searchParams.set('start', state.start);
    u.searchParams.set('end', state.end);
    history.replaceState(null, '', u);
    $('smStart').value = state.start;
    $('smEnd').value = state.end;
    state.data = await api(`/api/${MEAL}/summary?start=${state.start}&end=${state.end}`);
    render();
  }

  function render() {
    const d = state.data;
    $('smTitle').textContent = `${MEAL_LABEL}集計　${slash(d.start)}〜${slash(d.end)}`;
    $('smHead').innerHTML = `<tr><th>日付</th>${d.columns.map(c => `<th class="num">${esc(c.label)}</th>`).join('')}</tr>`;
    $('smBody').innerHTML = d.days.map(day => {
      const cls = { 土: 'sat', 日: 'sun' }[day.weekday] || '';
      return `<tr class="${day.groups ? '' : 'zero'}">
        <td class="date ${cls}"><a href="/${MEAL}?d=${day.date}">${+day.date.slice(5, 7)}/${+day.date.slice(8, 10)}(${day.weekday})</a></td>
        ${d.columns.map(c => `<td class="num${c.key === 'total' ? ' strong' : ''}">${day[c.key] || '<span class="z">0</span>'}</td>`).join('')}
      </tr>`;
    }).join('');
    $('smFoot').innerHTML = `<tr><td>合計</td>${d.columns.map(c => `<td class="num">${d.total[c.key]}</td>`).join('')}</tr>`;
  }

  function setRange(start, end) {
    if (end < start) return toast('終了日は開始日以降にしてください', true);
    state.start = start;
    state.end = end;
    load().catch(() => {});
  }

  const shiftMonth = n => {
    const s = new Date(state.start + 'T00:00:00');
    setRange(...monthRange(s.getFullYear(), s.getMonth() + n));
  };

  root.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'prevMonth') shiftMonth(-1);
    else if (act === 'nextMonth') shiftMonth(1);
    else if (act === 'thisMonth') setRange(defStart, defEnd);
    else if (act === 'print') window.print();
    else if (act === 'excel') location.href = `/api/${MEAL}/summary.xlsx?start=${state.start}&end=${state.end}`;
  });
  $('smStart').addEventListener('change', e => { if (e.target.value) setRange(e.target.value, state.end < e.target.value ? e.target.value : state.end); });
  $('smEnd').addEventListener('change', e => { if (e.target.value) setRange(state.start, e.target.value); });

  load().catch(() => {});
})();

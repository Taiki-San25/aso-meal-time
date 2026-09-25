/* logs.js — 操作ログ(予約・チャット・ログイン)を新しい順に表示 */
(function () {
  const root = document.getElementById('logs');
  const { esc, api, toast } = AMT;

  const pad = n => String(n).padStart(2, '0');
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = fmt(new Date());
  const valid = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  const params = new URLSearchParams(location.search);
  const state = {
    start: valid(params.get('start')) ? params.get('start') : today,
    end: valid(params.get('end')) ? params.get('end') : today,
    kind: params.get('kind') || '',
    q: '',
    logs: [],
  };
  const WEEK = '日月火水木金土';

  root.innerHTML = `
    <div class="logBar">
      <input type="date" id="lgStart" aria-label="開始日">
      <span class="muted">〜</span>
      <input type="date" id="lgEnd" aria-label="終了日">
      <button class="btn" data-act="today">今日</button>
      <select id="lgKind" aria-label="操作の種類">
        <option value="">すべての操作</option>
        <option value="reservation">予約</option>
        <option value="chat">チャット</option>
        <option value="auth">ログイン</option>
      </select>
      <input type="search" id="lgQ" placeholder="部屋・名前・操作者・内容で検索" aria-label="キーワード">
      <button class="btn" data-act="reload" title="最新の状態に更新"><i class="ti ti-refresh"></i>更新</button>
    </div>
    <p class="muted lgCount" id="lgCount"></p>
    <div class="tableWrap"><table class="grid logTable">
      <thead><tr><th>日時</th><th>操作者</th><th>種類</th><th>操作</th><th>対象</th><th>内容</th></tr></thead>
      <tbody id="lgBody"><tr><td colspan="6" class="empty">読み込み中…</td></tr></tbody>
    </table></div>`;

  const $ = id => document.getElementById(id);
  $('lgKind').value = state.kind;

  async function load() {
    const u = new URL(location.href);
    u.searchParams.set('start', state.start);
    u.searchParams.set('end', state.end);
    if (state.kind) u.searchParams.set('kind', state.kind); else u.searchParams.delete('kind');
    history.replaceState(null, '', u);
    $('lgStart').value = state.start;
    $('lgEnd').value = state.end;
    state.logs = await api(`/api/logs?start=${state.start}&end=${state.end}`);
    render();
  }

  function render() {
    const q = state.q.trim().toLowerCase();
    const rows = state.logs.filter(l => (!state.kind || l.kind === state.kind) &&
      (!q || [l.user, l.role_label, l.action, l.target, l.detail].join(' ').toLowerCase().includes(q)));
    $('lgCount').textContent = `${rows.length}件${rows.length !== state.logs.length ? `(全${state.logs.length}件中)` : ''}`;
    if (!rows.length) {
      $('lgBody').innerHTML = `<tr><td colspan="6" class="empty">${state.logs.length ? '該当する操作はありません' : 'この期間の操作はありません'}</td></tr>`;
      return;
    }
    const multiDay = state.start !== state.end;
    $('lgBody').innerHTML = rows.map(l => {
      const d = l.at.slice(0, 10);
      const when = `${multiDay ? `${+d.slice(5, 7)}/${+d.slice(8, 10)}(${WEEK[new Date(d + 'T00:00:00').getDay()]}) ` : ''}${l.at.slice(11, 19)}`;
      return `<tr class="${l.failed ? 'failed' : ''}">
        <td class="when">${when}</td>
        <td class="who">${l.role ? `<span class="roleTag role-${l.role}">${esc(l.role_label)}</span>` : ''}${esc(l.user) || '<span class="muted">不明</span>'}</td>
        <td><span class="kindTag k-${l.kind}">${esc(l.kind_label)}</span></td>
        <td class="act">${esc(l.action)}</td>
        <td class="target">${l.link ? `<a href="${l.link}">${esc(l.target)}</a>` : esc(l.target)}</td>
        <td class="detail" title="${esc(l.detail)}">${esc(l.detail)}</td>
      </tr>`;
    }).join('');
  }

  function setRange(start, end) {
    if (end < start) return toast('終了日は開始日以降にしてください', true);
    state.start = start;
    state.end = end;
    load().catch(() => {});
  }

  root.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'today') setRange(today, today);
    else if (act === 'reload') load().then(() => toast('更新しました')).catch(() => {});
  });
  $('lgStart').addEventListener('change', e => { if (e.target.value) setRange(e.target.value, state.end < e.target.value ? e.target.value : state.end); });
  $('lgEnd').addEventListener('change', e => { if (e.target.value) setRange(state.start, e.target.value); });
  $('lgKind').addEventListener('change', e => { state.kind = e.target.value; load().catch(() => {}); });
  $('lgQ').addEventListener('input', e => { state.q = e.target.value; render(); });

  load().catch(() => {});
})();

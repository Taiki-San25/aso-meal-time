/* chat.js — フロント・レストラン・管理者の連絡チャット */
(function () {
  const { esc, api, toast, modal } = AMT;
  const POLL_MS = 5000;
  const MEAL_LABEL = { dinner: '夕食', breakfast: '朝食' };
  const WEEK = '日月火水木金土';

  const log = document.getElementById('chatLog');
  const form = document.getElementById('composer');
  const input = document.getElementById('msgInput');
  const attachedBox = document.getElementById('attached');

  const state = { me: null, messages: [], reads: [], attached: null, lastRead: 0, loaded: false };

  const pad = n => String(n).padStart(2, '0');
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const dow = s => WEEK[new Date(s + 'T00:00:00').getDay()];
  const md = s => `${+s.slice(5, 7)}/${+s.slice(8, 10)}(${dow(s)})`;
  const dayHead = s => `${+s.slice(0, 4) === new Date().getFullYear() ? '' : s.slice(0, 4) + '年'}${+s.slice(5, 7)}月${+s.slice(8, 10)}日(${dow(s)})`;

  // ---------- 予約カード ----------
  function resCard(r, removable) {
    if (!r) return '';
    const body = `<i class="ti ${r.meal === 'dinner' ? 'ti-moon' : 'ti-sun'}"></i>
      <span><b>${MEAL_LABEL[r.meal]} ${md(r.date)}</b> ${esc(r.room)} ${esc(r.guest_name)}${r.guest_name ? ' 様' : ''}
      <span class="muted">${r.time_slot || '時間未定'}${r.deleted ? '・削除済み' : ''}</span></span>`;
    return removable
      ? `<div class="resCard">${body}<button type="button" class="iconBtn" data-unattach aria-label="添付を外す"><i class="ti ti-x"></i></button></div>`
      : `<a class="resCard${r.deleted ? ' deleted' : ''}" href="/${r.meal}?d=${r.date}&hl=${r.id}">${body}<i class="ti ti-chevron-right go"></i></a>`;
  }

  // ---------- 描画 ----------
  function render() {
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    if (!state.messages.length) {
      log.innerHTML = '<p class="empty">まだメッセージはありません。</p>';
      return;
    }
    let prevDay = '';
    log.innerHTML = state.messages.map(m => {
      const day = m.created_at.slice(0, 10);
      const sep = day !== prevDay ? `<div class="daySep"><span>${dayHead(day)}</span></div>` : '';
      prevDay = day;
      const mine = m.user_id === state.me;
      const time = m.created_at.slice(11, 16);
      const readers = mine && !m.retracted
        ? state.reads.filter(r => r.user_id !== state.me && r.last_read_id >= m.id).map(r => r.role_label || r.name)
        : [];
      const meta = `<div class="meta">
          ${mine && readers.length ? `<span class="read">既読 ${esc([...new Set(readers)].join('・'))}</span>` : ''}
          <span>${time}</span>
          ${mine && !m.retracted ? `<button type="button" class="retract" data-retract="${m.id}">取り消し</button>` : ''}
        </div>`;
      return `${sep}<div class="msg ${mine ? 'mine' : 'other'} role-${m.role}" data-id="${m.id}">
        ${mine ? '' : `<div class="who"><span class="roleTag role-${m.role}">${esc(m.role_label)}</span>${m.name !== m.role_label ? esc(m.name) : ''}</div>`}
        <div class="bubbleRow">
          ${m.retracted
            ? '<div class="bubble retracted"><i class="ti ti-arrow-back-up"></i>メッセージの送信を取り消しました</div>'
            : `<div class="bubble">${m.body ? `<div class="text">${esc(m.body)}</div>` : ''}${resCard(m.reservation, false)}</div>`}
          ${meta}
        </div>
      </div>`;
    }).join('');
    if (!state.loaded || nearBottom) log.scrollTop = log.scrollHeight;
    state.loaded = true;
  }

  function renderAttached() {
    attachedBox.hidden = !state.attached;
    attachedBox.innerHTML = resCard(state.attached, true);
  }

  // ---------- データ ----------
  async function load() {
    const d = await api('/api/chat/messages');
    const sig = JSON.stringify([d.messages, d.reads]);
    state.me = d.me;
    state.messages = d.messages;
    state.reads = d.reads;
    if (sig !== state.sig || !state.loaded) render();  // 変化が無ければ描き直さない(選択中の文字が消えないように)
    state.sig = sig;
    markRead();
  }

  async function markRead() {
    if (document.hidden || !state.messages.length) return;
    const last = state.messages[state.messages.length - 1].id;
    if (last <= state.lastRead) return;
    state.lastRead = last;
    const r = await api('/api/chat/read', { method: 'POST', body: { last_id: last } }).catch(() => null);
    if (r) AMT.setUnread(r.unread);
  }

  // ---------- 送信 ----------
  let sending = false;
  async function send() {
    const body = input.value.trim();
    if (sending || (!body && !state.attached)) return;
    sending = true;
    document.getElementById('sendBtn').disabled = true;
    try {
      await api('/api/chat/messages', { method: 'POST', body: { body, reservation_id: state.attached?.id ?? null } });
      input.value = '';
      autoGrow();
      state.attached = null;
      renderAttached();
      state.loaded = false;  // 自分の送信後は最下部へ
      await load();
    } catch (e) { /* toast 済み */ }
    sending = false;
    document.getElementById('sendBtn').disabled = false;
    input.focus();
  }

  form.addEventListener('submit', e => { e.preventDefault(); send(); });
  input.addEventListener('keydown', e => {
    // 日本語入力の変換確定の Enter では送信しない
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); send(); }
  });
  const autoGrow = () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight + 2, 160) + 'px';
    input.style.overflowY = input.scrollHeight > 158 ? 'auto' : 'hidden';
  };
  input.addEventListener('input', autoGrow);

  // ---------- 取り消し ----------
  log.addEventListener('click', e => {
    const id = e.target.closest('[data-retract]')?.dataset.retract;
    if (!id) return;
    modal({
      title: 'メッセージの取り消し',
      body: '<p style="margin:0">このメッセージを取り消します。相手の画面からも見えなくなります。</p>',
      buttons: [{ label: 'キャンセル' }, {
        label: '取り消す', danger: true, onClick: async () => {
          await api(`/api/chat/messages/${id}/retract`, { method: 'POST' });
          toast('取り消しました');
          await load();
        }
      }]
    });
  });

  // ---------- 予約の添付 ----------
  attachedBox.addEventListener('click', e => {
    if (e.target.closest('[data-unattach]')) { state.attached = null; renderAttached(); }
  });

  document.getElementById('attachBtn').addEventListener('click', () => {
    const m = modal({
      title: '予約を添付',
      wide: true,
      body: `<div class="form">
        <div class="row">
          <label>区分<select name="meal"><option value="dinner">夕食</option><option value="breakfast">朝食</option></select></label>
          <label>日付<input type="date" name="date" value="${today()}"></label>
        </div>
        <input type="search" name="q" placeholder="部屋・名前で絞り込み" aria-label="絞り込み">
        <div class="pickList"><p class="empty">読み込み中…</p></div>
      </div>`,
      buttons: [{ label: 'キャンセル' }],
    });
    const meal = m.querySelector('[name=meal]'), date = m.querySelector('[name=date]'), q = m.querySelector('[name=q]');
    const list = m.querySelector('.pickList');
    let rows = [];
    const draw = () => {
      const k = q.value.trim().toLowerCase();
      const shown = rows.filter(r => !k || (r.room + ' ' + r.guest_name).toLowerCase().includes(k));
      list.innerHTML = shown.length ? shown.map(r => `<button type="button" class="pickItem" data-id="${r.id}">
          <b>${esc(r.room)}</b><span>${esc(r.guest_name)}</span><span class="muted">${r.time_slot || '時間未定'}</span></button>`).join('')
        : '<p class="empty">この日の予約はありません</p>';
    };
    const fetchRows = async () => {
      list.innerHTML = '<p class="empty">読み込み中…</p>';
      rows = (await api(`/api/${meal.value}/reservations?d=${date.value}`).catch(() => []))
        .sort((a, b) => a.room.localeCompare(b.room, 'ja', { numeric: true }));
      draw();
    };
    meal.addEventListener('change', fetchRows);
    date.addEventListener('change', () => { if (date.value) fetchRows(); });
    q.addEventListener('input', draw);
    list.addEventListener('click', e => {
      const id = +e.target.closest('[data-id]')?.dataset.id;
      const r = rows.find(x => x.id === id);
      if (!r) return;
      state.attached = { id: r.id, meal: meal.value, date: date.value, room: r.room, guest_name: r.guest_name, time_slot: r.time_slot };
      renderAttached();
      m.close();
      input.focus();
    });
    fetchRows();
  });

  // ---------- 更新 ----------
  setInterval(() => { if (!document.hidden) load().catch(() => {}); }, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load().catch(() => {}); });
  load().catch(() => {});
})();

/* table_assign.js — 時間帯ごとに予約を見取り図のテーブルへアサイン(ドラッグ、または予約を選んでテーブルを押す) */
(function () {
  const root = document.getElementById('tableAssign');
  const MEAL = root.dataset.meal;
  const { esc, api, toast } = AMT;
  const pad = n => String(n).padStart(2, '0');
  const fmtDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return fmtDate(d); };
  const WEEK = '日月火水木金土';
  const mins = t => t ? (+t.slice(0, 2)) * 60 + (+t.slice(3, 5)) : null;
  const pax = r => r.adults + r.children + r.infants;

  const params = new URLSearchParams(location.search);
  const state = {
    date: /^\d{4}-\d{2}-\d{2}$/.test(params.get('d') || '') ? params.get('d') : fmtDate(new Date()),
    slot: params.get('t') || null,
    layout: { width: 3000, height: 2000, items: [] }, res: [], assigns: [], slots: [], stay: 120,
    sel: null,   // 選択中の予約ID
    q: '', zoom: 0.6,
  };

  root.innerHTML = `
    <div class="taBar">
      <button class="iconBtn" data-act="prev" aria-label="前日"><i class="ti ti-chevron-left"></i></button>
      <input type="date" id="taDate" aria-label="日付" style="width:150px">
      <span class="dow" id="taDow"></span>
      <button class="iconBtn" data-act="next" aria-label="翌日"><i class="ti ti-chevron-right"></i></button>
      <button class="btn" data-act="today">今日</button>
      <div class="barRight">
        <span class="muted" style="font-size:12px" id="taStay"></span>
        <span class="zoomBox"><button class="iconBtn" data-zoom="-1" aria-label="縮小"><i class="ti ti-zoom-out"></i></button><span id="taZoom"></span><button class="iconBtn" data-zoom="1" aria-label="拡大"><i class="ti ti-zoom-in"></i></button></span>
      </div>
    </div>
    <div class="slotTabs" id="taSlots"></div>
    <div class="taMain">
      <aside class="resPanel">
        <div class="rpTop">
          <input type="search" id="taQ" placeholder="部屋・名前・テーブル番号で検索" aria-label="検索">
          <div class="rpSum" id="taSum"></div>
        </div>
        <div class="resList" id="taList"></div>
      </aside>
      <div class="floorWrap" id="taWrap"><div class="floor" id="taFloor"></div></div>
    </div>`;
  const $ = id => document.getElementById(id);
  const wrap = $('taWrap'), floor = $('taFloor');
  let pop = null;

  // ---------- データ ----------
  let loadSeq = 0;
  async function load() {
    const seq = ++loadSeq;
    const u = new URL(location.href);
    u.searchParams.set('d', state.date);
    if (state.slot) u.searchParams.set('t', state.slot); else u.searchParams.delete('t');
    history.replaceState(null, '', u);
    const [layout, a] = await Promise.all([api(`/api/layout/${MEAL}`), api(`/api/${MEAL}/assign?d=${state.date}`)]);
    if (seq !== loadSeq) return;
    state.layout = layout;
    state.res = a.reservations;
    state.assigns = a.assignments;
    state.slots = a.slots;
    state.stay = a.stay_minutes;
    // 時間帯: 予約にあって枠設定に無い時刻も出す
    const times = [...new Set([...state.slots, ...state.res.map(r => r.time_slot).filter(Boolean)])].sort();
    state.times = times;
    if (!state.slot || !times.includes(state.slot)) state.slot = times.find(t => state.res.some(r => r.time_slot === t && !tablesOf(r.id).length)) || times[0] || null;
    if (state.sel && !state.res.some(r => r.id === state.sel)) state.sel = null;
    render();
  }
  // 今の見取り図にあるテーブルだけ(削除済みのテーブルへの過去のアサインは、判定・席数に含めない)
  const tablesOf = rid => state.assigns.filter(a => a.reservation_id === rid && tableById(a.table_id)).map(a => a.table_id);
  const tableNamesOf = rid => tablesOf(rid).map(tid => tableById(tid).name);
  const removedNamesOf = r => (r.tables || []).filter(n => !tableNamesOf(r.id).includes(n));
  const tagsOf = r => tableNamesOf(r.id).map(t => `<span class="tblTag">${esc(t)}</span>`).join('') +
    removedNamesOf(r).map(t => `<span class="tblTag removed" title="削除済みのテーブル">${esc(t)}</span>`).join('');
  const resById = id => state.res.find(r => r.id === id);
  const tableById = id => state.layout.items.find(i => i.id === id);
  const seatsOf = rid => tablesOf(rid).reduce((s, tid) => s + ((tableById(tid) || {}).seats || 0), 0);

  // その時間帯でのテーブルの状態: here(この時間帯の予約) / busy(滞在時間が重なる別の時間帯の予約) / free
  function tableState(tid) {
    const s = mins(state.slot);
    for (const a of state.assigns.filter(x => x.table_id === tid)) {
      const r = resById(a.reservation_id);
      if (!r || !r.time_slot) continue;
      if (r.time_slot === state.slot) return { kind: 'here', r };
    }
    for (const a of state.assigns.filter(x => x.table_id === tid)) {
      const r = resById(a.reservation_id);
      if (r && r.time_slot && Math.abs(mins(r.time_slot) - s) < state.stay) return { kind: 'busy', r };
    }
    return { kind: 'free' };
  }

  // ---------- 描画 ----------
  function render() {
    const d = state.date;
    $('taDate').value = d;
    const dw = WEEK[new Date(d + 'T00:00:00').getDay()];
    $('taDow').textContent = `(${dw})`;
    $('taDow').className = 'dow' + ({ 土: ' sat', 日: ' sun' }[dw] || '');
    $('taStay').textContent = `滞在時間 ${state.stay}分`;
    $('taZoom').textContent = `${Math.round(state.zoom * 100)}%`;
    renderSlots(); renderList(); renderFloor();
  }

  function renderSlots() {
    const unset = state.res.filter(r => !r.time_slot).length;
    $('taSlots').innerHTML = (state.times || []).map(t => {
      const rs = state.res.filter(r => r.time_slot === t), todo = rs.filter(r => !tablesOf(r.id).length).length;
      return `<button class="slotTab${t === state.slot ? ' on' : ''}" data-slot="${t}">${t}
        <span class="cnt${todo ? ' todo' : ''}" title="${todo ? `未アサイン${todo}組` : 'すべてアサイン済み'}">${todo ? `残${todo}` : rs.length ? '✓' : '0'}</span></button>`;
    }).join('') + (unset ? `<span class="muted" style="font-size:12px;align-self:center">時間未定 ${unset}組(時間を決めるとアサインできます)</span>` : '');
  }

  function renderList() {
    const q = state.q.trim().toLowerCase();
    const rs = state.res.filter(r => r.time_slot === state.slot)
      .filter(r => !q || [r.room, r.guest_name, ...tableNamesOf(r.id)].join(' ').toLowerCase().includes(q))
      .sort((a, b) => a.room.localeCompare(b.room, 'ja', { numeric: true }));
    const todo = rs.filter(r => !tablesOf(r.id).length), done = rs.filter(r => tablesOf(r.id).length);
    const all = state.res.filter(r => r.time_slot === state.slot);
    const freeCount = state.layout.items.filter(i => i.kind === 'table' && tableState(i.id).kind === 'free').length;
    $('taSum').innerHTML = `${state.slot || '-'}　${all.length}組・${all.reduce((a, r) => a + pax(r), 0)}名　未アサイン <b style="color:#c0392b">${all.filter(r => !tablesOf(r.id).length).length}</b>組　空き ${freeCount}卓`;
    const card = r => {
      const ts = tablesOf(r.id), seats = seatsOf(r.id), short = ts.length && seats < pax(r);
      return `<div class="resCard${r.id === state.sel ? ' sel' : ''}${ts.length ? ' done' : ''}" draggable="true" data-rid="${r.id}">
        <div class="rcTop"><span class="rcRoom">${esc(r.room)}</span><span class="rcName">${r.vip ? '<span class="vipStar">★</span>' : ''}${esc(r.guest_name)}</span>
          <span class="rcPax">${pax(r)}名</span></div>
        <div class="rcSub">${ts.length ? '' : '<span class="todoTag">未アサイン</span>'}${tagsOf(r)}
          ${short ? `<span class="warn" title="人数がテーブルの席数を超えています">席不足 ${pax(r)}/${seats}席</span>` : ''}
          ${r.allergy ? `<span class="allergy"><i class="ti ti-alert-triangle"></i>${esc(r.allergy)}</span>` : ''}</div>
      </div>`;
    };
    $('taList').innerHTML = !state.slot ? '<p class="empty">この日の予約はありません</p>'
      : (todo.length ? `<div class="resGroup">未アサイン ${todo.length}組</div>${todo.map(card).join('')}` : '') +
        (done.length ? `<div class="resGroup">アサイン済み ${done.length}組</div>${done.map(card).join('')}` : '') +
        (!rs.length ? '<p class="empty">該当する予約はありません</p>' : '');
  }

  function renderFloor() {
    const z = state.zoom, L = state.layout;
    floor.style.width = `${L.width * z}px`;
    floor.style.height = `${L.height * z}px`;
    floor.style.backgroundSize = `${20 * z}px ${20 * z}px`;
    if (!L.items.length) {
      floor.innerHTML = `<p class="empty" style="padding:40px">見取り図がまだありません。管理者が「レイアウト編集」で作成してください。</p>`;
      return;
    }
    const selTables = state.sel ? new Set(tablesOf(state.sel)) : new Set();
    const fs = Math.max(9, Math.min(14, 14 * z / 0.8));
    floor.innerHTML = L.items.map(it => {
      const box = `left:${it.x * z}px;top:${it.y * z}px;width:${it.w * z}px;height:${it.h * z}px;font-size:${fs}px`;
      if (it.kind !== 'table') return `<div class="fItem marker" style="${box}"><span>${esc(it.name)}</span></div>`;
      const st = tableState(it.id);
      let cls = '', guest = '';
      if (st.kind === 'here') {
        const r = st.r, over = seatsOf(r.id) < pax(r);
        cls = over ? 'assigned over' : 'assigned';
        guest = `${r.vip ? '★' : ''}${r.room} ${r.guest_name}`;
      } else if (st.kind === 'busy') {
        cls = 'busy';
        guest = `${st.r.time_slot} ${st.r.room}`;
      }
      if (selTables.has(it.id)) cls += ' mine';
      return `<div class="fItem table ${it.shape} ${cls}" data-tid="${it.id}" style="${box}" title="${esc(it.name)}(${it.seats}席)${guest ? ' ' + esc(guest) : ''}">
        <span class="fName" style="font-size:${fs}px">${esc(it.name)}</span>
        ${guest ? `<span class="fGuest" style="font-size:${fs * 0.8}px">${esc(guest)}</span>` : `<span class="fSeats" style="font-size:${fs * 0.8}px">${it.seats}席</span>`}
      </div>`;
    }).join('');
    const tables = L.items.filter(i => i.kind === 'table');
    const used = tables.filter(t => tableState(t.id).kind !== 'free').length;
    $('taStats').innerHTML = `テーブル <b>${tables.length}</b>卓・<b>${tables.reduce((a, b) => a + b.seats, 0)}</b>席　この時間帯の使用 <b>${used}</b>卓`;
  }

  // ---------- アサイン・解除 ----------
  async function assign(rid, tid) {
    const r = resById(rid), t = tableById(tid);
    if (!r || !t) return;
    if (tablesOf(rid).includes(tid)) return;
    const st = tableState(tid);
    if (st.kind === 'here' && st.r.id !== rid) return toast(`${t.name} はこの時間帯の ${st.r.room} ${st.r.guest_name} 様にアサイン済みです`, true);
    if (st.kind === 'busy') return toast(`${t.name} は ${st.r.time_slot} の ${st.r.room} ${st.r.guest_name} 様が使用中です`, true);
    const updated = await api(`/api/${MEAL}/reservations/${rid}/tables`, { method: 'POST', body: { table_id: tid } }).catch(() => null);
    if (!updated) return load().catch(() => {});
    state.assigns.push({ reservation_id: rid, table_id: tid });
    Object.assign(r, { tables: updated.tables });
    const short = seatsOf(rid) < pax(r);
    toast(`${r.room} ${r.guest_name} 様を ${t.name} にアサインしました${short ? `(席不足 ${pax(r)}名/${seatsOf(rid)}席)` : ''}`, short);
    render();
  }
  async function unassign(rid, tid) {
    const updated = await api(`/api/${MEAL}/reservations/${rid}/tables/${tid}`, { method: 'DELETE' }).catch(() => null);
    if (!updated) return;
    state.assigns = state.assigns.filter(a => !(a.reservation_id === rid && a.table_id === tid));
    Object.assign(resById(rid), { tables: updated.tables });
    toast(`${(tableById(tid) || {}).name} のアサインを解除しました`);
    render();
  }

  // ---------- 操作 ----------
  function closePop() { if (pop) { pop.remove(); pop = null; } }
  function openPop(tid, x, y) {
    closePop();
    const t = tableById(tid), st = tableState(tid);
    pop = document.createElement('div');
    pop.className = 'tPop';
    if (st.kind === 'here') {
      const r = st.r;
      pop.innerHTML = `<div class="tpHead">${esc(t.name)}(${t.seats}席)</div>
        <div>${r.vip ? '<span class="vipStar">★</span>' : ''}<b>${esc(r.room)}</b> ${esc(r.guest_name)} ${pax(r)}名</div>
        <div class="muted" style="font-size:12px">テーブル: ${esc(tableNamesOf(r.id).join(', '))}${seatsOf(r.id) < pax(r) ? `<br><span style="color:#c0392b">席不足 ${pax(r)}名/${seatsOf(r.id)}席</span>` : ''}</div>
        <div class="btns"><button class="btn" data-pop="select" data-rid="${r.id}">この予約を選ぶ</button><button class="btn danger" data-pop="unassign" data-rid="${r.id}" data-tid="${tid}">解除</button></div>`;
    } else if (st.kind === 'busy') {
      pop.innerHTML = `<div class="tpHead">${esc(t.name)}(${t.seats}席)</div><div>使用中: ${st.r.time_slot} ${esc(st.r.room)} ${esc(st.r.guest_name)} 様</div>
        <div class="muted" style="font-size:12px">滞在時間(${state.stay}分)が重なるため、この時間帯にはアサインできません。</div>`;
    } else {
      pop.innerHTML = `<div class="tpHead">${esc(t.name)}(${t.seats}席) 空き</div><div class="muted" style="font-size:12px">左の予約を選んでからテーブルを押すか、予約をテーブルへドラッグしてアサインします。</div>`;
    }
    document.body.appendChild(pop);
    pop.style.left = `${Math.min(x + 8, innerWidth - pop.offsetWidth - 8)}px`;
    pop.style.top = `${Math.min(y + 8, innerHeight - pop.offsetHeight - 8)}px`;
  }

  root.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'prev') { state.date = addDays(state.date, -1); state.sel = null; load().catch(() => {}); }
    else if (act === 'next') { state.date = addDays(state.date, 1); state.sel = null; load().catch(() => {}); }
    else if (act === 'today') { state.date = fmtDate(new Date()); state.sel = null; load().catch(() => {}); }
    const zoom = e.target.closest('[data-zoom]')?.dataset.zoom;
    if (zoom) { state.zoom = Math.max(0.3, Math.min(1.5, Math.round((state.zoom + (+zoom) * 0.1) * 10) / 10)); render(); }
    const slot = e.target.closest('[data-slot]')?.dataset.slot;
    if (slot) { state.slot = slot; state.sel = null; closePop(); load().catch(() => {}); }
    const card = e.target.closest('.resCard');
    if (card) { const rid = +card.dataset.rid; state.sel = state.sel === rid ? null : rid; render(); }
  });
  $('taDate').addEventListener('change', e => { if (e.target.value) { state.date = e.target.value; state.sel = null; load().catch(() => {}); } });
  $('taQ').addEventListener('input', e => { state.q = e.target.value; renderList(); });

  floor.addEventListener('click', e => {
    const el = e.target.closest('.fItem.table');
    if (!el) return closePop();
    const tid = +el.dataset.tid, st = tableState(tid);
    // 予約を選んでいて、テーブルが空いていればアサイン
    if (state.sel && st.kind === 'free') { closePop(); return assign(state.sel, tid); }
    if (state.sel && st.kind === 'here' && st.r.id === state.sel) return openPop(tid, e.clientX, e.clientY);
    openPop(tid, e.clientX, e.clientY);
  });
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-pop]');
    if (b) {
      const rid = +b.dataset.rid;
      if (b.dataset.pop === 'select') { state.sel = rid; closePop(); render(); }
      else if (b.dataset.pop === 'unassign') { closePop(); unassign(rid, +b.dataset.tid); }
      return;
    }
    if (pop && !pop.contains(e.target) && !e.target.closest('.fItem.table')) closePop();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closePop(); state.sel = null; render(); } });

  // ドラッグでアサイン
  let dragRid = null;
  $('taList').addEventListener('dragstart', e => {
    const card = e.target.closest('.resCard');
    if (!card) return;
    dragRid = +card.dataset.rid;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(dragRid));
  });
  $('taList').addEventListener('dragend', e => { e.target.closest('.resCard')?.classList.remove('dragging'); dragRid = null; floor.querySelectorAll('.dropOk').forEach(x => x.classList.remove('dropOk')); });
  floor.addEventListener('dragover', e => {
    const el = e.target.closest('.fItem.table');
    floor.querySelectorAll('.dropOk').forEach(x => x !== el && x.classList.remove('dropOk'));
    if (el && dragRid && tableState(+el.dataset.tid).kind === 'free') { e.preventDefault(); el.classList.add('dropOk'); }
  });
  floor.addEventListener('drop', e => {
    const el = e.target.closest('.fItem.table');
    if (!el || !dragRid) return;
    e.preventDefault();
    assign(dragRid, +el.dataset.tid);
  });

  // 他の端末の変更を反映(30秒ごと、ドラッグ中・小窓表示中は止める)
  setInterval(() => { if (!document.hidden && !dragRid && !pop) load().catch(() => {}); }, 30000);
  load().catch(() => {});
})();

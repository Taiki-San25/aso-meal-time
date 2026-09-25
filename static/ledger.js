/* ledger.js — 喫食時間管理表(夕食・朝食共通)。#ledger[data-meal] に描画する */
(function () {
  const root = document.getElementById('ledger');
  const MEAL = root.dataset.meal;
  const { esc, api, toast, modal } = AMT;
  const REFRESH_MS = 30000;
  const UNSET = '';  // 時間未定
  const MAX_COUNT = 6;  // フォームで選べる人数の上限

  const pad = n => String(n).padStart(2, '0');
  const fmtDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return fmtDate(d); };
  const WEEK = '日月火水木金土';
  const dow = s => WEEK[new Date(s + 'T00:00:00').getDay()];

  // 一覧の列。見出しクリックで並び替え(もう一度押すと逆順)
  const byText = f => r => r[f] || '';
  const COLUMNS = [
    { key: 'time', label: '時間', val: r => r.time_slot || '' },
    { key: 'status', label: 'ステータス', val: r => (r.entered_at ? 1 : 0) },
    { key: 'room', label: '部屋', val: byText('room') },
    { key: 'guest_name', label: '代表者名', val: byText('guest_name') },
    { key: 'nights', label: '泊数', val: r => r.nights * 100 + r.night_no },
    { key: 'adults', label: '大人', num: true, val: r => r.adults },
    { key: 'children', label: '子供', num: true, val: r => r.children },
    { key: 'infants', label: '幼児', num: true, val: r => r.infants },
    { key: 'total', label: '計', num: true, val: r => r.adults + r.children + r.infants },
    { key: 'allergy', label: 'アレルギー', val: byText('allergy') },
    { key: 'note', label: '備考', val: byText('note') },
    { key: 'updated', label: '更新', cls: 'noPrint', firstDir: -1, val: r => (r.deleted ? r.deleted_at : r.updated_at) || '' },
  ];

  // 人数の内訳(フォームでは略称、ホバーで正式名称)
  // icon: 大人=人 / 子供=子供の顔 / 外来=ドア、kind: 色分け(cp=クーポン, free=フリー, out=外来)
  const COUNT_FIELDS = [
    { key: 'adult_coupon', short: '大人CP', full: '大人クーポン(食事付)', icon: 'ti-user', kind: 'cp' },
    { key: 'free_adult', short: 'フリー大', full: 'フリー大人(生打ち)', icon: 'ti-user', kind: 'free' },
    { key: 'child_coupon', short: '子供CP', full: '子供クーポン(食事付)', icon: 'ti-mood-kid', kind: 'cp' },
    { key: 'free_child', short: 'フリー子', full: 'フリー子供(生打ち)', icon: 'ti-mood-kid', kind: 'free' },
    { key: 'outside', short: '外来', full: '外来', icon: 'ti-door-enter', kind: 'out' },
  ];
  const countIcon = c => `<span class="cntIcon ${c.kind}" title="${c.full}" aria-label="${c.full}" role="img"><i class="ti ${c.icon}"></i></span>`;
  // 数が1以上の内訳項目をアイコンで表示(数は出さない)
  const countBadges = r => {
    const icons = COUNT_FIELDS.filter(c => r[c.key] > 0).map(countIcon).join('');
    return icons ? `<span class="cntBadges">${icons}</span>` : '';
  };

  const params = new URLSearchParams(location.search);
  const state = {
    date: /^\d{4}-\d{2}-\d{2}$/.test(params.get('d') || '') ? params.get('d') : fmtDate(new Date()),
    slots: [],
    rows: [],
    q: '',
    sort: { key: 'time', dir: 1 },  // dir: 1=昇順 -1=降順
    showDeleted: false,
    role: null,  // ログイン中のロール(入場済の操作はレストランのみ)
  };

  root.innerHTML = `
    <div class="ledgerBar noPrint">
      <div class="dateNav">
        <button class="iconBtn" data-act="prev" aria-label="前日"><i class="ti ti-chevron-left"></i></button>
        <input type="date" id="ldDate" aria-label="日付">
        <span class="dow" id="ldDow"></span>
        <button class="iconBtn" data-act="next" aria-label="翌日"><i class="ti ti-chevron-right"></i></button>
        <button class="btn" data-act="today">今日</button>
      </div>
      <input type="search" id="ldSearch" placeholder="部屋・名前・備考で検索" aria-label="検索">
      <label class="delToggle"><input type="checkbox" id="ldShowDeleted">削除済みも表示</label>
      <div class="barRight">
        <button class="btn" data-act="print"><i class="ti ti-printer"></i>印刷</button>
        <button class="btn primary" data-act="add"><i class="ti ti-plus"></i>追加</button>
      </div>
    </div>
    <h2 class="printTitle" id="ldPrintTitle"></h2>
    <div class="summary" id="ldSummary"></div>
    <div class="tableWrap"><table class="grid ledgerTable">
      <thead><tr>${COLUMNS.map(c => `<th class="sortable${c.num ? ' num' : ''}${c.cls ? ' ' + c.cls : ''}" data-sort="${c.key}">
        <button type="button">${c.label}<i class="ti"></i></button></th>`).join('')}</tr></thead>
      <tbody id="ldBody"></tbody>
    </table></div>`;

  const $ = id => document.getElementById(id);
  const dateInput = $('ldDate');

  // ---------- データ ----------
  async function loadSlots() {
    state.slots = await api(`/api/slots/${MEAL}`);
  }

  // 日付を素早く切り替えたとき、後から返ってきた古い日付の結果で上書きしないよう最新の要求だけ反映する
  let loadSeq = 0;
  async function loadRows() {
    const seq = ++loadSeq;
    const rows = await api(`/api/${MEAL}/reservations?d=${state.date}${state.showDeleted ? '&include_deleted=true' : ''}`);
    if (seq !== loadSeq) return;
    state.rows = rows;
    render();
  }

  // 背景色: 表示中の日付が今日(0:00区切り)より前=グレー、後=ブルー、今日=白
  function applyDayTone() {
    const today = fmtDate(new Date());
    document.body.classList.toggle('dayPast', state.date < today);
    document.body.classList.toggle('dayFuture', state.date > today);
  }

  function setDate(d) {
    state.date = d;
    applyDayTone();
    const u = new URL(location.href);
    u.searchParams.set('d', d);
    history.replaceState(null, '', u);
    loadRows().catch(() => {});
  }

  // ---------- 描画 ----------
  const total = r => r.adults + r.children + r.infants;
  const active = () => state.rows.filter(r => !r.deleted);
  // "2026-09-24T18:05:12" → "9/24 18:05"(今年以外は年も表示)
  const fmtTs = ts => {
    if (!ts) return '';
    const [d, t] = ts.split('T');
    const [y, mo, da] = d.split('-');
    return `${y === String(new Date().getFullYear()) ? '' : y + '/'}${+mo}/${+da} ${t.slice(0, 5)}`;
  };
  const FIELD_LABELS = { date: '日付', time_slot: '時間', room: '部屋', guest_name: '代表者名', adults: '大人',
    children: '子供', infants: '幼児', ...Object.fromEntries(COUNT_FIELDS.map(c => [c.key, c.full])), nights: '泊数', night_no: '何泊目', group_id: 'グループ', entered_at: 'ステータス', allergy: 'アレルギー', note: '備考' };
  const nightsLabel = r => `${r.night_no}泊/${r.nights}泊`;
  const ACTION_LABELS = { create: '登録', update: '変更', delete: '削除', restore: '復元' };
  const fmtVal = (f, v) => f === 'time_slot' ? (v || '未定')
    : f === 'group_id' ? (v ? 'あり' : 'なし')
    : f === 'entered_at' ? (v ? `入場済(${fmtTs(v)})` : '空白')
    : (v === '' || v === null ? '(空欄)' : String(v));

  // グループ: この日の有効な予約のうち2件以上で構成されるものに G1, G2… を振る(時間→部屋順)
  function groupInfo() {
    const members = {};
    active().filter(r => r.group_id).forEach(r => (members[r.group_id] = members[r.group_id] || []).push(r));
    const order = r => (r.time_slot || '99:99') + '|' + r.room.padStart(8, '0');
    const groups = Object.entries(members).filter(([, ms]) => ms.length > 1)
      .map(([id, ms]) => [id, ms.sort((a, b) => order(a).localeCompare(order(b)))])
      .sort(([, a], [, b]) => order(a[0]).localeCompare(order(b[0])));
    return Object.fromEntries(groups.map(([id, ms], i) => [id, { no: i + 1, members: ms }]));
  }
  const GROUP_COLORS = 10;  // グループ色の数(ledger.css の .grpTag.g0〜g9)。超えると同じ色を繰り返す
  const groupTag = (g, extra = '') => g
    ? `<span class="grpTag g${(g.no - 1) % GROUP_COLORS}" title="グループ: ${esc(g.members.map(m => m.room).join('・'))}">G${g.no}</span>${extra}`
    : '';

  function visibleRows() {
    const q = state.q.trim().toLowerCase();
    let rows = state.rows;
    if (q) rows = rows.filter(r => [r.room, r.guest_name, r.allergy, r.note].some(v => v.toLowerCase().includes(q)));
    const col = COLUMNS.find(c => c.key === state.sort.key);
    const { dir } = state.sort;
    const cmp = (x, y) => typeof x === 'number' ? x - y : x.localeCompare(y, 'ja', { numeric: true });
    const byRoom = (a, b) => cmp(a.room, b.room);
    return [...rows].sort((a, b) => {
      const x = col.val(a), y = col.val(b);
      // 空欄(時間未定など)は並び順に関わらず末尾
      if ((x === '') !== (y === '')) return x === '' ? 1 : -1;
      return cmp(x, y) * dir || (col.key === 'room' ? 0 : byRoom(a, b));
    });
  }

  function renderSortHeads() {
    root.querySelectorAll('th[data-sort]').forEach(th => {
      const on = th.dataset.sort === state.sort.key;
      th.classList.toggle('sorted', on);
      th.setAttribute('aria-sort', on ? (state.sort.dir > 0 ? 'ascending' : 'descending') : 'none');
      th.querySelector('i').className = 'ti ' + (on ? (state.sort.dir > 0 ? 'ti-arrow-up' : 'ti-arrow-down') : 'ti-arrows-sort');
    });
  }

  // 登録済みの時刻が枠設定に無い場合も選択肢に残す
  function slotOptions(current) {
    const list = [...state.slots];
    if (current && !list.includes(current)) list.push(current);
    list.sort();
    return `<option value="${UNSET}">未定</option>` +
      list.map(s => `<option value="${s}"${s === current ? ' selected' : ''}>${s}</option>`).join('');
  }

  function renderSummary() {
    const agg = {};
    const add = (k, r) => {
      const a = agg[k] || (agg[k] = { n: 0, adults: 0, children: 0, infants: 0 });
      a.n++; a.adults += r.adults; a.children += r.children; a.infants += r.infants;
    };
    active().forEach(r => { add(r.time_slot || UNSET, r); add('*', r); });
    const keys = [...new Set([...state.slots, ...Object.keys(agg).filter(k => k !== '*' && k !== UNSET)])].sort();
    if (agg[UNSET]) keys.push(UNSET);
    const card = (label, a, cls = '') => {
      a = a || { n: 0, adults: 0, children: 0, infants: 0 };
      const t = a.adults + a.children + a.infants;
      return `<div class="sumCard ${cls}${a.n ? '' : ' zero'}">
        <div class="sumLabel">${esc(label)}</div>
        <div class="sumMain"><b>${t}</b>名 <span>${a.n}組</span></div>
        <div class="sumSub">大${a.adults} 子${a.children} 幼${a.infants}</div></div>`;
    };
    // 内訳(大人CP等)の1日合計。削除済みは含めない
    const counts = COUNT_FIELDS.map(c => {
      const n = active().reduce((sum, r) => sum + (r[c.key] || 0), 0);
      return `<div class="cntItem${n ? '' : ' zero'}" title="${c.full}">${countIcon(c)}<span class="cntLbl">${c.short}</span><b>${n}</b></div>`;
    }).join('');
    $('ldSummary').innerHTML =
      keys.map(k => card(k || '未定', agg[k], k ? '' : 'unset')).join('') + card('合計', agg['*'], 'total') +
      `<div class="sumCard cntCard"><div class="sumLabel">内訳(1日合計)</div><div class="cntItems">${counts}</div></div>`;
  }

  function render() {
    applyDayTone();
    dateInput.value = state.date;
    $('ldDow').textContent = `(${dow(state.date)})`;
    $('ldDow').className = 'dow' + ({ 日: ' sun', 土: ' sat' }[dow(state.date)] || '');
    $('ldPrintTitle').textContent = `${MEAL === 'dinner' ? '夕食' : '朝食'}時間管理表　${state.date.replace(/-/g, '/')}(${dow(state.date)})`;
    renderSummary();
    renderSortHeads();

    const rows = visibleRows();
    const tbody = $('ldBody');
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="12" class="empty">${state.rows.length ? '該当する予約はありません' : 'この日の予約はまだありません。「追加」から登録してください。'}</td></tr>`;
      return;
    }
    let prevSlot = null;
    const groups = groupInfo();
    tbody.innerHTML = rows.map(r => {
      const brk = state.sort.key === 'time' && prevSlot !== null && prevSlot !== (r.time_slot || UNSET);
      prevSlot = r.time_slot || UNSET;
      const cls = [brk && 'slotBreak', !r.time_slot && !r.deleted && 'noSlot', r.deleted && 'deleted'].filter(Boolean).join(' ');
      return `<tr data-id="${r.id}" class="${cls}">
        <td>${r.deleted
          ? `<span class="delBadge">削除済</span> ${r.time_slot || '未定'}`
          : `<select class="slotSel" aria-label="時間">${slotOptions(r.time_slot)}</select>
          <span class="printOnly">${r.time_slot || '未定'}</span>`}</td>
        <td class="status">${statusCell(r)}</td>
        <td class="room">${esc(r.room)}${groupTag(groups[r.group_id])}</td>
        <td class="guest">${esc(r.guest_name)}${countBadges(r)}</td>
        <td class="nights">${nightsLabel(r)}</td>
        <td class="num">${r.adults}</td><td class="num">${r.children}</td><td class="num">${r.infants}</td>
        <td class="num"><b>${total(r)}</b></td>
        <td class="allergyCell">${r.allergy ? `<span class="allergy"><i class="ti ti-alert-triangle"></i>${esc(r.allergy)}</span>` : ''}</td>
        <td class="note">${esc(r.note)}</td>
        <td class="noPrint upd">${r.deleted
          ? `削除 ${fmtTs(r.deleted_at)}<br>${esc(r.deleted_by)}`
          : `${fmtTs(r.updated_at)}<br>${esc(r.updated_by)}`}</td>
      </tr>`;
    }).join('');
  }

  // ステータス: レストランは(削除済み以外)チェックボックス、他ロールは表示のみ
  function statusCell(r) {
    const title = r.entered_at ? ` title="${fmtTs(r.entered_at)} ${esc(r.entered_by)}"` : '';
    if (state.role === 'restaurant' && !r.deleted) {
      return `<label class="entChk"${title}><input type="checkbox" class="entSel" ${r.entered_at ? 'checked' : ''}>入場済</label>`;
    }
    return r.entered_at ? `<span class="entBadge"${title}><i class="ti ti-check"></i>入場済</span>` : '';
  }

  // ---------- 編集 ----------
  function openForm(r) {
    const isNew = !r;
    if (r && r.deleted) return openDeleted(r);
    r = r || { date: state.date, nights: 1, room: '', guest_name: '', adults: 2, children: 0, infants: 0, time_slot: null, allergy: '', note: '',
      ...Object.fromEntries(COUNT_FIELDS.map(c => [c.key, 0])) };
    const dateLabel = d => `${d.replace(/-/g, '/')}(${dow(d)})`;
    // 人数は 0〜MAX_COUNT のプルダウン(既存データが上限超えなら、その値も選択肢に残す)
    const countSelect = (name, v, extra = '') => {
      const vals = [...Array(MAX_COUNT + 1).keys()];
      if (v > MAX_COUNT) vals.push(v);
      return `<select name="${name}"${extra}>${vals.map(n => `<option value="${n}"${n === v ? ' selected' : ''}>${n}</option>`).join('')}</select>`;
    };
    const groups = groupInfo();
    const myGroup = groups[r.group_id];
    const candidates = active().filter(x => x.id !== r.id)
      .sort((a, b) => a.room.localeCompare(b.room, 'ja', { numeric: true }));
    const mate = myGroup && myGroup.members.find(x => x.id !== r.id);
    const groupHtml = `
        <div class="groupBox">
          <label class="check"><input type="checkbox" name="grouped" ${myGroup ? 'checked' : ''} ${candidates.length ? '' : 'disabled'}>
            グループ登録(他の予約と紐づける)</label>
          ${candidates.length ? `<div class="groupPick" ${myGroup ? '' : 'hidden'}>
            <label>紐づける予約<select name="group_with">
              ${myGroup ? '' : '<option value="">選択してください</option>'}
              ${candidates.map(x => `<option value="${x.id}"${mate && x.id === mate.id ? ' selected' : ''}>${esc(x.room)}　${esc(x.guest_name)}(${x.time_slot || '未定'})${groups[x.group_id] ? `　[G${groups[x.group_id].no}]` : ''}</option>`).join('')}
            </select></label>
            ${myGroup ? `<p class="muted groupNote">現在のグループ: ${myGroup.members.map(x => esc(x.room + ' ' + x.guest_name)).join('、')}</p>` : ''}
            <p class="muted groupNote">選んだ予約がグループ登録済みの場合は、そのグループに加わります。</p>
          </div>` : '<p class="muted groupNote">この日に紐づけられる他の予約がありません。</p>'}
        </div>`;
    const m = modal({
      title: isNew ? '予約を追加' : `予約を編集(${r.room})`,
      wide: true,
      body: `<form class="form">
        <p class="formDate"><i class="ti ti-calendar"></i>${dateLabel(r.date)}${isNew
          ? '<span class="muted">から登録</span>'
          : `<span class="muted">${r.nights > 1 ? `${r.nights}泊の${r.night_no}泊目` : '1泊'}</span>`}</p>
        <div class="row">
          <label>時間<select name="time_slot">${slotOptions(r.time_slot)}</select></label>
          ${isNew ? '<label>泊数<input type="number" name="nights" value="1" min="1" max="30" required></label>' : ''}
        </div>
        ${isNew ? '<p class="muted nightsHint" style="margin:-4px 0 0;font-size:12px"></p>' : ''}
        <div class="row">
          <label>部屋番号<input type="text" name="room" value="${esc(r.room)}" required maxlength="32"></label>
          <label>代表者名<input type="text" name="guest_name" value="${esc(r.guest_name)}" maxlength="128"></label>
        </div>
        <div class="row">
          <label>大人${countSelect('adults', r.adults)}</label>
          <label>子供${countSelect('children', r.children)}</label>
          <label>幼児${countSelect('infants', r.infants)}</label>
        </div>
        <div class="row countRow">
          ${COUNT_FIELDS.map(c => `<label title="${c.full}"><span class="abbrWrap">${countIcon(c)}<span class="abbr">${c.short}</span></span>
            ${countSelect(c.key, r[c.key] ?? 0, ` aria-label="${c.full}"`)}</label>`).join('')}
        </div>
        <label>アレルギー<textarea name="allergy" maxlength="2000">${esc(r.allergy)}</textarea></label>
        <label>備考<textarea name="note" maxlength="2000">${esc(r.note)}</textarea></label>
        ${groupHtml}
      </form>
      ${isNew ? '' : auditHtml(r)}`,
      buttons: [
        ...(isNew ? [] : [{ label: '削除', danger: true, left: true, onClick: () => confirmDelete(r, m) }]),
        { label: 'キャンセル' },
        {
          label: isNew ? '追加する' : '保存する', primary: true, onClick: async () => {
            const f = m.querySelector('form');
            if (!f.reportValidity()) return false;
            const grouped = f.grouped.checked;
            if (grouped && !f.group_with.value) { toast('紐づける予約を選んでください', true); f.group_with.focus(); return false; }
            if (isNew && !f.time_slot.value && !(await confirmDialog({
              title: '時間が未定です',
              message: '時間が「未定」のまま登録しようとしています。このまま登録しますか？',
              ok: '未定のまま登録', cancel: '戻って時間を選ぶ',
            }))) { f.time_slot.focus(); return false; }
            const body = {
              time_slot: f.time_slot.value || null,
              room: f.room.value, guest_name: f.guest_name.value,
              adults: +f.adults.value, children: +f.children.value, infants: +f.infants.value,
              ...Object.fromEntries(COUNT_FIELDS.map(c => [c.key, +f[c.key].value])),
              allergy: f.allergy.value, note: f.note.value,
              grouped, group_with: grouped ? +f.group_with.value : null,
            };
            if (isNew) {
              Object.assign(body, { date: state.date, nights: +f.nights.value });
              await api(`/api/${MEAL}/reservations`, { method: 'POST', body });
              toast(body.nights > 1 ? `${body.nights}泊分(${body.nights}日)を登録しました` : '追加しました');
            } else {
              await api(`/api/${MEAL}/reservations/${r.id}`, { method: 'PUT', body });
              toast('保存しました');
            }
            await loadRows();
          }
        }
      ]
    });
    const form = m.querySelector('form');
    form.grouped.addEventListener('change', () => {
      const pick = m.querySelector('.groupPick');
      if (pick) pick.hidden = !form.grouped.checked;
    });
    if (isNew) {
      // 連泊時に登録される日付を表示
      const f = form;
      const hint = m.querySelector('.nightsHint');
      const upd = () => {
        const n = Math.min(Math.max(+f.nights.value || 1, 1), 30);
        hint.textContent = n > 1 ? `${dateLabel(state.date)} 〜 ${dateLabel(addDays(state.date, n - 1))} の${n}日分を登録します` : '';
      };
      f.nights.addEventListener('input', upd);
    } else {
      loadHistory(r, m);
    }
  }

  // 登録・更新・削除の記録と変更履歴
  function auditHtml(r) {
    const line = (label, ts, by) => ts ? `<div><span>${label}</span>${fmtTs(ts)}　${esc(by) || '-'}</div>` : '';
    return `<div class="audit">
      ${line('登録', r.created_at, r.created_by)}
      ${line('最終更新', r.updated_at, r.updated_by)}
      ${line('削除', r.deleted_at, r.deleted_by)}
    </div>
    <details class="history"><summary>変更履歴</summary><div class="historyList">読み込み中…</div></details>`;
  }

  async function loadHistory(r, m) {
    const box = m.querySelector('.historyList');
    try {
      const hist = await api(`/api/${MEAL}/reservations/${r.id}/history`);
      box.innerHTML = hist.map(h => {
        // 登録時は入力された項目だけ表示
        const entries = Object.entries(h.changes || {})
          .filter(([, [, v]]) => h.action !== 'create' || (v !== '' && v !== null && v !== 0));
        const detail = entries.map(([f, [a, b]]) => `<li><b>${FIELD_LABELS[f] || esc(f)}</b>: ${h.action === 'create'
          ? esc(fmtVal(f, b))
          : `${esc(fmtVal(f, a))} → ${esc(fmtVal(f, b))}`}</li>`).join('');
        return `<div class="hItem hi-${h.action}">
          <div class="hHead"><span class="hAct">${ACTION_LABELS[h.action] || esc(h.action)}</span>${fmtTs(h.changed_at)}　${esc(h.changed_by) || '-'}</div>
          ${detail ? `<ul>${detail}</ul>` : ''}</div>`;
      }).join('') || '<p class="muted">履歴はありません</p>';
    } catch (e) { box.textContent = '履歴を読み込めませんでした'; }
  }

  // 削除済み予約: 閲覧のみ(復元可)
  function openDeleted(r) {
    const item = (label, v) => `<div class="roItem"><span>${label}</span><div>${esc(v) || '<span class="muted">-</span>'}</div></div>`;
    const m = modal({
      title: `削除済みの予約(${r.room})`,
      wide: true,
      body: `<div class="readonly">
        ${item('日付', r.date.replace(/-/g, '/'))}${item('時間', r.time_slot || '未定')}
        ${item('部屋番号', r.room)}${item('代表者名', r.guest_name)}
        ${item('泊数', r.nights > 1 ? `${r.nights}泊(${r.night_no}泊目)` : '1泊')}
        ${item('人数', `大人${r.adults} 子供${r.children} 幼児${r.infants}(計${total(r)})`)}
        ${item('内訳', COUNT_FIELDS.filter(c => r[c.key]).map(c => `${c.full} ${r[c.key]}`).join('　'))}
        ${item('アレルギー', r.allergy)}${item('備考', r.note)}
      </div>${auditHtml(r)}`,
      buttons: [
        { label: '復元する', left: true, onClick: async () => {
          await api(`/api/${MEAL}/reservations/${r.id}/restore`, { method: 'POST' });
          toast('復元しました');
          await loadRows();
        } },
        { label: '閉じる', primary: true },
      ]
    });
    loadHistory(r, m);
  }

  // はい/いいえの確認。閉じ方に関わらず結果を返す
  function confirmDialog({ title, message, note, ok, cancel = 'キャンセル', danger }) {
    return new Promise(resolve => {
      let yes = false;
      modal({
        title,
        body: `<p style="margin:0">${message}</p>${note ? `<p class="muted" style="margin:8px 0 0;font-size:12px">${note}</p>` : ''}`,
        buttons: [{ label: cancel }, { label: ok, primary: !danger, danger, onClick: () => { yes = true; } }],
        onClose: () => resolve(yes),
      });
    });
  }

  async function confirmDelete(r, parent) {
    const ok = await confirmDialog({
      title: '予約を削除',
      message: `${esc(r.room)} ${esc(r.guest_name)} 様の予約を削除します。よろしいですか？`,
      note: '削除した予約は「削除済みも表示」から閲覧・復元できます。',
      ok: '削除する', danger: true,
    });
    if (!ok) return false;
    await api(`/api/${MEAL}/reservations/${r.id}`, { method: 'DELETE' });
    toast('削除しました');
    parent.close();
    await loadRows();
    return false;
  }

  // ---------- イベント ----------
  root.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'prev') setDate(addDays(state.date, -1));
    else if (act === 'next') setDate(addDays(state.date, 1));
    else if (act === 'today') setDate(fmtDate(new Date()));
    else if (act === 'print') window.print();
    else if (act === 'add') openForm(null);
  });
  dateInput.addEventListener('change', () => { if (dateInput.value) setDate(dateInput.value); });
  $('ldSearch').addEventListener('input', e => { state.q = e.target.value; render(); });
  root.querySelector('thead').addEventListener('click', e => {
    const key = e.target.closest('th[data-sort]')?.dataset.sort;
    if (!key) return;
    const col = COLUMNS.find(c => c.key === key);
    state.sort = state.sort.key === key ? { key, dir: -state.sort.dir } : { key, dir: col.firstDir || 1 };
    render();
  });
  $('ldShowDeleted').addEventListener('change', e => { state.showDeleted = e.target.checked; loadRows().catch(() => {}); });

  const tbody = $('ldBody');
  tbody.addEventListener('change', async e => {
    if (!e.target.classList.contains('slotSel')) return;
    const id = +e.target.closest('tr').dataset.id;
    try {
      const updated = await api(`/api/${MEAL}/reservations/${id}/time`, { method: 'PATCH', body: { time_slot: e.target.value || null } });
      state.rows = state.rows.map(r => r.id === id ? updated : r);
      toast(`${updated.room} を ${updated.time_slot || '未定'} に変更しました`);
    } catch (err) { /* toast 済み */ }
    render();
  });
  tbody.addEventListener('change', async e => {
    if (!e.target.classList.contains('entSel')) return;
    const cb = e.target;
    const entered = cb.checked;
    cb.checked = !entered;  // 確認で「はい」を押すまで戻しておく
    const r = state.rows.find(x => x.id === +cb.closest('tr').dataset.id);
    const who = `${esc(r.room)} ${esc(r.guest_name)}${r.guest_name ? ' 様' : ''}`;
    const ok = await confirmDialog(entered
      ? { title: '入場済にする', message: `${who}を入場済にしますか？`, ok: 'はい', cancel: 'いいえ' }
      : { title: '入場済を取り消す', message: `${who}の入場済を取り消しますか？`, ok: 'はい', cancel: 'いいえ' });
    if (!ok) return;
    try {
      const updated = await api(`/api/${MEAL}/reservations/${r.id}/entered`, { method: 'PATCH', body: { entered } });
      state.rows = state.rows.map(x => x.id === r.id ? updated : x);
      toast(entered ? `${r.room} を入場済にしました` : `${r.room} の入場済を取り消しました`);
    } catch (err) { /* toast 済み */ }
    render();
  });
  tbody.addEventListener('click', e => {
    if (e.target.closest('select, .entChk')) return;
    const tr = e.target.closest('tr[data-id]');
    if (tr) openForm(state.rows.find(r => r.id === +tr.dataset.id));
  });

  // 他端末の更新を反映(編集中・入力中は止める)
  setInterval(() => {
    if (document.hidden || AMT.isModalOpen() || document.activeElement?.classList.contains('slotSel')) return;
    loadRows().catch(() => {});
  }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !AMT.isModalOpen()) loadRows().catch(() => {}); });

  // チャットの予約カードから来た場合(?hl=予約ID)は該当行を強調
  async function highlight(id) {
    if (!id) return;
    let row = tbody.querySelector(`tr[data-id="${id}"]`);
    if (!row && !state.showDeleted) {  // 削除済みなら削除済みも表示して探す
      $('ldShowDeleted').checked = state.showDeleted = true;
      await loadRows();
      row = tbody.querySelector(`tr[data-id="${id}"]`);
    }
    if (!row) return toast('予約が見つかりません', true);
    row.scrollIntoView({ block: 'center' });
    row.classList.add('flash');
    setTimeout(() => row.classList.remove('flash'), 2600);
  }

  AMT.me.then(me => { state.role = me.role; render(); }).catch(() => {});
  loadSlots().then(loadRows).then(() => highlight(params.get('hl'))).catch(() => {});
})();

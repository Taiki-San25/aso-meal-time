/* layout_edit.js — レストランの見取り図を作る(テーブル・目印を置く、マス目に吸着、複数選択で移動・複製・削除) */
(function () {
  const root = document.getElementById('layoutEdit');
  const MEAL = root.dataset.meal;
  const { esc, api, toast, modal } = AMT;
  const GRID = 20;  // マス目(見取り図の単位)
  const snap = v => Math.round(v / GRID) * GRID;
  const SIZES = {  // 追加するときの大きさ・席数
    round: { w: 80, h: 80, seats: 4 }, square: { w: 80, h: 80, seats: 4 }, rect: { w: 160, h: 80, seats: 6 },
    label: { w: 120, h: 40, seats: 0 },
  };

  const state = { W: 3000, H: 2000, items: [], sel: new Set(), zoom: 0.6, dirty: false, uid: 0 };
  const nextUid = () => `u${++state.uid}`;

  root.innerHTML = `
    <div class="leBar">
      <button class="btn" data-add="round"><i class="ti ti-circle"></i>丸テーブル</button>
      <button class="btn" data-add="square"><i class="ti ti-square"></i>角テーブル</button>
      <button class="btn" data-add="rect"><i class="ti ti-rectangle"></i>長方形テーブル</button>
      <button class="btn" data-add="label"><i class="ti ti-tag"></i>目印</button>
      <button class="btn" data-act="bulk"><i class="ti ti-layout-grid-add"></i>まとめて追加</button>
      <span class="sep"></span>
      <span class="zoomBox"><button class="iconBtn" data-zoom="-1" aria-label="縮小"><i class="ti ti-zoom-out"></i></button><span id="leZoom"></span><button class="iconBtn" data-zoom="1" aria-label="拡大"><i class="ti ti-zoom-in"></i></button></span>
      <div class="barRight">
        <span class="dirty" id="leDirty" hidden>未保存の変更があります</span>
        <button class="btn" data-act="revert"><i class="ti ti-arrow-back-up"></i>元に戻す</button>
        <button class="btn primary" data-act="save"><i class="ti ti-device-floppy"></i>保存</button>
      </div>
    </div>
    <div class="leMain">
      <div class="floorWrap" id="leWrap"><div class="floor editing" id="leFloor"></div></div>
      <aside class="lePanel" id="lePanel"></aside>
    </div>`;
  const $ = id => document.getElementById(id);
  const wrap = $('leWrap'), floor = $('leFloor');

  // ---------- データ ----------
  async function load() {
    const d = await api(`/api/layout/${MEAL}`);
    state.W = d.width; state.H = d.height;
    state.items = d.items.map(it => ({ ...it, uid: nextUid() }));
    state.sel.clear();
    setDirty(false);
    render();
  }
  const setDirty = v => { state.dirty = v; $('leDirty').hidden = !v; };
  const byUid = uid => state.items.find(i => i.uid === uid);
  const tables = () => state.items.filter(i => i.kind === 'table');
  // 次のテーブル番号: 既存の「T+数字」の最大+1
  const nextNo = () => Math.max(0, ...tables().map(t => +(/^T(\d+)$/.exec(t.name) || [0, 0])[1])) + 1;

  // ---------- 描画 ----------
  function render() { renderFloor(); renderPanel(); }

  function renderFloor() {
    const z = state.zoom;
    floor.style.width = `${state.W * z}px`;
    floor.style.height = `${state.H * z}px`;
    floor.style.backgroundSize = `${GRID * z}px ${GRID * z}px`;
    const names = tables().map(t => t.name);
    const dup = new Set(names.filter((n, i) => names.indexOf(n) !== i));
    const single = state.sel.size === 1;
    floor.innerHTML = state.items.map(it => {
      const sel = state.sel.has(it.uid);
      const fs = Math.max(9, Math.min(14, 14 * z / 0.8));
      const cls = ['fItem', it.kind, it.kind === 'table' ? it.shape : '', sel ? 'sel' : '', it.kind === 'table' && dup.has(it.name) ? 'dupName' : ''].join(' ');
      return `<div class="${cls}" data-uid="${it.uid}" style="left:${it.x * z}px;top:${it.y * z}px;width:${it.w * z}px;height:${it.h * z}px;font-size:${fs}px">
        ${it.kind === 'table'
          ? `<span class="fName" style="font-size:${fs}px">${esc(it.name)}</span><span class="fSeats" style="font-size:${fs * 0.8}px">${it.seats}席</span>`
          : `<span>${esc(it.name)}</span>`}
        ${sel && single ? '<span class="resizeH" data-resize></span>' : ''}
      </div>`;
    }).join('');
    $('leZoom').textContent = `${Math.round(z * 100)}%`;
    const t = tables();
    $('leStats').innerHTML = `テーブル <b>${t.length}</b>卓・<b>${t.reduce((a, b) => a + (+b.seats || 0), 0)}</b>席　目印 <b>${state.items.length - t.length}</b>`;
  }

  function renderPanel() {
    const sel = [...state.sel].map(byUid).filter(Boolean);
    const p = $('lePanel');
    if (!sel.length) {
      p.innerHTML = `<h3>使い方</h3><p class="muted">
        ・上のボタンでテーブル・目印を追加します。<br>・ドラッグで移動(マス目に吸着)、選んだ部品の右下の■で大きさを変えます。<br>
        ・<kbd>Shift</kbd>+クリック、または何もない所をドラッグで複数選択できます。<br>
        ・<kbd>Delete</kbd> 削除 / <kbd>Ctrl</kbd>+<kbd>D</kbd> 複製 / 矢印キーで1マス移動<br>
        ・最後に「保存」を押してください。</p>`;
      return;
    }
    if (sel.length === 1) {
      const it = sel[0];
      p.innerHTML = `<h3>${it.kind === 'table' ? 'テーブル' : '目印'}</h3>
        <div class="form">
          <label>${it.kind === 'table' ? 'テーブル番号' : '文字'}<input type="text" data-f="name" value="${esc(it.name)}" maxlength="32"></label>
          ${it.kind === 'table' ? `<div class="row">
            <label>席数<input type="number" data-f="seats" value="${it.seats}" min="0" max="999"></label>
            <label>形<select data-f="shape">${[['round', '丸'], ['square', '角'], ['rect', '長方形']].map(([v, l]) => `<option value="${v}"${it.shape === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
          </div>` : ''}
          <div class="row">
            <label>幅<input type="number" data-f="w" value="${it.w}" min="20" step="${GRID}"></label>
            <label>高さ<input type="number" data-f="h" value="${it.h}" min="20" step="${GRID}"></label>
          </div>
        </div>
        <div class="btns"><button class="btn" data-act="dup"><i class="ti ti-copy"></i>複製</button><button class="btn danger" data-act="del"><i class="ti ti-trash"></i>削除</button></div>`;
      return;
    }
    const ts = sel.filter(i => i.kind === 'table');
    p.innerHTML = `<h3>${sel.length}個を選択中</h3>
      <p class="muted">テーブル ${ts.length}卓・${ts.reduce((a, b) => a + (+b.seats || 0), 0)}席</p>
      ${ts.length ? `<div class="form"><label>席数をまとめて変更<input type="number" data-f="seats" placeholder="席数" min="0" max="999"></label></div>` : ''}
      <div class="btns"><button class="btn" data-act="dup"><i class="ti ti-copy"></i>複製</button><button class="btn danger" data-act="del"><i class="ti ti-trash"></i>削除</button></div>`;
  }

  // ---------- 編集の操作 ----------
  function visibleOrigin() {  // 今見えている範囲の左上(見取り図の単位)
    return { x: snap(wrap.scrollLeft / state.zoom + 40), y: snap(wrap.scrollTop / state.zoom + 40) };
  }
  function clampItem(it) {
    it.w = Math.max(GRID, Math.min(it.w, state.W)); it.h = Math.max(GRID, Math.min(it.h, state.H));
    it.x = Math.max(0, Math.min(it.x, state.W - it.w)); it.y = Math.max(0, Math.min(it.y, state.H - it.h));
  }
  function addItem(shape, at) {
    const s = SIZES[shape], o = at || visibleOrigin();
    const it = shape === 'label'
      ? { uid: nextUid(), kind: 'marker', shape: 'label', name: '目印', seats: 0, x: o.x, y: o.y, w: s.w, h: s.h }
      : { uid: nextUid(), kind: 'table', shape, name: `T${nextNo()}`, seats: s.seats, x: o.x, y: o.y, w: s.w, h: s.h };
    clampItem(it);
    state.items.push(it);
    return it;
  }
  function duplicateSel() {
    const src = [...state.sel].map(byUid).filter(Boolean);
    if (!src.length) return;
    state.sel.clear();
    src.forEach(s => {
      const it = { ...s, id: undefined, uid: nextUid(), x: s.x + GRID * 2, y: s.y + GRID * 2 };
      if (it.kind === 'table') it.name = `T${nextNo()}`;
      clampItem(it);
      state.items.push(it);
      state.sel.add(it.uid);
    });
    setDirty(true); render();
  }
  function deleteSel() {
    if (!state.sel.size) return;
    state.items = state.items.filter(i => !state.sel.has(i.uid));
    state.sel.clear();
    setDirty(true); render();
  }

  root.addEventListener('click', e => {
    const add = e.target.closest('[data-add]')?.dataset.add;
    if (add) { const it = addItem(add); state.sel = new Set([it.uid]); setDirty(true); render(); return; }
    const zoom = e.target.closest('[data-zoom]')?.dataset.zoom;
    if (zoom) return setZoom(state.zoom + (+zoom) * 0.1);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'dup') duplicateSel();
    else if (act === 'del') deleteSel();
    else if (act === 'save') save();
    else if (act === 'revert') {
      if (!state.dirty) return toast('変更はありません');
      if (confirm('保存していない変更を取り消して、最後に保存した状態に戻しますか？')) load().catch(() => {});
    } else if (act === 'bulk') openBulk();
  });

  // パネルでの値の変更
  $('lePanel').addEventListener('input', e => {
    const f = e.target.dataset.f;
    if (!f) return;
    const sel = [...state.sel].map(byUid).filter(Boolean);
    sel.forEach(it => {
      if (f === 'name') it.name = e.target.value;
      else if (f === 'shape') { it.shape = e.target.value; if (it.shape === 'round') it.h = it.w; }
      else if (f === 'seats') { if (it.kind === 'table' && e.target.value !== '') it.seats = Math.max(0, +e.target.value); }
      else if (f === 'w' || f === 'h') { if (+e.target.value >= GRID) { it[f] = +e.target.value; if (it.shape === 'round') it.w = it.h = +e.target.value; clampItem(it); } }
    });
    setDirty(true);
    renderFloor();  // 入力中の欄は描き直さない
  });

  // ---------- マウス: 選択・移動・大きさ変更・範囲選択 ----------
  let drag = null;
  const pt = e => { const r = floor.getBoundingClientRect(); return { x: (e.clientX - r.left) / state.zoom, y: (e.clientY - r.top) / state.zoom }; };
  floor.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const p = pt(e);
    const el = e.target.closest('.fItem');
    if (e.target.closest('[data-resize]') && el) {
      const it = byUid(el.dataset.uid);
      drag = { mode: 'resize', it, start: p, w: it.w, h: it.h };
    } else if (el) {
      const uid = el.dataset.uid;
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        state.sel.has(uid) ? state.sel.delete(uid) : state.sel.add(uid);
        render();
        return;
      }
      if (!state.sel.has(uid)) { state.sel = new Set([uid]); render(); }
      drag = { mode: 'move', start: p, orig: [...state.sel].map(u => { const it = byUid(u); return { it, x: it.x, y: it.y }; }), moved: false };
    } else {
      drag = { mode: 'rubber', start: p, add: e.shiftKey || e.ctrlKey || e.metaKey, box: document.createElement('div') };
      drag.box.className = 'rubber';
      floor.appendChild(drag.box);
    }
    floor.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  floor.addEventListener('pointermove', e => {
    if (!drag) return;
    const p = pt(e), dx = p.x - drag.start.x, dy = p.y - drag.start.y;
    if (drag.mode === 'move') {
      if (!drag.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      drag.moved = true;
      // 選択全体がはみ出さない範囲でまとめて動かす
      const minX = Math.min(...drag.orig.map(o => o.x)), minY = Math.min(...drag.orig.map(o => o.y));
      const maxX = Math.max(...drag.orig.map(o => o.x + o.it.w)), maxY = Math.max(...drag.orig.map(o => o.y + o.it.h));
      const ddx = Math.max(-minX, Math.min(snap(dx), state.W - maxX)), ddy = Math.max(-minY, Math.min(snap(dy), state.H - maxY));
      drag.orig.forEach(o => { o.it.x = o.x + ddx; o.it.y = o.y + ddy; });
      renderFloor();
    } else if (drag.mode === 'resize') {
      const it = drag.it;
      it.w = Math.max(GRID, snap(drag.w + dx)); it.h = Math.max(GRID, snap(drag.h + dy));
      if (it.kind === 'table' && it.shape === 'round') it.w = it.h = Math.max(it.w, it.h);
      clampItem(it);
      drag.moved = true;
      renderFloor();
    } else {
      const x = Math.min(p.x, drag.start.x), y = Math.min(p.y, drag.start.y);
      Object.assign(drag.box.style, { left: `${x * state.zoom}px`, top: `${y * state.zoom}px`,
        width: `${Math.abs(dx) * state.zoom}px`, height: `${Math.abs(dy) * state.zoom}px` });
      drag.rect = { x, y, w: Math.abs(dx), h: Math.abs(dy) };
    }
  });
  floor.addEventListener('pointerup', () => {
    if (!drag) return;
    if (drag.mode === 'rubber') {
      const r = drag.rect;
      if (!drag.add) state.sel.clear();
      if (r && (r.w > 4 || r.h > 4)) {
        state.items.forEach(it => { if (it.x < r.x + r.w && it.x + it.w > r.x && it.y < r.y + r.h && it.y + it.h > r.y) state.sel.add(it.uid); });
      }
      drag.box.remove();
      render();
    } else if (drag.moved) { setDirty(true); render(); }
    drag = null;
  });

  // ---------- キーボード ----------
  document.addEventListener('keydown', e => {
    if (AMT.isModalOpen() || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { if (state.sel.size) { e.preventDefault(); deleteSel(); } }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSel(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    else if (e.key === 'Escape') { state.sel.clear(); render(); }
    else if (e.key.startsWith('Arrow') && state.sel.size) {
      e.preventDefault();
      const [dx, dy] = { ArrowLeft: [-GRID, 0], ArrowRight: [GRID, 0], ArrowUp: [0, -GRID], ArrowDown: [0, GRID] }[e.key];
      state.sel.forEach(u => { const it = byUid(u); it.x += dx; it.y += dy; clampItem(it); });
      setDirty(true); render();
    }
  });

  // ---------- 拡大・縮小 ----------
  function setZoom(z) {
    const cx = (wrap.scrollLeft + wrap.clientWidth / 2) / state.zoom, cy = (wrap.scrollTop + wrap.clientHeight / 2) / state.zoom;
    state.zoom = Math.max(0.3, Math.min(1.5, Math.round(z * 10) / 10));
    render();
    wrap.scrollLeft = cx * state.zoom - wrap.clientWidth / 2;
    wrap.scrollTop = cy * state.zoom - wrap.clientHeight / 2;
  }
  wrap.addEventListener('wheel', e => { if (e.ctrlKey) { e.preventDefault(); setZoom(state.zoom + (e.deltaY < 0 ? 0.1 : -0.1)); } }, { passive: false });

  // ---------- まとめて追加 ----------
  function openBulk() {
    const m = modal({
      title: 'テーブルをまとめて追加',
      body: `<form class="form">
        <div class="row">
          <label>卓数<input type="number" name="count" value="10" min="1" max="200" required></label>
          <label>横に並べる数<input type="number" name="cols" value="5" min="1" max="50" required></label>
        </div>
        <div class="row">
          <label>形<select name="shape"><option value="square">角</option><option value="round">丸</option><option value="rect">長方形</option></select></label>
          <label>席数<input type="number" name="seats" value="4" min="0" max="999" required></label>
        </div>
        <div class="row">
          <label>番号の頭<input type="text" name="prefix" value="T" maxlength="10"></label>
          <label>開始番号<input type="number" name="start" value="${nextNo()}" min="0" required></label>
        </div>
        <p class="muted" style="margin:0;font-size:12px">今見えている範囲の左上から、マス目に沿って並べます。追加後にまとめて動かせます。</p>
      </form>`,
      buttons: [{ label: 'キャンセル' }, {
        label: '追加する', primary: true, onClick: () => {
          const f = m.querySelector('form');
          if (!f.reportValidity()) return false;
          const n = +f.count.value, cols = +f.cols.value, shape = f.shape.value, s = SIZES[shape], o = visibleOrigin();
          const names = new Set(tables().map(t => t.name));
          const newNames = [...Array(n).keys()].map(i => `${f.prefix.value}${+f.start.value + i}`);
          const clash = newNames.filter(x => names.has(x));
          if (clash.length) { toast(`既にある番号です: ${clash.slice(0, 5).join('、')}${clash.length > 5 ? ' ほか' : ''}`, true); return false; }
          state.sel.clear();
          newNames.forEach((name, i) => {
            const it = { uid: nextUid(), kind: 'table', shape, name, seats: +f.seats.value, w: s.w, h: s.h,
              x: o.x + (i % cols) * (s.w + GRID * 2), y: o.y + Math.floor(i / cols) * (s.h + GRID * 2) };
            clampItem(it);
            state.items.push(it);
            state.sel.add(it.uid);
          });
          setDirty(true); render();
          toast(`${n}卓を追加しました(保存するまで確定しません)`);
        }
      }]
    });
  }

  // ---------- 保存 ----------
  async function save() {
    const t = tables();
    if (t.some(x => !x.name.trim())) return toast('テーブル番号が空のテーブルがあります', true);
    const names = t.map(x => x.name.trim());
    const dup = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
    if (dup.length) return toast(`テーブル番号が重複しています: ${dup.join('、')}`, true);
    // 削除されるテーブルに今日以降のアサインがあれば確認
    const usage = await api(`/api/layout/${MEAL}/usage`).catch(() => ({}));
    const keepIds = new Set(state.items.filter(i => i.id).map(i => i.id));
    const lost = Object.entries(usage).filter(([id]) => !keepIds.has(+id)).reduce((a, [, n]) => a + n, 0);
    if (lost && !confirm(`削除するテーブルに、今日以降のアサインが${lost}件あります。保存するとそのアサインは解除されます。よろしいですか？`)) return;
    const body = { items: state.items.map(i => ({ id: i.id || null, kind: i.kind, shape: i.kind === 'table' ? i.shape : 'label',
      name: i.name.trim(), seats: i.kind === 'table' ? +i.seats || 0 : 0, x: Math.round(i.x), y: Math.round(i.y), w: Math.round(i.w), h: Math.round(i.h) })) };
    const d = await api(`/api/layout/${MEAL}`, { method: 'PUT', body }).catch(() => null);
    if (!d) return;
    state.items = d.items.map(it => ({ ...it, uid: nextUid() }));
    state.sel.clear();
    setDirty(false);
    render();
    toast(d.unassigned ? `保存しました(アサイン${d.unassigned}件を解除)` : '保存しました');
  }

  window.addEventListener('beforeunload', e => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });
  load().catch(() => {});
})();

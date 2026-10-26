/* 共通ヘルパー: API・モーダル・トースト */
window.AMT = (function () {
  const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function api(url, opts = {}) {
    const init = { method: opts.method || 'GET', headers: {} };
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    const r = await fetch(url, init);
    if (r.status === 401 && url !== '/api/login') { location.href = '/login'; throw new Error('401'); }
    const data = await r.json().catch(() => null);
    if (!r.ok) {
      let msg = '通信エラーが発生しました';
      if (data && typeof data.detail === 'string') msg = data.detail;
      else if (data && Array.isArray(data.detail)) msg = data.detail.map(d => String(d.msg).replace(/^Value error, /, '')).join(' / ');
      toast(msg, true);
      throw new Error(msg);
    }
    return data;
  }

  let toastTimer;
  function toast(msg, isError) {
    let el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg;
    el.className = 'show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = ''; }, 3000);
  }

  // buttons: [{label, primary, danger, left, onClick}] — onClick が false を返すか例外なら閉じない
  // onClose: 閉じ方に関わらず閉じたときに1回呼ばれる
  function modal({ title, body, buttons = [], wide, onClose }) {
    const wrap = document.createElement('div');
    wrap.className = 'modalWrap';
    wrap.innerHTML = `<div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true">
      <div class="modalHead"><h2>${esc(title)}</h2><button class="iconBtn" data-close aria-label="閉じる"><i class="ti ti-x"></i></button></div>
      <div class="modalBody">${body}</div>
      <div class="modalFoot"></div></div>`;
    const foot = wrap.querySelector('.modalFoot');
    const close = () => {
      if (!wrap.isConnected) return;
      wrap.remove(); document.removeEventListener('keydown', onKey);
      if (onClose) onClose();
    };
    const isTop = () => [...document.querySelectorAll('.modalWrap')].pop() === wrap;
    const onKey = e => { if (e.key === 'Escape' && isTop()) close(); };
    buttons.forEach(b => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : '');
      if (b.left) btn.style.marginRight = 'auto';
      btn.textContent = b.label;
      btn.addEventListener('click', async () => {
        if (!b.onClick) return close();
        btn.disabled = true;
        try { if ((await b.onClick()) !== false) close(); } catch (e) { /* toast 済み */ }
        btn.disabled = false;
      });
      foot.appendChild(btn);
    });
    wrap.querySelector('[data-close]').addEventListener('click', close);
    wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
    document.addEventListener('keydown', onKey);
    const form = wrap.querySelector('form');
    if (form) form.addEventListener('submit', e => { e.preventDefault(); foot.querySelector('.primary')?.click(); });
    document.body.appendChild(wrap);
    wrap.querySelector('input,select,textarea')?.focus();
    wrap.close = close;
    return wrap;
  }

  return { esc, api, toast, modal, isModalOpen: () => !!document.querySelector('.modalWrap') };
})();

/* common.js — 上部バー・サイドバーを生成し、body直下の要素を #mainContent に移す */
(function () {
  const CONFIG = {
    siteName: '阿蘇リゾートグランヴィリオホテル　喫食時間管理表',
    favicon: '/static/logo.png',  // 上部バーのロゴ(favicon.ico から余白を除いたもの)
    ticker: '',             // お知らせ(空なら非表示)
    topButtons: [
      { label: 'ログアウト', icon: 'ti-logout', type: 'normal', href: '/logout' }
    ],
    // 左のメニュー(hotel-system と同じ作り): 大分類のアイコンと短い名前を縦に並べ、マウスを合わせると中分類(ページ)の小窓が出る
    // admin: 管理者・developer だけ(大分類・中分類のどちらにも付けられる)。lower: 区切り線の下にまとめる
    categories: [
      { key: 'dinner', label: '夕食', title: '夕食', icon: 'ti-moon', items: [
        { label: '夕食時間管理表', icon: 'ti-moon', href: '/dinner' },
        { label: '夕食集計', icon: 'ti-chart-bar', href: '/dinner-summary' },
        { label: 'テーブルアサイン', icon: 'ti-armchair', href: '/table-assign' },
        { label: 'レイアウト編集', icon: 'ti-layout-grid', href: '/layout-edit', admin: true }] },
      { key: 'breakfast', label: '朝食', title: '朝食', icon: 'ti-sun', items: [
        { label: '朝食時間管理表', icon: 'ti-sun', href: '/breakfast' },
        { label: '朝食集計', icon: 'ti-chart-bar', href: '/breakfast-summary' }] },
      { key: 'chat', label: 'チャット', title: 'チャット', icon: 'ti-messages', items: [
        { label: 'チャット', icon: 'ti-messages', href: '/chat', unread: true }] },
      { key: 'report', label: '帳票', title: '帳票', icon: 'ti-files', items: [
        { label: '夕食帳票', icon: 'ti-moon', href: '/dinner-report' },
        { label: '朝食帳票', icon: 'ti-sun', href: '/breakfast-report' }] },
      { key: 'record', label: '記録', title: '記録', icon: 'ti-list-details', items: [
        { label: '操作ログ', icon: 'ti-list-details', href: '/logs' }] },
      { key: 'master', label: '店舗\nマスタ', title: '店舗マスタ', icon: 'ti-building-store', admin: true, lower: true, items: [
        { label: '単価・時間枠・設定', icon: 'ti-adjustments', href: '/store-master' }] },
      { key: 'admin', label: '管理者', title: '管理者メニュー', icon: 'ti-shield-lock', admin: true, lower: true, items: [
        { label: '管理者ページ', icon: 'ti-settings', href: '/admin' }] },
    ]
  };
  const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const pageNodes = Array.from(document.body.childNodes)
    .filter(n => !(n.nodeType === 1 && n.tagName === 'SCRIPT'));

  const path = location.pathname.replace(/\/$/, '') || '/';
  // メニューに出してよいか(管理者メニューはログインした人のロールが分かるまで出さない)
  const vis = { admin: false, unread: 0 };
  const shown = c => !c.admin || vis.admin;
  const itemsOf = c => c.items.filter(shown);
  const navRow = (it, admin) => `<a class="navRow${admin ? ' adminPage' : ''}${path === it.href ? ' navRowActive' : ''}" href="${it.href}">
      <i class="ti ${it.icon}"></i><span class="lbl">${esc(it.label)}</span>${it.unread && vis.unread
        ? `<small class="navCnt" title="未読${vis.unread}件">${vis.unread > 99 ? '99+' : vis.unread}</small>` : ''}</a>`;
  const curCat = CONFIG.categories.find(c => c.items.some(it => it.href === path));  // 今いるページの大分類

  // 上部バー
  const topbar = document.createElement('header');
  topbar.id = 'topbar';
  topbar.innerHTML = `
    <div class="tbLeft">
      <button id="hamburger" aria-label="メニューを開く"><i class="ti ti-menu-2"></i></button>
      ${CONFIG.favicon
        ? `<img class="tbFavicon" src="${CONFIG.favicon}" alt="">`
        : `<div class="tbFaviconPh" aria-hidden="true">未定</div>`}
      <div class="tbLogo">${esc(CONFIG.siteName)}</div>
    </div>
    ${CONFIG.ticker ? `<div class="ticker"><i class="ti ti-speakerphone"></i><span>${esc(CONFIG.ticker)}</span></div>` : ''}
    <div class="tbRight">
      ${CONFIG.topButtons.map(b => `<a class="pillBtn ${b.type}" href="${b.href}" title="${esc(b.label)}" style="text-decoration:none"><i class="ti ${b.icon}"></i><span class="btnLbl">${esc(b.label)}</span></a>`).join('')}
    </div>`;

  // サイドバー
  const sidebar = document.createElement('nav');
  sidebar.id = 'sidebar';
  sidebar.innerHTML = `
    <div class="sbTop">
      <button type="button" id="accountRow" aria-haspopup="menu" aria-expanded="false" aria-controls="accountMenu"><span class="avatar"></span><span class="userName"></span></button>
      <div class="railNav" role="menubar" aria-label="メニュー"></div>
      <div class="drawerNav"></div>
    </div>`;
  const railPop = document.createElement('div');  // 大分類にマウスを合わせると出る小窓(中分類のページ)
  railPop.className = 'railPop';
  railPop.setAttribute('role', 'menu');
  railPop.hidden = true;

  // 大分類のアイコン(パソコン)と、見出しで区切った一覧(スマートフォンの引き出し)を描く
  const drawNav = () => {
    const cats = CONFIG.categories.filter(shown);
    const btn = c => `<button type="button" class="railCat${c === curCat ? ' cur' : ''}${c.items.some(it => it.unread) && vis.unread ? ' unread' : ''}"
        data-cat="${c.key}" aria-haspopup="true" aria-expanded="false" title="${esc(c.title)}"><i class="ti ${c.icon}"></i><small>${esc(c.label)}</small></button>`;
    const upper = cats.filter(c => !c.lower), lower = cats.filter(c => c.lower);
    sidebar.querySelector('.railNav').innerHTML = upper.map(btn).join('') +
      (lower.length ? `<span class="railGap" aria-hidden="true"></span>${lower.map(btn).join('')}` : '');
    sidebar.querySelector('.drawerNav').innerHTML = cats.map(c => `<div class="navHeading">${esc(c.title)}</div>
        ${itemsOf(c).map(it => navRow(it, !!c.admin)).join('')}`).join('');
    if (!railPop.hidden) openPop(railPop.dataset.cat);
  };

  const main = document.createElement('main');
  main.id = 'mainContent';
  pageNodes.forEach(n => main.appendChild(n));

  const backdrop = document.createElement('div');
  backdrop.id = 'drawerBackdrop';

  document.body.prepend(topbar, sidebar, railPop, backdrop, main);
  drawNav();

  // ユーザー名
  const setUser = name => {
    sidebar.querySelector('.avatar').textContent = name.charAt(0);
    sidebar.querySelector('.userName').textContent = name;
    sidebar.querySelector('#accountRow').title = `${name}(押すとパスワード変更)`;
  };
  setUser('…');

  // チャット未読(大分類の赤い点・ページの件数)。チャットページ自身も AMT.setUnread で更新する
  AMT.setUnread = n => {
    if (vis.unread === n) return;
    vis.unread = n;
    drawNav();
  };
  const pollUnread = () => {
    if (document.hidden) return;
    AMT.api('/api/chat/unread').then(d => AMT.setUnread(d.unread)).catch(() => {});
  };
  if (path !== '/chat') {
    pollUnread();
    setInterval(pollUnread, 30000);
    document.addEventListener('visibilitychange', pollUnread);
  }

  AMT.me = AMT.api('/api/me').then(d => {
    AMT.meInfo = d;
    setUser(d.name);
    vis.admin = !!d.is_admin;
    drawNav();
    return d;
  });

  // 左のメニュー: 大分類にマウスを合わせる(押す・キーボードで選ぶ)と、横に中分類の小窓が出る。離れて0.3秒で閉じる
  const canHover = matchMedia('(hover: hover) and (pointer: fine)').matches;
  let popTimer = null;
  function openPop(key) {
    const c = CONFIG.categories.find(x => x.key === key), btn = sidebar.querySelector(`.railCat[data-cat="${key}"]`);
    if (!c || !btn) return closePop();
    clearTimeout(popTimer);
    railPop.dataset.cat = key;
    railPop.innerHTML = `<div class="railPopTitle">${esc(c.title)}</div>${itemsOf(c).map(it => navRow(it, !!c.admin || !!it.admin).replace('class="navRow', 'role="menuitem" class="navRow')).join('')}`;
    railPop.hidden = false;
    const r = btn.getBoundingClientRect();
    railPop.style.top = `${Math.max(56, Math.min(r.top - 6, innerHeight - railPop.offsetHeight - 8))}px`;
    sidebar.querySelectorAll('.railCat').forEach(b => { const on = b === btn; b.classList.toggle('open', on); b.setAttribute('aria-expanded', String(on)); });
  }
  function closePop() {
    clearTimeout(popTimer);
    railPop.hidden = true;
    sidebar.querySelectorAll('.railCat').forEach(b => { b.classList.remove('open'); b.setAttribute('aria-expanded', 'false'); });
  }
  const closeSoon = () => { clearTimeout(popTimer); popTimer = setTimeout(closePop, 300); };
  const rail = sidebar.querySelector('.railNav');
  if (canHover) {
    rail.addEventListener('mouseover', e => { const b = e.target.closest('.railCat'); if (b && (railPop.hidden || railPop.dataset.cat !== b.dataset.cat)) openPop(b.dataset.cat); else clearTimeout(popTimer); });
    rail.addEventListener('mouseleave', closeSoon);
    railPop.addEventListener('mouseenter', () => clearTimeout(popTimer));
    railPop.addEventListener('mouseleave', closeSoon);
  }
  rail.addEventListener('click', e => {  // 押したとき(タブレットなど): 開いていなければ開き、開いていれば閉じる
    const b = e.target.closest('.railCat');
    if (!b) return;
    if (!railPop.hidden && railPop.dataset.cat === b.dataset.cat && !canHover) closePop(); else openPop(b.dataset.cat);
  });
  rail.addEventListener('keydown', e => {
    const b = e.target.closest('.railCat');
    if (b && (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openPop(b.dataset.cat); railPop.querySelector('a')?.focus(); }
  });
  railPop.addEventListener('keydown', e => {
    if (e.key === 'Escape' || e.key === 'ArrowLeft') { const k = railPop.dataset.cat; closePop(); sidebar.querySelector(`.railCat[data-cat="${k}"]`)?.focus(); }
  });
  document.addEventListener('mousedown', e => { if (!railPop.hidden && !railPop.contains(e.target) && !rail.contains(e.target)) closePop(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !railPop.hidden) closePop(); });

  // ハンバーガー(640px以下)
  document.getElementById('hamburger').addEventListener('click', () => document.body.classList.toggle('drawerOpen'));
  backdrop.addEventListener('click', () => document.body.classList.remove('drawerOpen'));

  // アカウントの小窓(左のメニューの一番上の丸): 名前・ロールとパスワード変更
  const accBtn = sidebar.querySelector('#accountRow');
  const accMenu = document.createElement('div');
  accMenu.id = 'accountMenu';
  accMenu.setAttribute('role', 'menu');
  accMenu.hidden = true;
  document.body.appendChild(accMenu);
  const closeAcc = focus => { if (accMenu.hidden) return; accMenu.hidden = true; accBtn.setAttribute('aria-expanded', 'false'); if (focus) accBtn.focus(); };
  accBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (!accMenu.hidden) return closeAcc();
    const d = AMT.meInfo || {};
    accMenu.innerHTML = `<div class="amName">${esc(d.name || '')}</div><div class="amRole">${esc(d.role_label || '')}</div>
      <button type="button" role="menuitem" class="amItem" data-acc="password"><i class="ti ti-key"></i>パスワード変更</button>`;
    const r = accBtn.getBoundingClientRect();
    accMenu.style.top = `${r.top}px`;
    accMenu.style.left = `${Math.min(r.right + 6, innerWidth - 230)}px`;
    if (r.right + 230 > innerWidth) { accMenu.style.top = `${r.bottom + 4}px`; accMenu.style.left = `${Math.max(8, r.left)}px`; }  // 狭い画面(引き出しのメニュー)では丸の下に
    accMenu.hidden = false;
    accBtn.setAttribute('aria-expanded', 'true');
    accMenu.querySelector('.amItem').focus();
  });
  accMenu.addEventListener('click', e => {
    if (e.target.closest('[data-acc="password"]')) { closeAcc(); document.body.classList.remove('drawerOpen'); openPassword(); }
  });
  document.addEventListener('click', e => { if (!accMenu.hidden && !accMenu.contains(e.target)) closeAcc(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !accMenu.hidden) closeAcc(true); });

  // パスワード変更
  function openPassword() {
    const m = AMT.modal({
      title: 'パスワード変更',
      body: `<form class="form">
        <label>現在のパスワード<input type="password" name="current" required autocomplete="current-password"></label>
        <label>新しいパスワード(4文字以上)<input type="password" name="new" required minlength="4" autocomplete="new-password"></label>
        <label>新しいパスワード(確認)<input type="password" name="confirm" required minlength="4" autocomplete="new-password"></label>
      </form>`,
      buttons: [{ label: 'キャンセル' }, {
        label: '変更する', primary: true, onClick: async () => {
          const f = m.querySelector('form');
          if (!f.reportValidity()) return false;
          if (f.new.value !== f.confirm.value) { AMT.toast('確認用パスワードが一致しません', true); return false; }
          await AMT.api('/api/me/password', { method: 'POST', body: { current: f.current.value, new: f.new.value } });
          AMT.toast('パスワードを変更しました');
        }
      }]
    });
  }
})();

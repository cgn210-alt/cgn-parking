// CGN 주차 — 직원 화면과 관리자 화면이 같이 쓰는 표시용 함수
var ParkingUI = (function (P) {
  var LOT_NAME = { annex: '별관', nam: '남경', wait: '대기' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function rank(s) { return { 'in': 0, ok: 1, wait: 1, released: 2, returned: 3 }[s.status]; }
  function statusBadge(s) {
    if (s.status === 'in') return '<span class="badge in">주차 완료' + (s.inAt ? ' ' + P.hm(s.inAt) : '') + '</span>';
    if (s.status === 'returned') return '<span class="badge off">반납</span>';
    if (s.status === 'released') return '<span class="badge off">해제</span>';
    if (s.status === 'ok') return '<span class="badge">' + (s.promotedAt ? '승계' : '배정') + '</span>';
    return s.lateAt ? '<span class="badge">늦은 등록</span>' : '';
  }

  // 별관·남경·대기 현황표. opt.key: 날짜, opt.me: 강조할 사람, opt.actions(uid, seat): 마지막 칸 버튼 HTML
  function boardHtml(day, users, opt) {
    opt = opt || {};
    var seats = (day && day.seats) || {};
    var cols = opt.actions ? 6 : 5;
    var out = '<div class="tbl"><table class="grid"><thead><tr><th class="num">순번</th><th>이름</th><th>차량번호</th><th>그룹</th><th>상태</th>' +
      (opt.actions ? '<th>처리</th>' : '') + '</tr></thead><tbody>';
    ['annex', 'nam', 'wait'].forEach(function (lot) {
      var list = Object.keys(seats).filter(function (u) { return seats[u].lot === lot; })
        .sort(function (a, b) { return rank(seats[a]) - rank(seats[b]) || (seats[a].order || 99) - (seats[b].order || 99); });
      var holding = list.filter(function (u) { return /^(ok|in)$/.test(seats[u].status); }).length;
      out += '<tr class="sec ' + lot + '"><td colspan="' + cols + '">' + LOT_NAME[lot] + ' · ' +
        (lot === 'wait' ? list.length + '명' : holding + ' / ' + P.LOTS[lot].cap + '대') + '</td></tr>';
      if (!list.length) out += '<tr><td colspan="' + cols + '" class="empty">없음</td></tr>';
      list.forEach(function (u, i) {
        var p = users[u] || {}, s = seats[u];
        out += '<tr' + (u === opt.me ? ' class="me"' : '') + '><td class="num">' + (lot === 'wait' ? s.order : i + 1) + '</td>' +
          '<td>' + esc(p.name || '(삭제됨)') + '</td><td>' + esc(p.plate || '') + '</td>' +
          '<td>' + (opt.key ? P.groupName(P.groupOf(p, opt.key)) : '') + '</td>' +
          '<td>' + (statusBadge(s) || '<span class="badge">대기</span>') + '</td>' +
          (opt.actions ? '<td class="acts">' + opt.actions(u, s) + '</td>' : '') + '</tr>';
      });
    });
    return out + '</tbody></table></div>';
  }

  function pct(a, b) { return b ? Math.round(a / b * 100) + '%' : '-'; }

  // 월간 통계: 그룹 분포, 사람별 표, 날짜별 표
  function statsHtml(ym, st, users, me) {
    var ids = Object.keys(users).filter(function (u) { return users[u].approved || st.person[u]; });
    var mid = ym + '-15';
    var odd = 0, even = 0;
    ids.forEach(function (u) { if (!users[u] || !users[u].approved) return; var g = P.groupOf(users[u], mid); if (g === 'odd') odd++; else if (g === 'even') even++; });
    var used = ids.map(function (u) { return (st.person[u] || {}).used || 0; });
    var users2 = used.filter(function (n, i) { return (st.person[ids[i]] || {}).req; });
    var avg = users2.length ? (users2.reduce(function (a, b) { return a + b; }, 0) / users2.length).toFixed(1) : '0';
    var out = '<div class="summary">' + (+ym.slice(5)) + '월 그룹: 홀수 <b>' + odd + '명</b> · 짝수 <b>' + even + '명</b>' +
      ' · 신청한 사람 1인당 평균 이용 <b>' + avg + '회</b></div>';

    if (me) {
      var m = st.person[me] || {};
      out += '<div class="mystat">' +
        stat('신청', (m.req || 0) + '일') + stat('별관', (m.annex || 0) + '일') + stat('남경', (m.nam || 0) + '일') +
        stat('이용', (m.used || 0) + '회') + stat('미도착', (m.released || 0) + '회') + stat('배정률', pct((m.annex || 0) + (m.nam || 0), m.req)) +
        '</div>';
    }

    ids.sort(function (a, b) {
      var x = st.person[a] || {}, y = st.person[b] || {};
      return (x.used || 0) - (y.used || 0) || String((users[a] || {}).name).localeCompare(String((users[b] || {}).name), 'ko');
    });
    out += '<div class="lot-title"><span>사람별 (이용 적은 순)</span></div><div class="tbl"><table class="grid"><thead><tr>' +
      '<th>이름</th><th>그룹</th><th class="num">신청</th><th class="num">별관</th><th class="num">남경</th><th class="num">이용</th>' +
      '<th class="num">반납</th><th class="num">미도착</th><th class="num">미배정</th><th class="num">배정률</th></tr></thead><tbody>' +
      ids.map(function (u) {
        var r = st.person[u] || {}, p = users[u] || {};
        return '<tr' + (u === me ? ' class="me"' : '') + '><td>' + esc(p.name || '(삭제됨)') + (p.priority ? ' <span class="badge">우선</span>' : '') + '</td>' +
          '<td>' + P.groupName(P.groupOf(p, mid)) + '</td>' +
          ['req', 'annex', 'nam', 'used', 'returned', 'released', 'waitOnly'].map(function (k) { return '<td class="num">' + (r[k] || 0) + '</td>'; }).join('') +
          '<td class="num">' + pct((r.annex || 0) + (r.nam || 0), r.req) + '</td></tr>';
      }).join('') + '</tbody></table></div>';

    var dates = Object.keys(st.daily).sort();
    out += '<div class="lot-title"><span>날짜별</span></div><div class="tbl"><table class="grid"><thead><tr>' +
      '<th>날짜</th><th>그룹</th><th class="num">신청</th><th class="num">별관</th><th class="num">남경</th><th class="num">대기</th></tr></thead><tbody>' +
      (dates.length ? dates.map(function (k) {
        var d = st.daily[k];
        return '<tr><td>' + P.shortLabel(k) + '</td><td>' + P.groupName(P.dayGroup(k)) + '</td><td class="num">' + d.req + '</td>' +
          '<td class="num">' + d.annex + ' / ' + P.LOTS.annex.cap + '</td><td class="num">' + d.nam + ' / ' + P.LOTS.nam.cap + '</td><td class="num">' + d.wait + '</td></tr>';
      }).join('') : '<tr><td colspan="6" class="empty">기록이 없습니다</td></tr>') +
      '</tbody></table></div>' +
      '<div class="note">이용 = 배정받고 반납하지 않은 날(미도착 포함). 미도착 = 반납 없이 오전 9시까지 오지 않아 해제된 날로, 다음 주 배정에서 제외됩니다. 미배정 = 신청했지만 대기로 끝난 날. 배정 순서는 이번 달 이용이 적은 사람이 먼저입니다.</div>';
    return out;
  }
  function stat(k, v) { return '<div><div class="k">' + k + '</div><div class="v">' + v + '</div></div>'; }

  // 월간 통계에 필요한 자료 읽기
  function loadStats(db, ym) {
    var from = ym + '-01', to = P.addDays(P.addMonths(ym, 1) + '-01', -1);
    return Promise.all([P.readDays(db, from, to), P.readApps(db, P.addDays(from, -6), to)])
      .then(function (r) { return P.stats(ym, r[0], r[1]); });
  }

  // 공지 목록 (고정 공지 먼저, 최신순)
  function sortedNotices(notices) {
    return Object.keys(notices || {}).map(function (id) { var n = notices[id]; n.id = id; return n; })
      .sort(function (a, b) { return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.at || 0) - (a.at || 0); });
  }
  function noticeHtml(n, actions) {
    var d = n.at ? new Date(n.at + 9 * 3600000) : null;
    return '<div class="notice' + (n.pinned ? ' pinned' : '') + '">' +
      '<div class="n-title">' + esc(n.title) + '</div>' +
      '<div class="n-body">' + esc(n.body).replace(/\n/g, '<br>') + '</div>' +
      '<div class="n-meta">' + (d ? (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' 수정' : '') + (actions || '') + '</div></div>';
  }

  // ── 좁은 화면에서 넘치는 표는 줄마다 '항목: 값' 카드로 바꿔 위아래로만 스크롤되게 함 ──
  // 각 칸에 머리글(th) 글자를 data-label 로 붙이고, 표가 칸보다 넓으면 stack 클래스를 붙임
  var STACK_CSS =
    'table.grid.stack, table.grid.stack tbody, table.grid.stack tr, table.grid.stack td { display:block; width:100%; }' +
    'table.grid.stack { border:none; white-space:normal; }' +
    'table.grid.stack thead { display:none; }' +
    // 카드 안은 두 칸으로 나눠 높이를 줄이고, 첫 칸(이름·날짜)과 처리 버튼은 한 줄 전체를 씀
    'table.grid.stack tr { display:grid; grid-template-columns:1fr 1fr; column-gap:16px; border:1px solid var(--border); border-radius:10px; padding:8px 10px; margin-bottom:8px; background:var(--surface); }' +
    'table.grid.stack tr.sec { display:block; border:none; padding:10px 2px 2px; margin:0; background:none; }' +
    'table.grid.stack td:first-child, table.grid.stack td.acts { grid-column:1 / -1; }' +
    'table.grid.stack td:first-child { font-weight:700; font-size:14px; border-bottom:1px solid var(--border); padding-bottom:6px; margin-bottom:2px; }' +
    'table.grid.stack td { display:flex; justify-content:space-between; align-items:center; gap:12px; border:none; padding:4px 0; text-align:right; white-space:normal; background:none; }' +
    'table.grid.stack td::before { content:attr(data-label); color:var(--text-muted); font-size:11.5px; font-weight:500; text-align:left; flex-shrink:0; }' +
    'table.grid.stack td:not([data-label])::before, table.grid.stack td[data-label=""]::before { content:none; }' +
    'table.grid.stack tr.sec td, table.grid.stack td[colspan] { display:block; text-align:left; padding:0; }' +
    'table.grid.stack td.acts { flex-wrap:wrap; justify-content:flex-end; }' +
    'table.grid.stack tr.me, table.grid.stack tr.pending, table.grid.stack tr.pickrow.on { background:var(--accent-bg); }' +
    'table.grid.stack tr.me td, table.grid.stack tr.pending td, table.grid.stack tr.pickrow.on td { background:none; }' +
    '.tbl:has(> table.grid.stack) { overflow:visible; }';

  function label(table) {
    var heads = [].map.call(table.querySelectorAll('thead th'), function (th) { return th.textContent.trim(); });
    if (!heads.length) return;
    [].forEach.call(table.querySelectorAll('tbody tr'), function (tr) {
      if (tr.classList.contains('sec')) return;
      var i = 0;
      [].forEach.call(tr.children, function (td) {
        if (!td.hasAttribute('colspan')) td.setAttribute('data-label', heads[i] || '');
        i += +(td.getAttribute('colspan') || 1);
      });
    });
  }
  function fit(table) {
    var box = table.parentNode;
    table.classList.remove('stack');
    if (box && table.scrollWidth > box.clientWidth + 2) table.classList.add('stack');
  }
  function fitAll() { [].forEach.call(document.querySelectorAll('table.grid'), function (t) { label(t); fit(t); }); }

  if (typeof document !== 'undefined') {
    var st = document.createElement('style');
    st.textContent = STACK_CSS;
    document.head.appendChild(st);
    var pending = false;
    var run = function () { if (pending) return; pending = true; requestAnimationFrame(function () { pending = false; fitAll(); }); };
    // 내용이 바뀌거나 숨겨진 탭이 열릴 때(class 변경) 다시 맞춤. 표 자신의 stack 표시 변경은 무시
    new MutationObserver(function (recs) {
      if (recs.some(function (r) { return r.type === 'childList' || r.target.tagName !== 'TABLE'; })) run();
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', run);
  }

  return {
    LOT_NAME: LOT_NAME, esc: esc, statusBadge: statusBadge, boardHtml: boardHtml,
    statsHtml: statsHtml, loadStats: loadStats, sortedNotices: sortedNotices, noticeHtml: noticeHtml
  };
})(Parking);

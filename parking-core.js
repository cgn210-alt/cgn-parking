// CGN 주차 배정 — 공통 로직 (직원 화면 index.html, 관리자 화면 admin.html, 자동 실행 scripts/weekly.js 공용)
var Parking = (function () {
  var LOTS = { annex: { name: '별관', cap: 8 }, nam: { name: '남경', cap: 5 } };
  // 주간 신청 일정: 매주 금요일 오후 2시 신청 시작, 2시 30분 마감, 오후 4시 결과 발표 (다음 주 월~금)
  var OPEN_HM = [14, 0], CLOSE_HM = [14, 30], PUBLISH_HM = [16, 0];
  var RELEASE_HOUR = 9;    // 주차일 오전 9시 미도착 해제
  var KST = 9 * 3600 * 1000;
  var DAY = 86400000;
  var ROOT = 'parking';
  var _offset = 0;         // 서버 시간 보정값 (휴대폰 시계가 틀려도 마감이 정확하도록)

  // 기본 공휴일 (평일만 의미 있음). 관리자 화면 '휴일' 탭에서 추가·삭제한 값이 이보다 우선합니다.
  var HOLIDAYS = {
    '2026-10-05': '개천절 대체공휴일', '2026-10-09': '한글날', '2026-12-25': '성탄절',
    '2027-01-01': '신정',
    '2027-03-01': '삼일절', '2027-05-05': '어린이날', '2027-05-13': '부처님오신날',
    '2027-08-16': '광복절 대체공휴일',
    '2027-09-14': '추석 연휴', '2027-09-15': '추석', '2027-09-16': '추석 연휴',
    '2027-10-04': '개천절 대체공휴일', '2027-10-11': '한글날 대체공휴일', '2027-12-27': '성탄절 대체공휴일'
  };

  // ── 시간 (모두 한국 시간 기준) ─────────────────
  function setOffset(ms) { _offset = ms || 0; }
  function now() { return Date.now() + _offset; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dateKey(ms) {
    var d = new Date(ms + KST);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function at(key, hour, min) {
    var p = key.split('-');
    return Date.UTC(+p[0], +p[1] - 1, +p[2], hour, min || 0) - KST;
  }
  function addDays(key, n) { return dateKey(at(key, 12) + n * DAY); }
  function today() { return dateKey(now()); }
  function dow(key) { var p = key.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay(); }
  function releaseTime(key) { return at(key, RELEASE_HOUR); }
  function dayGroup(key) { return (+key.slice(8)) % 2 ? 'odd' : 'even'; }
  function groupName(g) { return g === 'odd' ? '홀수' : g === 'even' ? '짝수' : '-'; }
  function label(key) {
    var p = key.split('-');
    return (+p[1]) + '월 ' + (+p[2]) + '일(' + '일월화수목금토'.charAt(dow(key)) + ')';
  }
  function shortLabel(key) { return (+key.slice(5, 7)) + '/' + (+key.slice(8)) + '(' + '일월화수목금토'.charAt(dow(key)) + ')'; }
  function hm(ms) {
    var d = new Date(ms + KST);
    return (d.getUTCHours() < 12 ? '오전 ' : '오후 ') + ((d.getUTCHours() + 11) % 12 + 1) + ':' + pad(d.getUTCMinutes());
  }
  function monthOf(key) { return key.slice(0, 7); }
  function addMonths(ym, n) {
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + n;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return y + '-' + pad(m + 1);
  }

  // ── 주간 일정 ─────────────────────────────────
  function mondayOf(key) { return addDays(key, -((dow(key) + 6) % 7)); }
  // 지금 신청·발표 대상인 '다음 주'의 월요일 (금요일 신청 → 다음 주 월~금)
  function nextWeek() { return addDays(mondayOf(today()), 7); }
  // 기본 일정(직전 금요일 2:00 / 2:30 / 4:00). week 를 주면 마스터가 바꿔 저장한 일정이 우선
  function schedule(wk, week) {
    if (week && week.openAt) return { openAt: week.openAt, closeAt: week.closeAt, publishAt: week.publishAt, custom: !!week.custom };
    var fri = addDays(wk, -3);
    return { openAt: at(fri, OPEN_HM[0], OPEN_HM[1]), closeAt: at(fri, CLOSE_HM[0], CLOSE_HM[1]), publishAt: at(fri, PUBLISH_HM[0], PUBLISH_HM[1]) };
  }
  // 'M/D(요일) 오후 2:00' 형태
  function when(ms) { return shortLabel(dateKey(ms)) + ' ' + hm(ms); }
  function isHoliday(key, overrides) {
    var o = overrides && overrides[key];
    if (o !== undefined && o !== null) return o !== false && o !== '';
    return !!HOLIDAYS[key];
  }
  function holidayName(key, overrides) {
    var o = overrides && overrides[key];
    return typeof o === 'string' ? o : HOLIDAYS[key] || '';
  }
  function weekDays(wk, overrides) {
    var out = [];
    for (var i = 0; i < 5; i++) { var k = addDays(wk, i); if (!isHoliday(k, overrides)) out.push(k); }
    return out;
  }

  // ── 월별 홀수/짝수 그룹 ───────────────────────
  // 그 달에 승인된 그룹, 없으면 가장 최근 승인 그룹, 그것도 없으면 가입 때 고른 그룹
  function groupOf(u, key) {
    if (!u) return null;
    var ym = key.slice(0, 7), g = u.groups || {};
    if (g[ym]) return g[ym];
    var ks = Object.keys(g).filter(function (k) { return k < ym; }).sort();
    return ks.length ? g[ks[ks.length - 1]] : u.group;
  }

  // ── 배정 계산 ─────────────────────────────────
  // 실제로 자리를 쓴 것으로 보는 상태 (반납은 제외, 미도착 해제는 포함)
  var USED = { ok: 1, 'in': 1, released: 1 };
  var HOLDING = { ok: 1, 'in': 1 };

  // key 날짜가 속한 달에서 key 이전 날짜의 이용 횟수 (월별 초기화), inclusive 이면 key 당일까지
  function monthCounts(days, key, inclusive) {
    var c = {}, m = key.slice(0, 7);
    Object.keys(days || {}).forEach(function (k) {
      if (k.slice(0, 7) !== m || k > key || (k === key && !inclusive)) return;
      var seats = (days[k] && days[k].seats) || {};
      Object.keys(seats).forEach(function (uid) {
        var s = seats[uid];
        if (s.lot !== 'wait' && USED[s.status]) c[uid] = (c[uid] || 0) + 1;
      });
    });
    return c;
  }

  // 횟수가 같을 때 쓰는 추첨 값 — 날짜+사람으로 정해지므로 누가 계산해도 같은 결과
  function tieBreak(key, uid) {
    var s = key + uid, h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function allocate(key, uids, users, counts) {
    var g = dayGroup(key);
    var list = uids.filter(function (u) { return users[u] && users[u].approved; });
    function cmp(a, b) {
      return (users[b].priority ? 1 : 0) - (users[a].priority ? 1 : 0) ||
             (counts[a] || 0) - (counts[b] || 0) ||
             tieBreak(key, a) - tieBreak(key, b);
    }
    var seats = {};
    // 별관: 그날 그룹만 (홀수날 = 홀수 그룹, 짝수날 = 짝수 그룹). 우선 배정 대상은 그 안에서 먼저.
    // 별관이 본관과 가깝고 남경은 멀어서, 별관은 자기 그룹 날에만 쓸 수 있게 고정
    list.filter(function (u) { return groupOf(users[u], key) === g; })
      .sort(cmp).slice(0, LOTS.annex.cap)
      .forEach(function (u, i) { seats[u] = { lot: 'annex', order: i + 1, status: 'ok' }; });
    // 남경: 별관에 못 들어간 모든 신청자, 나머지는 대기
    list.filter(function (u) { return !seats[u]; }).sort(cmp)
      .forEach(function (u, i) {
        seats[u] = i < LOTS.nam.cap
          ? { lot: 'nam', order: i + 1, status: 'ok' }
          : { lot: 'wait', order: i - LOTS.nam.cap + 1, status: 'wait' };
      });
    return seats;
  }

  // 한 주를 날짜순으로 배정 — 앞 날짜 배정을 횟수에 반영해서 같은 주 안에서도 고르게 돌아가도록
  function allocateWeek(dates, apps, users, history) {
    var hist = {}, out = {};
    Object.keys(history || {}).forEach(function (k) { hist[k] = history[k]; });
    dates.forEach(function (key) {
      var uids = Object.keys(apps || {}).filter(function (u) { return apps[u] && apps[u].dates && apps[u].dates[key]; });
      out[key] = allocate(key, uids, users, monthCounts(hist, key));
      hist[key] = { seats: out[key] };
    });
    return out;
  }

  // 미도착 패널티: 지난주에 배정받고 반납 없이 오전 9시까지 오지 않아 해제된 사람은 이번 주 배정에서 제외
  // (관리자가 면제한 건은 빼고) → { uid: [미도착 날짜들] }
  function penalized(wk, days, waivers) {
    var from = addDays(wk, -7), out = {};
    Object.keys(days || {}).forEach(function (k) {
      if (k < from || k >= wk) return;
      var seats = (days[k] && days[k].seats) || {};
      Object.keys(seats).forEach(function (u) {
        if (seats[u].lot !== 'wait' && seats[u].status === 'released' && !(waivers && waivers[k] && waivers[k][u])) (out[u] = out[u] || []).push(k);
      });
    });
    return out;
  }

  function waitingOf(seats) {
    return Object.keys(seats).filter(function (u) { return seats[u].lot === 'wait'; })
      .sort(function (a, b) { return seats[a].order - seats[b].order; });
  }

  // 별관을 쓸 수 있는 사람인지 (그날 그룹만)
  function annexOk(u, key) { return !!u && groupOf(u, key) === dayGroup(key); }

  // 빈자리를 대기 순번대로 채움 (별관 빈자리는 그날 그룹 대기자만 받음)
  function fill(day, users, t, key) {
    var seats = day.seats || (day.seats = {});
    var waiting = waitingOf(seats);
    ['annex', 'nam'].forEach(function (lot) {
      var free = LOTS[lot].cap - Object.keys(seats).filter(function (u) {
        return seats[u].lot === lot && HOLDING[seats[u].status];
      }).length;
      while (free > 0 && waiting.length) {
        var idx = 0;
        if (lot === 'annex') {
          idx = -1;
          for (var j = 0; j < waiting.length; j++) { if (key && annexOk(users[waiting[j]], key)) { idx = j; break; } }
          if (idx < 0) break;
        }
        var u = waiting.splice(idx, 1)[0];
        seats[u] = { lot: lot, order: 0, status: 'ok', promotedAt: t };
        free--;
      }
    });
    waiting.forEach(function (u, i) { seats[u].order = i + 1; });
    return day;
  }

  // 오전 9시: 도착 확인이 없는 배정을 해제 (당일 대기에서 올라온 사람은 제외)
  function sweep(day, key, users, t) {
    var seats = day.seats || {};
    var dayStart = at(key, 0);
    Object.keys(seats).forEach(function (u) {
      var s = seats[u];
      if (s.lot !== 'wait' && s.status === 'ok' && !(s.promotedAt >= dayStart)) {
        s.status = 'released';
        s.releasedAt = t;
      }
    });
    day.swept = true;
    return fill(day, users, t, key);
  }

  function giveBack(day, uid, users, t, key) {
    var s = day.seats && day.seats[uid];
    if (!s) return day;
    if (s.lot === 'wait') {
      delete day.seats[uid];
    } else if (HOLDING[s.status]) {
      s.status = 'returned';
      s.returnedAt = t;
    }
    return fill(day, users, t, key);
  }

  function joinWait(day, uid, users, t, key) {
    day.seats = day.seats || {};
    if (day.seats[uid]) return day;
    day.seats[uid] = { lot: 'wait', order: waitingOf(day.seats).length + 1, status: 'wait', lateAt: t };
    return fill(day, users, t, key);
  }

  // ── 통계 ──────────────────────────────────────
  // ym 달의 사람별·날짜별 집계. days: 배정 확정된 날, apps: 주간 신청 {월요일: {uid: {dates}}}
  function stats(ym, days, apps) {
    var person = {}, daily = {};
    function p(u) { return person[u] || (person[u] = { req: 0, annex: 0, nam: 0, used: 0, returned: 0, released: 0, waitOnly: 0 }); }
    Object.keys(apps || {}).forEach(function (wk) {
      Object.keys(apps[wk] || {}).forEach(function (u) {
        Object.keys((apps[wk][u] && apps[wk][u].dates) || {}).forEach(function (k) {
          if (k.slice(0, 7) !== ym) return;
          p(u).req++;
          (daily[k] = daily[k] || { req: 0, annex: 0, nam: 0, wait: 0 }).req++;
        });
      });
    });
    Object.keys(days || {}).forEach(function (k) {
      if (k.slice(0, 7) !== ym || !days[k] || !days[k].finalized) return;
      var d = daily[k] = daily[k] || { req: 0, annex: 0, nam: 0, wait: 0 };
      var seats = days[k].seats || {};
      Object.keys(seats).forEach(function (u) {
        var s = seats[u], r = p(u);
        if (s.lot === 'wait') { r.waitOnly++; d.wait++; return; }
        r[s.lot]++;
        if (HOLDING[s.status]) d[s.lot]++;   // 날짜별 칸은 실제로 자리를 차지한 수 (반납·해제 뒤 승계한 사람과 겹치지 않게)
        if (USED[s.status]) r.used++;
        if (s.status === 'returned') r.returned++;
        if (s.status === 'released') r.released++;
      });
    });
    return { person: person, daily: daily };
  }

  // ── Firebase 작업 ─────────────────────────────
  // (브라우저의 firebase compat 과 서버의 firebase-admin 이 같은 ref API 를 쓰므로 양쪽에서 그대로 사용)
  function ref(db, path) { return db.ref(ROOT + '/' + path); }
  function val(p) { return p.then(function (s) { return s.val(); }); }

  function readDays(db, from, to) {
    return val(ref(db, 'days').orderByKey().startAt(from).endAt(to).once('value')).then(function (v) { return v || {}; });
  }
  function readApps(db, from, to) {
    return val(ref(db, 'apps').orderByKey().startAt(from).endAt(to).once('value')).then(function (v) { return v || {}; });
  }

  // 다음 주 신청 일정 만들기 (관리자 화면, 자동 실행, 또는 신청 시작 후 처음 여는 직원)
  function ensureWeek(db, wk) {
    return val(ref(db, 'holidays').once('value')).then(function (hol) {
      var sc = schedule(wk), days = {};
      weekDays(wk, hol || {}).forEach(function (k) { days[k] = true; });
      return ref(db, 'weeks/' + wk).transaction(function (cur) {
        if (cur && cur.openAt) return;   // 이미 있으면 그대로
        return { openAt: sc.openAt, closeAt: sc.closeAt, publishAt: sc.publishAt, days: days, createdAt: now() };
      });
    });
  }

  // 마감 뒤 자동 배정안 만들기
  function ensureDraft(db, wk, users) {
    return val(ref(db, 'weeks/' + wk).once('value')).then(function (w) {
      if (!w || now() < w.closeAt) return null;
      return val(ref(db, 'drafts/' + wk + '/createdAt').once('value')).then(function (done) {
        if (done) return null;
        var dates = Object.keys(w.days || {}).sort();
        if (!dates.length) return null;
        var from = dates[0].slice(0, 8) + '01';
        if (addDays(wk, -7) < from) from = addDays(wk, -7);
        return Promise.all([
          val(ref(db, 'apps/' + wk).once('value')),
          readDays(db, from, addDays(dates[0], -1)),
          val(ref(db, 'waivers').orderByKey().startAt(addDays(wk, -7)).endAt(addDays(wk, -1)).once('value'))
        ]).then(function (r) {
          var apps = r[0] || {}, pen = penalized(wk, r[1], r[2] || {}), ok = {};
          Object.keys(apps).forEach(function (u) { if (!pen[u]) ok[u] = apps[u]; });
          var plan = allocateWeek(dates, ok, users, r[1]);
          return ref(db, 'drafts/' + wk).transaction(function (cur) {
            if (cur && cur.createdAt) return;
            var d = { createdAt: now(), days: plan };
            if (Object.keys(pen).length) d.penalized = pen;
            return d;
          });
        });
      });
    });
  }

  // 오후 4시 발표: 배정안을 날짜별 확정 배정으로 옮김
  function publish(db, wk, users, force) {
    return val(ref(db, 'weeks/' + wk).once('value')).then(function (w) {
      if (!w || w.publishedAt || (!force && now() < w.publishAt)) return null;
      return ensureDraft(db, wk, users).then(function () {
        return val(ref(db, 'drafts/' + wk).once('value'));
      }).then(function (dr) {
        if (!dr) return null;
        var dates = Object.keys(w.days || {}).sort();
        return Promise.all(dates.map(function (k) {
          return ref(db, 'days/' + k).transaction(function (cur) {
            if (cur && cur.finalized) return;
            return { finalized: true, finalizedAt: now(), group: dayGroup(k), week: wk, seats: (dr.days && dr.days[k]) || {} };
          });
        })).then(function () { return ref(db, 'weeks/' + wk + '/publishedAt').set(now()); });
      });
    });
  }

  // 시간이 된 단계를 순서대로 진행 (누가 열든 한 번만 실행됨). 마스터가 바꾼 일정이 있으면 그 시각을 따름
  function advance(db, users, canDraft) {
    var wk = nextWeek(), t = now();
    return val(ref(db, 'weeks/' + wk).once('value')).then(function (w) {
      var p = Promise.resolve();
      if (!w && t >= schedule(wk).openAt - 3600000) p = p.then(function () { return ensureWeek(db, wk); });
      if (w && !w.publishedAt) {
        if (canDraft && t >= w.closeAt) p = p.then(function () { return ensureDraft(db, wk, users); });
        if (t >= w.publishAt) p = p.then(function () { return publish(db, wk, users); });
      }
      return p;
    }).then(function () { return ensureSwept(db, today(), users); });
  }

  function ensureSwept(db, key, users) {
    if (now() < releaseTime(key)) return Promise.resolve();
    return ref(db, 'days/' + key).transaction(function (cur) {
      if (!cur || !cur.finalized || cur.swept) return cur;
      return sweep(cur, key, users, now());
    });
  }

  function update(db, key, fn) {
    return ref(db, 'days/' + key).transaction(function (cur) {
      if (!cur || !cur.finalized) return cur;
      return fn(cur);
    });
  }

  function checkIn(db, key, uid) {
    return update(db, key, function (cur) {
      var s = cur.seats && cur.seats[uid];
      if (s && s.lot !== 'wait' && s.status === 'ok') { s.status = 'in'; s.inAt = now(); }
      return cur;
    });
  }
  function returnSeat(db, key, uid, users) {
    return update(db, key, function (cur) { return giveBack(cur, uid, users, now(), key); });
  }
  function lateJoin(db, key, uid, users) {
    return update(db, key, function (cur) { return joinWait(cur, uid, users, now(), key); });
  }
  // 관리자용: 특정 배정을 바로 해제
  function release(db, key, uid, users) {
    return update(db, key, function (cur) {
      var s = cur.seats && cur.seats[uid];
      if (s && s.lot !== 'wait' && HOLDING[s.status]) { s.status = 'released'; s.releasedAt = now(); }
      return fill(cur, users, now(), key);
    });
  }

  return {
    LOTS: LOTS, ROOT: ROOT, RELEASE_HOUR: RELEASE_HOUR, HOLIDAYS: HOLIDAYS,
    setOffset: setOffset, now: now, dateKey: dateKey, at: at, addDays: addDays, today: today, dow: dow,
    releaseTime: releaseTime, dayGroup: dayGroup, groupName: groupName, label: label, shortLabel: shortLabel,
    hm: hm, monthOf: monthOf, addMonths: addMonths,
    mondayOf: mondayOf, nextWeek: nextWeek, schedule: schedule, when: when, isHoliday: isHoliday, holidayName: holidayName,
    weekDays: weekDays, groupOf: groupOf, annexOk: annexOk,
    monthCounts: monthCounts, allocate: allocate, allocateWeek: allocateWeek, fill: fill, sweep: sweep,
    giveBack: giveBack, joinWait: joinWait, waitingOf: waitingOf, stats: stats, penalized: penalized,
    ref: ref, readDays: readDays, readApps: readApps, ensureWeek: ensureWeek, ensureDraft: ensureDraft,
    publish: publish, advance: advance, ensureSwept: ensureSwept,
    checkIn: checkIn, returnSeat: returnSeat, lateJoin: lateJoin, release: release
  };
})();

if (typeof module !== 'undefined') module.exports = Parking;

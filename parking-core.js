// CGN 주차 배정 — 공통 로직 (직원 화면 index.html, 관리자 화면 admin.html 공용)
var Parking = (function () {
  var LOTS = { annex: { name: '별관', cap: 8 }, nam: { name: '남경', cap: 5 } };
  var DEADLINE_HOUR = 15;  // 주차일 전날 오후 3시 신청 마감
  var RELEASE_HOUR  = 9;   // 주차일 오전 9시 미도착 해제
  var KST = 9 * 3600 * 1000;
  var DAY = 86400000;
  var ROOT = 'parking';
  var _offset = 0;         // 서버 시간 보정값 (휴대폰 시계가 틀려도 마감이 정확하도록)

  // ── 시간 (모두 한국 시간 기준) ─────────────────
  function setOffset(ms) { _offset = ms || 0; }
  function now() { return Date.now() + _offset; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dateKey(ms) {
    var d = new Date(ms + KST);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function at(key, hour) {
    var p = key.split('-');
    return Date.UTC(+p[0], +p[1] - 1, +p[2], hour) - KST;
  }
  function addDays(key, n) { return dateKey(at(key, 12) + n * DAY); }
  function today() { return dateKey(now()); }
  function deadline(key) { return at(addDays(key, -1), DEADLINE_HOUR); }
  function releaseTime(key) { return at(key, RELEASE_HOUR); }
  function dayGroup(key) { return (+key.slice(8)) % 2 ? 'odd' : 'even'; }
  function groupName(g) { return g === 'odd' ? '홀수' : g === 'even' ? '짝수' : '-'; }
  function label(key) {
    var p = key.split('-');
    var w = '일월화수목금토'.charAt(new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay());
    return (+p[1]) + '월 ' + (+p[2]) + '일(' + w + ')';
  }
  // 신청 대상 날짜: 오후 3시 전이면 내일, 지나면 모레
  function openKey() {
    var t = today();
    return now() < at(t, DEADLINE_HOUR) ? addDays(t, 1) : addDays(t, 2);
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
    // 별관: 우선 배정 대상 + 그날 그룹
    list.filter(function (u) { return users[u].priority || users[u].group === g; })
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

  function waitingOf(seats) {
    return Object.keys(seats).filter(function (u) { return seats[u].lot === 'wait'; })
      .sort(function (a, b) { return seats[a].order - seats[b].order; });
  }

  // 빈자리를 대기 순번대로 채움 (별관은 그날 그룹 대기자를 먼저)
  function fill(day, users, t) {
    var seats = day.seats || (day.seats = {});
    var waiting = waitingOf(seats);
    ['annex', 'nam'].forEach(function (lot) {
      var free = LOTS[lot].cap - Object.keys(seats).filter(function (u) {
        return seats[u].lot === lot && HOLDING[seats[u].status];
      }).length;
      while (free > 0 && waiting.length) {
        var idx = 0;
        if (lot === 'annex') {
          for (var j = 0; j < waiting.length; j++) {
            var w = users[waiting[j]];
            if (w && (w.priority || w.group === day.group)) { idx = j; break; }
          }
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
    return fill(day, users, t);
  }

  function giveBack(day, uid, users, t) {
    var s = day.seats && day.seats[uid];
    if (!s) return day;
    if (s.lot === 'wait') {
      delete day.seats[uid];
    } else if (HOLDING[s.status]) {
      s.status = 'returned';
      s.returnedAt = t;
    }
    return fill(day, users, t);
  }

  function joinWait(day, uid, users, t) {
    day.seats = day.seats || {};
    if (day.seats[uid]) return day;
    day.seats[uid] = { lot: 'wait', order: waitingOf(day.seats).length + 1, status: 'wait', lateAt: t };
    return fill(day, users, t);
  }

  // ── Firebase 작업 ─────────────────────────────
  function ref(db, path) { return db.ref(ROOT + '/' + path); }

  function readMonth(db, key) {
    return ref(db, 'days').orderByKey().startAt(key.slice(0, 8) + '01').endAt(key)
      .once('value').then(function (s) { return s.val() || {}; });
  }

  // 마감이 지난 날짜는 처음 여는 사람이 배정을 확정 (트랜잭션이라 한 번만 실행됨)
  function ensureFinalized(db, key, users) {
    if (now() < deadline(key)) return Promise.resolve();
    return ref(db, 'days/' + key + '/finalized').once('value').then(function (s) {
      if (s.val()) return;
      return Promise.all([ref(db, 'requests/' + key).once('value'), readMonth(db, key)])
        .then(function (r) {
          var seats = allocate(key, Object.keys(r[0].val() || {}), users, monthCounts(r[1], key));
          return ref(db, 'days/' + key).transaction(function (cur) {
            if (cur && cur.finalized) return cur;
            return { finalized: true, finalizedAt: now(), group: dayGroup(key), seats: seats };
          });
        });
    });
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
    return update(db, key, function (cur) { return giveBack(cur, uid, users, now()); });
  }
  function lateJoin(db, key, uid, users) {
    return update(db, key, function (cur) { return joinWait(cur, uid, users, now()); });
  }
  // 관리자용: 특정 배정을 바로 해제
  function release(db, key, uid, users) {
    return update(db, key, function (cur) {
      var s = cur.seats && cur.seats[uid];
      if (s && s.lot !== 'wait' && HOLDING[s.status]) { s.status = 'released'; s.releasedAt = now(); }
      return fill(cur, users, now());
    });
  }

  return {
    LOTS: LOTS, ROOT: ROOT, DEADLINE_HOUR: DEADLINE_HOUR, RELEASE_HOUR: RELEASE_HOUR,
    setOffset: setOffset, now: now, dateKey: dateKey, at: at, addDays: addDays, today: today,
    deadline: deadline, releaseTime: releaseTime, dayGroup: dayGroup, groupName: groupName,
    label: label, openKey: openKey,
    monthCounts: monthCounts, allocate: allocate, fill: fill, sweep: sweep,
    giveBack: giveBack, joinWait: joinWait, waitingOf: waitingOf,
    ref: ref, readMonth: readMonth, ensureFinalized: ensureFinalized, ensureSwept: ensureSwept,
    checkIn: checkIn, returnSeat: returnSeat, lateJoin: lateJoin, release: release
  };
})();

if (typeof module !== 'undefined') module.exports = Parking;

"use strict";

// =====================================================
// 확률표 정적 내장
// PROB[등급]["단계"][키트] = 0..1
// 키트: B=초급, I=중급, A=상급
// =====================================================
const PROB = {"R":{"0":{"B":0.176,"I":0.55,"A":1.0},"1":{"B":0.208,"I":0.65,"A":1.0},"2":{"B":0.24,"I":0.75,"A":1.0},"3":{"B":0.272,"I":0.85,"A":1.0},"4":{"B":0.4,"I":1.0,"A":1.0},"5":{"B":0.16,"I":0.5,"A":1.0},"6":{"B":0.192,"I":0.6,"A":1.0},"7":{"B":0.224,"I":0.7,"A":1.0},"8":{"B":0.272,"I":0.85,"A":1.0},"9":{"B":0.4,"I":1.0,"A":1.0},"10":{"B":0.144,"I":0.45,"A":1.0},"11":{"B":0.176,"I":0.55,"A":1.0},"12":{"B":0.224,"I":0.7,"A":1.0},"13":{"B":0.272,"I":0.85,"A":1.0},"14":{"B":0.4,"I":1.0,"A":1.0}},"SR":{"0":{"B":0.036,"I":0.11,"A":0.25},"1":{"B":0.059,"I":0.198,"A":0.4},"2":{"B":0.078,"I":0.287,"A":0.55},"3":{"B":0.113,"I":0.413,"A":0.75},"4":{"B":0.15,"I":0.55,"A":1.0},"5":{"B":0.022,"I":0.08,"A":0.2},"6":{"B":0.033,"I":0.12,"A":0.3},"7":{"B":0.049,"I":0.18,"A":0.45},"8":{"B":0.076,"I":0.28,"A":0.7},"9":{"B":0.125,"I":0.5,"A":1.0},"10":{"B":0.012,"I":0.054,"A":0.15},"11":{"B":0.022,"I":0.099,"A":0.275},"12":{"B":0.031,"I":0.144,"A":0.4},"13":{"B":0.047,"I":0.216,"A":0.6},"14":{"B":0.1,"I":0.45,"A":1.0}}};

const $ = (id) => document.getElementById(id);

const Kit = {
  B: { key: "B", label: "초급자용", xpUnits: 2 },   // 200 / 100
  I: { key: "I", label: "중급자용", xpUnits: 5 },   // 500 / 100
  A: { key: "A", label: "상급자용", xpUnits: 10 },  // 1000 / 100
};
const KITS = [Kit.B, Kit.I, Kit.A];
const EPS = 1e-12;

// ----- 규칙 -----
function jumpTarget(stage) {
  if (stage <= 4) return 5;
  if (stage <= 9) return 10;
  return 15;
}
function needUnits(grade) {
  return grade === "R" ? 10 : 30; // 1000/100 or 3000/100
}
function clampInt(v, lo, hi) {
  v = Number.isFinite(v) ? Math.trunc(v) : lo;
  return Math.max(lo, Math.min(hi, v));
}
function normXpToUnits(grade, xp) {
  // 100 단위로 반올림(상태 폭발 방지)
  const max = grade === "R" ? 999 : 2999;
  xp = clampInt(xp, 0, max);
  const units = Math.round(xp / 100);
  const cap = grade === "R" ? 9 : 29;
  return Math.max(0, Math.min(cap, units));
}

function copyState(s) {
  return { g: s.g, st: s.st, x: s.x, b: s.b, i: s.i, a: s.a };
}
function totalKits(s) { return s.b + s.i + s.a; }

function probGreat(g, st, kitKey) {
  if (st >= 15) return 0;
  const row = PROB[g]?.[String(st)];
  if (!row) return 0;
  return row[kitKey] ?? 0;
}

function goalReached(s, goalMode) {
  if (goalMode === "SR15") return s.g === "SR" && s.st >= 15;
  const tgt = jumpTarget(s.st);
  return s.st >= tgt;
}

function autoConvertIfNeeded(s, goalMode) {
  // SR15 목표일 때만 R15->SR5 자동 변환(진행을 위해 사실상 필수)
  if (goalMode === "SR15" && s.g === "R" && s.st >= 15) {
    s.g = "SR";
    s.st = 5;
    s.x = 0;
  }
  return s;
}

// 실패 시 XP누적 + 오버플로우
function applyFailProgress(s, kit) {
  const need = needUnits(s.g);
  s.x += kit.xpUnits;

  while (s.st < 15 && s.x >= need) {
    s.x -= need;
    s.st += 1;
    if (s.st >= 15) {
      s.st = 15;
      s.x = 0;
      break;
    }
  }
  return s;
}

// 대성공(C1): XP 무시, 점프, XP=0
function applyGreatSuccess(s) {
  s.st = jumpTarget(s.st);
  s.x = 0;
  return s;
}

function decKit(s, kitKey) {
  if (kitKey === "B") s.b--;
  else if (kitKey === "I") s.i--;
  else if (kitKey === "A") s.a--;
  return s;
}
function kitRemain(s, kitKey) {
  if (kitKey === "B") return s.b;
  if (kitKey === "I") return s.i;
  return s.a;
}

// “보유량 비율 기반 가치” 반영(희소 비용)
function costOfUse(s, kitKey, costMode) {
  const rem = kitRemain(s, kitKey);
  if (rem <= 0) return Number.POSITIVE_INFINITY;

  if (costMode === "ONE_OVER_REMAIN") return 1 / rem;

  // 기본: 남은총량/해당키트잔량  (부족한 키트일수록 비싸짐)
  const tot = totalKits(s);
  return tot / rem;
}

function compareResult(a, b, priority) {
  // a가 더 좋으면 true
  if (priority === "C_FIRST") {
    if (a.c + EPS < b.c) return true;
    if (Math.abs(a.c - b.c) <= EPS && a.p > b.p + EPS) return true;
    return false;
  }
  // 기본: 성공확률 우선
  if (a.p > b.p + EPS) return true;
  if (Math.abs(a.p - b.p) <= EPS && a.c + EPS < b.c) return true;
  return false;
}

// BigInt 키로 메모이제이션 (정책=순서 최적화 핵심)
function packKey(s) {
  // key = ((((((g*16 + st)*32 + x)*1024 + b)*1024 + i)*1024 + a))
  const g = s.g === "SR" ? 1n : 0n;
  return ((((((g * 16n + BigInt(s.st)) * 32n + BigInt(s.x)) * 1024n + BigInt(s.b)) * 1024n + BigInt(s.i)) * 1024n + BigInt(s.a)));
}

function estimateStateCount(s) {
  const inv = (s.b + 1) * (s.i + 1) * (s.a + 1);
  const xpStates = s.g === "R" ? 10 : 30;
  return inv * 2 * 16 * xpStates;
}

// 상태 폭발 시 근사(그리디 1-step)
function greedyActionOneStep(s, goalMode, costMode, priority) {
  let best = null;
  for (const k of KITS) {
    if (kitRemain(s, k.key) <= 0) continue;
    if (s.st >= 15) continue;

    const p = probGreat(s.g, s.st, k.key);
    const c = costOfUse(s, k.key, costMode);
    const score = (priority === "C_FIRST") ? (p / (c + 1e-9)) : (p * 1000 - c);

    if (!best || score > best.score) best = { kitKey: k.key, score };
  }
  return best?.kitKey ?? null;
}

function buildSolver({ goalMode, costMode, priority, stateLimit }) {
  const memo = new Map(); // key -> {p,c,a,mode}

  function solve(state) {
    state = autoConvertIfNeeded(state, goalMode);

    if (goalReached(state, goalMode)) return { p: 1, c: 0, a: null, mode: "exact" };
    if (state.st >= 15) return { p: 0, c: 0, a: null, mode: "exact" };
    if (totalKits(state) <= 0) return { p: 0, c: 0, a: null, mode: "exact" };

    const key = packKey(state);
    const cached = memo.get(key);
    if (cached) return cached;

    // 너무 크면 근사로 전환
    if (estimateStateCount(state) > stateLimit) {
      const a = greedyActionOneStep(state, goalMode, costMode, priority);
      const res = { p: 0, c: 0, a, mode: "greedy" };
      memo.set(key, res);
      return res;
    }

    let bestRes = null;

    for (const kit of KITS) {
      if (kitRemain(state, kit.key) <= 0) continue;

      const immediateCost = costOfUse(state, kit.key, costMode);
      const pGreat = probGreat(state.g, state.st, kit.key);

      // 성공 분기(C1)
      const s1 = copyState(state);
      decKit(s1, kit.key);
      applyGreatSuccess(s1);
      autoConvertIfNeeded(s1, goalMode);
      const r1 = solve(s1);

      // 실패 분기
      const s0 = copyState(state);
      decKit(s0, kit.key);
      applyFailProgress(s0, kit);
      autoConvertIfNeeded(s0, goalMode);
      const r0 = solve(s0);

      const p = pGreat * r1.p + (1 - pGreat) * r0.p;
      const c = immediateCost + pGreat * r1.c + (1 - pGreat) * r0.c;

      const candidate = { p, c, a: kit.key, mode: "exact" };
      if (!bestRes || compareResult(candidate, bestRes, priority)) bestRes = candidate;
    }

    memo.set(key, bestRes);
    return bestRes;
  }

  return { solve, memo };
}

function formatKit(k) {
  if (k === "B") return "초급자용(+200)";
  if (k === "I") return "중급자용(+500)";
  if (k === "A") return "상급자용(+1000)";
  return "-";
}
function stateToText(s) {
  return `${s.g}${s.st} / XP:${s.x * 100} / 키트(초:${s.b}, 중:${s.i}, 상:${s.a})`;
}

function readInputs() {
  const g = $("grade").value;
  const st = clampInt(Number($("stage").value), 0, 15);
  const xpUnits = normXpToUnits(g, Number($("xp").value));

  const b = clampInt(Number($("bCnt").value), 0, 1023);
  const i = clampInt(Number($("iCnt").value), 0, 1023);
  const a = clampInt(Number($("aCnt").value), 0, 1023);

  const goalMode = $("goalMode").value;
  const priority = $("priority").value;
  const costMode = $("costMode").value;
  const stateLimit = clampInt(Number($("stateLimit").value), 100000, 20000000);

  return { start: { g, st, x: xpUnits, b, i, a }, goalMode, priority, costMode, stateLimit };
}

function explainWhyOrderMatters(s) {
  const pB = probGreat(s.g, s.st, "B");
  const pI = probGreat(s.g, s.st, "I");
  const pA = probGreat(s.g, s.st, "A");
  const tgt = jumpTarget(s.st);

  return [
    `현재 단계(${s.g}${s.st})에서 대성공 확률:`,
    `- 초급자용: ${(pB * 100).toFixed(2)}%`,
    `- 중급자용: ${(pI * 100).toFixed(2)}%`,
    `- 상급자용: ${(pA * 100).toFixed(2)}%`,
    `대성공 시 목표 단계는 ${tgt} 입니다.`,
    `※ 먼저 어떤 키트를 쓰느냐에 따라 다음 상태(단계/경험치)가 달라지고,`,
    `  그 다음 키트를 쓸 때 적용되는 ‘대성공 확률(단계별)’도 달라지므로 ‘순서’가 성능을 바꿉니다.`,
  ].join("\n");
}

// “순서(정책)”이 어떻게 바뀌는지 성공/실패 분기 트리로 보여줌
function policyPreview(solver, start, goalMode, costMode, depth = 2) {
  const lines = [];

  function rec(s, d, prefix) {
    s = autoConvertIfNeeded(s, goalMode);

    if (goalReached(s, goalMode)) {
      lines.push(`${prefix}✅ 목표 달성: ${stateToText(s)}`);
      return;
    }
    if (s.st >= 15 || totalKits(s) <= 0) {
      lines.push(`${prefix}⛔ 종료: ${stateToText(s)}`);
      return;
    }

    const r = solver.solve(s);
    const act = r.a;
    if (!act) {
      lines.push(`${prefix}⛔ 종료(행동없음): ${stateToText(s)}`);
      return;
    }

    const p = probGreat(s.g, s.st, act);
    const c = costOfUse(s, act, costMode);

    lines.push(`${prefix}• 상태: ${stateToText(s)}`);
    lines.push(`${prefix}  → 행동: ${formatKit(act)}  (대성공 ${(p * 100).toFixed(2)}%, 즉시비용 ${c.toFixed(4)})`);

    if (d <= 0) return;

    // 성공
    const s1 = copyState(s);
    decKit(s1, act);
    applyGreatSuccess(s1);
    autoConvertIfNeeded(s1, goalMode);
    lines.push(`${prefix}  ↳ [대성공] → ${stateToText(s1)}`);
    rec(s1, d - 1, prefix + "    ");

    // 실패
    const s0 = copyState(s);
    decKit(s0, act);
    const kitObj = act === "B" ? Kit.B : act === "I" ? Kit.I : Kit.A;
    applyFailProgress(s0, kitObj);
    autoConvertIfNeeded(s0, goalMode);
    lines.push(`${prefix}  ↳ [실패]   → ${stateToText(s0)}`);
    rec(s0, d - 1, prefix + "    ");
  }

  rec(copyState(start), depth, "");
  return lines.join("\n");
}

function monteCarlo(solver, startState, goalMode, costMode, N = 5000) {
  let success = 0;
  let sumCost = 0;
  let sumUsed = 0;
  const dist = new Map();

  for (let t = 0; t < N; t++) {
    let s = copyState(startState);
    let cost = 0;
    let used = 0;

    while (true) {
      s = autoConvertIfNeeded(s, goalMode);
      if (goalReached(s, goalMode)) { success++; break; }
      if (s.st >= 15) break;
      if (totalKits(s) <= 0) break;

      const r = solver.solve(s);
      const act = r.a;
      if (!act) break;

      cost += costOfUse(s, act, costMode);
      used += 1;

      // C1: 대성공 먼저 판정
      const p = probGreat(s.g, s.st, act);
      decKit(s, act);

      if (Math.random() < p) {
        applyGreatSuccess(s);
      } else {
        const kitObj = act === "B" ? Kit.B : act === "I" ? Kit.I : Kit.A;
        applyFailProgress(s, kitObj);
      }
    }

    sumCost += cost;
    sumUsed += used;
    const endKey = `${s.g}${s.st}`;
    dist.set(endKey, (dist.get(endKey) ?? 0) + 1);
  }

  return { pSuccess: success / N, avgCost: sumCost / N, avgUsed: sumUsed / N, dist };
}

function distToText(dist, N) {
  const arr = [...dist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  return arr.map(([k, v]) => `${k}: ${(v / N * 100).toFixed(2)}%`).join("\n");
}

function setOut(text) { $("out").textContent = text; }

// ----- UI wiring -----
(function main() {
  $("btnSolve").addEventListener("click", () => {
    const { start, goalMode, priority, costMode, stateLimit } = readInputs();
    const solver = buildSolver({ goalMode, costMode, priority, stateLimit });

    const r = solver.solve(copyState(start));
    const mode = r.mode === "greedy" ? "근사(그리디)" : "정확(DP)";

    const preview = policyPreview(solver, start, goalMode, costMode, 2);

    const text = [
      `입력 상태: ${stateToText(start)}`,
      `목표: ${goalMode === "SR15" ? "SR15" : "현재 구간 목표(5/10/15)"}`,
      `우선순위: ${priority === "P_FIRST" ? "성공확률 우선" : "비용 우선"}`,
      `비용모델: ${costMode === "TOTAL_OVER_REMAIN" ? "남은총량/해당키트잔량" : "1/해당키트잔량"}`,
      `계산 모드: ${mode}  (상태수 추정치=${estimateStateCount(start).toLocaleString()}, 한도=${stateLimit.toLocaleString()})`,
      "",
      `추천 1수: ${formatKit(r.a)}`,
      `- 목표 달성 확률(추정): ${(r.p * 100).toFixed(2)}%`,
      `- 기대 비용(희소 기준): ${r.c.toFixed(4)}`,
      "",
      explainWhyOrderMatters(start),
      "",
      "--- 정책 미리보기(깊이 2, 성공/실패 분기) ---",
      preview
    ].join("\n");

    setOut(text);
    window.__solver = solver;
    window.__last = { start, goalMode, costMode };
  });

  $("btnSim").addEventListener("click", () => {
    const last = window.__last;
    const solver = window.__solver;
    if (!last || !solver) {
      setOut("먼저 “최적 전략 계산”을 눌러 정책을 계산하세요.");
      return;
    }

    const N = 5000;
    const mc = monteCarlo(solver, copyState(last.start), last.goalMode, last.costMode, N);

    setOut([
      $("out").textContent,
      "",
      `--- 몬테카를로 검증 (${N}회) ---`,
      `- 목표 달성 확률: ${(mc.pSuccess * 100).toFixed(2)}%`,
      `- 평균 비용(희소 기준): ${mc.avgCost.toFixed(4)}`,
      `- 평균 사용 키트 수: ${mc.avgUsed.toFixed(2)}`,
      "",
      `최종 상태 상위 분포(Top10):`,
      distToText(mc.dist, N)
    ].join("\n"));
  });
})();

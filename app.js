// 장비 강화 최적 전략 시뮬레이터 (GitHub Pages용)
// - 확률표 CSV를 fetch로 로드
// - 유한 재고(초/중/상 키트) 하에서 “순서가 중요한” 최적 정책을 DP로 계산
// - 상태 수가 너무 크면 근사(그리디 1-step lookahead)로 전환

const $ = (id) => document.getElementById(id);

const Kit = {
  B: { key: "B", label: "초급자용", xpUnits: 2 },   // 200 / 100
  I: { key: "I", label: "중급자용", xpUnits: 5 },   // 500 / 100
  A: { key: "A", label: "상급자용", xpUnits: 10 },  // 1000 / 100
};
const KITS = [Kit.B, Kit.I, Kit.A];
const EPS = 1e-12;

let PROB = null; // PROB[grade]["0".."14"][kitKey] = 0..1

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
  if (!PROB) return 0;
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

function applyFailProgress(s, kit) {
  const need = needUnits(s.g);
  s.x += kit.xpUnits;

  while (s.st < 15 && s.x >= need) {
    s.x -= need;
    s.st += 1;
    if (s.st >= 15) {
      s.st = 15;
      s.x = 0; // 15단계에서는 의미 없으니 0 처리
      break;
    }
  }
  return s;
}
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

function costOfUse(s, kitKey, costMode) {
  const rem = kitRemain(s, kitKey);
  if (rem <= 0) return Number.POSITIVE_INFINITY;

  if (costMode === "ONE_OVER_REMAIN") return 1 / rem;

  // 기본: 남은총량/해당키트잔량 (희소성 + “보유비율 기반 가치” 반영)
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
  if (a.p > b.p + EPS) return true;
  if (Math.abs(a.p - b.p) <= EPS && a.c + EPS < b.c) return true;
  return false;
}

function packKey(s) {
  // BigInt 키: ((((((g*16 + st)*32 + x)*1024 + b)*1024 + i)*1024 + a))
  const g = s.g === "SR" ? 1n : 0n;
  return ((((((g * 16n + BigInt(s.st)) * 32n + BigInt(s.x)) * 1024n + BigInt(s.b)) * 1024n + BigInt(s.i)) * 1024n + BigInt(s.a));
}

function estimateStateCount(s) {
  const inv = (s.b + 1) * (s.i + 1) * (s.a + 1);
  const xpStates = s.g === "R" ? 10 : 30;
  return inv * 2 * 16 * xpStates;
}

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
  const memo = new Map(); // key(BigInt) -> {p,c,a,mode}

  function solve(state) {
    state = autoConvertIfNeeded(state, goalMode);

    if (goalReached(state, goalMode)) return { p: 1, c: 0, a: null, mode: "exact" };
    if (state.st >= 15) return { p: 0, c: 0, a: null, mode: "exact" };
    if (totalKits(state) <= 0) return { p: 0, c: 0, a: null, mode: "exact" };

    const key = packKey(state);
    const cached = memo.get(key);
    if (cached) return cached;

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

      // 성공 분기 (C1: 대성공이면 XP 무시하고 점프 + XP=0)
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
    `  그 다음 키트를 쓸 때 적용되는 ‘대성공 확률’도 달라지므로 ‘순서’가 성능을 바꿉니다.`,
  ].join("\n");
}

function monteCarlo({ solve }, startState, goalMode, costMode, N = 5000) {
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

      const r = solve(s);
      const act = r.a;
      if (!act) break;

      const c = costOfUse(s, act, costMode);
      cost += c;
      used += 1;

      // C1: 대성공 먼저 판정
      const p = probGreat(s.g, s.st, act);
      decKit(s, act);

      if (Math.random() < p) {
        applyGreatSuccess(s);
      } else {
        const kit = act === "B" ? Kit.B : act === "I" ? Kit.I : Kit.A;
        applyFailProgress(s, kit);
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

async function loadCsvProbs() {
  const res = await fetch("./대성공확률표.csv", { cache: "no-store" });
  if (!res.ok) throw new Error(`CSV 로드 실패: HTTP ${res.status}`);
  const text = await res.text();

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const header = lines[0].split(",").map(s => s.trim());
  const idx = (namePart) => header.findIndex(h => h.includes(namePart));

  const colGrade = idx("등급");
  const colStage = idx("단계");
  const colB = idx("초급자용");
  const colI = idx("중급자용");
  const colA = idx("상급자용");

  if ([colGrade, colStage, colB, colI, colA].some(i => i < 0)) {
    throw new Error("CSV 헤더 형식이 예상과 다릅니다. (등급/단계/초급자용/중급자용/상급자용 컬럼 필요)");
  }

  const prob = { R: {}, SR: {} };

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map(s => s.trim());
    const g = cols[colGrade];
    const st = Number(cols[colStage]);
    const b = Number(cols[colB]) / 100;
    const m = Number(cols[colI]) / 100;
    const a = Number(cols[colA]) / 100;

    if (!prob[g]) continue;
    if (!Number.isFinite(st)) continue;
    prob[g][String(st)] = { B: b, I: m, A: a };
  }
  return prob;
}

function setOut(text) { $("out").textContent = text; }
function setLoadState(ok, msg) {
  const el = $("loadState");
  el.textContent = msg;
  el.classList.toggle("ok", ok);
  el.classList.toggle("bad", !ok);
}

async function main() {
  try {
    PROB = await loadCsvProbs();
    setLoadState(true, "확률표 로딩 완료");
  } catch (e) {
    setLoadState(false, "확률표 로딩 실패");
    setOut(String(e));
    return;
  }

  $("btnSolve").addEventListener("click", () => {
    const { start, goalMode, priority, costMode, stateLimit } = readInputs();
    const solver = buildSolver({ goalMode, costMode, priority, stateLimit });

    const r = solver.solve(copyState(start));
    const mode = r.mode === "greedy" ? "근사(그리디)" : "정확(DP)";

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
      explainWhyOrderMatters(start)
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
}

main();

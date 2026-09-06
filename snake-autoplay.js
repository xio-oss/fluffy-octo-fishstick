// snake-autoplay.js — 无头版贪吃蛇:复刻 snake.html 的规则,让 AI 自己玩
// 运行: node snake-autoplay.js [局数]
"use strict";

const GRID = 20;
const DIRS = [
  { x: 0, y: -1 }, // 上
  { x: 0, y: 1 },  // 下
  { x: -1, y: 0 }, // 左
  { x: 1, y: 0 },  // 右
];

const key = (p) => p.y * GRID + p.x;
const inb = (p) => p.x >= 0 && p.x < GRID && p.y >= 0 && p.y < GRID;
const manh = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

// ---------- 与 snake.html 完全一致的游戏核心 ----------
class Game {
  constructor(seed) {
    this.rng = seed ? mulberry32(seed) : Math.random;
    this.reset();
  }
  reset() {
    const c = Math.floor(GRID / 2);
    this.snake = [
      { x: c, y: c },
      { x: c - 1, y: c },
      { x: c - 2, y: c },
    ];
    this.food = this.spawnFood();
    this.score = 0;
    this.steps = 0;
    this.over = false;
    this.won = false;
    this.reason = "";
  }
  rnd() { return this.rng(); }
  spawnFood() {
    const occ = new Set(this.snake.map(key));
    const free = [];
    for (let x = 0; x < GRID; x++)
      for (let y = 0; y < GRID; y++)
        if (!occ.has(y * GRID + x)) free.push({ x, y });
    if (!free.length) return null; // 蛇占满棋盘 -> 胜利
    return free[Math.floor(this.rnd() * free.length)];
  }
  step(dir) {
    this.steps++;
    const head = { x: this.snake[0].x + dir.x, y: this.snake[0].y + dir.y };
    if (!inb(head)) {
      this.over = true;
      this.reason = "撞墙";
      return;
    }
    const eating = this.food && head.x === this.food.x && head.y === this.food.y;
    const limit = this.snake.length - (eating ? 0 : 1); // 不吃时尾巴会离开,不算撞
    for (let i = 0; i < limit; i++) {
      const s = this.snake[i];
      if (s.x === head.x && s.y === head.y) {
        this.over = true;
        this.reason = "撞到自己";
        return;
      }
    }
    this.snake.unshift(head);
    if (eating) {
      this.score += 10;
      this.food = this.spawnFood();
      if (!this.food) {
        this.over = true;
        this.won = true;
        this.reason = "填满棋盘,通关!";
      }
    } else {
      this.snake.pop();
    }
  }
}

// 简易可复现随机数(用于种子)
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- AI 大脑 ----------
// 分析:假设头在 nh、身体为 body(移动后,含头),忽略尾巴那格(它下一步会移开),
// 用洪水填充统计可达空间,并判断能否够到自己的尾巴(够到尾巴 = 大概率安全)。
function analyze(nh, body) {
  const obs = new Set();
  for (let i = 0; i < body.length - 1; i++) obs.add(key(body[i])); // 除尾巴外都是墙
  const seen = new Set([key(nh)]);
  const stack = [nh];
  while (stack.length) {
    const p = stack.pop();
    for (const d of DIRS) {
      const n = { x: p.x + d.x, y: p.y + d.y };
      if (!inb(n)) continue;
      const k = key(n);
      if (seen.has(k) || obs.has(k)) continue;
      seen.add(k);
      stack.push(n);
    }
  }
  const tailReachable = seen.has(key(body[body.length - 1]));
  return { area: seen.size, tailReachable };
}

// BFS 求蛇头到食物的最短路径(身体视为墙,尾巴那格允许通过——它会移开)
// 返回路径数组(含起点)或 null
function pathToFood(snake, food) {
  if (!food) return null;
  const head = snake[0];
  const obs = new Set();
  for (let i = 0; i < snake.length - 1; i++) obs.add(key(snake[i]));
  if (obs.has(key(food))) return null; // 食物被身体包死
  const prev = new Map();
  const seen = new Set([key(head)]);
  const q = [head];
  while (q.length) {
    const p = q.shift();
    if (p.x === food.x && p.y === food.y) {
      const path = [p];
      let cur = p;
      while (cur.x !== head.x || cur.y !== head.y) {
        cur = prev.get(key(cur));
        path.push(cur);
      }
      return path.reverse();
    }
    for (const d of DIRS) {
      const n = { x: p.x + d.x, y: p.y + d.y };
      if (!inb(n)) continue;
      const k = key(n);
      if (seen.has(k) || obs.has(k)) continue;
      seen.add(k);
      prev.set(k, p);
      q.push(n);
    }
  }
  return null;
}

// 决策:遍历 4 个方向,排除立即撞死的走法,然后打分:
//   吃到食物 +400; 处于去食物的最短路径上 +250(安全才走); 够得到尾巴 +100, 够不到 -80;
//   可达空间越大越好(转圈保命时的偏好); 离食物越近越好(小权重)。
function chooseDir(game) {
  const { snake, food } = game;
  const head = snake[0];
  const path = pathToFood(snake, food);
  const onPath = (nh) =>
    path && path.length > 1 && nh.x === path[1].x && nh.y === path[1].y;
  let best = null;
  let bestScore = -Infinity;
  for (const d of DIRS) {
    const nh = { x: head.x + d.x, y: head.y + d.y };
    if (!inb(nh)) continue;
    const eating = food && nh.x === food.x && nh.y === food.y;
    const limit = snake.length - (eating ? 0 : 1);
    let hit = false;
    for (let i = 0; i < limit; i++) {
      const s = snake[i];
      if (s.x === nh.x && s.y === nh.y) { hit = true; break; }
    }
    if (hit) continue;
    const next = [nh].concat(snake);
    if (!eating) next.pop();
    const { area, tailReachable } = analyze(nh, next);
    let sc = 0;
    if (eating) sc += 400;
    if (onPath(nh) && tailReachable) sc += 250;
    sc += tailReachable ? 100 : -80;
    sc += area * 0.3;                       // 偏爱开阔空间
    sc -= manh(nh, food || nh) * 3;         // 朝食物靠近
    if (sc > bestScore) { bestScore = sc; best = d; }
  }
  return best;
}

// ---------- 跑一局,返回战报 ----------
function playOne(seed, maxSteps) {
  const g = new Game(seed);
  const moves = [];
  let lastEat = 0; // 上次吃到食物的步数
  while (!g.over && g.steps < maxSteps) {
    const d = chooseDir(g);
    if (!d) {
      g.over = true;
      g.reason = "无路可走";
      break;
    }
    moves.push(d);
    const before = g.score;
    g.step(d);
    if (g.score > before) {
      lastEat = g.steps;
    } else if (g.steps - lastEat > 3500) {
      // AI 的"耐心":转圈超过 3500 步还吃不到食物就认输
      g.over = true;
      g.reason = "转圈 3500 步没吃到食物,自动认输";
      break;
    }
  }
  if (!g.over) {
    g.reason = "达到步数上限,仍在安全转圈";
  }
  return { g, moves };
}

function arrowOf(d) {
  if (d.x === 0 && d.y === -1) return "↑";
  if (d.x === 0 && d.y === 1) return "↓";
  if (d.x === -1 && d.y === 0) return "←";
  return "→";
}

function drawBoard(g) {
  const cells = new Map();
  g.snake.forEach((s, i) => cells.set(key(s), i === 0 ? "🐍" : "■"));
  if (g.food) cells.set(key(g.food), "●");
  const rows = [];
  for (let y = 0; y < GRID; y++) {
    let line = "";
    for (let x = 0; x < GRID; x++) {
      line += (cells.get(y * GRID + x) || "·") + " ";
    }
    rows.push(line.trimEnd());
  }
  return rows.join("\n");
}

// ---------- 主流程 ----------
const games = Number(process.argv[2] || 3);
const results = [];
for (let i = 0; i < games; i++) {
  const { g, moves } = playOne(1234 + i * 777, 20000);
  results.push({ g, moves, i });
}

results.forEach(({ g, moves, i }) => {
  console.log(`\n=== 第 ${i + 1} 局 (种子 ${1234 + i * 777}) ===`);
  console.log(`共走 ${g.steps} 步, 吃到 ${g.score / 10} 个食物, 得分 ${g.score}, 蛇长 ${g.snake.length}`);
  console.log(`结局: ${g.reason}`);
  if (g.won) console.log("🏆 通关!");
  console.log("前 40 步: " + moves.slice(0, 40).map(arrowOf).join(""));
  console.log("终局棋盘:");
  console.log(drawBoard(g));
});

const scores = results.map((r) => r.g.score);
const best = Math.max(...scores);
console.log(`\n📊 战报: ${games} 局得分 ${scores.join(" / ")}, 最好成绩 ${best} 分`);

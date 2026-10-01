// --- DRAW RUN - メインゲームスクリプト（モード追加版） ---

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

canvas.width = 400;
canvas.height = 700;

const Engine = Matter.Engine;
const World = Matter.World;
const Bodies = Matter.Bodies;
const Body = Matter.Body;

const engine = Engine.create();
const world = engine.world;

const normalGravityY = 0.7;
engine.world.gravity.y = normalGravityY;

// --- 画像の読み込み ---
const groundImage = new Image();
groundImage.src = "ground.jpg";

const bgAozora = new Image();
bgAozora.src = "haikei-aozora.png";

const bgYuugure = new Image();
bgYuugure.src = "yuugure.jpeg";

const bgYozora = new Image();
bgYozora.src = "yozora.png";

const bgCyber = new Image();
bgCyber.src = "syber.jpg";

// --- 音声ファイルの読み込みと音量設定 ---
const deathSound = new Audio("death.mp3");
deathSound.volume = 0.03;
const playBGM = new Audio("play.mp3");
playBGM.loop = true; 
playBGM.volume = 0.03; 

const characterList = [
  { src: "player.png", name: "棒人間" },
  { src: "player2.png", name: "格闘家" }, 
  { src: "player3.png", name: "忍者" }    
];

const playerImages = characterList.map((char) => {
  const img = new Image();
  img.src = char.src;
  return img;
});

let currentSkinIndex = parseInt(localStorage.getItem('drawRunSkinIndex')) || 0;
if (currentSkinIndex < 0 || currentSkinIndex >= characterList.length) {
  currentSkinIndex = 0;
}

// ===== モード設定 =====
const MODE_CONFIG = {
  score: {
    name: "スコアアタック",
    isInfinite: true,
    targetScore: null,
    holeChance: 0.50,
    minHoleWidth: 200,
    maxHoleWidthFactor: 0.80,
    wallHeightMin: 100,
    wallHeightMax: 350,
    minSafeDistance: 400,
    baseSpeed: 4.0,
    airborneGravityStart: 120,
    gravityIncrease: 0.15,
    bgFixed: null           // スコア連動
  },
  stage1: {
    name: "STAGE 1",
    isInfinite: false,
    targetScore: 250,
    holeChance: 0.30,
    minHoleWidth: 160,
    maxHoleWidthFactor: 0.55,
    wallHeightMin: 80,
    wallHeightMax: 180,
    minSafeDistance: 500,
    baseSpeed: 3.6,
    airborneGravityStart: 150,
    gravityIncrease: 0.10,
    bgFixed: "aozora"
  },
  stage2: {
    name: "STAGE 2",
    isInfinite: false,
    targetScore: 450,
    holeChance: 0.40,
    minHoleWidth: 180,
    maxHoleWidthFactor: 0.65,
    wallHeightMin: 100,
    wallHeightMax: 240,
    minSafeDistance: 420,
    baseSpeed: 3.9,
    airborneGravityStart: 130,
    gravityIncrease: 0.13,
    bgFixed: "yuugure"
  },
  stage3: {
    name: "STAGE 3",
    isInfinite: false,
    targetScore: 700,
    holeChance: 0.50,
    minHoleWidth: 200,
    maxHoleWidthFactor: 0.75,
    wallHeightMin: 120,
    wallHeightMax: 300,
    minSafeDistance: 360,
    baseSpeed: 4.2,
    airborneGravityStart: 110,
    gravityIncrease: 0.16,
    bgFixed: "yozora"
  },
  stage4: {
    name: "STAGE 4",
    isInfinite: false,
    targetScore: 1000,
    holeChance: 0.58,
    minHoleWidth: 220,
    maxHoleWidthFactor: 0.85,
    wallHeightMin: 140,
    wallHeightMax: 360,
    minSafeDistance: 300,
    baseSpeed: 4.5,
    airborneGravityStart: 90,
    gravityIncrease: 0.20,
    bgFixed: "cyber"
  }
};

let currentMode = null;          // 'score' | 'stage1' ... 
let currentConfig = null;        // MODE_CONFIG[currentMode]
let gameStarted = false;
let gameOver = false;
let gameCleared = false;

const player = Bodies.circle(200, canvas.height / 2, 20, {
  friction: 0.05,
  restitution: 0,
  inertia: Infinity
});
World.add(world, player);

let score = 0; 
let cameraX = 0;

let playerSpeed = 4;
let stoppedTime = 0;

const baseHoleSize = 400;
const maxDrawLength = baseHoleSize * 1.5; 

const cooldownDuration = 500; 
let lastReleaseTime = 0;      

// --- 滞空時間（地面や線に触れていないフレーム数）のカウント用 ---
let airborneFrames = 0;
let isTouchingGroundOrLine = false;

// --- 通常エリアでの上部滞空時間（フレーム数）のカウント用 ---
let upperZoneFrames = 0;

// ===== ギミック共通（同時発動防止） =====
// null のときだけ新しいギミックを開始できる
let activeGimmick = null; // null | "laser" | （今後追加するギミック名）

function tryStartGimmick(name) {
  if (activeGimmick !== null) return false;
  activeGimmick = name;
  return true;
}
function endGimmick(name) {
  if (activeGimmick === name) activeGimmick = null;
}

// ===== レーザーギミック（3レーン） =====
const LANE_COUNT = 3;
const LANE_H = canvas.height / LANE_COUNT; // ≈233.33
// 状態: idle → warning → active → cooldown → idle
let laserState = "idle";
let laserSafeLane = 1;          // 0:上 1:中 2:下
let laserTimer = 0;             // 現在ステートの経過フレーム
const LASER_WARNING_FRAMES = 150;  // 警告 2.5秒（早めに予告）
const LASER_ACTIVE_FRAMES = 120;   // レーザー 2秒
const LASER_COOLDOWN_MIN = 200;    // クールダウン最短 ≈3.3秒
const LASER_COOLDOWN_MAX = 320;    // クールダウン最長 ≈5.3秒
let laserCooldownTarget = 240;

function isLaserModeActive() {
  if (!currentMode || !currentConfig) return false;
  if (currentMode === "score" && score >= 400) return true;
  if (currentMode === "stage4" && score >= Math.floor(currentConfig.targetScore / 2)) return true;
  return false;
}

function startLaserWarning() {
  // 他ギミック作動中は開始しない
  if (!tryStartGimmick("laser")) return;
  laserSafeLane = Math.floor(Math.random() * LANE_COUNT);
  laserState = "warning";
  laserTimer = 0;
}

function updateLaserGimmick() {
  if (!isLaserModeActive()) {
    // 条件を外れたら強制終了してロック解放
    if (laserState !== "idle") {
      endGimmick("laser");
    }
    laserState = "idle";
    laserTimer = 0;
    return;
  }

  laserTimer++;

  if (laserState === "idle") {
    // 他ギミックが動いていなければ警告開始
    startLaserWarning();
  } else if (laserState === "warning") {
    if (laserTimer >= LASER_WARNING_FRAMES) {
      laserState = "active";
      laserTimer = 0;
    }
  } else if (laserState === "active") {
    // プレイヤーが危険レーンにいたら死亡
    const py = player.position.y;
    const playerLane = Math.min(LANE_COUNT - 1, Math.max(0, Math.floor(py / LANE_H)));
    if (playerLane !== laserSafeLane) {
      triggerGameOver();
    }
    if (laserTimer >= LASER_ACTIVE_FRAMES) {
      laserState = "cooldown";
      laserTimer = 0;
      laserCooldownTarget = LASER_COOLDOWN_MIN + Math.floor(Math.random() * (LASER_COOLDOWN_MAX - LASER_COOLDOWN_MIN + 1));
    }
  } else if (laserState === "cooldown") {
    if (laserTimer >= laserCooldownTarget) {
      laserState = "idle";
      laserTimer = 0;
      endGimmick("laser"); // ロック解放 → 他ギミックも開始可能に
    }
  }
}

function drawLaserGimmick() {
  if (laserState !== "warning" && laserState !== "active") return;

  const now = Date.now();

  for (let i = 0; i < LANE_COUNT; i++) {
    if (i === laserSafeLane) continue; // 安全レーンは何も描かない

    const y = i * LANE_H;
    const h = LANE_H;

    if (laserState === "warning") {
      // 点滅する警告帯
      const flash = Math.sin(now / 80) > 0;
      if (flash) {
        ctx.fillStyle = "rgba(255, 40, 40, 0.25)";
        ctx.fillRect(0, y, canvas.width, h);

        // 点線ボーダー
        ctx.strokeStyle = "rgba(255, 80, 80, 0.9)";
        ctx.lineWidth = 3;
        ctx.setLineDash([12, 8]);
        ctx.strokeRect(2, y + 2, canvas.width - 4, h - 4);
        ctx.setLineDash([]);
      }

      // 警告テキスト
      ctx.save();
      ctx.font = "bold 22px 'Helvetica Neue', Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = flash ? "#ff2244" : "#ffaaaa";
      ctx.shadowColor = "rgba(255,0,0,0.8)";
      ctx.shadowBlur = 12;
      ctx.fillText("⚠ LASER WARNING ⚠", canvas.width / 2, y + h / 2);
      ctx.restore();
    } else if (laserState === "active") {
      // レーザー本体
      const pulse = 0.55 + 0.25 * Math.sin(now / 40);

      // 外側のグロー
      ctx.fillStyle = `rgba(255, 20, 60, ${0.15 * pulse})`;
      ctx.fillRect(0, y, canvas.width, h);

      // 中心の強いビーム
      const beamH = 18;
      const beamY = y + h / 2 - beamH / 2;
      const grad = ctx.createLinearGradient(0, beamY, 0, beamY + beamH);
      grad.addColorStop(0, "rgba(255, 100, 150, 0)");
      grad.addColorStop(0.3, `rgba(255, 40, 80, ${0.9 * pulse})`);
      grad.addColorStop(0.5, `rgba(255, 255, 255, ${pulse})`);
      grad.addColorStop(0.7, `rgba(255, 40, 80, ${0.9 * pulse})`);
      grad.addColorStop(1, "rgba(255, 100, 150, 0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, beamY, canvas.width, beamH);

      // 上下のエッジライン
      ctx.strokeStyle = `rgba(255, 80, 120, ${0.8 * pulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, beamY);
      ctx.lineTo(canvas.width, beamY);
      ctx.moveTo(0, beamY + beamH);
      ctx.lineTo(canvas.width, beamY + beamH);
      ctx.stroke();
    }
  }

  // 安全レーンのガイド（薄い緑）
  if (laserState === "warning" || laserState === "active") {
    const sy = laserSafeLane * LANE_H;
    ctx.fillStyle = "rgba(0, 255, 120, 0.08)";
    ctx.fillRect(0, sy, canvas.width, LANE_H);
    ctx.strokeStyle = "rgba(0, 255, 120, 0.35)";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.strokeRect(1, sy + 1, canvas.width - 2, LANE_H - 2);
    ctx.setLineDash([]);
  }
}

function saveScore(newScore) {
  // スコアアタックのみランキングに保存
  if (currentMode !== "score") return;

  const now = new Date();
  const dateString = `${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  let scores = JSON.parse(localStorage.getItem('drawRunScores')) || [];
  scores.push({ score: newScore, date: dateString });
  scores.sort((a, b) => b.score - a.score);
  scores = scores.slice(0, 5); 
  localStorage.setItem('drawRunScores', JSON.stringify(scores));

  const lastRecord = { score: newScore, date: dateString };
  localStorage.setItem('drawRunLastScore', JSON.stringify(lastRecord));
}

function saveStageClear(modeKey) {
  const cleared = JSON.parse(localStorage.getItem('drawRunStageClears')) || {};
  cleared[modeKey] = true;
  localStorage.setItem('drawRunStageClears', JSON.stringify(cleared));
}

const grounds = [];
const walls = [];

let currentX = 0;
const segmentWidth = 400; 
let lastObstacleX = 0;

function resetWorldForMode() {
  // 既存の地面・壁を削除
  grounds.forEach(g => World.remove(world, g));
  walls.forEach(w => World.remove(world, w));
  grounds.length = 0;
  walls.length = 0;

  // 線もクリア
  currentLines.forEach(l => World.remove(world, l));
  currentLines.length = 0;

  // プレイヤー位置リセット
  Body.setPosition(player, { x: 200, y: canvas.height / 2 });
  Body.setVelocity(player, { x: 0, y: 0 });

  currentX = 0;
  lastObstacleX = 0;
  cameraX = 0;
  score = 0;
  stoppedTime = 0;
  airborneFrames = 0;
  upperZoneFrames = 0;
  isTouchingGroundOrLine = false;
  gameOver = false;
  gameCleared = false;
  drawing = false;
  lastPoint = null;
  currentDrawLength = 0;
  lastReleaseTime = 0;

  // レーザーギミックもリセット
  laserState = "idle";
  laserTimer = 0;
  laserSafeLane = 1;
  activeGimmick = null;

  // タイムステップもリセット
  timeAccumulator = 0;
  lastFrameTime = performance.now();

  // 初期セグメント生成
  for (let i = 0; i < 15; i++) {
    generateSegment();
  }
}

function generateSegment() {
  if (!currentConfig) return;

  const currentGroundY = canvas.height - 40;
  const groundHeight = 80;
  const cfg = currentConfig;

  // ステージモードで既に目標距離を超える分は生成しない（余裕を持って少し先まで）
  if (!cfg.isInfinite) {
    const targetX = (cfg.targetScore * 100) + 200 + 1200; // 少し先まで地面を敷く
    if (currentX > targetX) {
      // 平坦な地面だけ敷き続ける
      const ground = Bodies.rectangle(
        currentX + segmentWidth / 2,
        currentGroundY,
        segmentWidth,
        groundHeight,
        { isStatic: true, label: "ground" }
      );
      grounds.push(ground);
      World.add(world, ground);
      currentX += segmentWidth;
      return;
    }
  }

  // 最初の1200pxは安全地帯
  if (currentX <= 1200) {
    const ground = Bodies.rectangle(
      currentX + segmentWidth / 2,
      currentGroundY,
      segmentWidth,
      groundHeight,
      { isStatic: true, label: "ground" }
    );
    grounds.push(ground);
    World.add(world, ground);
    currentX += segmentWidth;
    return;
  }

  const distanceSinceLastObstacle = currentX - lastObstacleX;
  const isSafeZoneOver = distanceSinceLastObstacle >= cfg.minSafeDistance;

  if (!isSafeZoneOver) {
    const ground = Bodies.rectangle(currentX + segmentWidth / 2, currentGroundY, segmentWidth, groundHeight, { isStatic: true, label: "ground" });
    grounds.push(ground);
    World.add(world, ground);
    currentX += segmentWidth;
    return;
  }

  const rand = Math.random();

  if (rand < cfg.holeChance) {
    // 穴あきゾーン
    const maxSafeHoleSize = maxDrawLength * cfg.maxHoleWidthFactor; 
    const holeWidth = cfg.minHoleWidth + Math.random() * (maxSafeHoleSize - cfg.minHoleWidth);
    const leftWidth = 100;
    const leftGround = Bodies.rectangle(currentX + leftWidth / 2, currentGroundY, leftWidth, groundHeight, { isStatic: true, label: "ground" });
    grounds.push(leftGround);
    World.add(world, leftGround);

    currentX += leftWidth + holeWidth;
    const rightWidth = 150;
    const rightGround = Bodies.rectangle(currentX + rightWidth / 2, currentGroundY, rightWidth, groundHeight, { isStatic: true, label: "ground" });
    grounds.push(rightGround);
    World.add(world, rightGround);

    currentX += rightWidth;
    lastObstacleX = currentX;

  } else {
    // 壁ゾーン
    const ground = Bodies.rectangle(currentX + segmentWidth / 2, currentGroundY, segmentWidth, groundHeight, { isStatic: true, label: "ground" });
    grounds.push(ground);
    World.add(world, ground);

    const targetX = currentX + segmentWidth / 2;
    const randomWallHeight = cfg.wallHeightMin + Math.random() * (cfg.wallHeightMax - cfg.wallHeightMin); 
    const groundTopY = currentGroundY - (groundHeight / 2);
    const currentWallY = groundTopY - randomWallHeight / 2;

    const wall = Bodies.rectangle(targetX, currentWallY, 40, randomWallHeight, { isStatic: true, label: "wall" });
    walls.push(wall);
    World.add(world, wall);

    currentX += segmentWidth;
    lastObstacleX = currentX;
  }
}

// 初期生成はモード決定後に行うため、ここでは何もしない
// for (let i = 0; i < 15; i++) { generateSegment(); }

let drawing = false;
let lastPoint = null;
const currentLines = [];
let currentDrawLength = 0;
const maxDrawTime = 3000;
let drawStartTime = 0;

function releaseLines() {
  if (!drawing) return;
  drawing = false;
  lastPoint = null;
  lastReleaseTime = Date.now();

  if (currentLines.length > 0) {
    const combinedLine = Body.create({
      parts: [...currentLines],
      isStatic: false, 
      friction: 0.8,
      restitution: 0,
      density: 0.002,
      label: "line"
    });

    currentLines.forEach((line) => {
      World.remove(world, line);
    });
    currentLines.length = 0;

    currentLines.push(combinedLine);
    World.add(world, combinedLine);

    setTimeout(() => {
      World.remove(world, combinedLine);
      const index = currentLines.indexOf(combinedLine);
      if (index !== -1) {
        currentLines.splice(index, 1);
      }
    }, 500);
  }
}

function getCanvasPoint(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY
  };
}

function startDrawing(clientX, clientY) {
  if (!gameStarted) return;
  if (gameOver || gameCleared) return;

  const timeSinceLastRelease = Date.now() - lastReleaseTime;
  if (timeSinceLastRelease < cooldownDuration) return; 

  const pt = getCanvasPoint(clientX, clientY);

  drawing = true;
  currentDrawLength = 0;
  drawStartTime = Date.now();
  lastPoint = { x: pt.x + cameraX, y: pt.y };
}

function moveDrawing(clientX, clientY) {
  if (!drawing) return;

  const elapsedTime = Date.now() - drawStartTime;
  if (elapsedTime >= maxDrawTime) {
    releaseLines();
    return;
  }

  const pt = getCanvasPoint(clientX, clientY);
  const currentPoint = { x: pt.x + cameraX, y: pt.y };
  const dx = currentPoint.x - lastPoint.x;
  const dy = currentPoint.y - lastPoint.y;
  const length = Math.sqrt(dx * dx + dy * dy);

  if (currentDrawLength + length > maxDrawLength) return;

  currentDrawLength += length;
  const angle = Math.atan2(dy, dx);

  const line = Bodies.rectangle(
    (lastPoint.x + currentPoint.x) / 2,
    (lastPoint.y + currentPoint.y) / 2,
    length,
    14, 
    { isStatic: true, angle: angle, friction: 0.8, density: 0.002, label: "line" }
  );

  currentLines.push(line);
  World.add(world, line);
  lastPoint = currentPoint;
}

function handleScreenClick(clientX, clientY) {
  const pt = getCanvasPoint(clientX, clientY);

  if (gameOver || gameCleared) {
    const btnX = canvas.width / 2 - 110;
    const btnY = canvas.height / 2 + 70;
    const btnW = 220;
    const btnH = 50;

    if (pt.x >= btnX && pt.x <= btnX + btnW && pt.y >= btnY && pt.y <= btnY + btnH) {
      playBGM.pause(); 
      location.reload(); 
    }
  }
  return false;
}

canvas.addEventListener("mousedown", (e) => {
  if (handleScreenClick(e.clientX, e.clientY)) return;
  if (gameOver || gameCleared) return;
  startDrawing(e.clientX, e.clientY);
});
canvas.addEventListener("mousemove", (e) => moveDrawing(e.clientX, e.clientY));
canvas.addEventListener("mouseup", () => releaseLines());

canvas.addEventListener("touchstart", (e) => {
  e.preventDefault();
  const touch = e.touches[0];
  if (handleScreenClick(touch.clientX, touch.clientY)) return;
  if (gameOver || gameCleared) return;
  startDrawing(touch.clientX, touch.clientY);
}, { passive: false });

canvas.addEventListener("touchmove", (e) => {
  e.preventDefault();
  const touch = e.touches[0];
  moveDrawing(touch.clientX, touch.clientY);
});
canvas.addEventListener("touchend", (e) => {
  e.preventDefault();
  releaseLines();
});

// --- 衝突判定 ---
Matter.Events.on(engine, "collisionStart", (event) => {
  event.pairs.forEach((pair) => {
    const isLineA = pair.bodyA.label === "line";
    const isLineB = pair.bodyB.label === "line";
    const isStaticEnvA = pair.bodyA.label === "ground" || pair.bodyA.label === "wall";
    const isStaticEnvB = pair.bodyB.label === "ground" || pair.bodyB.label === "wall";

    if ((isLineA && isStaticEnvB) || (isLineB && isStaticEnvA)) {
      pair.isActive = false;
      return;
    }

    walls.forEach((wall) => {
      if ((pair.bodyA === player && pair.bodyB === wall) || (pair.bodyB === player && pair.bodyA === wall)) {
        if (!gameOver && !gameCleared) triggerGameOver();
      }
    });
  });
});

Matter.Events.on(engine, "collisionActive", (event) => {
  let touchingSurface = false;

  event.pairs.forEach((pair) => {
    if (pair.isActive) {
      const isPlayerA = pair.bodyA === player;
      const isPlayerB = pair.bodyB === player;

      if (isPlayerA || isPlayerB) {
        const other = isPlayerA ? pair.bodyB : pair.bodyA;
        const otherLabel = other.label;
        const otherParentLabel = other.parent ? other.parent.label : "";

        if (
          otherLabel === "ground" || 
          otherLabel === "line" || 
          otherParentLabel === "line"
        ) {
          touchingSurface = true;
        }
      }
    }
  });

  isTouchingGroundOrLine = touchingSurface;
});

function triggerGameOver() {
  if (gameOver || gameCleared) return;
  // デバッグ無敵中はゲームオーバーにしない
  if (window.DRAW_RUN && window.DRAW_RUN.invincible) return;
  gameOver = true;
  saveScore(score);

  playBGM.pause();
  deathSound.currentTime = 0;
  deathSound.play().catch(e => console.log("デス音の再生がブロックされました", e));
}

function triggerGameClear() {
  if (gameOver || gameCleared) return;
  gameCleared = true;

  if (currentMode && currentMode.startsWith("stage")) {
    saveStageClear(currentMode);
  }

  playBGM.pause();
}

function drawBody(body, color) {
  ctx.save();
  ctx.translate(body.position.x - cameraX, body.position.y);

  if (body !== player && !body.isSensor) {
    ctx.rotate(body.angle);
  }

  if (body.circleRadius) {
    if (body === player) {
      const size = 50;
      const currentSkinImg = playerImages[currentSkinIndex];
      
      if (currentSkinImg && currentSkinImg.naturalWidth > 0) {
        const imgWidth = currentSkinImg.width;
        const imgHeight = currentSkinImg.height;
        const drawHeight = size * (imgHeight / imgWidth);

        ctx.save();
        ctx.shadowColor = "#ffffff";
        ctx.shadowBlur = 6;
        ctx.drawImage(
          currentSkinImg,
          -size / 2,
          -drawHeight / 2,
          size,
          drawHeight
        );
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, body.circleRadius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, body.circleRadius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  } else {
    if (body.parts && body.parts.length > 1) {
      for (let i = 1; i < body.parts.length; i++) {
        const part = body.parts[i];
        ctx.save();
        ctx.translate(part.position.x - body.position.x, part.position.y - body.position.y);
        ctx.rotate(part.angle - body.angle);

        const pWidth = part.bounds.max.x - part.bounds.min.x;
        const pHeight = part.bounds.max.y - part.bounds.min.y;

        ctx.fillStyle = color;
        ctx.fillRect(-pWidth / 2, -pHeight / 2, pWidth, pHeight);

        ctx.restore();
      }
    } else {
      const width = body.bounds.max.x - body.bounds.min.x;
      const height = body.bounds.max.y - body.bounds.min.y;

      if (grounds.includes(body)) {
        ctx.drawImage(groundImage, -width / 2, -height / 2, width, height);
      } else {
        ctx.fillStyle = color; 
        ctx.fillRect(-width / 2, -height / 2, width, height);
      }
    }
  }
  ctx.restore();
}

function getActiveBackground() {
  if (!currentConfig) return bgAozora;

  if (currentConfig.bgFixed) {
    switch (currentConfig.bgFixed) {
      case "aozora":  return bgAozora;
      case "yuugure": return bgYuugure;
      case "yozora":  return bgYozora;
      case "cyber":   return bgCyber;
      default:        return bgAozora;
    }
  }

  // スコアアタック：スコア連動
  if (score >= 300) return bgCyber;
  if (score >= 200) return bgYozora;
  if (score >= 100) return bgYuugure;
  return bgAozora;
}

// ===== 固定タイムステップ（機種ごとのFPS差を吸収） =====
const FIXED_DT_MS = 1000 / 60;   // 1ステップ = 1/60秒
const FIXED_DT_SEC = 1 / 60;
const MAX_FRAME_MS = 80;         // ラグ時の追いつき暴走を防止
let lastFrameTime = performance.now();
let timeAccumulator = 0;

/** 1/60秒ぶんのゲーム更新（物理・タイマー・ギミック） */
function fixedUpdate() {
  if (gameOver || gameCleared) return;

  const baseGrav = normalGravityY;
  const cfg = currentConfig;

  // プレイヤーを一定速度で前進
  playerSpeed = cfg.baseSpeed;
  Body.setVelocity(player, { x: playerSpeed, y: player.velocity.y });

  // 画面の上半分に長くいるとゲームオーバー（300フレーム = 5秒）
  if (player.position.y < canvas.height / 2) {
    upperZoneFrames++;
    if (upperZoneFrames >= 300) {
      triggerGameOver();
    }
  } else {
    upperZoneFrames = 0;
  }

  // 滞空重力増加システム
  if (isTouchingGroundOrLine) {
    airborneFrames = 0;
  } else {
    airborneFrames++;
  }

  if (airborneFrames > cfg.airborneGravityStart) {
    const extraWeight = Math.min(airborneFrames - cfg.airborneGravityStart, 100) * cfg.gravityIncrease;
    engine.world.gravity.y = baseGrav + extraWeight;
  } else {
    engine.world.gravity.y = baseGrav;
  }

  // レーザーギミック更新
  updateLaserGimmick();

  // 物理1ステップ
  Engine.update(engine, FIXED_DT_MS);

  Body.setAngle(player, 0);

  cameraX = player.position.x - canvas.width * 0.1;
  score = Math.max(0, Math.floor((player.position.x - 200) / 100));

  // ステージクリア判定
  if (!cfg.isInfinite && score >= cfg.targetScore) {
    triggerGameClear();
  }

  if (currentX < cameraX + canvas.width + 800) {
    generateSegment();
  }

  for (let i = grounds.length - 1; i >= 0; i--) {
    if (grounds[i].position.x < cameraX - 600) {
      World.remove(world, grounds[i]);
      grounds.splice(i, 1);
    }
  }
  for (let i = walls.length - 1; i >= 0; i--) {
    if (walls[i].position.x < cameraX - 600) {
      World.remove(world, walls[i]);
      walls.splice(i, 1);
    }
  }

  if (player.position.y > canvas.height + 200) {
    triggerGameOver();
  }

  if (Math.abs(player.velocity.x) < 0.5) {
    stoppedTime += FIXED_DT_SEC;
  } else {
    stoppedTime = 0;
  }
  if (stoppedTime >= 3) {
    triggerGameOver();
  }
}

function gameLoop(now) {
  if (now == null) now = performance.now();
  let frameDelta = now - lastFrameTime;
  lastFrameTime = now;
  if (frameDelta > MAX_FRAME_MS) frameDelta = MAX_FRAME_MS;
  if (frameDelta < 0) frameDelta = 0;

  if (gameStarted) {
    if (!gameOver && !gameCleared) {
      timeAccumulator += frameDelta;
      // 固定ステップで追いつくまで更新（FPSに依存しない）
      while (timeAccumulator >= FIXED_DT_MS) {
        fixedUpdate();
        timeAccumulator -= FIXED_DT_MS;
      }
    } else {
      // ゲームオーバー／クリア後も角度だけリセット
      Body.setAngle(player, 0);
    }
  }

  if (drawing) {
    const elapsedTime = Date.now() - drawStartTime;
    if (elapsedTime >= maxDrawTime) releaseLines();
  }

  if (!gameStarted) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    requestAnimationFrame(gameLoop);
    return;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 背景描画
  const activeBg = getActiveBackground();
  if (gameStarted && activeBg.complete && activeBg.width > 0) {
    const bgSpeed = 0.3;
    const bgHeight = canvas.height;
    const bgWidth = activeBg.width * (canvas.height / activeBg.height);
    let bgX = -((cameraX * bgSpeed) % bgWidth);
    if (bgX > 0) bgX -= bgWidth;

    ctx.drawImage(activeBg, bgX, 0, bgWidth, bgHeight);
    ctx.drawImage(activeBg, bgX + bgWidth - 1, 0, bgWidth, bgHeight);
    ctx.drawImage(activeBg, bgX + bgWidth * 2 - 2, 0, bgWidth, bgHeight);
  } else if (gameStarted) {
    ctx.fillStyle = "#87CEEB";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  grounds.forEach((ground) => { drawBody(ground, "black"); });
  walls.forEach((wall) => { drawBody(wall, "gray"); });

  world.bodies.forEach((body) => {
    if (body !== player && !grounds.includes(body) && !walls.includes(body)) {
      drawBody(body, "black");
    }
  });

  drawBody(player, "red");

  // レーザーギミック描画（プレイヤーの上に重ねる）
  if (!gameOver && !gameCleared) {
    drawLaserGimmick();
  }

  // ===== GAME OVER / CLEAR 画面 =====
  if (gameOver || gameCleared) {
    ctx.save();

    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.font = "bold 48px 'Helvetica Neue', Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    if (gameCleared) {
      ctx.shadowColor = "rgba(0, 255, 150, 0.8)";
      ctx.shadowBlur = 20;
      const gradient = ctx.createLinearGradient(
        canvas.width / 2, canvas.height / 2 - 60,
        canvas.width / 2, canvas.height / 2 + 20
      );
      gradient.addColorStop(0, "#33ff99");
      gradient.addColorStop(1, "#00aa55");
      ctx.fillStyle = gradient;
      ctx.fillText("STAGE CLEAR!", canvas.width / 2, canvas.height / 2 - 40);

      ctx.shadowBlur = 0;
      ctx.font = "bold 20px 'Helvetica Neue', Arial, sans-serif";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(`${currentConfig.name}`, canvas.width / 2, canvas.height / 2 + 10);
      ctx.fillText(`SCORE : ${score}m`, canvas.width / 2, canvas.height / 2 + 40);
    } else {
      ctx.shadowColor = "rgba(255, 0, 0, 0.8)";
      ctx.shadowBlur = 20;
      const gradient = ctx.createLinearGradient(
        canvas.width / 2, canvas.height / 2 - 60,
        canvas.width / 2, canvas.height / 2 + 20
      );
      gradient.addColorStop(0, "#ff3333");
      gradient.addColorStop(1, "#990000");
      ctx.fillStyle = gradient;
      ctx.fillText("GAME OVER", canvas.width / 2, canvas.height / 2 - 30);

      ctx.shadowBlur = 0;
      ctx.font = "bold 22px 'Helvetica Neue', Arial, sans-serif";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(`SCORE : ${score}m`, canvas.width / 2, canvas.height / 2 + 25);
    }

    const btnX = canvas.width / 2 - 110;
    const btnY = canvas.height / 2 + 70;
    const btnW = 220;
    const btnH = 50;

    ctx.fillStyle = "#222222";
    ctx.fillRect(btnX, btnY, btnW, btnH);
    ctx.strokeStyle = gameCleared ? "#33ff99" : "#ff3333";
    ctx.lineWidth = 2;
    ctx.strokeRect(btnX, btnY, btnW, btnH);

    ctx.font = "bold 18px 'Helvetica Neue', Arial, sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.fillText("タイトルに戻る", canvas.width / 2, btnY + btnH / 2);

    ctx.restore();
    ctx.textAlign = "left";
  }

  // ===== HUD =====
  ctx.save();

  // スコア表示
  ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(20, 20, 160, 45, 8);
  ctx.fill();
  ctx.stroke();

  ctx.font = "bold 22px 'Helvetica Neue', Arial, sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
  ctx.shadowBlur = 4;
  ctx.fillText(`${score} m`, 35, 50);

  // ステージの場合は目標距離も表示
  if (currentConfig && !currentConfig.isInfinite) {
    ctx.font = "bold 13px 'Helvetica Neue', Arial, sans-serif";
    ctx.fillStyle = "#aaaaaa";
    ctx.fillText(`/ ${currentConfig.targetScore}m`, 110, 50);
  }

  // インクゲージ
  const gaugeX = 200;
  const gaugeY = 20;
  const gaugeW = 180;
  const gaugeH = 45;

  ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
  ctx.beginPath();
  ctx.roundRect(gaugeX, gaugeY, gaugeW, gaugeH, 8);
  ctx.fill();
  ctx.stroke();

  const timeSinceLastRelease = Date.now() - lastReleaseTime;
  let chargeRatio = Math.min(1, timeSinceLastRelease / cooldownDuration);

  if (chargeRatio < 1) {
    ctx.fillStyle = "rgba(255, 50, 50, 0.5)";
    ctx.beginPath();
    ctx.roundRect(gaugeX + 6, gaugeY + 6, (gaugeW - 12) * chargeRatio, gaugeH - 12, 5);
    ctx.fill();

    ctx.font = "bold 13px 'Helvetica Neue', Arial, sans-serif";
    ctx.fillStyle = "#ff8888";
    ctx.textAlign = "center";
    ctx.fillText(`RECHARGING...`, gaugeX + gaugeW / 2, gaugeY + 28);
  } else {
    ctx.fillStyle = "rgba(50, 220, 100, 0.6)";
    ctx.beginPath();
    ctx.roundRect(gaugeX + 6, gaugeY + 6, gaugeW - 12, gaugeH - 12, 5);
    ctx.fill();

    ctx.font = "bold 14px 'Helvetica Neue', Arial, sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.fillText("INK READY", gaugeX + gaugeW / 2, gaugeY + 28);
  }

  // モード名表示（左下）
  if (currentConfig) {
    ctx.textAlign = "left";
    ctx.font = "bold 14px 'Helvetica Neue', Arial, sans-serif";
    ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
    ctx.shadowBlur = 0;
    ctx.fillText(currentConfig.name, 20, canvas.height - 20);
  }

  ctx.restore();

  requestAnimationFrame(gameLoop);
}

// ===== モード選択・スタート処理 =====
window.addEventListener("DOMContentLoaded", () => {
  const startBtn = document.getElementById("start-button");
  const startScreen = document.getElementById("start-screen");
  const modeSelectScreen = document.getElementById("mode-select-screen");
  const countdownDisplay = document.getElementById("countdown-display");
  const modeBackBtn = document.getElementById("mode-back-btn");
  const modeButtons = document.querySelectorAll(".mode-btn");

  // STARTボタン → モード選択画面を表示
  if (startBtn) {
    startBtn.addEventListener("click", () => {
      startBtn.style.display = "none";
      const otherBtns = startScreen.querySelectorAll("a");
      otherBtns.forEach(btn => btn.style.display = "none");

      if (startScreen) {
        startScreen.classList.add("hidden");
      }

      // モード選択画面を表示
      if (modeSelectScreen) {
        modeSelectScreen.classList.add("visible");
      }
    });
  }

  // 戻るボタン
  if (modeBackBtn) {
    modeBackBtn.addEventListener("click", () => {
      modeSelectScreen.classList.remove("visible");
      startScreen.classList.remove("hidden");
      startBtn.style.display = "block";
      const otherBtns = startScreen.querySelectorAll("a");
      otherBtns.forEach(btn => btn.style.display = "block");
    });
  }

  // 各モードボタン
  modeButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const modeKey = btn.dataset.mode;
      if (!MODE_CONFIG[modeKey]) return;

      currentMode = modeKey;
      currentConfig = MODE_CONFIG[modeKey];

      // モード選択画面を隠す
      modeSelectScreen.classList.remove("visible");

      // ワールドをリセットしてモード用に生成
      resetWorldForMode();

      // カウントダウン開始
      if (countdownDisplay) {
        countdownDisplay.style.display = "block";
        
        let count = 3;
        countdownDisplay.textContent = count;

        const timer = setInterval(() => {
          count--;
          if (count > 0) {
            countdownDisplay.textContent = count;
          } else if (count === 0) {
            countdownDisplay.textContent = "GO!";
          } else {
            clearInterval(timer);
            countdownDisplay.style.display = "none";
            gameStarted = true; 

            playBGM.currentTime = 0;
            playBGM.play().catch(e => console.log("BGMの再生がブロックされました", e));
          }
        }, 1000);
      }
    });
  });
});

gameLoop();

// ===== デバッグ用に状態を公開（debug.js が参照する） =====
// このブロックは debug.js が無い場合は何もしないので本番に影響しません
window.DRAW_RUN = {
  invincible: false,   // debug.js が true にすると無敵になる
  get engine() { return engine; },
  get world() { return world; },
  get player() { return player; },
  get canvas() { return canvas; },
  get ctx() { return ctx; },
  get score() { return score; },
  get cameraX() { return cameraX; },
  get gameStarted() { return gameStarted; },
  get gameOver() { return gameOver; },
  get gameCleared() { return gameCleared; },
  get currentMode() { return currentMode; },
  get currentConfig() { return currentConfig; },
  get playerSpeed() { return playerSpeed; },
  get airborneFrames() { return airborneFrames; },
  get upperZoneFrames() { return upperZoneFrames; },
  get isTouchingGroundOrLine() { return isTouchingGroundOrLine; },
  get drawing() { return drawing; },
  get grounds() { return grounds; },
  get walls() { return walls; },
  get currentLines() { return currentLines; },
  get gravityY() { return engine.world.gravity.y; },
  triggerGameOver,
  triggerGameClear,
  MODE_CONFIG,
  /** 指定したワールドX座標へプレイヤーをワープさせる */
  warpTo(worldX, worldY) {
    if (!player) return;
    const y = (worldY != null) ? worldY : player.position.y;
    Body.setPosition(player, { x: worldX, y: y });
    Body.setVelocity(player, { x: playerSpeed || 4, y: 0 });
    // カメラも追従
    cameraX = player.position.x - canvas.width * 0.1;
    // 先の地形を生成しておく
    while (currentX < cameraX + canvas.width + 800) {
      generateSegment();
    }
  }
};

(() => {
  const leaderboardKey = "tower_house_leaderboard_v1";
  const canvas = document.querySelector("#gameCanvas");
  const ctx = canvas.getContext("2d");

  const startScreen = document.querySelector("#startScreen");
  const endScreen = document.querySelector("#endScreen");
  const hud = document.querySelector("#hud");
  const playerNameInput = document.querySelector("#playerName");
  const startButton = document.querySelector("#startButton");
  const retryButton = document.querySelector("#retryButton");
  const homeButton = document.querySelector("#homeButton");
  const clearScoresButton = document.querySelector("#clearScoresButton");
  const leaderboardList = document.querySelector("#leaderboardList");
  const hudName = document.querySelector("#hudName");
  const hudHeight = document.querySelector("#hudHeight");
  const hudTime = document.querySelector("#hudTime");
  const resultText = document.querySelector("#resultText");
  const rankText = document.querySelector("#rankText");

  const MatterEngine = Matter.Engine;
  const MatterWorld = Matter.World;
  const MatterBodies = Matter.Bodies;
  const MatterBody = Matter.Body;
  const MatterEvents = Matter.Events;

  const game = {
    state: "menu",
    playerName: "玩家",
    engine: null,
    runnerLastTime: 0,
    bodies: [],
    fallingHouse: null,
    anchorHouse: null,
    swingPhase: 0,
    swingDirection: 1,
    towerHeight: 0,
    timer: 10,
    cameraY: 0,
    targetCameraY: 0,
    width: 0,
    height: 0,
    groundY: 0,
    lastFrame: 0,
    settleFrames: 0,
    dropSpeed: 0,
    gameOverReason: "",
  };

  const colors = [
    ["#f4d35e", "#ee964b", "#3d5a80"],
    ["#8ecae6", "#219ebc", "#023047"],
    ["#f7a072", "#e76f51", "#264653"],
    ["#b8e986", "#6a994e", "#31572c"],
    ["#f2bac9", "#b23a48", "#5f0f40"],
    ["#cdb4db", "#7b2cbf", "#240046"],
  ];

  const minimumLandingOverlapRatio = 0.2;

  function resizeCanvas() {
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
    game.width = window.innerWidth;
    game.height = window.innerHeight;
    canvas.width = Math.floor(game.width * dpr);
    canvas.height = Math.floor(game.height * dpr);
    canvas.style.width = `${game.width}px`;
    canvas.style.height = `${game.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    game.groundY = game.height - 84;

    if (game.engine) {
      const ground = game.bodies.find((body) => body.label === "ground");
      if (ground) {
        MatterBody.setPosition(ground, { x: game.width / 2, y: game.groundY + 36 });
      }
    }
  }

  function loadScores() {
    try {
      const scores = JSON.parse(localStorage.getItem(leaderboardKey) || "[]");
      return Array.isArray(scores) ? scores : [];
    } catch {
      return [];
    }
  }

  function saveScores(scores) {
    localStorage.setItem(leaderboardKey, JSON.stringify(scores.slice(0, 10)));
  }

  function addScore(name, height) {
    const before = loadScores();
    const record = { name, height, date: new Date().toISOString() };
    const sorted = [...before, record].sort((a, b) => {
      if (b.height !== a.height) return b.height - a.height;
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });
    const top = sorted.slice(0, 10);
    saveScores(top);
    return top.indexOf(record) >= 0 ? top.indexOf(record) + 1 : 0;
  }

  function renderLeaderboard() {
    const scores = loadScores();
    leaderboardList.innerHTML = "";

    if (!scores.length) {
      const empty = document.createElement("li");
      empty.className = "empty-score";
      empty.textContent = "還沒有紀錄，第一座高塔等你來蓋。";
      leaderboardList.appendChild(empty);
      return;
    }

    scores.forEach((score) => {
      const li = document.createElement("li");
      const date = new Date(score.date);
      li.innerHTML = `
        <span class="score-row">
          <span>${escapeHtml(score.name || "玩家")}</span>
          <span>${Number(score.height) || 0} 層</span>
        </span>
        <span class="score-date">${date.toLocaleDateString("zh-TW")}</span>
      `;
      leaderboardList.appendChild(li);
    });
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function layerTime(height) {
    return Math.max(4, 10 - Math.floor(height / 3));
  }

  function getHouseSize() {
    const width = Math.max(78, Math.min(118, game.width * 0.18));
    return { width, height: width * 0.72 };
  }

  function startGame() {
    game.playerName = playerNameInput.value.trim() || "玩家";
    game.state = "playing";
    game.towerHeight = 0;
    game.timer = layerTime(0);
    game.cameraY = 0;
    game.targetCameraY = 0;
    game.swingPhase = 0;
    game.swingDirection = Math.random() > 0.5 ? 1 : -1;
    game.settleFrames = 0;
    game.gameOverReason = "";

    startScreen.classList.remove("active");
    endScreen.classList.remove("active");
    hud.classList.add("active");
    hudName.textContent = game.playerName;

    setupPhysics();
    createBase();
    spawnSwingingHouse();
    updateHud();
  }

  function setupPhysics() {
    game.engine = MatterEngine.create();
    game.engine.gravity.y = 1.05;
    game.bodies = [];
    game.fallingHouse = null;
    game.anchorHouse = null;

    const ground = MatterBodies.rectangle(game.width / 2, game.groundY + 36, game.width * 1.7, 72, {
      isStatic: true,
      label: "ground",
      friction: 0.9,
      restitution: 0.02,
    });
    game.bodies.push(ground);
    MatterWorld.add(game.engine.world, ground);

    MatterEvents.on(game.engine, "collisionStart", (event) => {
      for (const pair of event.pairs) {
        if (game.fallingHouse && (pair.bodyA === game.fallingHouse || pair.bodyB === game.fallingHouse)) {
          game.fallingHouse.hasTouched = true;
        }
      }
    });
  }

  function createBase() {
    const size = getHouseSize();
    const base = MatterBodies.rectangle(game.width / 2, game.groundY - size.height / 2, size.width, size.height, {
      isStatic: true,
      label: "house",
      friction: 0.95,
      restitution: 0,
      density: 0.004,
    });
    base.renderColorIndex = 0;
    game.anchorHouse = base;
    game.bodies.push(base);
    MatterWorld.add(game.engine.world, base);
  }

  function spawnSwingingHouse() {
    const size = getHouseSize();
    const y = game.anchorHouse.position.y - size.height - 178;
    const x = game.width / 2;
    const house = MatterBodies.rectangle(x, y, size.width, size.height, {
      isStatic: true,
      label: "house",
      friction: 1,
      frictionStatic: 1,
      frictionAir: 0.035,
      restitution: 0,
      density: 0.01,
    });
    house.renderColorIndex = game.towerHeight + 1;
    house.hasTouched = false;
    house.wasDropped = false;
    house.isDropping = false;
    game.fallingHouse = house;
    game.settleFrames = 0;
    game.timer = layerTime(game.towerHeight);
    game.bodies.push(house);
    MatterWorld.add(game.engine.world, house);
  }

  function dropHouse() {
    if (game.state !== "playing" || !game.fallingHouse || game.fallingHouse.wasDropped) return;
    const house = game.fallingHouse;
    house.wasDropped = true;
    house.isDropping = true;
    game.dropSpeed = Math.max(520, game.height * 0.72);
    MatterBody.setVelocity(house, { x: 0, y: 0 });
    MatterBody.setAngularVelocity(house, 0);
    MatterBody.setAngle(house, 0);
  }

  function updateGame(timestamp) {
    if (!game.lastFrame) game.lastFrame = timestamp;
    const delta = Math.min(40, timestamp - game.lastFrame);
    game.lastFrame = timestamp;

    drawScene();

    if (game.state === "playing" && game.engine) {
      stepPlaying(delta);
    }

    requestAnimationFrame(updateGame);
  }

  function stepPlaying(delta) {
    const seconds = delta / 1000;
    MatterEngine.update(game.engine, delta);
    game.cameraY += (game.targetCameraY - game.cameraY) * 0.08;

    if (game.fallingHouse && !game.fallingHouse.wasDropped) {
      game.timer -= seconds;
      updateSwingingHouse(seconds);
      if (game.timer <= 0) {
        endGame("時間到，房子還沒落下。");
        return;
      }
    }

    if (game.fallingHouse?.wasDropped) {
      updateDroppedHouse(seconds);
    }

    if (towerLooksBroken()) {
      endGame("塔身傾斜太多，倒塌了。");
      return;
    }

    updateHud();
  }

  function updateSwingingHouse(seconds) {
    const house = game.fallingHouse;
    const amplitude = Math.max(78, Math.min(180, game.width * 0.24));
    const speed = Math.min(10, 1.35 + game.towerHeight * 0.11625);
    game.swingPhase += seconds * speed * game.swingDirection;
    const x = game.width / 2 + Math.sin(game.swingPhase) * amplitude;
    const y = game.anchorHouse.position.y - getHouseSize().height - 178;
    MatterBody.setPosition(house, { x, y });
    MatterBody.setAngle(house, 0);
  }

  function evaluateFallingHouse() {
    const house = game.fallingHouse;
    if (!house) return;

    if (house.position.y + game.cameraY > game.height + 160 || Math.abs(house.position.x - game.width / 2) > game.width * 0.72) {
      endGame("房子掉出塔外。");
      return;
    }

    if (!house.hasTouched) return;

    const velocity = Math.hypot(house.velocity.x, house.velocity.y);
    const angular = Math.abs(house.angularVelocity);
    const overlap = horizontalOverlap(house, game.anchorHouse);
    const size = getHouseSize();

    if (velocity < 0.22 && angular < 0.018) {
      if (overlap < size.width * minimumLandingOverlapRatio || Math.abs(house.angle) > 0.38) {
        endGame("落點偏太多，沒有穩穩疊上。");
        return;
      }
      game.settleFrames += 1;
    } else {
      game.settleFrames = 0;
    }

    if (game.settleFrames > 24) {
      lockSuccessfulHouse(house);
    }
  }

  function updateDroppedHouse(seconds) {
    const house = game.fallingHouse;
    if (!house) return;

    const size = getHouseSize();
    const targetY = game.anchorHouse.position.y - size.height;
    const nextY = house.position.y + game.dropSpeed * seconds;
    MatterBody.setPosition(house, { x: house.position.x, y: Math.min(nextY, targetY) });
    MatterBody.setAngle(house, 0);
    MatterBody.setVelocity(house, { x: 0, y: 0 });
    MatterBody.setAngularVelocity(house, 0);

    if (house.position.y + game.cameraY > game.height + 160) {
      endGame("房子掉出塔外。");
      return;
    }

    if (house.position.y < targetY) return;

    const overlap = horizontalOverlap(house, game.anchorHouse);
    if (overlap < size.width * minimumLandingOverlapRatio) {
      endGame("落點偏太多，沒有穩穩疊上。");
      return;
    }

    lockSuccessfulHouse(house);
  }

  function horizontalOverlap(a, b) {
    const size = getHouseSize();
    const leftA = a.position.x - size.width / 2;
    const rightA = a.position.x + size.width / 2;
    const leftB = b.position.x - size.width / 2;
    const rightB = b.position.x + size.width / 2;
    return Math.max(0, Math.min(rightA, rightB) - Math.max(leftA, leftB));
  }

  function lockSuccessfulHouse(house) {
    const size = getHouseSize();
    game.towerHeight += 1;
    MatterBody.setPosition(house, {
      x: house.position.x,
      y: game.anchorHouse.position.y - size.height,
    });
    MatterBody.setAngle(house, 0);
    MatterBody.setVelocity(house, { x: 0, y: 0 });
    MatterBody.setAngularVelocity(house, 0);
    MatterBody.setStatic(house, true);
    game.anchorHouse = house;
    game.fallingHouse = null;
    game.targetCameraY = Math.max(0, game.height * 0.46 - house.position.y);

    for (const body of game.bodies) {
      if (body.label === "house") {
        MatterBody.setVelocity(body, { x: 0, y: 0 });
        MatterBody.setAngularVelocity(body, 0);
      }
    }

    window.setTimeout(() => {
      if (game.state === "playing") spawnSwingingHouse();
    }, 260);
  }

  function towerLooksBroken() {
    if (game.towerHeight < 2) return false;
    const houses = game.bodies.filter((body) => body.label === "house" && body.wasDropped === true);
    return houses.some((body) => Math.abs(body.angle) > 0.8 || Math.abs(body.position.x - game.width / 2) > game.width * 0.42);
  }

  function endGame(reason) {
    if (game.state !== "playing") return;
    game.state = "ended";
    game.gameOverReason = reason;
    hud.classList.remove("active");

    const rank = addScore(game.playerName, game.towerHeight);
    renderLeaderboard();
    resultText.textContent = `${game.playerName} 蓋到 ${game.towerHeight} 層`;
    rankText.textContent = rank ? `進入排行榜第 ${rank} 名。${reason}` : `沒有進入前 10 名。${reason}`;
    endScreen.classList.add("active");
  }

  function updateHud() {
    hudHeight.textContent = String(game.towerHeight);
    hudTime.textContent = Math.max(0, game.timer).toFixed(1);
  }

  function drawScene() {
    drawBackground();

    if (!game.engine) {
      drawPreviewTower();
      return;
    }

    ctx.save();
    ctx.translate(0, game.cameraY);
    for (const body of game.bodies) {
      if (body.label === "ground") drawGround(body);
      if (body.label === "house") drawHouse(body);
    }
    ctx.restore();

    if (game.state === "playing" && game.fallingHouse && !game.fallingHouse.wasDropped) {
      drawRope(game.fallingHouse);
    }
  }

  function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, game.height);
    sky.addColorStop(0, "#bfe4f2");
    sky.addColorStop(0.62, "#eaf7f7");
    sky.addColorStop(1, "#d4ece5");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, game.width, game.height);

    ctx.fillStyle = "rgba(255,255,255,0.72)";
    drawCloud(game.width * 0.2, game.height * 0.16, 42);
    drawCloud(game.width * 0.78, game.height * 0.24, 34);

    ctx.fillStyle = "rgba(63, 100, 112, 0.16)";
    for (let i = 0; i < 9; i++) {
      const w = 48 + (i % 3) * 18;
      const h = 92 + (i % 4) * 28;
      const x = i * (game.width / 8) - 16;
      ctx.fillRect(x, game.height - h, w, h);
    }
  }

  function drawCloud(x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.arc(x + r * 0.78, y + r * 0.08, r * 0.72, 0, Math.PI * 2);
    ctx.arc(x - r * 0.72, y + r * 0.16, r * 0.58, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawGround(body) {
    ctx.fillStyle = "#6a994e";
    ctx.fillRect(-game.width * 0.2, body.position.y - 36, game.width * 1.4, 72);
    ctx.fillStyle = "#386641";
    ctx.fillRect(-game.width * 0.2, body.position.y - 36, game.width * 1.4, 9);
  }

  function drawPreviewTower() {
    const size = getHouseSize();
    for (let i = 0; i < 4; i++) {
      drawHouseShape(game.width / 2 + (i % 2 ? 8 : -8), game.groundY - size.height / 2 - i * size.height, 0, i);
    }
  }

  function drawHouse(body) {
    drawHouseShape(body.position.x, body.position.y, body.angle, body.renderColorIndex || 0);
  }

  function drawHouseShape(x, y, angle, colorIndex) {
    const size = getHouseSize();
    const palette = colors[colorIndex % colors.length];
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    ctx.fillStyle = "rgba(36,48,64,0.16)";
    ctx.fillRect(-size.width / 2 + 6, size.height / 2 - 4, size.width, 8);

    ctx.fillStyle = palette[0];
    roundRect(-size.width / 2, -size.height / 2, size.width, size.height, 3);
    ctx.fill();
    ctx.strokeStyle = "rgba(36,48,64,0.22)";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = palette[1];
    ctx.fillRect(-size.width / 2, -size.height / 2, size.width, size.height * 0.18);

    ctx.fillStyle = palette[2];
    const windowSize = size.width * 0.17;
    const gap = size.width * 0.11;
    const startX = -windowSize - gap / 2;
    ctx.fillRect(startX, -size.height * 0.18, windowSize, windowSize);
    ctx.fillRect(gap / 2, -size.height * 0.18, windowSize, windowSize);
    ctx.fillRect(-windowSize / 2, size.height * 0.12, windowSize, size.height * 0.38);

    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(startX + windowSize / 2, -size.height * 0.18);
    ctx.lineTo(startX + windowSize / 2, -size.height * 0.18 + windowSize);
    ctx.moveTo(gap / 2 + windowSize / 2, -size.height * 0.18);
    ctx.lineTo(gap / 2 + windowSize / 2, -size.height * 0.18 + windowSize);
    ctx.stroke();
    ctx.restore();
  }

  function drawRope(house) {
    const screenY = house.position.y + game.cameraY;
    ctx.save();
    ctx.strokeStyle = "rgba(36,48,64,0.38)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(game.width / 2, 0);
    ctx.lineTo(house.position.x, screenY - getHouseSize().height / 2);
    ctx.stroke();
    ctx.restore();
  }

  function roundRect(x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
  }

  function showHome() {
    game.state = "menu";
    hud.classList.remove("active");
    endScreen.classList.remove("active");
    startScreen.classList.add("active");
    renderLeaderboard();
  }

  startButton.addEventListener("click", startGame);
  retryButton.addEventListener("click", startGame);
  homeButton.addEventListener("click", showHome);
  clearScoresButton.addEventListener("click", () => {
    localStorage.removeItem(leaderboardKey);
    renderLeaderboard();
  });

  canvas.addEventListener("pointerdown", dropHouse);
  window.addEventListener("keydown", (event) => {
    if (event.code === "Space") {
      event.preventDefault();
      dropHouse();
    }
    if (event.code === "Enter" && game.state === "menu") {
      startGame();
    }
  });
  window.addEventListener("resize", resizeCanvas);

  resizeCanvas();
  renderLeaderboard();
  requestAnimationFrame(updateGame);
})();

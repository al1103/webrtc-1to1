import { useEffect, useRef } from "react";

const GROUND_Y_OFFSET = 90;
const PLAYER_ANCHOR_X = 160;
const GROW_SPEED = 260; // px/sec while holding
const FALL_DURATION = 0.25; // sec for the bridge to tip from standing to flat
const WALK_SPEED = 320; // px/sec
const MAX_BRIDGE = 340;
const GRAVITY = 900;
const BEST_SCORE_KEY = "bridge-game-best";

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function makeRound(score) {
  const difficulty = Math.min(score * 3, 80);
  const gapWidth = randomRange(70 + difficulty * 0.4, 150 + difficulty);
  const platformWidth = Math.max(60, randomRange(90, 160 - difficulty * 0.3));
  return { gapWidth, platformWidth };
}

/**
 * Finger-gesture bridge-crossing game: hold ("closed" hand) grows a bridge
 * from the current platform, release ("open" hand) lets it fall flat. Landing
 * within [gapWidth, gapWidth + platformWidth] reaches the next platform;
 * short or long drops the player into the river and ends the run.
 */
export default function BridgeGame({ gestureRef }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    let width = canvas.clientWidth;
    let height = canvas.clientHeight;

    function resize() {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = width * devicePixelRatio;
      canvas.height = height * devicePixelRatio;
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    let score = 0;
    let best = Number(localStorage.getItem(BEST_SCORE_KEY) || 0);
    let round = makeRound(score);
    let state = "waiting"; // waiting | growing | falling | walking | walking-fail | falling-river | gameover
    let bridgeLength = 0;
    let bridgeAngle = 90; // degrees; 90 = standing, 0 = flat
    let playerX = PLAYER_ANCHOR_X;
    let playerY = 0; // vertical offset used only for the river-fall animation
    let fallVelocity = 0;
    let walkTargetX = 0;
    let gameOverTimer = 0;
    let prevTime = performance.now();
    let rafId = null;

    function groundY() {
      return height - GROUND_Y_OFFSET;
    }

    function resetRun() {
      score = 0;
      round = makeRound(score);
      state = "waiting";
      bridgeLength = 0;
      bridgeAngle = 90;
      playerX = PLAYER_ANCHOR_X;
      playerY = 0;
    }

    function update(dt) {
      const holding = gestureRef.current === "closed";

      if (state === "waiting") {
        if (holding) {
          state = "growing";
        }
      } else if (state === "growing") {
        bridgeLength = Math.min(MAX_BRIDGE, bridgeLength + GROW_SPEED * dt);
        if (!holding) {
          state = "falling";
          bridgeAngle = 90;
        }
      } else if (state === "falling") {
        bridgeAngle = Math.max(0, bridgeAngle - (90 / FALL_DURATION) * dt);
        if (bridgeAngle === 0) {
          const reach = bridgeLength;
          const success = reach >= round.gapWidth && reach <= round.gapWidth + round.platformWidth;
          if (success) {
            walkTargetX = PLAYER_ANCHOR_X + Math.min(reach, round.gapWidth + round.platformWidth * 0.6);
            state = "walking";
          } else {
            walkTargetX = PLAYER_ANCHOR_X + reach;
            state = "walking-fail";
          }
        }
      } else if (state === "walking" || state === "walking-fail") {
        const dir = walkTargetX >= playerX ? 1 : -1;
        playerX += dir * WALK_SPEED * dt;
        const reached = dir > 0 ? playerX >= walkTargetX : playerX <= walkTargetX;
        if (reached) {
          playerX = walkTargetX;
          if (state === "walking") {
            score += 1;
            best = Math.max(best, score);
            localStorage.setItem(BEST_SCORE_KEY, String(best));
            round = makeRound(score);
            playerX = PLAYER_ANCHOR_X;
            bridgeLength = 0;
            bridgeAngle = 90;
            state = "waiting";
          } else {
            state = "falling-river";
            fallVelocity = 0;
          }
        }
      } else if (state === "falling-river") {
        fallVelocity += GRAVITY * dt;
        playerY += fallVelocity * dt;
        if (playerY > 200) {
          state = "gameover";
          gameOverTimer = 0;
        }
      } else if (state === "gameover") {
        gameOverTimer += dt;
        if (gameOverTimer > 1.8) {
          resetRun();
        }
      }
    }

    function draw() {
      ctx.clearRect(0, 0, width, height);

      const skyGrad = ctx.createLinearGradient(0, 0, 0, height);
      skyGrad.addColorStop(0, "#1b2a4a");
      skyGrad.addColorStop(1, "#3a5a8c");
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, width, height);

      const gy = groundY();

      ctx.fillStyle = "#6b4f3a";
      ctx.fillRect(0, gy, PLAYER_ANCHOR_X, height - gy);
      ctx.fillStyle = "#7fae52";
      ctx.fillRect(0, gy, PLAYER_ANCHOR_X, 10);

      ctx.fillStyle = "#2f6fa8";
      ctx.fillRect(PLAYER_ANCHOR_X, gy, round.gapWidth + round.platformWidth, height - gy);

      const nextX = PLAYER_ANCHOR_X + round.gapWidth;
      ctx.fillStyle = "#6b4f3a";
      ctx.fillRect(nextX, gy, round.platformWidth, height - gy);
      ctx.fillStyle = "#7fae52";
      ctx.fillRect(nextX, gy, round.platformWidth, 10);

      if (bridgeLength > 0 && state !== "gameover") {
        ctx.save();
        ctx.translate(PLAYER_ANCHOR_X, gy);
        ctx.rotate((-bridgeAngle * Math.PI) / 180);
        ctx.fillStyle = "#d8c08a";
        ctx.fillRect(0, -4, bridgeLength, 8);
        ctx.restore();
      }

      if (state !== "gameover") {
        ctx.fillStyle = "#f2c14e";
        ctx.beginPath();
        ctx.arc(playerX, gy - 20 + playerY, 16, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = "white";
      ctx.font = "bold 22px sans-serif";
      ctx.fillText(`Điểm: ${score}`, 16, 32);
      ctx.font = "14px sans-serif";
      ctx.fillText(`Kỷ lục: ${best}`, 16, 52);

      ctx.font = "13px sans-serif";
      ctx.fillStyle = "#cfd8e6";
      ctx.fillText("Nắm tay = giữ để dựng cầu · Xòe tay = thả cầu", 16, height - 16);

      if (state === "gameover") {
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = "white";
        ctx.textAlign = "center";
        ctx.font = "bold 32px sans-serif";
        ctx.fillText("Rơi xuống sông!", width / 2, height / 2 - 10);
        ctx.font = "18px sans-serif";
        ctx.fillText(`Điểm: ${score} · Kỷ lục: ${best}`, width / 2, height / 2 + 24);
        ctx.textAlign = "left";
      }
    }

    function loop(time) {
      const dt = Math.min(0.05, (time - prevTime) / 1000);
      prevTime = time;
      update(dt);
      draw();
      rafId = requestAnimationFrame(loop);
    }
    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
  }, [gestureRef]);

  return <canvas ref={canvasRef} className="bridge-game-canvas" />;
}

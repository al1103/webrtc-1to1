import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const FINGER_TIPS = [8, 12, 16, 20];
const FINGER_MCPS = [5, 9, 13, 17];
const STABLE_FRAMES = 3;

let landmarkerPromise = null;

function getHandLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = FilesetResolver.forVisionTasks(WASM_BASE).then((filesetResolver) =>
      HandLandmarker.createFromOptions(filesetResolver, {
        baseOptions: { modelAssetPath: MODEL_URL },
        runningMode: "VIDEO",
        numHands: 1,
      })
    );
  }
  return landmarkerPromise;
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * "closed" when at least 3 of the 4 non-thumb fingertips sit closer to the
 * wrist than their own knuckle (curled toward the palm), "open" otherwise.
 * Distance-to-wrist is used instead of a plain y-comparison so the
 * classification holds regardless of hand rotation on screen.
 */
function classifyHand(landmarks) {
  const wrist = landmarks[0];
  let curled = 0;
  for (let i = 0; i < FINGER_TIPS.length; i++) {
    const tip = landmarks[FINGER_TIPS[i]];
    const mcp = landmarks[FINGER_MCPS[i]];
    if (distance(tip, wrist) < distance(mcp, wrist)) {
      curled++;
    }
  }
  return curled >= 3 ? "closed" : "open";
}

/**
 * Runs hand-landmark detection against a playing video element on every
 * animation frame and calls onGesture("open" | "closed") once a reading
 * holds steady for a few consecutive frames, to absorb single-frame noise.
 * Returns a stop() function that cancels the loop.
 */
export function startGestureDetection(videoEl, onGesture) {
  let stopped = false;
  let rafId = null;
  let lastRaw = null;
  let stableCount = 0;

  getHandLandmarker().then((landmarker) => {
    if (stopped) {
      return;
    }

    const loop = () => {
      if (stopped) {
        return;
      }
      if (videoEl.readyState >= 2) {
        const result = landmarker.detectForVideo(videoEl, performance.now());
        const hand = result.landmarks && result.landmarks[0];
        const raw = hand ? classifyHand(hand) : null;

        if (raw === lastRaw) {
          stableCount++;
        } else {
          lastRaw = raw;
          stableCount = 1;
        }
        if (stableCount === STABLE_FRAMES && raw) {
          onGesture(raw);
        }
      }
      rafId = requestAnimationFrame(loop);
    };
    loop();
  });

  return () => {
    stopped = true;
    if (rafId) {
      cancelAnimationFrame(rafId);
    }
  };
}

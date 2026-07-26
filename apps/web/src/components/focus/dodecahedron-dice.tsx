import {
  type Component,
  onMount,
  onCleanup,
  createEffect,
  createSignal,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three-stdlib';
import { Dice1, Dice2, Dice3, Dice4, Dice5, Dice6 } from 'lucide-solid';

/* ══════════════════════════════════════════════════════════════
   6-SIDED CUBE DICE — Three.js
   ══════════════════════════════════════════════════════════════
   - True 6-sided dice logic, mapped to Dice1 through Dice6 icons.
   - Canvas-rendered dots for faces.
   - Cinematic "Wheel of Fortune" animation easing.
   - Guarantees perfectly smooth rotation with exact landing at 4s.
   ══════════════════════════════════════════════════════════════ */

import { rewardLabels } from '@/stores/focus.store';

export interface Reward {
  id: number;
  icon: Component<{ class?: string }>;
  label: string;
}

export const getRewards = (): Reward[] => {
  const labels = rewardLabels();
  return [
    { id: 0, icon: Dice1, label: labels[0] || 'Play a game' },
    { id: 1, icon: Dice2, label: labels[1] || 'Watch a movie' },
    { id: 2, icon: Dice3, label: labels[2] || 'Browse short videos' },
    { id: 3, icon: Dice4, label: labels[3] || 'Go outside for fresh air' },
    { id: 4, icon: Dice5, label: labels[4] || 'Free break' },
    { id: 5, icon: Dice6, label: labels[5] || 'Listen to favorite music' },
  ];
};

interface Props {
  onResult: (reward: Reward) => void;
  rolling: boolean;
  onRollingChange: (rolling: boolean) => void;
  disabled?: boolean;
}

const FACE_COLOR_TOKENS = [
  { bg: '--color-info', text: '--color-info-foreground' },
  { bg: '--color-forecast', text: '--color-forecast-foreground' },
  { bg: '--color-success', text: '--color-success-foreground' },
  { bg: '--color-learning', text: '--color-learning-foreground' },
  { bg: '--color-destructive', text: '--color-destructive-foreground' },
  { bg: '--color-primary', text: '--color-primary-foreground' },
];

// Target rotations (Euler) so the respective face points to the camera (+Z axis)
const TARGET_EULERS = [
  new THREE.Euler(0, -Math.PI / 2, 0), // 0: +X (Right)
  new THREE.Euler(0, Math.PI / 2, 0), // 1: -X (Left)
  new THREE.Euler(Math.PI / 2, 0, 0), // 2: +Y (Top)
  new THREE.Euler(-Math.PI / 2, 0, 0), // 3: -Y (Bottom)
  new THREE.Euler(0, 0, 0), // 4: +Z (Front)
  new THREE.Euler(0, Math.PI, 0), // 5: -Z (Back)
];

// Easing function: Buttery smooth prolonged brake (Wheel of Fortune style)
function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - x, 3);
}

const CubeDice: Component<Props> = (props) => {
  let containerRef!: HTMLButtonElement;
  let frameId = 0;
  let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
  let fallbackRolling = false;
  const [fallbackMode, setFallbackMode] = createSignal(false);
  const [fallbackFace, setFallbackFace] = createSignal(0);
  const fallbackIcon = () => getRewards()[fallbackFace()]?.icon ?? Dice1;

  const rollFallback = () => {
    if (!fallbackMode() || fallbackRolling) return;

    fallbackRolling = true;
    const selectedFace = Math.floor(Math.random() * getRewards().length);
    setFallbackFace(selectedFace);
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;

    fallbackTimer = setTimeout(
      () => {
        fallbackRolling = false;
        props.onRollingChange(false);
        props.onResult(getRewards()[selectedFace]);
      },
      reduceMotion ? 0 : 1200,
    );
  };

  createEffect(() => {
    if (fallbackMode() && props.rolling) rollFallback();
  });

  onCleanup(() => {
    if (fallbackTimer) clearTimeout(fallbackTimer);
  });

  onMount(() => {
    const rootStyles = getComputedStyle(document.documentElement);
    const faceColors = FACE_COLOR_TOKENS.map((tokens) => ({
      bg: rootStyles.getPropertyValue(tokens.bg).trim(),
      text: rootStyles.getPropertyValue(tokens.text).trim(),
    }));
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;

    // ── Scene ──────────────────────────────────────────────
    const scene = new THREE.Scene();
    scene.background = null;

    const width = containerRef.clientWidth;
    const height = containerRef.clientHeight;
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(0, 0, 5.0);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      });
    } catch {
      setFallbackMode(true);
      return;
    }
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.domElement.setAttribute('aria-hidden', 'true');
    containerRef.appendChild(renderer.domElement);

    // ── Lighting ───────────────────────────
    scene.add(new THREE.AmbientLight(0xffffff, 1.2));
    const mainLight = new THREE.DirectionalLight(0xffffff, 0.8);
    mainLight.position.set(4, 5, 6);
    scene.add(mainLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
    fillLight.position.set(-4, -2, 4);
    scene.add(fillLight);

    // ── Geometry (6 Faces) ─────────────────────────────────
    const geometry = new RoundedBoxGeometry(1.6, 1.6, 1.6, 4, 0.15);
    const materials: THREE.MeshStandardMaterial[] = [];

    // Order: +X, -X, +Y, -Y, +Z, -Z
    for (let i = 0; i < 6; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext('2d')!;
      const color = faceColors[i];

      // Solid bright background
      ctx.fillStyle = color.bg;
      ctx.fillRect(0, 0, 256, 256);

      // Draw standard dice dots
      ctx.fillStyle = color.text;
      const dot = 22;
      const center = 128;
      const offset = 65;

      const draw = (x: number, y: number) => {
        ctx.beginPath();
        ctx.arc(x, y, dot, 0, Math.PI * 2);
        ctx.fill();
      };

      const num = i + 1;
      if (num === 1 || num === 3 || num === 5) draw(center, center);
      if (num === 2 || num === 3 || num === 4 || num === 5 || num === 6) {
        draw(center - offset, center - offset);
        draw(center + offset, center + offset);
      }
      if (num === 4 || num === 5 || num === 6) {
        draw(center + offset, center - offset);
        draw(center - offset, center + offset);
      }
      if (num === 6) {
        draw(center - offset, center);
        draw(center + offset, center);
      }

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      materials.push(
        new THREE.MeshStandardMaterial({
          map: texture,
          metalness: 0.25,
          roughness: 0.35,
          envMapIntensity: 1.0,
        }),
      );
    }

    const mesh = new THREE.Mesh(geometry, materials);

    // Group separates the exact deterministic roll rotation (on the mesh)
    // from the subtle continuous hover bobbing (on the group).
    const diceGroup = new THREE.Group();
    diceGroup.add(mesh);
    scene.add(diceGroup);

    // ── Rim light for 3D rounded edge glow (replaces wireframe)
    const rimLight = new THREE.DirectionalLight(0xffffff, 0.6);
    rimLight.position.set(-3, 3, -4);
    scene.add(rimLight);

    const bottomFill = new THREE.DirectionalLight(0xffffff, 0.3);
    bottomFill.position.set(0, -4, 2);
    scene.add(bottomFill);

    // ── Animation state ───────────────────────────────────
    let isRolling = false;
    let rollStartTime = 0;
    const ROLL_DURATION = 4000;

    let startQuat = new THREE.Quaternion();
    let targetFaceQuat = new THREE.Quaternion();
    let spinAxis = new THREE.Vector3();
    let spinTotalAngle = 0;
    let selectedFaceIdx = 0;
    let idleTime = 0;

    function settleNow() {
      isRolling = false;
      props.onRollingChange(false);
      props.onResult(getRewards()[selectedFaceIdx]);

      // Set exact final rotation
      mesh.quaternion.copy(targetFaceQuat);

      // Highlight winning face, dim others
      materials.forEach((mat, idx) => {
        if (idx === selectedFaceIdx) {
          mat.emissive = new THREE.Color(faceColors[selectedFaceIdx].bg);
          mat.emissiveIntensity = 0.5;
          mat.opacity = 1;
        } else {
          mat.emissive = new THREE.Color(0x000000);
          mat.emissiveIntensity = 0;
          mat.transparent = true;
          mat.opacity = 0.3;
        }
      });
    }

    function roll() {
      if (isRolling) return;
      isRolling = true;
      rollStartTime = performance.now();

      materials.forEach((mat) => {
        mat.emissive = new THREE.Color(0x000000);
        mat.emissiveIntensity = 0;
        mat.opacity = 1;
        mat.transparent = false;
      });

      selectedFaceIdx = Math.floor(Math.random() * 6); // 0 to 5
      startQuat.copy(mesh.quaternion);
      targetFaceQuat = new THREE.Quaternion().setFromEuler(
        TARGET_EULERS[selectedFaceIdx],
      );

      if (reduceMotion) {
        settleNow();
        return;
      }

      // Random rotation axis and 6 to 10 full random spins
      spinAxis
        .set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
        .normalize();
      spinTotalAngle = Math.PI * 2 * (6 + Math.random() * 4);
    }

    // ── Animation loop ────────────────────────────────────
    function animate() {
      frameId = requestAnimationFrame(animate);

      if (isRolling) {
        // Keep group perfectly straight during the roll so the face aligns exactly
        diceGroup.rotation.set(0, 0, 0);

        const elapsed = performance.now() - rollStartTime;
        const t = Math.min(elapsed / ROLL_DURATION, 1.0);

        // Smooth easing curve exactly over 4000ms
        const easedT = easeOutCubic(t);

        // Slerp from start rotation to target rotation
        const baseQ = startQuat.clone().slerp(targetFaceQuat, easedT);

        // Apply extra wild spin that smoothly logarithmically zeroes out at t=1
        const currentSpinAngle = spinTotalAngle * (1 - easedT);
        const spinQ = new THREE.Quaternion().setFromAxisAngle(
          spinAxis,
          currentSpinAngle,
        );

        // Combine spin and orientation
        mesh.quaternion.copy(baseQ).multiply(spinQ);

        if (t >= 1.0) {
          settleNow();
        }
      } else if (!reduceMotion) {
        // Idle hover bobbing is applied to the GROUP, so it doesn't destroy the exact computed quaternion state of the mesh!
        idleTime += 0.01;
        diceGroup.rotation.x = Math.sin(idleTime) * 0.04;
        diceGroup.rotation.y = Math.cos(idleTime * 0.8) * 0.04;
      }

      renderer.render(scene, camera);
    }
    animate();

    const resizeObserver = new ResizeObserver(() => {
      const w = containerRef.clientWidth;
      const h = containerRef.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObserver.observe(containerRef);

    const handleClick = () => {
      if (!isRolling && !props.disabled) {
        props.onRollingChange(true);
        roll();
      }
    };
    containerRef.addEventListener('click', handleClick);

    createEffect(() => {
      if (props.rolling && !isRolling) {
        roll();
      }
    });

    onCleanup(() => {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      containerRef.removeEventListener('click', handleClick);
      renderer.dispose();
      geometry.dispose();
      materials.forEach((m) => {
        m.map?.dispose();
        m.dispose();
      });
    });
  });

  return (
    <button
      ref={containerRef!}
      type="button"
      class="relative mx-auto block aspect-square w-full max-w-72 select-none overflow-hidden rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-default"
      aria-label={
        props.rolling
          ? 'Rolling reward dice'
          : props.disabled
            ? 'Reward dice result'
            : 'Roll reward dice'
      }
      aria-busy={props.rolling}
      disabled={props.rolling || props.disabled}
      onClick={() => {
        if (fallbackMode() && !props.rolling && !props.disabled) {
          props.onRollingChange(true);
        }
      }}
    >
      <Show when={fallbackMode()}>
        <span
          class="absolute inset-0 flex flex-col items-center justify-center gap-4"
          aria-hidden="true"
        >
          <span
            class={`flex h-32 w-32 items-center justify-center rounded-2xl border bg-primary text-primary-foreground shadow-lg ${
              props.rolling
                ? 'animate-dice-fallback-roll will-change-transform motion-reduce:animate-none'
                : ''
            }`}
          >
            <Dynamic component={fallbackIcon()} class="h-16 w-16" />
          </span>
          <span class="block text-sm font-medium text-muted-foreground">
            {props.rolling
              ? 'Choosing your reward...'
              : props.disabled
                ? 'Reward selected'
                : 'Tap to roll'}
          </span>
        </span>
      </Show>
      <span class="sr-only">
        {props.rolling
          ? 'Rolling reward dice'
          : props.disabled
            ? 'Reward dice result'
            : 'Roll reward dice'}
      </span>
    </button>
  );
};

export default CubeDice;

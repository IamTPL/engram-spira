import { type Component, onMount, onCleanup, createEffect } from 'solid-js';
import * as THREE from 'three';

/* ══════════════════════════════════════════════════════════════
   DODECAHEDRON DICE — Three.js 3D 12-faced dice
   ══════════════════════════════════════════════════════════════
   - Each face has a BRIGHT, DISTINCT color — easily distinguishable
   - Large number (1–12) centered on every face
   - Dark wireframe edges so faces are clearly separated
   - Click to roll / click again to stop immediately
   - Responsive canvas, auto-resize, cleanup on unmount
   ══════════════════════════════════════════════════════════════ */

export interface Reward {
  id: number;
  emoji: string;
  label: string;
}

export const REWARDS: Reward[] = [
  { id: 0, emoji: '🎮', label: 'Play a game' },
  { id: 1, emoji: '🎬', label: 'Watch a movie' },
  { id: 2, emoji: '📱', label: 'Browse short videos' },
  { id: 3, emoji: '🌿', label: 'Go outside for fresh air' },
  { id: 4, emoji: '📚', label: 'Study 15 more minutes' },
  { id: 5, emoji: '💬', label: 'Browse social media' },
  { id: 6, emoji: '🎉', label: 'Free break' },
  { id: 7, emoji: '🎵', label: 'Listen to favorite music' },
  { id: 8, emoji: '🍫', label: 'Have a snack / drink water' },
  { id: 9, emoji: '🧘', label: 'Meditate / Stretch' },
  { id: 10, emoji: '💭', label: 'Chat with friends' },
  { id: 11, emoji: '😴', label: 'Power nap 10 minutes' },
];

interface Props {
  onResult: (reward: Reward) => void;
  rolling: boolean;
  onRollingChange: (rolling: boolean) => void;
}

/* ── 12 bright, highly distinct face colors ────────────────── */
const FACE_COLORS: Array<{ bg: string; text: string }> = [
  { bg: '#ef4444', text: '#ffffff' }, // 1  Red
  { bg: '#3b82f6', text: '#ffffff' }, // 2  Blue
  { bg: '#22c55e', text: '#ffffff' }, // 3  Green
  { bg: '#f59e0b', text: '#1a1a1a' }, // 4  Amber
  { bg: '#8b5cf6', text: '#ffffff' }, // 5  Violet
  { bg: '#ec4899', text: '#ffffff' }, // 6  Pink
  { bg: '#06b6d4', text: '#ffffff' }, // 7  Cyan
  { bg: '#f97316', text: '#ffffff' }, // 8  Orange
  { bg: '#14b8a6', text: '#ffffff' }, // 9  Teal
  { bg: '#6366f1', text: '#ffffff' }, // 10 Indigo
  { bg: '#eab308', text: '#1a1a1a' }, // 11 Yellow
  { bg: '#a855f7', text: '#ffffff' }, // 12 Purple
];

const DodecahedronDice: Component<Props> = (props) => {
  let containerRef!: HTMLDivElement;
  let frameId = 0;

  onMount(() => {
    // ── Scene ──────────────────────────────────────────────
    const scene = new THREE.Scene();
    scene.background = null; // transparent

    const width = containerRef.clientWidth;
    const height = containerRef.clientHeight;
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(0, 0, 4.5);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    containerRef.appendChild(renderer.domElement);

    // ── Lighting — bright & even ───────────────────────────
    scene.add(new THREE.AmbientLight(0xffffff, 1.2));

    const mainLight = new THREE.DirectionalLight(0xffffff, 0.8);
    mainLight.position.set(4, 5, 6);
    scene.add(mainLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
    fillLight.position.set(-4, -2, 4);
    scene.add(fillLight);

    const backLight = new THREE.DirectionalLight(0xffffff, 0.3);
    backLight.position.set(0, 0, -5);
    scene.add(backLight);

    // ── Geometry ───────────────────────────────────────────
    const geometry = new THREE.DodecahedronGeometry(1.3, 0);

    // ── Create a material per face with canvas texture ────
    const materials: THREE.MeshStandardMaterial[] = [];

    for (let i = 0; i < 12; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext('2d')!;
      const color = FACE_COLORS[i];

      // Solid bright background
      ctx.fillStyle = color.bg;
      ctx.fillRect(0, 0, 256, 256);

      // Large number
      ctx.font = 'bold 120px "Inter", "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = color.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${i + 1}`, 128, 132);

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;

      materials.push(
        new THREE.MeshStandardMaterial({
          map: texture,
          metalness: 0.05,
          roughness: 0.4,
        }),
      );
    }

    // Assign material groups: 12 faces × 3 triangles × 3 vertices = 9 indices each
    geometry.clearGroups();
    for (let face = 0; face < 12; face++) {
      geometry.addGroup(face * 9, 9, face);
    }

    const mesh = new THREE.Mesh(geometry, materials);
    scene.add(mesh);

    // ── Dark edge wireframe for clear face separation ─────
    const edgesGeo = new THREE.EdgesGeometry(geometry, 10);
    const edgesMat = new THREE.LineBasicMaterial({
      color: 0x1a1a2e,
      linewidth: 1,
      transparent: true,
      opacity: 0.7,
    });
    const edgesMesh = new THREE.LineSegments(edgesGeo, edgesMat);
    mesh.add(edgesMesh);

    // ── Animation state ───────────────────────────────────
    let velX = 0;
    let velY = 0;
    let velZ = 0;
    let isRolling = false;
    let idleTime = 0;
    const FRICTION = 0.985;
    const SETTLE_THRESHOLD = 0.003;

    // ── Face normals for result detection ─────────────────
    const faceNormals: THREE.Vector3[] = [];
    const posAttr = geometry.getAttribute('position');
    for (let face = 0; face < 12; face++) {
      const center = new THREE.Vector3();
      for (let t = 0; t < 9; t++) {
        const idx = face * 9 + t;
        center.x += posAttr.getX(idx);
        center.y += posAttr.getY(idx);
        center.z += posAttr.getZ(idx);
      }
      center.divideScalar(9).normalize();
      faceNormals.push(center);
    }

    function getTopFace(): number {
      const cameraDir = new THREE.Vector3(0, 0, 1);
      let bestDot = -Infinity;
      let bestFace = 0;
      for (let i = 0; i < faceNormals.length; i++) {
        const worldNormal = faceNormals[i]
          .clone()
          .applyQuaternion(mesh.quaternion);
        const dot = worldNormal.dot(cameraDir);
        if (dot > bestDot) {
          bestDot = dot;
          bestFace = i;
        }
      }
      return bestFace;
    }

    /** Settle immediately — resolve the roll and emit result */
    function settleNow() {
      isRolling = false;
      velX = 0;
      velY = 0;
      velZ = 0;

      const faceIdx = getTopFace();
      props.onRollingChange(false);
      props.onResult(REWARDS[faceIdx]);

      // Highlight winning face
      materials.forEach((mat, idx) => {
        if (idx === faceIdx) {
          mat.emissive = new THREE.Color(FACE_COLORS[faceIdx].bg);
          mat.emissiveIntensity = 0.3;
        } else {
          mat.emissive = new THREE.Color(0x000000);
          mat.emissiveIntensity = 0;
        }
      });
    }

    function roll() {
      if (isRolling) return;
      isRolling = true;

      velX = (Math.random() - 0.5) * 0.35 + 0.15;
      velY = (Math.random() - 0.5) * 0.35 + 0.15;
      velZ = (Math.random() - 0.5) * 0.2;
      if (Math.random() > 0.5) velX *= -1;
      if (Math.random() > 0.5) velY *= -1;
    }

    // ── Animation loop ────────────────────────────────────
    function animate() {
      frameId = requestAnimationFrame(animate);

      if (isRolling) {
        mesh.rotation.x += velX;
        mesh.rotation.y += velY;
        mesh.rotation.z += velZ;

        velX *= FRICTION;
        velY *= FRICTION;
        velZ *= FRICTION;

        if (
          Math.abs(velX) + Math.abs(velY) + Math.abs(velZ) <
          SETTLE_THRESHOLD
        ) {
          settleNow();
        }
      } else {
        idleTime += 0.008;
        mesh.rotation.y += Math.sin(idleTime) * 0.003;
        mesh.rotation.x += Math.cos(idleTime * 0.7) * 0.002;
      }

      renderer.render(scene, camera);
    }
    animate();

    // ── Resize ────────────────────────────────────────────
    const resizeObserver = new ResizeObserver(() => {
      const w = containerRef.clientWidth;
      const h = containerRef.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObserver.observe(containerRef);

    // ── Click: roll OR stop immediately ───────────────────
    const handleClick = () => {
      if (isRolling) {
        settleNow();
      } else {
        // Reset emissive
        materials.forEach((mat) => {
          mat.emissive = new THREE.Color(0x000000);
          mat.emissiveIntensity = 0;
        });
        props.onRollingChange(true);
        roll();
      }
    };
    containerRef.addEventListener('click', handleClick);

    // ── Reactive: trigger roll from parent ────────────────
    createEffect(() => {
      if (props.rolling && !isRolling) {
        materials.forEach((mat) => {
          mat.emissive = new THREE.Color(0x000000);
          mat.emissiveIntensity = 0;
        });
        roll();
      }
    });

    // ── Cleanup ───────────────────────────────────────────
    onCleanup(() => {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      containerRef.removeEventListener('click', handleClick);
      renderer.dispose();
      geometry.dispose();
      edgesGeo.dispose();
      edgesMat.dispose();
      materials.forEach((m) => {
        m.map?.dispose();
        m.dispose();
      });
    });
  });

  return (
    <div
      ref={containerRef!}
      class="w-full aspect-square max-w-72 mx-auto cursor-pointer select-none"
      title="Click to roll / click again to stop"
    />
  );
};

export default DodecahedronDice;

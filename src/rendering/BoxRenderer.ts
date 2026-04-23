import * as THREE from 'three';
import type { BoxGeometry, Panel } from '../models/types';

export class BoxRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene:    THREE.Scene;
  private camera:   THREE.PerspectiveCamera;
  private meshes:   THREE.Group[] = [];
  private panelByGroup = new Map<THREE.Group, Panel>();

  private orb = { theta: -0.6, phi: 0.7, radius: 320, panX: 0, panY: 0 };
  private drag = { active: false, rmb: false, lx: 0, ly: 0 };

  private _wireframe = false;
  private _explode   = false;
  private _animId    = 0;
  private _geometry: BoxGeometry | null = null;
  private _paused = false;

  public fps         = 0;
  private _frames    = 0;
  private _fpsTime   = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = this.initRenderer(canvas);
    this.scene    = this.initScene();
    this.camera   = new THREE.PerspectiveCamera(42, 1, 0.5, 2000);
    this.initOrbitEvents(canvas);
    this.updateCamera();
  }

  private initRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
    const r = new THREE.WebGLRenderer({ canvas, antialias: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type    = THREE.PCFSoftShadowMap;
    r.setClearColor(0x080b0f, 1);
    return r;
  }

  private initScene(): THREE.Scene {
    const scene = new THREE.Scene();
    scene.fog   = new THREE.FogExp2(0x080b0f, 0.003);

    scene.add(new THREE.AmbientLight(0x223344, 0.75));

    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(200, 300, 200);
    dir.castShadow            = true;
    dir.shadow.mapSize.width  = 1024;
    dir.shadow.mapSize.height = 1024;
    scene.add(dir);

    const rim = new THREE.DirectionalLight(0x00c8ff, 0.25);
    rim.position.set(-200, 100, -200);
    scene.add(rim);

    const grid = new THREE.GridHelper(600, 60, 0x1a2232, 0x131923);
    grid.position.y = 0;
    scene.add(grid);

    return scene;
  }

  private initOrbitEvents(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.drag.active = true;
      if (e.button === 2) this.drag.rmb    = true;
      this.drag.lx = e.clientX;
      this.drag.ly = e.clientY;
      e.preventDefault();
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('mousemove', (e) => {
      if (!this.drag.active && !this.drag.rmb) return;
      const dx = e.clientX - this.drag.lx;
      const dy = e.clientY - this.drag.ly;
      if (this.drag.active) {
        this.orb.theta += dx * 0.008;
        this.orb.phi    = Math.max(0.05, Math.min(Math.PI - 0.05, this.orb.phi + dy * 0.008));
      }
      if (this.drag.rmb) {
        this.orb.panX -= dx * 0.25;
        this.orb.panY += dy * 0.25;
      }
      this.drag.lx = e.clientX;
      this.drag.ly = e.clientY;
      this.updateCamera();
    });

    window.addEventListener('mouseup', () => {
      this.drag.active = false;
      this.drag.rmb    = false;
    });

    canvas.addEventListener('wheel', (e) => {
      this.orb.radius *= e.deltaY > 0 ? 1.08 : 0.93;
      this.orb.radius   = Math.max(20, Math.min(1500, this.orb.radius));
      e.preventDefault();
      this.updateCamera();
    }, { passive: false });
  }

  private updateCamera(): void {
    const { theta, phi, radius, panX, panY } = this.orb;
    this.camera.position.set(
      radius * Math.sin(phi) * Math.sin(theta) + panX,
      radius * Math.cos(phi) + panY,
      radius * Math.sin(phi) * Math.cos(theta),
    );
    this.camera.lookAt(panX * 0.2, panY * 0.2, 0);
  }

  private buildPanelMesh(panel: Panel): THREE.Group {
    const group = new THREE.Group();
    const shape = new THREE.Shape();

    if (panel.outline.length >= 3) {
      shape.moveTo(panel.outline[0].x, panel.outline[0].y);
      for (let i = 1; i < panel.outline.length; i++) {
        shape.lineTo(panel.outline[i].x, panel.outline[i].y);
      }
      shape.closePath();
    } else {
      shape.moveTo(0, 0);
      shape.lineTo(panel.panelWidth, 0);
      shape.lineTo(panel.panelWidth, panel.panelHeight);
      shape.lineTo(0, panel.panelHeight);
      shape.closePath();
    }

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: panel.thickness,
      bevelEnabled: false,
    });

    geo.translate(
      -panel.panelWidth  / 2,
      -panel.panelHeight / 2,
      -panel.thickness   / 2,
    );

    const mat = new THREE.MeshStandardMaterial({
      color:       panel.colorHex,
      roughness:   0.48,
      metalness:   0.08,
      transparent: panel.group === 'lid',
      opacity:     panel.group === 'lid' ? 0.8 : 1,
      wireframe:   this._wireframe,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow    = true;
    mesh.receiveShadow = true;

    const edges   = new THREE.EdgesGeometry(geo);
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.22,
    });
    mesh.add(new THREE.LineSegments(edges, lineMat));

    const labelCanvas     = document.createElement('canvas');
    labelCanvas.width     = 128;
    labelCanvas.height    = 128;
    const ctx             = labelCanvas.getContext('2d')!;
    ctx.fillStyle         = '#' + panel.colorHex.toString(16).padStart(6, '0');
    ctx.beginPath();
    ctx.arc(64, 64, 52, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle        = '#080b0f';
    ctx.font             = 'bold 54px monospace';
    ctx.textAlign        = 'center';
    ctx.textBaseline     = 'middle';
    ctx.fillText(String(panel.sequenceNumber), 64, 64);

    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map:        new THREE.CanvasTexture(labelCanvas),
        depthTest:  false,
        transparent: true,
      }),
    );
    sprite.scale.set(8, 8, 8);

    group.add(mesh);
    group.add(sprite);

    const es  = this._explode ? 1.6 : 1.0;
    const pos = panel.position3D;
    const rot = panel.rotation3D;
    group.position.set(pos.x * es, pos.y * es, pos.z * es);
    group.rotation.set(rot.x, rot.y, rot.z);

    return group;
  }

  private clearMeshes(): void {
    for (const group of this.meshes) {
      group.traverse((obj) => {
        const anyObj = obj as unknown as { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };
        if (anyObj.geometry) anyObj.geometry.dispose();
        if (anyObj.material) {
          const mats = Array.isArray(anyObj.material) ? anyObj.material : [anyObj.material];
          for (const m of mats) {
            const mm = m as THREE.Material & { map?: THREE.Texture | null };
            if (mm.map) mm.map.dispose();
            m.dispose();
          }
        }
      });
      this.scene.remove(group);
    }
    this.meshes = [];
    this.panelByGroup.clear();
  }

  public loadGeometry(geometry: BoxGeometry): void {
    this._geometry = geometry;
    this.clearMeshes();

    for (const panel of geometry.panels) {
      const group = this.buildPanelMesh(panel);
      this.scene.add(group);
      this.meshes.push(group);
      this.panelByGroup.set(group, panel);
    }

    const { params } = geometry;
    this.orb.radius = Math.max(params.width, params.depth, params.height) * 3.0;
    this.updateCamera();
  }

  public resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  public resetCamera(): void {
    this.orb.theta  = -0.6;
    this.orb.phi    = 0.7;
    this.orb.panX   = 0;
    this.orb.panY   = 0;
    if (this._geometry) {
      const { params } = this._geometry;
      this.orb.radius = Math.max(params.width, params.depth, params.height) * 3.0;
    }
    this.updateCamera();
  }

  public set wireframe(val: boolean) {
    this._wireframe = val;
    // Avoid rebuilding geometry; update materials in-place.
    this.meshes.forEach((group) => {
      group.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (typeof mat.wireframe === 'boolean') mat.wireframe = val;
        mat.needsUpdate = true;
      });
    });
  }

  public set explode(val: boolean) {
    this._explode = val;
    // Avoid rebuilding; update group transforms in-place.
    const es = val ? 1.6 : 1.0;
    this.meshes.forEach((group) => {
      const panel = this.panelByGroup.get(group);
      if (!panel) return;
      const pos = panel.position3D;
      group.position.set(pos.x * es, pos.y * es, pos.z * es);
    });
  }

  public get wireframe() { return this._wireframe; }
  public get explode()   { return this._explode;   }

  public highlightPanel(seqNum: number): void {
    this.meshes.forEach((group, i) => {
      group.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) {
          const mat = mesh.material as THREE.MeshStandardMaterial;
          if (mat.emissive) {
            mat.emissive.setHex(i === seqNum - 1 ? 0x331800 : 0x000000);
          }
        }
      });
    });
  }

  public set paused(val: boolean) {
    this._paused = val;
  }

  public get paused(): boolean {
    return this._paused;
  }

  public start(): void {
    const loop = (ts: number) => {
      this._animId = requestAnimationFrame(loop);
      if (this._paused || document.hidden) return;
      this._frames++;
      if (ts - this._fpsTime > 1000) {
        this.fps     = this._frames;
        this._frames = 0;
        this._fpsTime = ts;
      }
      this.renderer.render(this.scene, this.camera);
    };
    this._animId = requestAnimationFrame(loop);
  }

  public dispose(): void {
    cancelAnimationFrame(this._animId);
    this.clearMeshes();
    this.renderer.dispose();
  }
}
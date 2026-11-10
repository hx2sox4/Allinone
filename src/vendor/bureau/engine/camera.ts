// Source: https://github.com/devlikemasta/bureau-des-agents (v0.1.0, commit 184daa8), src/engine/camera.ts
// Copyright (c) 2026 VibesMoney. MIT License: see ../LICENSE. Import paths were adjusted for this project.
// La caméra du bureau : un plan large (tout le monde au travail), ou un gros plan qui suit l'action.
// En mode tournage, un « réalisateur » choisit les plans tout seul, comme à la télé : le nouvel
// arrivant qui passe la porte, la chercheuse qui lit un site, le rapport posé sur le bureau du chef…
// et régulièrement un plan large, pour voir toute l'équipe travailler en même temps.
import type { OfficeEvent } from '../shared/protocol';
import { BOARD, H, SPOTS, T, W } from './layout';
import type { World } from './world';

export class Camera {
  x = W / 2;
  y = H / 2;
  zoom = 1;
  tx = W / 2;
  ty = H / 2;
  tzoom = 1;
  /** jusqu'à quand garder le plan en cours (secondes, horloge du navigateur) */
  holdUntil = 0;

  shot(x: number, y: number, zoom: number, hold: number) {
    this.tx = x;
    this.ty = y;
    this.tzoom = zoom;
    this.holdUntil = performance.now() / 1000 + hold;
  }

  wide(hold = 0) { this.shot(W / 2, H / 2, 1, hold); }

  /** Avance la caméra vers son plan. Renvoie vrai tant qu'elle bouge. */
  update(dt: number) {
    const k = 1 - Math.exp(-dt * 2.6);
    this.x += (this.tx - this.x) * k;
    this.y += (this.ty - this.y) * k;
    this.zoom += (this.tzoom - this.zoom) * k;
    return Math.abs(this.tzoom - this.zoom) > 0.002 || Math.abs(this.tx - this.x) > 0.3 || Math.abs(this.ty - this.y) > 0.3;
  }

  /** La transformation CSS de la scène (taille d'affichage : W*scale × H*scale). */
  css(scale: number) {
    const vw = W * scale, vh = H * scale;
    const z = this.zoom;
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    const ox = clamp(vw / 2 - this.x * scale * z, vw - vw * z, 0);
    const oy = clamp(vh / 2 - this.y * scale * z, vh - vh * z, 0);
    return { transform: `translate3d(${ox.toFixed(1)}px, ${oy.toFixed(1)}px, 0) scale(${z.toFixed(4)})`, zoomed: z > 1.02 };
  }
}

/** Le réalisateur : il choisit les plans d'après ce qui se passe vraiment dans la mission. */
export class Director {
  enabled = false;
  private cam: Camera;
  private world: World;
  private lastWho = '';
  private lastWideAt = 0;
  private lastHireShot = 0;

  constructor(cam: Camera, world: World) {
    this.cam = cam;
    this.world = world;
  }

  private now() { return performance.now() / 1000; }
  private free() { return this.now() > this.cam.holdUntil; }

  private onActor(id: string, zoom: number, hold: number) {
    const a = this.world.actors.get(id);
    if (!a) return;
    const y = a.seated && a.seat ? a.seat.y - 10 : a.y - 10;
    this.cam.shot(a.x, y, zoom, hold);
    this.lastWho = id;
  }

  event(ev: OfficeEvent, live: boolean) {
    if (!this.enabled || !live) return;
    const t = this.now();
    switch (ev.k) {
      case 'start':
        this.onActor('chef', 1.9, 2.6);
        break;
      case 'plan':
        if (this.free() || ev.items.every((i) => i.status === 'pending')) this.cam.shot(BOARD.x + BOARD.w / 2, BOARD.y + 26, 2.1, 3.2);
        break;
      case 'hire':
        if (t - this.lastHireShot > 3) { this.cam.shot(11 * T, 13 * T, 1.7, 2.6); this.lastHireShot = t; }
        break;
      case 'act':
        if (ev.who !== 'chef' && this.free() && ev.who !== this.lastWho) this.onActor(ev.who, 1.95, 2.8);
        break;
      case 'report':
        this.cam.shot(11 * T, 7 * T, 1.8, 2.6);
        break;
      case 'file':
        if (this.free()) this.cam.shot(12 * T + 8, 4 * T, 2.1, 2.2);
        break;
      case 'ask':
        this.onActor(ev.who, 2.1, 4);
        break;
      case 'end':
        this.cam.shot(SPOTS.receptionPx.x, SPOTS.receptionPx.y - 30, 1.7, 5.5);
        break;
    }
  }

  /** Régulièrement, un plan large : toute l'équipe au travail en même temps. */
  tick() {
    if (!this.enabled || !this.free()) return;
    const t = this.now();
    if (this.cam.tzoom > 1 && t - this.lastWideAt > 9) {
      this.cam.wide(4.5);
      this.lastWideAt = t;
    }
  }
}

// 가져온 사무실 엔진(src/vendor/bureau, MIT)의 인스턴스. 브라우저에서만 불러와야 한다(캔버스를 바로 만든다).
import { Camera } from "@/vendor/bureau/engine/camera";
import { Renderer } from "@/vendor/bureau/engine/render";
import { World } from "@/vendor/bureau/engine/world";

export { hitAt, type Hit } from "@/vendor/bureau/engine/hits";
export { H, W } from "@/vendor/bureau/engine/layout";
export type { TimeOfDay } from "@/vendor/bureau/engine/room";

export const world = new World();
export const renderer = new Renderer();
export const camera = new Camera();

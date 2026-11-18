import "leaflet";

declare module "leaflet" {
  interface MapOptions {
    rotate?: boolean;
    bearing?: number;
    touchRotate?: boolean;
    shiftKeyRotate?: boolean;
    pitchDrag?: boolean;
    rotateControl?: boolean | object;
  }
  interface Map {
    setBearing(deg: number, options?: { animate?: boolean; duration?: number }): this;
    getBearing(): number;
    resetNorth(options?: { animate?: boolean }): this;
  }
}

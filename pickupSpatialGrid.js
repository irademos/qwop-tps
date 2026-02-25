const DEFAULT_CELL_SIZE = 4;

export class PickupSpatialGrid {
  constructor(cellSize = DEFAULT_CELL_SIZE) {
    this.cellSize = Number.isFinite(cellSize) && cellSize > 0 ? cellSize : DEFAULT_CELL_SIZE;
    this.cells = new Map();
    this.pickupToCellKey = new WeakMap();
  }

  getCellKey(x, z) {
    const cellX = Math.floor(x / this.cellSize);
    const cellZ = Math.floor(z / this.cellSize);
    return `${cellX},${cellZ}`;
  }

  add(pickup, position) {
    if (!pickup || !position) return;
    const cellKey = this.getCellKey(position.x, position.z);
    const previousKey = this.pickupToCellKey.get(pickup);
    if (previousKey === cellKey) return;
    if (previousKey) {
      this.remove(pickup);
    }
    let bucket = this.cells.get(cellKey);
    if (!bucket) {
      bucket = new Set();
      this.cells.set(cellKey, bucket);
    }
    bucket.add(pickup);
    this.pickupToCellKey.set(pickup, cellKey);
  }

  remove(pickup) {
    if (!pickup) return;
    const cellKey = this.pickupToCellKey.get(pickup);
    if (!cellKey) return;
    const bucket = this.cells.get(cellKey);
    if (bucket) {
      bucket.delete(pickup);
      if (!bucket.size) {
        this.cells.delete(cellKey);
      }
    }
    this.pickupToCellKey.delete(pickup);
  }

  queryNearby(x, z, radius) {
    const searchRadius = Math.max(0, Number.isFinite(radius) ? radius : 0);
    const centerCellX = Math.floor(x / this.cellSize);
    const centerCellZ = Math.floor(z / this.cellSize);
    const cellRadius = Math.ceil(searchRadius / this.cellSize);
    const nearby = [];

    for (let offsetX = -cellRadius; offsetX <= cellRadius; offsetX += 1) {
      for (let offsetZ = -cellRadius; offsetZ <= cellRadius; offsetZ += 1) {
        const cellKey = `${centerCellX + offsetX},${centerCellZ + offsetZ}`;
        const bucket = this.cells.get(cellKey);
        if (!bucket) continue;
        bucket.forEach((pickup) => nearby.push(pickup));
      }
    }

    return nearby;
  }
}

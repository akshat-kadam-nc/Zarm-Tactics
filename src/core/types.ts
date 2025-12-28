//All Types

export enum TurnPhase {
  PlayerMove,
  PlayerAttack,
  EnemyTurn
}

export type GridPos = { q: number; r: number }; // q = col, r = row
export type TileKey = string;

export type Terrain = "grass" | "water" | "sand" | "stone" | "lava" | "ice";

export type Tile = {
  pos: GridPos;
  walkable: boolean;
  terrain: Terrain;
  polluted: boolean;
};

export type Unit = {
  id: string;
  name: string;
  pos: GridPos;
  hp: number;
  maxHp: number;
  energy: number;
  moveRange: number;
  attackRange: number;
  attackDamage: number;
  isEnemy: boolean;
  downed: boolean;

  homeTerrains: Terrain[];
};

export type Reachability = {
  reachable: Set<TileKey>;
  cameFrom: Map<TileKey, TileKey | null>;
};
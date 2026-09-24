// Arena layouts: 13 x 18 tiles. '#' = barrier, '.' = floor.
// Every layout is fully connected with no dead ends (checked before shipping).
export const MAPS = [
  {
    id: "court",
    name: "Center Court",
    start: { x: 6, y: 7 },
    tiles: [
      "#############",
      "#.....#.....#",
      "#.##.....##.#",
      "#.#..#.#..#.#",
      "#...##.##...#",
      "##.#.....#.##",
      "#..#.###.#..#",
      "#...........#",
      "#.##.#.#.##.#",
      "#....#.#....#",
      "#.##.....##.#",
      "#..#.###.#..#",
      "##.#.....#.##",
      "#...##.##...#",
      "#.#..#.#..#.#",
      "#.##.....##.#",
      "#.....#.....#",
      "#############"
    ]
  },
  {
    id: "cross",
    name: "Crossfire",
    start: { x: 6, y: 7 },
    tiles: [
      "#############",
      "#...........#",
      "#.#.##.##.#.#",
      "#.#.......#.#",
      "#...#.#.#...#",
      "###.#...#.###",
      "#.....#.....#",
      "#.###...###.#",
      "#.....#.....#",
      "##.#.###.#.##",
      "#..#.....#..#",
      "#.##.#.#.##.#",
      "#....#.#....#",
      "#.##.....##.#",
      "#....#.#....#",
      "#.##.#.#.##.#",
      "#...........#",
      "#############"
    ]
  },
  {
    id: "loop",
    name: "The Loop",
    start: { x: 6, y: 7 },
    tiles: [
      "#############",
      "#.....#.....#",
      "#.###.#.###.#",
      "#...........#",
      "#.#.#####.#.#",
      "#.#...#...#.#",
      "#.###.#.###.#",
      "#...........#",
      "###.#.#.#.###",
      "#...#...#...#",
      "#.#.#####.#.#",
      "#.#.......#.#",
      "#.#.##.##.#.#",
      "#...#...#...#",
      "#.###.#.###.#",
      "#.....#.....#",
      "#...#...#...#",
      "#############"
    ]
  }
];

// Adds helpers to a map definition.
export function buildMap(def) {
  const rows = def.tiles.length, cols = def.tiles[0].length;
  const open = (x, y) => y >= 0 && y < rows && x >= 0 && x < cols && def.tiles[y][x] === ".";
  const floor = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (open(x, y)) floor.push({ x, y });
  // Spawn points: the floor tiles farthest from the start, spread across the corners.
  const corners = [[1, 1], [cols - 2, 1], [1, rows - 2], [cols - 2, rows - 2], [Math.floor(cols / 2), 1], [Math.floor(cols / 2), rows - 2]];
  const spawns = corners.map(([cx, cy]) => floor.slice().sort((a, b) =>
    ((a.x - cx) ** 2 + (a.y - cy) ** 2) - ((b.x - cx) ** 2 + (b.y - cy) ** 2))[0]);
  return { ...def, rows, cols, open, floor, spawns };
}

// The production chains view: every building as a node, with a line for
// each resource that goes from one to another. Not part of Freeserf.
//
// The lines between two buildings are derived from the table of
// production.ts (A makes what B needs). The rest is listed in extraEdges
// with the game code behind it.

import './build-menu.css';

import { BuildingType } from '../game/building';
import { ResourceType } from '../game/resource';
import type { Interface } from './interface';
import { blurActive, buildingCanvas, el, resourceCanvas } from './overlay-dom';
import {
  buildingCost,
  buildingInfo,
  buildingInfos,
  foodResources,
  productionLine,
  resourceName,
} from './production';

const R = ResourceType;
const B = BuildingType;

interface ChainNode {
  id: string;
  col: number;
  row: number;
  name: string;
  /* A building of the game, or none for a node that only groups. */
  type: BuildingType | null;
  /* Icons shown in place of a building. */
  icons: ResourceType[];
  /* What leaves the node, as icons and as a word. */
  out: ResourceType[];
  outText: string;
  detail: string;
}

interface ChainEdge {
  from: string;
  to: string;
}

const bid = (type: BuildingType): string => 'b' + type;

/* Column and row of each building: every line runs from left to right. */
const places: [BuildingType, number, number][] = [
  [B.TypeForester, 0, 0],
  [B.TypeFarm, 0, 3],
  [B.TypeLumberjack, 1, 0],
  [B.TypeStonecutter, 1, 1],
  [B.TypeFisher, 1, 2],
  [B.TypeMill, 1, 3],
  [B.TypePigFarm, 1, 4],
  [B.TypeSawmill, 2, 0],
  [B.TypeBaker, 2, 3],
  [B.TypeButcher, 2, 4],
  [B.TypeBoatbuilder, 3, 0],
  [B.TypeStoneMine, 4, 2],
  [B.TypeCoalMine, 4, 3],
  [B.TypeIronMine, 4, 4],
  [B.TypeGoldMine, 4, 5],
  [B.TypeSteelSmelter, 5, 3],
  [B.TypeGoldSmelter, 5, 5],
  [B.TypeToolMaker, 6, 2],
  [B.TypeWeaponSmith, 6, 3],
  [B.TypeHut, 8, 3],
  [B.TypeTower, 8, 4],
  [B.TypeFortress, 8, 5],
];

function costText(type: BuildingType): string {
  const cost = buildingCost(type);
  const parts: string[] = [];
  if (cost.planks > 0) parts.push(`${cost.planks} planks`);
  if (cost.stones > 0) parts.push(`${cost.stones} stone`);
  return parts.length > 0 ? ` Costs ${parts.join(' and ')}.` : '';
}

function buildNodes(): ChainNode[] {
  const nodes: ChainNode[] = [];
  for (const [type, col, row] of places) {
    const info = buildingInfo(type)!;
    let detail = `${info.name}: ${productionLine(info)}.`;
    if (info.tools.length > 0) {
      detail += ` The worker needs ${info.tools.map(resourceName).join(' and ')}.`;
    }
    detail += costText(type);
    nodes.push({
      id: bid(type),
      col,
      row,
      name: info.name,
      type,
      icons: [],
      /* One icon stands for the nine tools. */
      out: info.makesText !== undefined ? [R.TypeHammer] : info.makes,
      outText: info.makesText ?? (info.type === B.TypeForester ? 'trees' : ''),
      detail,
    });
  }

  // serf.ts handleSerfMiningState: a miner eats one of GroupFood, which is
  // fish, bread or meat (Building::requested_resource_delivered).
  nodes.push({
    id: 'food', col: 3, row: 3, name: 'Food', type: null, icons: foodResources, out: [], outText: 'to the mines',
    detail: 'Food: fish, bread and meat count the same. Every mine needs food for its miner.',
  });
  // building.ts startBuilding / updateUnfinished: a site asks for planks in
  // stock[0] and stone in stock[1], as many as constInfo() says.
  nodes.push({
    id: 'sites', col: 7, row: 1, name: 'Building sites', type: null, icons: [R.TypePlank, R.TypeStone], out: [], outText: '',
    detail: 'Building sites: every new building needs planks, most need stone too.',
  });
  // inventory.ts: the castle and the storehouses hold the tools that make a
  // serf a worker (specializeSerf), sword and shield for a knight, and the
  // boat for the sailor of a water road.
  nodes.push({
    id: 'store', col: 7, row: 3, name: 'Castle, storehouses', type: B.TypeCastle, icons: [], out: [], outText: 'workers, knights',
    detail:
      'Castle and storehouses: store everything. A serf with a tool becomes a worker, ' +
      'with sword and shield a knight, with a boat a sailor. ' +
      `A storehouse${costText(B.TypeStock).toLowerCase().replace('.', '')}.`,
  });
  return nodes;
}

function buildEdges(): ChainEdge[] {
  const edges: ChainEdge[] = [];
  const placed = new Set(places.map(([type]) => type));

  /* A makes what B needs. */
  for (const a of buildingInfos) {
    if (!placed.has(a.type)) continue;
    for (const b of buildingInfos) {
      if (!placed.has(b.type) || a === b) continue;
      if (a.makes.some((res) => b.needs.includes(res))) {
        edges.push({ from: bid(a.type), to: bid(b.type) });
      }
    }
  }

  const extraEdges: [string, string][] = [
    // serf.ts: the forester plants (StatePlanting) the trees the lumberjack
    // fells (StateLogging).
    [bid(B.TypeForester), bid(B.TypeLumberjack)],
    // building.ts updateUnfinished: planks (stock[0]) and stone (stock[1]).
    [bid(B.TypeSawmill), 'sites'],
    [bid(B.TypeStonecutter), 'sites'],
    [bid(B.TypeStoneMine), 'sites'],
    // GroupFood: fish, bread and meat (requestedResourceDelivered).
    [bid(B.TypeFisher), 'food'],
    [bid(B.TypeBaker), 'food'],
    [bid(B.TypeButcher), 'food'],
    // serf.ts entering building, TypeMiner: stockInit(0, GroupFood, 8).
    ['food', bid(B.TypeStoneMine)],
    ['food', bid(B.TypeCoalMine)],
    ['food', bid(B.TypeIronMine)],
    ['food', bid(B.TypeGoldMine)],
    // inventory.ts: tools, sword and shield, and boats are used in the
    // inventories of the castle and the storehouses.
    [bid(B.TypeToolMaker), 'store'],
    [bid(B.TypeWeaponSmith), 'store'],
    [bid(B.TypeBoatbuilder), 'store'],
    // building.ts updateMilitary: sendSerfToBuilding asks an inventory for
    // a knight.
    ['store', bid(B.TypeHut)],
    ['store', bid(B.TypeTower)],
    ['store', bid(B.TypeFortress)],
  ];
  for (const [from, to] of extraEdges) {
    edges.push({ from, to });
  }
  return edges;
}

const svgNs = 'http://www.w3.org/2000/svg';

const idleDetail =
  'Point at a building, or move to it with Tab, to see what feeds it and what it feeds.';

export class ChainsView {
  protected root: HTMLElement;
  protected diagram: HTMLElement;
  protected svg: SVGSVGElement;
  protected detail: HTMLElement;
  protected closeButton: HTMLButtonElement;
  protected nodes: ChainNode[] = [];
  protected edges: ChainEdge[] = [];
  protected nodeEls = new Map<string, HTMLButtonElement>();
  protected countEls = new Map<string, HTMLElement>();
  protected pathEls: SVGPathElement[] = [];
  protected built = false;
  protected timer = 0;

  constructor(protected iface: Interface) {
    this.root = el('div', 'gx');
    this.root.id = 'gx-chains';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Production chains');

    const panel = el('div', 'ch-panel gx-box');
    const head = el('div', 'ch-head');
    head.append(
      el('h2', 'ch-title', 'Production chains'),
      el('span', 'ch-sub', 'The numbers are your buildings: built, and after the plus under construction.'),
    );
    this.closeButton = el('button', 'gx-btn', 'Close');
    this.closeButton.type = 'button';
    this.closeButton.addEventListener('click', () => this.close());
    head.append(this.closeButton);

    const scroll = el('div', 'ch-scroll');
    this.diagram = el('div', 'ch-diagram');
    this.svg = document.createElementNS(svgNs, 'svg');
    this.svg.setAttribute('class', 'ch-lines');
    this.svg.setAttribute('aria-hidden', 'true');
    this.diagram.append(this.svg);
    scroll.append(this.diagram);

    this.detail = el('div', 'ch-detail', idleDetail);
    this.detail.setAttribute('aria-live', 'polite');

    panel.append(head, scroll, this.detail);
    this.root.append(panel);
    document.body.append(this.root);

    /* A click beside the panel closes the view. */
    this.root.addEventListener('mousedown', (e) => {
      if (e.target === this.root) this.close();
    });
    /* No key reaches the game while the view is open. */
    this.root.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape' || (e.key.toLowerCase() === 'v' && !e.ctrlKey && !e.altKey && !e.metaKey)) {
        e.preventDefault();
        this.close();
      }
    });
    window.addEventListener('resize', () => {
      if (this.isOpen()) this.drawLines();
    });
  }

  isOpen(): boolean {
    return !this.root.hidden;
  }

  toggle(): void {
    if (this.isOpen()) {
      this.close();
    } else {
      this.open();
    }
  }

  open(): void {
    if (!this.built) {
      this.build();
    }
    this.root.hidden = false;
    this.refreshCounts();
    this.drawLines();
    this.closeButton.focus({ preventScroll: true });
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.refreshCounts(), 1000);
  }

  close(): void {
    if (!this.isOpen()) return;
    this.root.hidden = true;
    window.clearInterval(this.timer);
    this.highlight(null);
    blurActive();
  }

  protected build(): void {
    this.built = true;
    this.nodes = buildNodes();
    this.edges = buildEdges();
    const player = this.iface.getPlayer();
    const color = player !== null ? player.getColor() : undefined;

    /* In the order of the flow, for the Tab key. */
    const ordered = this.nodes.slice().sort((a, b) => a.col - b.col || a.row - b.row);
    for (const node of ordered) {
      const button = el('button', node.type === null || node.id === 'store' ? 'ch-node ch-pseudo' : 'ch-node');
      button.type = 'button';
      button.style.gridColumn = String(node.col + 1);
      button.style.gridRow = String(node.row + 1);

      const pic = el('span', 'ch-pic');
      if (node.type !== null) {
        pic.append(buildingCanvas(node.type, color));
      } else {
        for (const res of node.icons) pic.append(resourceCanvas(res));
      }
      button.append(pic, el('span', 'ch-name', node.name));

      if (node.out.length > 0 || node.outText !== '') {
        const out = el('span', 'ch-out');
        out.append('→ ');
        for (const res of node.out) out.append(resourceCanvas(res));
        if (node.outText !== '') out.append(' ' + node.outText);
        button.append(out);
      }

      if (node.type !== null) {
        const count = el('span', 'ch-count');
        this.countEls.set(node.id, count);
        button.append(count);
      }

      button.addEventListener('mouseenter', () => this.highlight(node.id));
      button.addEventListener('mouseleave', () => this.highlight(this.focusedNode()));
      button.addEventListener('focus', () => this.highlight(node.id));
      button.addEventListener('blur', () => this.highlight(null));
      this.nodeEls.set(node.id, button);
      this.diagram.append(button);
    }

    for (let i = 0; i < this.edges.length; i++) {
      const path = document.createElementNS(svgNs, 'path');
      this.pathEls.push(path);
      this.svg.append(path);
    }
  }

  protected focusedNode(): string | null {
    for (const [id, button] of this.nodeEls) {
      if (button === document.activeElement) return id;
    }
    return null;
  }

  /* The lines, from the right edge of a node to the left edge of the next,
     in the pixels of the diagram. */
  protected drawLines(): void {
    const width = this.diagram.scrollWidth;
    const height = this.diagram.scrollHeight;
    this.svg.setAttribute('width', String(width));
    this.svg.setAttribute('height', String(height));
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    this.edges.forEach((edge, i) => {
      const from = this.nodeEls.get(edge.from);
      const to = this.nodeEls.get(edge.to);
      if (from === undefined || to === undefined) return;
      const sx = from.offsetLeft + from.offsetWidth;
      const sy = from.offsetTop + from.offsetHeight / 2;
      const tx = to.offsetLeft;
      const ty = to.offsetTop + to.offsetHeight / 2;
      const bend = Math.max(16, (tx - sx) / 2);
      const d =
        `M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx - 1} ${ty} ` +
        `M ${tx - 7} ${ty - 4} L ${tx - 1} ${ty} L ${tx - 7} ${ty + 4}`;
      this.pathEls[i].setAttribute('d', d);
    });
  }

  protected highlight(id: string | null): void {
    this.diagram.classList.toggle('ch-active', id !== null);
    for (const button of this.nodeEls.values()) {
      button.classList.remove('ch-on', 'ch-in', 'ch-outn');
    }
    this.pathEls.forEach((path) => path.classList.remove('ch-edge-in', 'ch-edge-out'));
    if (id === null) {
      this.detail.textContent = idleDetail;
      return;
    }

    const feeds: string[] = [];
    const fedBy: string[] = [];
    this.edges.forEach((edge, i) => {
      if (edge.to === id) {
        this.pathEls[i].classList.add('ch-edge-in');
        this.nodeEls.get(edge.from)?.classList.add('ch-in');
        fedBy.push(this.nodeName(edge.from));
      } else if (edge.from === id) {
        this.pathEls[i].classList.add('ch-edge-out');
        this.nodeEls.get(edge.to)?.classList.add('ch-outn');
        feeds.push(this.nodeName(edge.to));
      }
    });
    this.nodeEls.get(id)?.classList.add('ch-on');

    const node = this.nodes.find((n) => n.id === id)!;
    this.detail.textContent = '';
    this.detail.append(node.detail);
    if (fedBy.length > 0) {
      const line = el('span', 'ch-key-in', ` Fed by: ${fedBy.join(', ')}.`);
      this.detail.append(line);
    }
    if (feeds.length > 0) {
      const line = el('span', 'ch-key-out', ` Feeds: ${feeds.join(', ')}.`);
      this.detail.append(line);
    }
  }

  protected nodeName(id: string): string {
    return this.nodes.find((n) => n.id === id)?.name ?? '';
  }

  /* How many of each the local player owns: Player's counts of completed
     and incomplete buildings. */
  protected refreshCounts(): void {
    const player = this.iface.getPlayer();
    for (const node of this.nodes) {
      const count = this.countEls.get(node.id);
      const button = this.nodeEls.get(node.id);
      if (count === undefined || button === undefined || node.type === null) continue;

      let done = 0;
      let started = 0;
      if (player !== null) {
        if (node.id === 'store') {
          done = (player.hasCastle() ? 1 : 0) + player.getCompletedBuildingCount(B.TypeStock);
          started = player.getIncompleteBuildingCount(B.TypeStock);
        } else {
          done = player.getCompletedBuildingCount(node.type);
          started = player.getIncompleteBuildingCount(node.type);
        }
      }
      const text = started > 0 ? `${done} +${started}` : String(done);
      if (count.textContent !== text) count.textContent = text;
      count.classList.toggle('ch-has', done + started > 0);
      const label =
        `${node.name}, ${done} built` + (started > 0 ? `, ${started} under construction` : '');
      button.setAttribute('aria-label', label);
      button.title = label;
    }
  }
}

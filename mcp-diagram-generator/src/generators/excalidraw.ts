import * as fs from 'fs/promises';
import * as path from 'path';
import { DiagramSpec, Node, Edge, Container, Geometry } from '../types.js';

interface ExcalidrawElement {
  type: string;
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: string;
  strokeWidth?: number;
  strokeStyle?: string;
  roughness?: number;
  opacity?: number;
  text?: string;
  fontSize?: number;
  fontFamily?: number;
  points?: [[number, number], [number, number]];
  startArrowhead?: string | null;
  endArrowhead?: string | null;
  startBinding?: { elementId: string; focus?: number; gap?: number };
  endBinding?: { elementId: string; focus?: number; gap?: number };
  containerId?: { id: string };
  groupIds?: string[];
  angle?: number;
  roundness?: { type: number };
}

interface ExcalidrawData {
  type: 'excalidraw';
  version: number;
  source: string;
  elements: ExcalidrawElement[];
  appState: {
    viewBackgroundColor: string;
  };
}

interface ElementPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

const DEFAULT_NODE_WIDTH = 160;
const DEFAULT_NODE_HEIGHT = 70;
const DEFAULT_CONTAINER_WIDTH = 360;
const DEFAULT_CONTAINER_HEIGHT = 240;
const CONTAINER_PADDING_X = 32;
const CONTAINER_HEADER_HEIGHT = 64;
const CONTAINER_PADDING_BOTTOM = 32;
const NODE_GAP_X = 64;
const NODE_GAP_Y = 40;
const ROOT_START_X = 80;
const ROOT_START_Y = 80;
const ROOT_GAP_X = 80;
const ROOT_GAP_Y = 70;

export class ExcalidrawGenerator {
  private idMap = new Map<string, string>();
  private positionMap = new Map<string, ElementPosition>();
  private boundArrowsMap = new Map<string, Array<{ type: 'arrow'; id: string }>>();
  private edgeIdMap = new Map<any, string>();
  private nextId = 1;

  async generate(spec: DiagramSpec, outputPath: string): Promise<void> {
    this.resetState();
    const data = this.generateData(spec);
    const dir = path.dirname(outputPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  private resetState(): void {
    this.idMap.clear();
    this.positionMap.clear();
    this.boundArrowsMap.clear();
    this.edgeIdMap.clear();
    this.nextId = 1;
  }

  private preassignIds(elements: any[]): void {
    for (const element of elements) {
      if (element.type === 'container') {
        this.idMap.set(element.id, (this.nextId++).toString());
        if (element.children) {
          this.preassignIds(element.children);
        }
      } else if (element.type === 'node') {
        this.idMap.set(element.id, (this.nextId++).toString());
      }
    }
  }

  private generateData(spec: DiagramSpec): ExcalidrawData {
    const elements: ExcalidrawElement[] = [];

    this.normalizeLayout(spec.elements);

    // 1. 预分配所有 Node 和 Container 的 ID
    this.preassignIds(spec.elements);

    // 2. 预分配 Edge ID 并构建双向吸附映射
    const edges = spec.elements.filter(e => e.type === 'edge') as Edge[];
    for (const edge of edges) {
      const arrowId = (this.nextId++).toString();
      this.edgeIdMap.set(edge, arrowId);

      const sourceExId = this.idMap.get(edge.source);
      const targetExId = this.idMap.get(edge.target);

      if (sourceExId) {
        if (!this.boundArrowsMap.has(sourceExId)) {
          this.boundArrowsMap.set(sourceExId, []);
        }
        this.boundArrowsMap.get(sourceExId)!.push({ type: 'arrow', id: arrowId });
      }
      if (targetExId) {
        if (!this.boundArrowsMap.has(targetExId)) {
          this.boundArrowsMap.set(targetExId, []);
        }
        this.boundArrowsMap.get(targetExId)!.push({ type: 'arrow', id: arrowId });
      }
    }

    // 3. 生成 Container 和 Node 元素
    for (const element of spec.elements) {
      if (element.type === 'container') {
        const containerElements = this.generateContainer(element, 0, 0);
        elements.push(...containerElements);
      } else if (element.type === 'node') {
        const nodeElements = this.generateNode(element, 0, 0);
        if (Array.isArray(nodeElements)) {
          elements.push(...nodeElements);
        } else {
          elements.push(nodeElements);
        }
      }
    }

    // 4. 生成 Edge 元素
    for (const element of spec.elements) {
      if (element.type === 'edge') {
        const edgeResult = this.generateEdge(element);
        if (Array.isArray(edgeResult)) {
          elements.push(...edgeResult);
        } else if (edgeResult) {
          elements.push(edgeResult);
        }
      }
    }

    return {
      type: 'excalidraw',
      version: 2,
      source: 'mcp-diagram-generator',
      elements,
      appState: {
        viewBackgroundColor: '#ffffff'
      }
    };
  }

  private generateContainer(container: Container, parentAbsX: number, parentAbsY: number): ExcalidrawElement[] {
    const elements: ExcalidrawElement[] = [];
    const idStr = this.idMap.get(container.id) || (this.nextId++).toString();
    const labelId = this.nextId++;
    const labelIdStr = labelId.toString();
    const groupId = `${idStr}-group`;

    const geometry = this.resolveContainerGeometry(container);
    // 计算当前容器的绝对位置
    const absX = parentAbsX + (container.geometry?.x || 0);
    const absY = parentAbsY + (container.geometry?.y || 0);
    const width = geometry.width || DEFAULT_CONTAINER_WIDTH;
    const height = geometry.height || DEFAULT_CONTAINER_HEIGHT;
    const strokeColor = geometry.strokeColor;
    const strokeWidth = geometry.strokeWidth || 2;

    const boundElements = this.boundArrowsMap.get(idStr) || [];
    const allBoundElements = [...boundElements, { type: 'text', id: labelIdStr }];

    const containerElement: ExcalidrawElement = {
      type: 'rectangle',
      id: idStr,
      x: absX,
      y: absY,
      width,
      height,
      strokeColor: strokeColor,
      backgroundColor: 'transparent',
      strokeWidth: strokeWidth || 2,
      strokeStyle: 'solid',
      roughness: 1,
      opacity: 100,
      boundElements: allBoundElements,
      groupIds: [groupId]
    } as any;

    const labelElement: ExcalidrawElement = {
      type: 'text',
      id: labelIdStr,
      x: absX + 10,
      y: absY + 10,
      width: width - 20,
      height: 30,
      text: container.name,
      fontSize: 20,
      fontFamily: 1,
      textAlign: 'center',
      verticalAlign: 'top',
      strokeColor: '#000000',
      roughness: 1,
      opacity: 100,
      containerId: idStr,
      groupIds: [groupId]
    } as any;

    elements.push(containerElement, labelElement);

    // 保存容器位置信息（用于计算连线位置）
    this.positionMap.set(idStr, { x: absX, y: absY, width, height });

    if (container.children) {
      for (const child of container.children) {
        if (child.type === 'container') {
          // 子容器的绝对坐标基准为当前容器的绝对坐标 absX, absY
          const childElements = this.generateContainer(child, absX, absY);
          elements.push(...childElements);
        } else if (child.type === 'node') {
          // 子节点的绝对坐标基准为当前容器的绝对坐标 absX, absY
          const nodeElements = this.generateNode(child, absX, absY);
          if (Array.isArray(nodeElements)) {
            elements.push(...nodeElements);
          } else {
            elements.push(nodeElements);
          }
        }
      }
    }

    return elements;
  }

  private generateNode(node: Node, parentAbsX: number, parentAbsY: number): ExcalidrawElement | ExcalidrawElement[] {
    const idStr = this.idMap.get(node.id) || (this.nextId++).toString();
    const textId = this.nextId++;
    const textIdStr = textId.toString();
    const groupId = `${idStr}-group`;
    const { width, height, shape } = this.resolveNodeGeometry(node);

    // 计算当前节点的绝对位置
    const absX = parentAbsX + (node.geometry?.x || 0);
    const absY = parentAbsY + (node.geometry?.y || 0);
    const nodeWidth = width || DEFAULT_NODE_WIDTH;
    const nodeHeight = height || DEFAULT_NODE_HEIGHT;

    const boundElements = this.boundArrowsMap.get(idStr) || [];
    const allBoundElements = [...boundElements, { type: 'text', id: textIdStr }];

    // 创建形状元素
    const element: ExcalidrawElement = {
      type: shape === 'ellipse' ? 'ellipse' : shape === 'diamond' ? 'diamond' : 'rectangle',
      id: idStr,
      x: absX,
      y: absY,
      width: nodeWidth,
      height: nodeHeight,
      strokeColor: node.style?.strokeColor || '#000000',
      backgroundColor: node.style?.fillColor || 'transparent',
      fillStyle: 'solid',
      strokeWidth: node.style?.strokeWidth || 2,
      strokeStyle: 'solid',
      roughness: 1,
      opacity: 100,
      boundElements: allBoundElements,
      groupIds: [groupId]
    } as any;

    if (shape === 'rounded') {
      (element as any).roundness = { type: 3 };
    }

    // 创建独立的文本元素
    const textElement: ExcalidrawElement = {
      type: 'text',
      id: textIdStr,
      x: absX + 10,
      y: absY + nodeHeight / 2 - 10,
      width: nodeWidth - 20,
      height: 20,
      text: node.name,
      fontSize: 16,
      fontFamily: 1,
      textAlign: 'center',
      verticalAlign: 'middle',
      strokeColor: node.style?.fontColor || '#000000',
      roughness: 1,
      opacity: 100,
      containerId: idStr,
      groupIds: [groupId]
    } as any;

    // 保存节点位置信息（使用形状的 ID）
    this.positionMap.set(idStr, { x: absX, y: absY, width: nodeWidth, height: nodeHeight });

    // 返回形状和文本元素
    return [element, textElement];
  }

  private generateEdge(edge: Edge): ExcalidrawElement | ExcalidrawElement[] | null {
    const sourceId = this.idMap.get(edge.source);
    const targetId = this.idMap.get(edge.target);

    if (!sourceId || !targetId) {
      return null;
    }

    const arrowId = this.edgeIdMap.get(edge) || (this.nextId++).toString();

    // 计算源元素和目标元素的位置
    const sourcePos = this.positionMap.get(sourceId);
    const targetPos = this.positionMap.get(targetId);

    let points: [[number, number], [number, number]] = [[0, 0], [1, 1]];
    let arrowX = 0;
    let arrowY = 0;
    let labelX = 0;
    let labelY = 0;
    let labelWidth = Math.max(40, (edge.label?.length || 0) * 18);
    const labelHeight = 20;
    let startFocus = 0;
    let endFocus = 0;

    if (sourcePos && targetPos) {
      const sourceCenter = this.getCenter(sourcePos);
      const targetCenter = this.getCenter(targetPos);
      const sourceBoundary = this.getBoundaryPoint(sourcePos, targetCenter);
      const targetBoundary = this.getBoundaryPoint(targetPos, sourceCenter);

      arrowX = sourceBoundary.x;
      arrowY = sourceBoundary.y;

      points = [
        [0, 0],
        [targetBoundary.x - sourceBoundary.x, targetBoundary.y - sourceBoundary.y]
      ];

      const labelPosition = this.getEdgeLabelPosition(sourceBoundary, targetBoundary, labelWidth, labelHeight);
      labelX = labelPosition.x;
      labelY = labelPosition.y;
      startFocus = this.getBindingFocus(sourcePos, sourceBoundary);
      endFocus = this.getBindingFocus(targetPos, targetBoundary);
    }

    const element: ExcalidrawElement = {
      type: 'arrow',
      id: arrowId,
      x: arrowX,
      y: arrowY,
      width: points[1][0],
      height: points[1][1],
      strokeColor: edge.style?.strokeColor || '#000000',
      strokeWidth: edge.style?.strokeWidth || 2,
      strokeStyle: edge.style?.dashPattern ? 'dashed' : 'solid',
      roughness: 1,
      opacity: 100,
      points: points,
      lastCommittedPoint: points[points.length - 1],
      startArrowhead: null,
      endArrowhead: 'arrow',
      startBinding: {
        elementId: sourceId,
        focus: startFocus,
        gap: 0
      },
      endBinding: {
        elementId: targetId,
        focus: endFocus,
        gap: 0
      }
    } as any;

    if (edge.style?.endArrow === 'none') {
      element.endArrowhead = null;
    }

    if (edge.label) {
      const labelId = this.nextId++;

      const labelElement: ExcalidrawElement = {
        type: 'text',
        id: labelId.toString(),
        x: labelX,
        y: labelY,
        width: labelWidth,
        height: labelHeight,
        text: edge.label,
        fontSize: 14,
        fontFamily: 1,
        strokeColor: edge.style?.strokeColor || '#000000',
        roughness: 1,
        opacity: 100
      } as any;

      // 将标签绑定到箭头
      (labelElement as any).containerId = arrowId;

      // 在箭头上记录绑定的元素
      (element as any).boundElements = (element as any).boundElements || [];
      (element as any).boundElements.push({
        type: 'text',
        id: labelId.toString()
      });

      return [element, labelElement];
    }

    return element;
  }

  private resolveContainerGeometry(container: Container): Geometry & { fillColor: string; strokeColor: string; strokeWidth: number } {
    const defaultStyles: Record<string, any> = {
      environment: { fillColor: '#e1d5e7', strokeColor: '#9673a6', strokeWidth: 3 },
      datacenter: { fillColor: '#d5e8d4', strokeColor: '#82b366', strokeWidth: 2 },
      zone: { fillColor: '#fff2cc', strokeColor: '#d6b656', strokeWidth: 2 }
    };

    const defaults = defaultStyles[container.level || 'other'] || {
      fillColor: '#dae8fc',
      strokeColor: '#6c8ebf',
      strokeWidth: 2
    };

    return {
      x: container.geometry?.x || 0,
      y: container.geometry?.y || 0,
      width: container.geometry?.width || DEFAULT_CONTAINER_WIDTH,
      height: container.geometry?.height || DEFAULT_CONTAINER_HEIGHT,
      fillColor: container.style?.fillColor || defaults.fillColor,
      strokeColor: container.style?.strokeColor || defaults.strokeColor,
      strokeWidth: container.style?.strokeWidth ?? defaults.strokeWidth
    };
  }

  private resolveNodeGeometry(node: Node): Geometry & { shape: string } {
    const shapes: Record<string, string> = {
      rect: 'rectangle',
      ellipse: 'ellipse',
      diamond: 'diamond',
      parallelogram: 'rectangle',
      rounded: 'rectangle',
      cylinder: 'rectangle',
      cloud: 'rectangle',
      other: 'rectangle'
    };

    return {
      x: node.geometry?.x || 0,
      y: node.geometry?.y || 0,
      width: node.geometry?.width || DEFAULT_NODE_WIDTH,
      height: node.geometry?.height || DEFAULT_NODE_HEIGHT,
      shape: shapes[node.shape || 'other'] || 'rectangle'
    };
  }

  private normalizeLayout(elements: any[]): void {
    const roots = elements.filter(element => element.type !== 'edge');

    for (const element of roots) {
      if (element.type === 'container') {
        this.normalizeContainerLayout(element);
      } else {
        this.ensureElementGeometry(element);
      }
    }

    this.layoutElements(roots, ROOT_START_X, ROOT_START_Y, 3, ROOT_GAP_X, ROOT_GAP_Y);
  }

  private normalizeContainerLayout(container: Container): void {
    this.ensureElementGeometry(container);

    const children = container.children || [];
    for (const child of children) {
      if (child.type === 'container') {
        this.normalizeContainerLayout(child);
      } else {
        this.ensureElementGeometry(child);
      }
    }

    const maxCols = children.length <= 4 ? 2 : 3;
    this.layoutElements(children, CONTAINER_PADDING_X, CONTAINER_HEADER_HEIGHT, maxCols, NODE_GAP_X, NODE_GAP_Y);
    this.expandContainerToFitChildren(container, children);
  }

  private layoutElements(elements: Array<Container | Node>, startX: number, startY: number, maxCols: number, gapX: number, gapY: number): void {
    let col = 0;
    let cursorX = startX;
    let cursorY = startY;
    let rowHeight = 0;

    for (const element of elements) {
      const geometry = this.ensureElementGeometry(element);
      const shouldPlace = this.shouldAutoPlace(element);

      if (shouldPlace) {
        geometry.x = cursorX;
        geometry.y = cursorY;
      }

      const placedX = shouldPlace ? cursorX : geometry.x;
      rowHeight = Math.max(rowHeight, geometry.height || DEFAULT_NODE_HEIGHT);
      cursorX = placedX + (geometry.width || DEFAULT_NODE_WIDTH) + gapX;
      col += 1;

      if (col >= maxCols) {
        col = 0;
        cursorX = startX;
        cursorY += rowHeight + gapY;
        rowHeight = 0;
      }
    }
  }

  private expandContainerToFitChildren(container: Container, children: Array<Container | Node>): void {
    const geometry = this.ensureElementGeometry(container);
    if (children.length === 0) {
      return;
    }

    const maxRight = Math.max(...children.map(child => {
      const childGeometry = this.ensureElementGeometry(child);
      return childGeometry.x + (childGeometry.width || DEFAULT_NODE_WIDTH);
    }));
    const maxBottom = Math.max(...children.map(child => {
      const childGeometry = this.ensureElementGeometry(child);
      return childGeometry.y + (childGeometry.height || DEFAULT_NODE_HEIGHT);
    }));

    geometry.width = Math.max(geometry.width || DEFAULT_CONTAINER_WIDTH, maxRight + CONTAINER_PADDING_X);
    geometry.height = Math.max(geometry.height || DEFAULT_CONTAINER_HEIGHT, maxBottom + CONTAINER_PADDING_BOTTOM);
  }

  private ensureElementGeometry(element: Container | Node): Geometry {
    const defaults = element.type === 'container'
      ? { width: DEFAULT_CONTAINER_WIDTH, height: DEFAULT_CONTAINER_HEIGHT }
      : { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT };

    element.geometry = {
      x: element.geometry?.x || 0,
      y: element.geometry?.y || 0,
      width: element.geometry?.width || defaults.width,
      height: element.geometry?.height || defaults.height
    };

    return element.geometry;
  }

  private shouldAutoPlace(element: Container | Node): boolean {
    return !element.geometry || ((element.geometry.x || 0) === 0 && (element.geometry.y || 0) === 0);
  }

  private getCenter(position: ElementPosition): Point {
    return {
      x: position.x + position.width / 2,
      y: position.y + position.height / 2
    };
  }

  private getBoundaryPoint(position: ElementPosition, toward: Point): Point {
    const center = this.getCenter(position);
    const dx = toward.x - center.x;
    const dy = toward.y - center.y;

    if (dx === 0 && dy === 0) {
      return { x: center.x + position.width / 2, y: center.y };
    }

    const halfWidth = position.width / 2;
    const halfHeight = position.height / 2;
    const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : halfWidth / Math.abs(dx);
    const scaleY = dy === 0 ? Number.POSITIVE_INFINITY : halfHeight / Math.abs(dy);
    const scale = Math.min(scaleX, scaleY);

    return {
      x: center.x + dx * scale,
      y: center.y + dy * scale
    };
  }

  private getBindingFocus(position: ElementPosition, boundaryPoint: Point): number {
    const center = this.getCenter(position);
    const halfWidth = position.width / 2;
    const halfHeight = position.height / 2;
    const touchesVerticalEdge = Math.abs(Math.abs(boundaryPoint.x - center.x) - halfWidth) < 0.1;
    const rawFocus = touchesVerticalEdge
      ? (boundaryPoint.y - center.y) / halfHeight
      : (boundaryPoint.x - center.x) / halfWidth;

    return Math.max(-1, Math.min(1, rawFocus));
  }

  private getEdgeLabelPosition(start: Point, end: Point, labelWidth: number, labelHeight: number): Point {
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;
    const dx = end.x - start.x;
    const dy = end.y - start.y;

    if (Math.abs(dx) >= Math.abs(dy)) {
      return {
        x: midX - labelWidth / 2,
        y: midY - labelHeight - 12
      };
    }

    return {
      x: midX + 12,
      y: midY - labelHeight / 2
    };
  }
}

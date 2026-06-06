import * as fs from 'fs/promises';
import * as path from 'path';
import { DiagramSpec, Container, Node, Edge, Style, Geometry, Swimlane, SwimlaneStep } from '../types.js';

type DiagramVertex = Container | Node;
type FlatNode = {
  id: string;
  element: DiagramVertex;
  parentId: string;
  absoluteGeometry: Required<Geometry>;
};
type NodeStylePreset = Style & { shapeStyle: string };
const DEFAULT_NODE_WIDTH = 180;
const DEFAULT_NODE_HEIGHT = 72;
const DEFAULT_FONT_SIZE = 20;
const DEFAULT_CONTAINER_WIDTH = 280;
const DEFAULT_CONTAINER_HEIGHT = 150;
const CONTAINER_PADDING_X = 24;
const CONTAINER_PADDING_BOTTOM = 24;
const CONTAINER_HEADER_HEIGHT = 52;
const NODE_HORIZONTAL_GAP = 72;
const NODE_VERTICAL_GAP = 24;
const CONTAINER_GAP = 36;
const ARCHITECTURE_COMPONENTS_PER_ROW = 3;
const SWIMLANE_GAP = 18;
const FLOWCHART_BRANCH_GAP = 72;
const FLOWCHART_LEVEL_GAP = 52;

export class DrawioGenerator {
  private nextCellId = 1;
  private idMap = new Map<string, string>();
  private flatNodes: FlatNode[] = [];
  private flatEdges: Edge[] = [];
  private renderedEdgeLabels = new Set<string>();
  private shouldRenderEdgeLabels = true;
  private shouldForceStraightEdges = false;
  private swimlaneStepColumns = new Map<string, number>();
  private swimlaneColumnCount = 0;

  async generate(spec: DiagramSpec, outputPath: string): Promise<void> {
    const xml = this.generateXml(spec);
    const dir = path.dirname(outputPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(outputPath, xml, 'utf-8');
  }

  private generateXml(spec: DiagramSpec): string {
    this.resetState();

    const elements = this.buildDrawableElements(spec);
    const isNetworkTopology = this.isNetworkTopology(elements, spec.diagramType);
    this.shouldRenderEdgeLabels = !isNetworkTopology;
    this.shouldForceStraightEdges = isNetworkTopology;
    this.normalizeLayout(elements, spec.diagramType);

    this.flattenElements(elements);

    const pageWidth = 1654;
    const pageHeight = 2339;

    const childrenXml = this.buildChildrenXml();
    const edgesXml = this.buildEdgesXml();

    return `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="Electron" agent="Claude MCP Server" version="1.0.0" pages="1">
  <diagram name="${this.escapeXml(spec.title || 'diagram')}" id="diagram-1">
    <mxGraphModel dx="1426" dy="840" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${pageWidth}" pageHeight="${pageHeight}" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="root-parent" parent="0" />
${childrenXml}${edgesXml}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;
  }

  private resetState(): void {
    this.nextCellId = 1;
    this.idMap.clear();
    this.flatNodes = [];
    this.flatEdges = [];
    this.renderedEdgeLabels.clear();
    this.shouldRenderEdgeLabels = true;
    this.shouldForceStraightEdges = false;
    this.swimlaneStepColumns.clear();
    this.swimlaneColumnCount = 0;
  }

  private buildDrawableElements(spec: DiagramSpec): any[] {
    if (spec.diagramType === 'architecture' && spec.layers && spec.layers.length > 0) {
      const layerContainers = spec.layers.map(layer => ({
        id: layer.id,
        type: 'container',
        name: layer.name,
        level: 'other',
        style: this.getArchitectureLayerStyle(layer.name),
        children: layer.components.map(component => ({
          ...component,
          type: 'node'
        }))
      }));
      return [...layerContainers, ...spec.elements.filter(element => element.type === 'edge')];
    }

    if (spec.diagramType === 'swimlane' && spec.lanes && spec.lanes.length > 0) {
      const edges: Edge[] = [];
      this.buildSwimlaneStepColumns(spec.lanes);
      const laneContainers = spec.lanes.map(lane => {
        const sortedSteps = [...lane.steps].sort((a, b) => (a.order || 0) - (b.order || 0));

        for (const step of sortedSteps) {
          for (const next of step.next || []) {
            edges.push({
              type: 'edge',
              source: step.id,
              target: next,
              style: { lineStyle: 'orthogonal', endArrow: 'arrow' }
            });
          }
        }

        return {
          id: lane.id,
          type: 'container',
          name: lane.name,
          level: 'other',
          children: sortedSteps.map(step => this.swimlaneStepToNode(step))
        };
      });

      return [
        ...laneContainers,
        ...spec.elements.filter(element => element.type === 'edge'),
        ...edges
      ];
    }

    return spec.elements;
  }

  private swimlaneStepToNode(step: SwimlaneStep): Node {
    return {
      id: step.id,
      type: 'node',
      name: step.name,
      deviceType: step.deviceType || 'service'
    };
  }

  private buildSwimlaneStepColumns(lanes: Swimlane[]): void {
    const steps = lanes.flatMap(lane => lane.steps);
    const orderedValues = [...new Set(steps
      .map(step => step.order)
      .filter((order): order is number => order !== undefined))]
      .sort((a, b) => a - b);
    const orderColumns = new Map(orderedValues.map((order, index) => [order, index]));
    let nextColumn = orderedValues.length;

    for (const lane of lanes) {
      for (const step of lane.steps) {
        const column = step.order !== undefined ? orderColumns.get(step.order)! : nextColumn++;
        this.swimlaneStepColumns.set(step.id, column);
      }
    }

    this.swimlaneColumnCount = Math.max(nextColumn, 1);
  }

  private flattenElements(elements: any[]): void {
    for (const element of elements) {
      if (element.type === 'edge') {
        this.flatEdges.push(element);
      } else {
        this.flattenNode(element, 'root-parent');
      }
    }
  }

  private flattenNode(element: DiagramVertex, parentId: string, parentAbsX = 0, parentAbsY = 0): void {
    const cellId = (this.nextCellId++).toString();
    const geometry = this.getGeometry(element);
    const absoluteGeometry = {
      ...geometry,
      x: parentAbsX + geometry.x,
      y: parentAbsY + geometry.y
    };

    this.idMap.set(element.id, cellId);
    this.flatNodes.push({ id: cellId, element, parentId, absoluteGeometry });

    if (element.type === 'container' && element.children) {
      for (const child of element.children) {
        this.flattenNode(child, cellId, absoluteGeometry.x, absoluteGeometry.y);
      }
    }
  }

  private buildChildrenXml(): string {
    return this.flatNodes
      .map(({ id, element, parentId }) => {
        if (element.type === 'container') {
          return this.buildContainerXml(id, element, parentId);
        } else {
          return this.buildNodeXml(id, element, parentId);
        }
      })
      .join('\n');
  }

  private buildContainerXml(id: string, container: Container, parentId: string): string {
    const style = this.buildContainerStyle(container.style, container.level);
    const { x = 0, y = 0, width = 300, height = 200 } = container.geometry || {};
    const name = this.escapeXml(container.name);

    return `        <mxCell id="${id}" value="${name}" style="${style}" parent="${parentId}" vertex="1">
          <mxGeometry x="${x}" y="${y}" width="${width}" height="${height}" as="geometry" />
        </mxCell>`;
  }

  private buildNodeXml(id: string, node: Node, parentId: string): string {
    const style = this.buildNodeStyle(node.style, node.deviceType, node.shape);
    const { x = 0, y = 0, width = 100, height = 50 } = node.geometry || {};
    const name = this.escapeXml(node.name);

    return `        <mxCell id="${id}" value="${name}" style="${style}" parent="${parentId}" vertex="1">
          <mxGeometry x="${x}" y="${y}" width="${width}" height="${height}" as="geometry" />
        </mxCell>`;
  }

  private buildEdgesXml(): string {
    return this.flatEdges
      .map((edge, index) => {
        const cellId = (this.nextCellId++).toString();
        const sourceId = this.idMap.get(edge.source) || edge.source;
        const targetId = this.idMap.get(edge.target) || edge.target;

        const sourceNode = this.flatNodes.find(n => n.element.id === edge.source);
        const targetNode = this.flatNodes.find(n => n.element.id === edge.target);

        // 如果源与目标节点在同一个父容器中，将 parent 设为该容器 ID，以实现拖动容器时连线跟移
        let parentId = 'root-parent';
        if (sourceNode && targetNode && sourceNode.parentId === targetNode.parentId) {
          parentId = sourceNode.parentId;
        }

        const style = this.buildEdgeStyle(edge.style, sourceNode?.absoluteGeometry, targetNode?.absoluteGeometry);
        const labelText = this.getVisibleEdgeLabel(edge.label);
        const label = labelText ? ` value="${this.escapeXml(labelText)}"` : '';

        return `        <mxCell id="${cellId}"${label} style="${style}" parent="${parentId}" source="${sourceId}" target="${targetId}" edge="1">
          <mxGeometry width="50" height="50" relative="1" as="geometry">
            <mxPoint x="0" y="0" as="sourcePoint" />
            <mxPoint x="0" y="0" as="targetPoint" />
          </mxGeometry>
        </mxCell>`;
      })
      .join('\n');
  }

  private buildContainerStyle(style?: Style, level?: string): string {
    const defaults = this.getDefaultContainerStyle(level);
    const merged = { ...defaults, ...style };
    return `swimlane;whiteSpace=wrap;html=1;collapsible=0;${this.styleToString(merged)}`;
  }

  private buildNodeStyle(style?: Style, deviceType?: string, shape?: string): string {
    const defaults = this.getDefaultNodeStyle(deviceType);
    const merged = { ...defaults, ...style };

    let shapeStyle = defaults.shapeStyle || 'shape=rect';
    if (shape) {
      const shapeMap: Record<string, string> = {
        rect: 'shape=rect',
        ellipse: 'shape=ellipse',
        diamond: 'shape=diamond',
        parallelogram: 'shape=parallelogram',
        rounded: 'rounded=1;shape=rect',
        cylinder: 'shape=cylinder3',
        cloud: 'shape=cloud'
      };
      shapeStyle = shapeMap[shape] || 'shape=rect';
    }

    return `${shapeStyle};whiteSpace=wrap;html=1;align=center;verticalAlign=middle;spacing=8;${this.styleToString(merged)}`;
  }

  private buildEdgeStyle(style?: any, source?: Required<Geometry>, target?: Required<Geometry>): string {
    const defaults: any = {
      endArrow: 'none',
      lineStyle: 'straight'
    };
    const merged: any = { ...defaults, ...style };
    if (this.shouldForceStraightEdges) {
      merged.lineStyle = 'straight';
    }

    let result = 'html=1;rounded=0;endFill=0;fontSize=9;labelBackgroundColor=#ffffff;';

    if (merged.endArrow && merged.endArrow !== 'none') {
      result = `html=1;rounded=0;endFill=1;endArrow=${merged.endArrow};fontSize=9;labelBackgroundColor=#ffffff;`;
    }

    if (merged.startArrow && merged.startArrow !== 'none') {
      result += `startArrow=${merged.startArrow};`;
    }

    if (merged.lineStyle === 'orthogonal') {
      result += `edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;`;
    }

    if (merged.strokeColor) {
      result += `strokeColor=${merged.strokeColor};`;
    }

    if (merged.strokeWidth) {
      result += `strokeWidth=${merged.strokeWidth};`;
    }

    if (merged.dashPattern) {
      result += `dashed=1;dashPattern=${merged.dashPattern};`;
    }

    if (source && target) {
      const sX = source.x + source.width / 2;
      const sY = source.y + source.height / 2;
      const tX = target.x + target.width / 2;
      const tY = target.y + target.height / 2;

      const dx = tX - sX;
      const dy = tY - sY;

      let anchorStyle = '';
      if (Math.abs(dy) > Math.abs(dx)) {
        if (dy > 0) {
          anchorStyle = 'exitX=0.5;exitY=1;entryX=0.5;entryY=0;';
        } else {
          anchorStyle = 'exitX=0.5;exitY=0;entryX=0.5;entryY=1;';
        }
      } else {
        if (dx > 0) {
          anchorStyle = 'exitX=1;exitY=0.5;entryX=0;entryY=0.5;';
        } else {
          anchorStyle = 'exitX=0;exitY=0.5;entryX=1;entryY=0.5;';
        }
      }
      result += anchorStyle;
    }

    return result;
  }

  private getDefaultContainerStyle(level?: string): Style {
    const levelStyles: Record<string, Style> = {
      environment: {
        fillColor: '#e1d5e7',
        strokeColor: '#9673a6',
        fontSize: DEFAULT_FONT_SIZE,
        fontStyle: 'bold'
      },
      datacenter: {
        fillColor: '#d5e8d4',
        strokeColor: '#82b366',
        fontSize: DEFAULT_FONT_SIZE,
        fontStyle: 'bold'
      },
      zone: {
        fillColor: '#fff2cc',
        strokeColor: '#d6b656',
        fontSize: DEFAULT_FONT_SIZE,
        fontStyle: 'bold'
      },
      other: {
        fillColor: '#dae8fc',
        strokeColor: '#6c8ebf',
        fontSize: DEFAULT_FONT_SIZE
      }
    };

    return levelStyles[level || 'other'] || {};
  }

  private getArchitectureLayerStyle(name: string): Style {
    const text = name.toLowerCase();

    if (this.includesAny(text, ['client', 'user', 'external', '用户', '客户端', '外部'])) {
      return { fillColor: '#F8FAFC', strokeColor: '#64748B', fontSize: DEFAULT_FONT_SIZE, fontStyle: 'bold' };
    }

    if (this.includesAny(text, ['access', 'gateway', 'edge', '入口', '网关', '接入'])) {
      return { fillColor: '#E0F2FE', strokeColor: '#0284C7', fontSize: DEFAULT_FONT_SIZE, fontStyle: 'bold' };
    }

    if (this.includesAny(text, ['service', 'application', 'app', '服务', '应用'])) {
      return { fillColor: '#E0E7FF', strokeColor: '#4F46E5', fontSize: DEFAULT_FONT_SIZE, fontStyle: 'bold' };
    }

    if (this.includesAny(text, ['data', 'storage', 'database', '数据', '存储'])) {
      return { fillColor: '#F3E8FF', strokeColor: '#9333EA', fontSize: DEFAULT_FONT_SIZE, fontStyle: 'bold' };
    }

    if (this.includesAny(text, ['dependency', 'third', 'cloud', '依赖', '三方', '云'])) {
      return { fillColor: '#ECFDF5', strokeColor: '#059669', fontSize: DEFAULT_FONT_SIZE, fontStyle: 'bold' };
    }

    return { fillColor: '#F8FAFC', strokeColor: '#94A3B8', fontSize: DEFAULT_FONT_SIZE, fontStyle: 'bold' };
  }

  private getDefaultNodeStyle(deviceType?: string): NodeStylePreset {
    const deviceStyles: Record<string, NodeStylePreset> = {
      router: {
        shapeStyle: 'shape=ellipse',
        fillColor: '#DBEAFE',
        strokeColor: '#2563EB',
        strokeWidth: 2,
        fontColor: '#1E3A8A',
        fontSize: DEFAULT_FONT_SIZE,
        fontStyle: 'bold'
      },
      switch: {
        shapeStyle: 'shape=rect',
        fillColor: '#FFFFCC',
        strokeColor: '#16A34A',
        strokeWidth: 2,
        fontColor: '#14532D',
        fontSize: DEFAULT_FONT_SIZE
      },
      accessSwitch: {
        shapeStyle: 'shape=rect',
        fillColor: '#FFFFCC',
        strokeColor: '#16A34A',
        strokeWidth: 2,
        fontColor: '#14532D',
        fontSize: DEFAULT_FONT_SIZE
      },
      coreSwitch: {
        shapeStyle: 'shape=rect;double=1',
        fillColor: '#FFFFCC',
        strokeColor: '#15803D',
        strokeWidth: 3,
        fontColor: '#14532D',
        fontSize: DEFAULT_FONT_SIZE,
        fontStyle: 'bold'
      },
      firewall: {
        shapeStyle: 'shape=hexagon;perimeter=hexagonPerimeter2',
        fillColor: '#FEE2E2',
        strokeColor: '#DC2626',
        strokeWidth: 2,
        fontColor: '#7F1D1D',
        fontSize: DEFAULT_FONT_SIZE,
        fontStyle: 'bold'
      },
      loadBalancer: {
        shapeStyle: 'rounded=1;shape=rect',
        fillColor: '#EDE9FE',
        strokeColor: '#7C3AED',
        strokeWidth: 2,
        fontColor: '#4C1D95',
        fontSize: DEFAULT_FONT_SIZE
      },
      sslGateway: {
        shapeStyle: 'rounded=1;shape=rect',
        fillColor: '#CFFAFE',
        strokeColor: '#0891B2',
        strokeWidth: 2,
        fontColor: '#164E63',
        fontSize: DEFAULT_FONT_SIZE
      },
      proxy: {
        shapeStyle: 'rounded=1;shape=rect',
        fillColor: '#E0F2FE',
        strokeColor: '#0284C7',
        strokeWidth: 2,
        fontColor: '#0C4A6E',
        fontSize: DEFAULT_FONT_SIZE
      },
      gateway: {
        shapeStyle: 'rounded=1;shape=rect',
        fillColor: '#CFFAFE',
        strokeColor: '#0891B2',
        strokeWidth: 2,
        fontColor: '#164E63',
        fontSize: DEFAULT_FONT_SIZE
      },
      service: {
        shapeStyle: 'rounded=1;shape=rect',
        fillColor: '#E0E7FF',
        strokeColor: '#4F46E5',
        strokeWidth: 2,
        fontColor: '#312E81',
        fontSize: DEFAULT_FONT_SIZE
      },
      server: {
        shapeStyle: 'rounded=1;shape=rect',
        fillColor: '#DBEAFE',
        strokeColor: '#2196F3',
        strokeWidth: 2,
        fontColor: '#0C4A6E',
        fontSize: DEFAULT_FONT_SIZE
      },
      database: {
        shapeStyle: 'shape=cylinder3',
        fillColor: '#F3E8FF',
        strokeColor: '#9C27B0',
        strokeWidth: 2,
        fontColor: '#581C87',
        fontSize: DEFAULT_FONT_SIZE
      },
      cache: {
        shapeStyle: 'shape=cylinder3',
        fillColor: '#FEF3C7',
        strokeColor: '#D97706',
        strokeWidth: 2,
        fontColor: '#78350F',
        fontSize: DEFAULT_FONT_SIZE
      },
      messageQueue: {
        shapeStyle: 'shape=parallelogram',
        fillColor: '#FFEDD5',
        strokeColor: '#EA580C',
        strokeWidth: 2,
        fontColor: '#7C2D12',
        fontSize: DEFAULT_FONT_SIZE
      },
      pc: {
        shapeStyle: 'shape=rect',
        fillColor: '#F1F5F9',
        strokeColor: '#607D8B',
        strokeWidth: 2,
        fontColor: '#334155',
        fontSize: DEFAULT_FONT_SIZE
      },
      user: {
        shapeStyle: 'shape=ellipse',
        fillColor: '#F8FAFC',
        strokeColor: '#475569',
        strokeWidth: 2,
        fontColor: '#334155',
        fontSize: DEFAULT_FONT_SIZE
      },
      cloud: {
        shapeStyle: 'shape=cloud',
        fillColor: '#F1F5F9',
        strokeColor: '#64748B',
        strokeWidth: 2,
        fontColor: '#334155',
        fontSize: DEFAULT_FONT_SIZE
      },
      externalSystem: {
        shapeStyle: 'shape=cloud',
        fillColor: '#F8FAFC',
        strokeColor: '#475569',
        strokeWidth: 2,
        fontColor: '#334155',
        fontSize: DEFAULT_FONT_SIZE
      },
      other: {
        shapeStyle: 'shape=rect',
        fillColor: '#F8FAFC',
        strokeColor: '#333333',
        strokeWidth: 2,
        fontColor: '#111827',
        fontSize: DEFAULT_FONT_SIZE
      }
    };

    return deviceStyles[deviceType || 'other'] || {
      shapeStyle: 'shape=rect',
      strokeColor: '#333333',
      strokeWidth: 2,
      fillColor: '#F8FAFC',
      fontColor: '#111827',
      fontSize: DEFAULT_FONT_SIZE
    };
  }

  private styleToString(style: Style): string {
    const parts: string[] = [];

    if (style.fillColor) parts.push(`fillColor=${style.fillColor}`);
    if (style.strokeColor) parts.push(`strokeColor=${style.strokeColor}`);
    if (style.strokeWidth) parts.push(`strokeWidth=${style.strokeWidth}`);
    if (style.fontColor) parts.push(`fontColor=${style.fontColor}`);
    if (style.fontSize) parts.push(`fontSize=${style.fontSize}`);
    if (style.fontStyle === 'bold') parts.push('fontStyle=1');
    if (style.fontStyle === 'italic') parts.push('fontStyle=2');

    return parts.join(';');
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private normalizeLayout(elements: any[], diagramType?: string): void {
    if (diagramType === 'flowchart') {
      this.layoutFlowchart(elements);
      return;
    }

    if (diagramType === 'architecture') {
      this.layoutArchitecture(elements);
      return;
    }

    if (diagramType === 'swimlane') {
      this.layoutSwimlane(elements);
      return;
    }

    let col = 0;
    let row = 0;
    const maxCols = 2;
    const colGap = NODE_HORIZONTAL_GAP;
    const rowGap = NODE_VERTICAL_GAP + 48;

    for (const element of elements) {
      if (element.type === 'edge') continue;

      this.normalizeElement(element, diagramType);

      if (!this.hasExplicitPosition(element)) {
        const geometry = this.getGeometry(element);
        element.geometry.x = col * (geometry.width + colGap) + 50;
        element.geometry.y = row * (geometry.height + rowGap) + 50;
      }

      col++;
      if (col >= maxCols) {
        col = 0;
        row++;
      }
    }
  }

  private layoutFlowchart(elements: any[]): void {
    const nodes = elements.filter(element => element.type === 'node') as Node[];
    const edges = elements.filter(element => element.type === 'edge') as Edge[];

    for (const node of nodes) {
      this.ensureNodeGeometry(node);
      this.applyFlowchartNodeDefaults(node);
    }

    const ranks = this.getFlowchartRanks(nodes, edges);
    const nodesByRank = new Map<number, Node[]>();
    for (const node of nodes) {
      const rank = ranks.get(node.id) || 0;
      const group = nodesByRank.get(rank) || [];
      group.push(node);
      nodesByRank.set(rank, group);
    }

    for (const [rank, group] of [...nodesByRank.entries()].sort(([a], [b]) => a - b)) {
      group.forEach((node, index) => {
        if (!this.hasExplicitPosition(node)) {
          node.geometry!.x = 50 + index * (DEFAULT_NODE_WIDTH + FLOWCHART_BRANCH_GAP);
          node.geometry!.y = 50 + rank * (DEFAULT_NODE_HEIGHT + FLOWCHART_LEVEL_GAP);
        }
      });
    }
  }

  private getFlowchartRanks(nodes: Node[], edges: Edge[]): Map<string, number> {
    const nodeIds = new Set(nodes.map(node => node.id));
    const incomingCount = new Map(nodes.map(node => [node.id, 0]));
    const outgoing = new Map<string, string[]>();

    for (const edge of edges) {
      if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
      if (this.isFlowchartBackwardEdge(edge)) continue;
      incomingCount.set(edge.target, (incomingCount.get(edge.target) || 0) + 1);
      const targets = outgoing.get(edge.source) || [];
      targets.push(edge.target);
      outgoing.set(edge.source, targets);
    }

    const startNodes = nodes.filter(node => this.isFlowchartStartNode(node) || (incomingCount.get(node.id) || 0) === 0);
    const queue = [...(startNodes.length > 0 ? startNodes : nodes)].map(node => node.id);
    const ranks = new Map<string, number>();

    for (const id of queue) {
      ranks.set(id, 0);
    }

    const maxRank = Math.max(nodes.length, 1);
    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentRank = ranks.get(current) || 0;

      for (const target of outgoing.get(current) || []) {
        const nextRank = currentRank + 1;
        if (nextRank <= maxRank && (ranks.get(target) || -1) < nextRank) {
          ranks.set(target, nextRank);
          queue.push(target);
        }
      }
    }

    for (const node of nodes) {
      if (!ranks.has(node.id)) {
        ranks.set(node.id, ranks.size);
      }
    }

    return ranks;
  }

  private applyFlowchartNodeDefaults(node: Node): void {
    if (node.shape) return;

    if (this.isFlowchartStartNode(node) || this.isFlowchartEndNode(node)) {
      node.shape = 'rounded';
      return;
    }

    if (this.isFlowchartDecisionNode(node)) {
      node.shape = 'diamond';
    }
  }

  private isFlowchartStartNode(node: Node): boolean {
    const text = `${node.id} ${node.name}`.toLowerCase();
    return this.includesAny(text, ['start', '开始', '发起']);
  }

  private isFlowchartEndNode(node: Node): boolean {
    const text = `${node.id} ${node.name}`.toLowerCase();
    return this.includesAny(text, ['end', '结束', '完成', '终止']);
  }

  private isFlowchartDecisionNode(node: Node): boolean {
    const text = `${node.id} ${node.name}`.toLowerCase();
    return this.includesAny(text, ['?', '是否', '判断', '审批', '审核', '校验', '验证', '通过']);
  }

  private isFlowchartBackwardEdge(edge: Edge): boolean {
    return this.includesAny(edge.label || '', ['退回', '返回', '驳回', '重试', '重新']);
  }

  private layoutArchitecture(elements: any[]): void {
    const layers = elements.filter(element => element.type === 'container');
    const normalizedLayers = layers.map(layer => {
      this.normalizeElement(layer, 'architecture');
      return layer;
    });
    const maxLayerWidth = Math.max(...normalizedLayers.map(layer => this.getGeometry(layer).width), DEFAULT_CONTAINER_WIDTH);
    let y = 50;

    for (const layer of normalizedLayers) {
      const geometry = this.getGeometry(layer);
      layer.geometry.x = 50;
      layer.geometry.y = y;
      layer.geometry.width = Math.max(maxLayerWidth, 240);
      layer.geometry.height = Math.max(geometry.height, 180);
      y += layer.geometry.height + CONTAINER_GAP;
    }
  }

  private layoutSwimlane(elements: any[]): void {
    const lanes = elements.filter(element => element.type === 'container');
    const swimlaneWidth = CONTAINER_PADDING_X * 2
      + this.swimlaneColumnCount * DEFAULT_NODE_WIDTH
      + Math.max(0, this.swimlaneColumnCount - 1) * NODE_HORIZONTAL_GAP;
    const swimlaneMinHeight = CONTAINER_HEADER_HEIGHT + DEFAULT_NODE_HEIGHT + CONTAINER_PADDING_BOTTOM;
    let y = 50;

    for (const lane of lanes) {
      this.normalizeElement(lane, 'swimlane');
      lane.geometry.x = 50;
      lane.geometry.y = y;
      lane.geometry.width = Math.max(lane.geometry.width || 0, swimlaneWidth);
      lane.geometry.height = Math.max(lane.geometry.height || 0, swimlaneMinHeight);
      y += lane.geometry.height + SWIMLANE_GAP;
    }
  }

  private normalizeElement(element: any, diagramType?: string): void {
    if (element.type === 'container') {
      this.normalizeContainer(element, diagramType);
      return;
    }

    this.ensureNodeGeometry(element);
  }

  private normalizeContainer(container: Container, diagramType?: string): void {
    if (!container.geometry) {
      container.geometry = { x: 0, y: 0, width: DEFAULT_CONTAINER_WIDTH, height: DEFAULT_CONTAINER_HEIGHT };
    }

    container.geometry.width = container.geometry.width || DEFAULT_CONTAINER_WIDTH;
    container.geometry.height = container.geometry.height || DEFAULT_CONTAINER_HEIGHT;

    if (!container.children || container.children.length === 0) {
      return;
    }

    for (const child of container.children) {
      this.normalizeElement(child, diagramType);
    }

    this.layoutContainerChildren(container, diagramType);
    this.expandContainerToFitChildren(container);
  }

  private ensureNodeGeometry(node: Node): void {
    if (!node.geometry) {
      node.geometry = { x: 0, y: 0 };
    }

    node.geometry.width = node.geometry.width || DEFAULT_NODE_WIDTH;
    node.geometry.height = node.geometry.height || DEFAULT_NODE_HEIGHT;
  }

  private layoutContainerChildren(container: Container, diagramType?: string): void {
    const children = container.children || [];

    if (diagramType === 'architecture' && children.every(child => child.type === 'node')) {
      this.layoutArchitectureLayerNodes(children as Node[]);
      return;
    }

    if (diagramType === 'swimlane' && children.every(child => child.type === 'node')) {
      this.layoutSwimlaneSteps(children as Node[]);
      return;
    }

    if (container.level === 'environment') {
      this.layoutEnvironmentChildren(children);
      return;
    }

    if (container.level === 'datacenter') {
      this.layoutDatacenterChildren(children);
      return;
    }

    if (container.level === 'zone' && children.every(child => child.type === 'node')) {
      this.layoutZoneNodes(children as Node[]);
      return;
    }

    this.layoutGenericChildren(children);
  }

  private layoutArchitectureLayerNodes(nodes: Node[]): void {
    nodes.forEach((node, index) => {
      this.ensureNodeGeometry(node);
      if (!this.hasExplicitPosition(node)) {
        const col = index % ARCHITECTURE_COMPONENTS_PER_ROW;
        const row = Math.floor(index / ARCHITECTURE_COMPONENTS_PER_ROW);
        node.geometry!.x = CONTAINER_PADDING_X + col * (DEFAULT_NODE_WIDTH + NODE_HORIZONTAL_GAP);
        node.geometry!.y = CONTAINER_HEADER_HEIGHT + row * (DEFAULT_NODE_HEIGHT + NODE_VERTICAL_GAP);
        node.geometry!.width = Math.max(node.geometry!.width || 0, DEFAULT_NODE_WIDTH);
        node.geometry!.height = Math.max(node.geometry!.height || 0, DEFAULT_NODE_HEIGHT);
      }
    });
  }

  private layoutEnvironmentChildren(children: any[]): void {
    const external = children.filter(child => child.level === 'other');
    const datacenters = children.filter(child => child.level === 'datacenter');
    const others = children.filter(child => child.level !== 'other' && child.level !== 'datacenter');

    let externalX = CONTAINER_PADDING_X;
    let externalBottom = CONTAINER_HEADER_HEIGHT;
    for (const child of external) {
      if (!this.hasExplicitPosition(child)) {
        child.geometry.x = externalX;
        child.geometry.y = CONTAINER_HEADER_HEIGHT;
      }
      const geometry = this.getGeometry(child);
      externalX += geometry.width + CONTAINER_GAP;
      externalBottom = Math.max(externalBottom, CONTAINER_HEADER_HEIGHT + geometry.height);
    }

    const lowerY = external.length > 0 ? externalBottom + CONTAINER_GAP : CONTAINER_HEADER_HEIGHT;
    let x = CONTAINER_PADDING_X;
    let y = lowerY;
    let rowHeight = 0;
    let col = 0;
    const maxContainersPerRow = 2;
    for (const child of [...datacenters, ...others]) {
      const geometry = this.getGeometry(child);
      if (!this.hasExplicitPosition(child)) {
        child.geometry.x = x;
        child.geometry.y = y;
      }
      rowHeight = Math.max(rowHeight, geometry.height);
      col++;
      if (col >= maxContainersPerRow) {
        col = 0;
        x = CONTAINER_PADDING_X;
        y += rowHeight + CONTAINER_GAP;
        rowHeight = 0;
      } else {
        x += geometry.width + CONTAINER_GAP;
      }
    }
  }

  private layoutDatacenterChildren(children: any[]): void {
    const normalZones = children.filter(child => child.level !== 'zone' || (!this.nameIncludes(child, '核心') && !this.nameIncludes(child, '专有云')));
    const sideZones = children.filter(child => child.level === 'zone' && (this.nameIncludes(child, '核心') || this.nameIncludes(child, '专有云')));

    let y = CONTAINER_HEADER_HEIGHT;
    let maxRowWidth = 0;
    const maxZonesPerRow = 2;
    for (let index = 0; index < normalZones.length; index += maxZonesPerRow) {
      const row = normalZones.slice(index, index + maxZonesPerRow);
      let x = CONTAINER_PADDING_X;
      let rowHeight = 0;
      let rowWidth = 0;

      for (const [rowIndex, child] of row.entries()) {
        const geometry = this.getGeometry(child);
        if (!this.hasExplicitPosition(child)) {
          child.geometry.x = x;
          child.geometry.y = y;
        }
        x += geometry.width + CONTAINER_GAP;
        rowHeight = Math.max(rowHeight, geometry.height);
        rowWidth += geometry.width + (rowIndex > 0 ? CONTAINER_GAP : 0);
      }

      maxRowWidth = Math.max(maxRowWidth, rowWidth);
      y += rowHeight + CONTAINER_GAP;
    }

    const orderedSideZones = [...sideZones].sort((a, b) => this.getDatacenterLowerZoneOrder(a) - this.getDatacenterLowerZoneOrder(b));
    for (const child of orderedSideZones) {
      const geometry = this.getGeometry(child);
      if (!this.hasExplicitPosition(child)) {
        child.geometry.x = CONTAINER_PADDING_X + Math.max(0, (maxRowWidth - geometry.width) / 2);
        child.geometry.y = y;
      }
      y += geometry.height + CONTAINER_GAP;
    }
  }

  private getDatacenterLowerZoneOrder(element: DiagramVertex): number {
    if (this.nameIncludes(element, '核心')) return 0;
    if (this.nameIncludes(element, '专有云')) return 1;
    return 2;
  }

  private layoutZoneNodes(nodes: Node[]): void {
    const columns = new Map<number, Node[]>();

    for (const node of nodes) {
      this.ensureNodeGeometry(node);
      const rank = this.getDeviceColumn(node);
      const group = columns.get(rank) || [];
      group.push(node);
      columns.set(rank, group);
    }

    let y = CONTAINER_HEADER_HEIGHT;
    const maxNodesPerRow = 2;
    for (const [, group] of [...columns.entries()].sort(([a], [b]) => a - b)) {
      group.forEach((node, index) => {
        if (!this.hasExplicitPosition(node)) {
          const col = index % maxNodesPerRow;
          const row = Math.floor(index / maxNodesPerRow);
          node.geometry!.x = CONTAINER_PADDING_X + col * (DEFAULT_NODE_WIDTH + NODE_HORIZONTAL_GAP);
          node.geometry!.y = y + row * (DEFAULT_NODE_HEIGHT + NODE_VERTICAL_GAP);
        }
      });
      y += Math.ceil(group.length / maxNodesPerRow) * (DEFAULT_NODE_HEIGHT + NODE_VERTICAL_GAP) + CONTAINER_GAP;
    }
  }

  private layoutGenericChildren(children: any[]): void {
    let col = 0;
    let row = 0;
    const drawableChildren = children.filter(child => child.type !== 'edge');
    const maxCols = drawableChildren.length <= 4 ? 2 : 3;
    const xGap = NODE_HORIZONTAL_GAP;
    const yGap = NODE_VERTICAL_GAP;
    const startX = CONTAINER_PADDING_X;
    const startY = CONTAINER_HEADER_HEIGHT;

    for (const child of drawableChildren) {
      const geometry = this.getGeometry(child);

      if (!this.hasExplicitPosition(child)) {
        child.geometry.x = startX + col * (geometry.width + xGap);
        child.geometry.y = startY + row * (geometry.height + yGap);
      }

      col++;
      if (col >= maxCols) {
        col = 0;
        row++;
      }
    }
  }

  private layoutSwimlaneSteps(nodes: Node[]): void {
    const rowsByColumn = new Map<number, number>();

    nodes.forEach((node, index) => {
      this.ensureNodeGeometry(node);
      if (!this.hasExplicitPosition(node)) {
        const column = this.swimlaneStepColumns.get(node.id) ?? index;
        const row = rowsByColumn.get(column) || 0;
        rowsByColumn.set(column, row + 1);
        node.geometry!.x = CONTAINER_PADDING_X + column * (DEFAULT_NODE_WIDTH + NODE_HORIZONTAL_GAP);
        node.geometry!.y = CONTAINER_HEADER_HEIGHT + row * (DEFAULT_NODE_HEIGHT + NODE_VERTICAL_GAP);
        node.geometry!.width = Math.max(node.geometry!.width || 0, DEFAULT_NODE_WIDTH);
        node.geometry!.height = Math.max(node.geometry!.height || 0, DEFAULT_NODE_HEIGHT);
      }
    });
  }

  private getDeviceColumn(node: Node): number {
    if (node.deviceType) {
      const deviceColumns: Record<string, number> = {
        router: 0,
        accessSwitch: 1,
        switch: 3,
        firewall: 2,
        loadBalancer: 4,
        sslGateway: 4,
        proxy: 4,
        gateway: 3,
        service: 3,
        server: 3,
        coreSwitch: 5,
        cloud: 6,
        externalSystem: 0,
        database: 4,
        cache: 4,
        messageQueue: 4
      };
      const column = deviceColumns[node.deviceType];
      if (column !== undefined) return column;
    }

    const text = `${node.id} ${node.name}`.toLowerCase();

    if (text.includes('router') || text.includes('路由')) return 0;
    if (text.includes('access') || text.includes('接入交换机')) return 1;
    if (text.includes('fw') || text.includes('firewall') || text.includes('防火墙')) return 2;
    if (text.includes('dmz') || text.includes('汇聚')) return 3;
    if (text.includes('dwdm') || text.includes('otn') || text.includes('sdh') || text.includes('传输')) return 3;
    if (text.includes('f5') || text.includes('ssl') || text.includes('nginx') || text.includes('代理')) return 4;
    if (text.includes('core') || text.includes('核心')) return 5;
    if (text.includes('cloud') || text.includes('专有云')) return 6;
    if (text.includes('省中心') || text.includes('银行')) return 0;

    return 3;
  }

  private getVisibleEdgeLabel(label?: string): string | undefined {
    if (!this.shouldRenderEdgeLabels) return undefined;
    if (!label) return undefined;
    if (this.renderedEdgeLabels.has(label)) return undefined;
    this.renderedEdgeLabels.add(label);
    return label;
  }

  private isNetworkTopology(elements: any[], diagramType?: string): boolean {
    if (diagramType === 'architecture' || diagramType === 'swimlane') return false;

    return elements.some(element => this.hasNetworkLevel(element));
  }

  private hasNetworkLevel(element: any): boolean {
    if (element.type === 'container' && ['environment', 'datacenter', 'zone'].includes(element.level)) {
      return true;
    }

    return Boolean(element.children?.some((child: any) => this.hasNetworkLevel(child)));
  }

  private nameIncludes(element: DiagramVertex, value: string): boolean {
    return element.name.includes(value);
  }

  private includesAny(text: string, values: string[]): boolean {
    return values.some(value => text.includes(value));
  }

  private expandContainerToFitChildren(container: Container): void {
    const children = container.children || [];
    if (children.length === 0) return;

    let maxRight = 0;
    let maxBottom = 0;

    for (const child of children) {
      const geometry = this.getGeometry(child);
      maxRight = Math.max(maxRight, geometry.x + geometry.width);
      maxBottom = Math.max(maxBottom, geometry.y + geometry.height);
    }

    container.geometry = {
      ...this.getGeometry(container),
      width: maxRight + CONTAINER_PADDING_X,
      height: maxBottom + CONTAINER_PADDING_BOTTOM
    };
  }

  private hasExplicitPosition(element: DiagramVertex): boolean {
    return Boolean(element.geometry && (element.geometry.x !== 0 || element.geometry.y !== 0));
  }

  private getGeometry(element: DiagramVertex): Required<Geometry> {
    const defaultWidth = element.type === 'container' ? DEFAULT_CONTAINER_WIDTH : DEFAULT_NODE_WIDTH;
    const defaultHeight = element.type === 'container' ? DEFAULT_CONTAINER_HEIGHT : DEFAULT_NODE_HEIGHT;

    return {
      x: element.geometry?.x || 0,
      y: element.geometry?.y || 0,
      width: element.geometry?.width || defaultWidth,
      height: element.geometry?.height || defaultHeight
    };
  }
}

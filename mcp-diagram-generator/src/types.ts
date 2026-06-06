export type DiagramFormat = 'drawio' | 'mermaid' | 'excalidraw';
export type ContainerLevel = 'environment' | 'datacenter' | 'zone' | 'other';
export type KnownDeviceType =
  | 'router'
  | 'switch'
  | 'accessSwitch'
  | 'coreSwitch'
  | 'firewall'
  | 'loadBalancer'
  | 'sslGateway'
  | 'proxy'
  | 'gateway'
  | 'service'
  | 'server'
  | 'database'
  | 'cache'
  | 'messageQueue'
  | 'pc'
  | 'user'
  | 'cloud'
  | 'externalSystem'
  | 'other';
export type DeviceType = KnownDeviceType | (string & {});
export type ShapeType = 'rect' | 'ellipse' | 'diamond' | 'parallelogram' | 'rounded' | 'cylinder' | 'cloud' | 'other';
export type FontStyle = 'normal' | 'bold' | 'italic';
export type ArrowType = 'none' | 'arrow' | 'circle' | 'diamond';
export type LineStyle = 'straight' | 'orthogonal' | 'curved';
export type DiagramType = 'flowchart' | 'sequence' | 'class' | 'er' | 'architecture' | 'swimlane';
export type RelationType =
  | 'association'
  | 'inheritance'
  | 'composition'
  | 'aggregation'
  | 'dependency'
  | 'realization'
  | 'oneToOne'
  | 'oneToMany'
  | 'manyToOne'
  | 'manyToMany'
  | 'zeroOrOneToMany'
  | 'sync'
  | 'async'
  | 'return';

export interface Geometry {
  x: number; // 顶级元素使用绝对坐标，子容器内元素使用相对于父容器左上角的相对坐标
  y: number; // 顶级元素使用绝对坐标，子容器内元素使用相对于父容器左上角的相对坐标
  width?: number;
  height?: number;
}

export interface Style {
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  fontColor?: string;
  fontSize?: number;
  fontStyle?: FontStyle;
  borderRadius?: number;
  dashPattern?: string;
  __className?: string; // Internal use for style class assignment
}

export interface EdgeStyle extends Style {
  endArrow?: ArrowType;
  startArrow?: ArrowType;
  lineStyle?: LineStyle;
}

export interface BaseElement {
  id: string;
  name?: string;
}

export interface Container extends BaseElement {
  type: 'container';
  name: string;
  level?: ContainerLevel;
  style?: Style;
  geometry?: Geometry & { width?: number; height?: number };
  children?: (Container | Node)[];
}

export interface Node extends BaseElement {
  type: 'node';
  name: string;
  deviceType?: DeviceType;
  shape?: ShapeType;
  fields?: string[];
  methods?: string[];
  style?: Style;
  geometry?: Geometry & { width?: number; height?: number };
}

export interface Edge {
  id?: string;
  type: 'edge';
  source: string;
  target: string;
  label?: string;
  relation?: RelationType;
  style?: EdgeStyle;
}

export type Element = Container | Node | Edge;

export interface ArchitectureLayer {
  id: string;
  name: string;
  components: Node[];
}

export interface SwimlaneStep {
  id: string;
  name: string;
  order?: number;
  deviceType?: DeviceType;
  next?: string[];
}

export interface Swimlane {
  id: string;
  name: string;
  steps: SwimlaneStep[];
}

export interface DiagramSpec {
  format: DiagramFormat;
  diagramType?: DiagramType; // 显式指定图表类型，如果不提供则由生成器自动推导
  title?: string;
  elements: Element[];
  layers?: ArchitectureLayer[];
  lanes?: Swimlane[];
}

export interface GenerateDiagramParams {
  diagram_spec: DiagramSpec;
  output_path: string;
  format?: DiagramFormat;
}

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { DiagramSpec } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class SchemaValidator {
  private spec: any;

  constructor() {
    const schemaPath = path.join(__dirname, '../schemas/diagram-spec.schema.json');
    this.spec = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
  }

  validate(data: unknown): { valid: boolean; errors?: string[]; warnings?: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (typeof data !== 'object' || data === null) {
      return { valid: false, errors: ['Root must be an object'] };
    }

    const spec = data as DiagramSpec;

    if (!spec.format || !['drawio', 'mermaid', 'excalidraw'].includes(spec.format)) {
      errors.push(`Invalid format: ${spec.format}`);
    }

    if (!Array.isArray(spec.elements)) {
      errors.push('elements must be an array');
      return { valid: false, errors };
    }

    for (const element of spec.elements) {
      this.validateElement(element, errors, true);
    }

    // 递归收集所有元素ID（包括容器内的子元素）
    const allIds = this.collectAllIds(spec.elements, errors);
    this.collectSemanticIds(spec as any, allIds, errors);

    const edgeElements = spec.elements.filter(e => e.type === 'edge') as any[];
    for (const edge of edgeElements) {
      if (!allIds.has(edge.source)) {
        errors.push(`Edge source not found: ${edge.source}`);
      }
      if (!allIds.has(edge.target)) {
        errors.push(`Edge target not found: ${edge.target}`);
      }
    }

    if (spec.diagramType === 'flowchart') {
      this.validateFlowchart(spec as any, edgeElements, errors);
    }

    this.collectQualityWarnings(spec as any, edgeElements, warnings);

    const validateContainer = (container: any, depth = 0): void => {
      if (depth > 10) {
        errors.push('Container nesting too deep (>10 levels)');
        return;
      }

      if (container.children) {
        for (const child of container.children) {
          this.validateElement(child, errors, false);

          if (child.type === 'container') {
            validateContainer(child, depth + 1);
          }
        }
      }
    };

    for (const element of spec.elements) {
      if (element.type === 'container') {
        validateContainer(element);
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
      warnings: warnings.length > 0 ? warnings : undefined
    };
  }

  private validateElement(element: any, errors: string[], allowEdge: boolean): void {
    if (!element.type || !['container', 'node', 'edge'].includes(element.type)) {
      errors.push(`Invalid element type: ${element.type}`);
      return;
    }

    if (element.type === 'edge' && !allowEdge) {
      errors.push('Edge elements are only allowed at the top level');
    }

    if (element.type !== 'edge' && !element.name) {
      errors.push(`Element missing name: ${element.id || '<missing id>'}`);
    }

    if (element.type !== 'edge' && !element.id) {
      errors.push('Element missing id');
    }

    if (element.type === 'node' && element.deviceType && typeof element.deviceType !== 'string') {
      errors.push(`Invalid deviceType: ${element.deviceType}`);
    }

    if (element.type === 'node') {
      this.validateStringArray(element.fields, `Invalid fields for node: ${element.id}`, errors);
      this.validateStringArray(element.methods, `Invalid methods for node: ${element.id}`, errors);
    }

    if (element.type === 'edge' && element.relation && !this.isValidRelation(element.relation)) {
      errors.push(`Invalid relation: ${element.relation}`);
    }
  }

  private collectAllIds(elements: any[], errors: string[]): Set<string> {
    const ids = new Set<string>();

    for (const element of elements) {
      if (element.id) {
        if (ids.has(element.id)) {
          errors.push(`Duplicate element id: ${element.id}`);
        }
        ids.add(element.id);
      }

      // 递归收集容器子元素的ID
      if (element.type === 'container' && element.children) {
        const childIds = this.collectAllIds(element.children, errors);
        childIds.forEach(id => {
          if (ids.has(id)) {
            errors.push(`Duplicate element id: ${id}`);
          }
          ids.add(id);
        });
      }
    }

    return ids;
  }

  private collectSemanticIds(spec: any, ids: Set<string>, errors: string[]): void {
    for (const layer of spec.layers || []) {
      this.addId(layer.id, ids, errors);
      for (const component of layer.components || []) {
        this.validateElement({ ...component, type: 'node' }, errors, false);
        this.addId(component.id, ids, errors);
      }
    }

    for (const lane of spec.lanes || []) {
      this.addId(lane.id, ids, errors);
      for (const step of lane.steps || []) {
        if (!step.id) errors.push('Swimlane step missing id');
        if (!step.name) errors.push(`Swimlane step missing name: ${step.id || '<missing id>'}`);
        this.addId(step.id, ids, errors);
      }
    }

    for (const lane of spec.lanes || []) {
      for (const step of lane.steps || []) {
        for (const next of step.next || []) {
          if (!ids.has(next)) {
            errors.push(`Swimlane step target not found: ${next}`);
          }
        }
      }
    }
  }

  private addId(id: string | undefined, ids: Set<string>, errors: string[]): void {
    if (!id) return;
    if (ids.has(id)) {
      errors.push(`Duplicate element id: ${id}`);
    }
    ids.add(id);
  }

  private validateFlowchart(spec: any, edges: any[], errors: string[]): void {
    const nodes = this.collectNodes(spec.elements || []);

    for (const node of nodes) {
      if (node.shape !== 'diamond') continue;

      const outgoing = edges.filter(edge => edge.source === node.id);
      if (outgoing.length < 2) {
        errors.push(`Decision node must have at least two outgoing edges: ${node.id}`);
      }

      for (const edge of outgoing) {
        if (!edge.label) {
          errors.push(`Decision node outgoing edge must have a label: ${node.id} -> ${edge.target}`);
        }
      }
    }
  }

  private collectNodes(elements: any[]): any[] {
    const nodes: any[] = [];

    for (const element of elements) {
      if (element.type === 'node') {
        nodes.push(element);
      }
      if (element.type === 'container' && element.children) {
        nodes.push(...this.collectNodes(element.children));
      }
    }

    return nodes;
  }

  private collectContainers(elements: any[]): any[] {
    const containers: any[] = [];

    for (const element of elements) {
      if (element.type === 'container') {
        containers.push(element);
        if (element.children) {
          containers.push(...this.collectContainers(element.children));
        }
      }
    }

    return containers;
  }

  private collectQualityWarnings(spec: any, edges: any[], warnings: string[]): void {
    if (spec.format !== 'drawio' || !this.isNetworkTopology(spec)) {
      return;
    }

    const containers = this.collectContainers(spec.elements || []);
    const nodes = this.collectNodes(spec.elements || []);
    const rootVisualElements = (spec.elements || []).filter((element: any) => element.type !== 'edge');

    if (!containers.some(container => container.level === 'datacenter')) {
      warnings.push('Quality: network topology should include datacenter containers');
    }

    if (!containers.some(container => container.level === 'zone')) {
      warnings.push('Quality: network topology should include zone containers');
    }

    if (rootVisualElements.length > 4 && containers.length === 0) {
      warnings.push('Quality: too many devices are attached directly to the root; use environment -> datacenter -> zone containers');
    }

    this.collectEdgeDensityWarnings(spec, nodes, containers, edges, warnings);

    for (const node of nodes) {
      if (!node.geometry) {
        warnings.push(`Quality: network node should use explicit geometry: ${node.id}`);
      }

      if (node.style?.fontSize !== undefined && node.style.fontSize < 18) {
        warnings.push(`Quality: network node font is likely too small: ${node.id}`);
      }

      if (this.nameImpliesKnownDeviceType(node.name) && !node.deviceType) {
        warnings.push(`Quality: network node should set deviceType: ${node.id}`);
      }
    }

    for (const container of containers) {
      if (!container.geometry) {
        warnings.push(`Quality: network container should use explicit geometry: ${container.id}`);
      }
    }

    for (const edge of edges) {
      if (edge.label) {
        warnings.push(`Quality: network topology edges should omit labels by default: ${edge.id || `${edge.source}->${edge.target}`}`);
      }

      if (edge.style?.lineStyle === 'orthogonal') {
        warnings.push(`Quality: network topology edges should use straight lines by default: ${edge.id || `${edge.source}->${edge.target}`}`);
      }

      if (edge.style?.endArrow && edge.style.endArrow !== 'none') {
        warnings.push(`Quality: network topology edges should omit arrowheads by default: ${edge.id || `${edge.source}->${edge.target}`}`);
      }
    }
  }

  private collectEdgeDensityWarnings(spec: any, nodes: any[], containers: any[], edges: any[], warnings: string[]): void {
    if (edges.length > 18 && edges.length > nodes.length * 1.35) {
      warnings.push('Quality: network topology has too many explicit links; use bundled trunk links or summarize redundant A/B paths');
    }

    const degree = new Map<string, number>();
    for (const edge of edges) {
      degree.set(edge.source, (degree.get(edge.source) || 0) + 1);
      degree.set(edge.target, (degree.get(edge.target) || 0) + 1);
    }

    for (const [id, count] of degree) {
      if (count > 6 && edges.length > 18) {
        warnings.push(`Quality: network node has too many visible links; use bundle/container links: ${id}`);
      }
    }

    const datacenterById = this.collectDatacenterById(spec.elements || []);
    const crossDatacenterEdges = edges.filter(edge => {
      const sourceDc = datacenterById.get(edge.source);
      const targetDc = datacenterById.get(edge.target);
      return sourceDc && targetDc && sourceDc !== targetDc;
    });

    if (crossDatacenterEdges.length > 4) {
      warnings.push('Quality: too many cross-datacenter links are drawn directly; use one or two interconnect trunk lines');
    }
  }

  private collectDatacenterById(elements: any[], currentDatacenter?: string): Map<string, string> {
    const result = new Map<string, string>();

    for (const element of elements) {
      const nextDatacenter = element.type === 'container' && element.level === 'datacenter'
        ? element.id
        : currentDatacenter;

      if (element.id && nextDatacenter) {
        result.set(element.id, nextDatacenter);
      }

      if (element.type === 'container' && element.children) {
        for (const [id, datacenter] of this.collectDatacenterById(element.children, nextDatacenter)) {
          result.set(id, datacenter);
        }
      }
    }

    return result;
  }

  private isNetworkTopology(spec: any): boolean {
    const containers = this.collectContainers(spec.elements || []);
    const nodes = this.collectNodes(spec.elements || []);

    if (containers.some(container => ['environment', 'datacenter', 'zone'].includes(container.level))) {
      return true;
    }

    return nodes.some(node => {
      const deviceType = String(node.deviceType || '').toLowerCase();
      return [
        'router',
        'switch',
        'accessswitch',
        'coreswitch',
        'firewall',
        'loadbalancer',
        'sslgateway',
        'proxy',
        'cloud',
        'externalsystem'
      ].includes(deviceType) || this.nameImpliesKnownDeviceType(node.name);
    });
  }

  private nameImpliesKnownDeviceType(name: unknown): boolean {
    if (typeof name !== 'string') return false;
    return /路由器|交换机|防火墙|F5|负载均衡|SSL|网关|Nginx|代理|专有云|云|监管|中心|router|switch|firewall|load balancer|gateway|proxy|cloud/i.test(name);
  }

  private validateStringArray(value: unknown, message: string, errors: string[]): void {
    if (value === undefined) return;
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
      errors.push(message);
    }
  }

  private isValidRelation(value: string): boolean {
    return [
      'association',
      'inheritance',
      'composition',
      'aggregation',
      'dependency',
      'realization',
      'oneToOne',
      'oneToMany',
      'manyToOne',
      'manyToMany',
      'zeroOrOneToMany',
      'sync',
      'async',
      'return'
    ].includes(value);
  }
}

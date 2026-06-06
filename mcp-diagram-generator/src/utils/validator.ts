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

  validate(data: unknown): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];

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
      errors: errors.length > 0 ? errors : undefined
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

import * as fs from 'fs/promises';
import * as path from 'path';
import { DiagramSpec, Node, Edge, ShapeType } from '../types.js';

export class MermaidGenerator {
  async generate(spec: DiagramSpec, outputPath: string): Promise<void> {
    const mermaidCode = this.generateCode(spec);
    const dir = path.dirname(outputPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(outputPath, mermaidCode, 'utf-8');
  }

  private generateCode(spec: DiagramSpec): string {
    const title = spec.title || 'Diagram';
    const diagramType = this.inferDiagramType(spec);

    const header = `# ${title}\n\n\`\`\`mermaid`;
    const footer = '```\n';

    let content = '';

    if (diagramType === 'flowchart') {
      content = this.generateFlowchart(spec);
    } else if (diagramType === 'sequence') {
      content = this.generateSequenceDiagram(spec);
    } else if (diagramType === 'class') {
      content = this.generateClassDiagram(spec);
    } else if (diagramType === 'er') {
      content = this.generateErDiagram(spec);
    } else {
      content = this.generateFlowchart(spec);
    }

    return `${header}\n${content}\n${footer}`;
  }

  private inferDiagramType(spec: DiagramSpec): 'flowchart' | 'sequence' | 'class' | 'er' {
    // 优先读取显式指定的图表类型
    if (
      spec.diagramType === 'flowchart' ||
      spec.diagramType === 'sequence' ||
      spec.diagramType === 'class' ||
      spec.diagramType === 'er'
    ) {
      return spec.diagramType;
    }

    const nodes = spec.elements.filter(e => e.type === 'node') as Node[];
    const hasDiamond = nodes.some(n => n.shape === 'diamond');

    if (hasDiamond || nodes.length > 0) {
      return 'flowchart';
    }

    return 'flowchart';
  }

  private generateFlowchart(spec: DiagramSpec): string {
    let content = 'flowchart TD\n\n';

    // 收集所有元素并按类型分组
    const containers = spec.elements.filter(e => e.type === 'container');
    const nodes = spec.elements.filter(e => e.type === 'node') as Node[];
    const edges = spec.elements.filter(e => e.type === 'edge') as Edge[];

    for (const node of nodes) {
      this.applyFlowchartNodeDefaults(node);
    }

    // 收集所有唯一样式并生成 classDef
    const allElements = [...containers, ...nodes];
    this.assignStyleClasses(allElements);
    const uniqueStyles = this.getUniqueStyles(allElements);
    content += this.generateStyleDefinitions(uniqueStyles);

    // 生成容器（subgraph）
    for (const container of containers) {
      content += this.generateContainer(container, '  ');
    }

    // 生成顶层节点
    for (const node of nodes) {
      content += `  ${this.formatNode(node)}\n`;
    }

    content += '\n';

    // 生成边缘
    for (const edge of edges) {
      content += `  ${this.formatEdge(edge)}\n`;
    }

    return content;
  }

  private assignStyleClasses(elements: any[]): void {
    const styleToClass = new Map<string, string>();
    let classIndex = 0;

    const processElement = (element: any) => {
      if (element.style && Object.keys(element.style).length > 0) {
        const styleKey = this.generateStyleKey(element.style);

        let className = styleToClass.get(styleKey);
        if (!className) {
          className = `style${classIndex++}`;
          styleToClass.set(styleKey, className);
        }

        // 存储 className 到 element 上
        if (!element.style) {
          element.style = {};
        }
        (element.style as any).__className = className;
      }

      // 递归处理容器内的子元素
      if (element.children && Array.isArray(element.children)) {
        for (const child of element.children) {
          processElement(child);
        }
      }
    };

    for (const element of elements) {
      processElement(element);
    }
  }

  private getUniqueStyles(elements: any[]): Map<string, any> {
    const styles = new Map<string, any>();

    const collectStyles = (element: any) => {
      if (element.style && element.style.__className && !styles.has(element.style.__className)) {
        styles.set(element.style.__className, element.style);
      }

      // 递归处理容器内的子元素
      if (element.children && Array.isArray(element.children)) {
        for (const child of element.children) {
          collectStyles(child);
        }
      }
    };

    for (const element of elements) {
      collectStyles(element);
    }

    return styles;
  }

  private collectUniqueStyles(elements: any[]): Map<string, any> {
    // 这个方法已被 getUniqueStyles 替代
    return new Map();
  }

  private generateStyleKey(style: any): string {
    const parts: string[] = [];
    if (style.fillColor) parts.push(style.fillColor);
    if (style.strokeColor) parts.push(style.strokeColor);
    if (style.strokeWidth) parts.push(style.strokeWidth.toString());
    return parts.join('-');
  }

  private generateStyleDefinitions(styles: Map<string, any>): string {
    let content = '';

    for (const [className, style] of styles) {
      const parts: string[] = [];

      if (style.fillColor) parts.push(`fill:${style.fillColor}`);
      if (style.strokeColor) parts.push(`stroke:${style.strokeColor}`);
      if (style.strokeWidth) parts.push(`stroke-width:${style.strokeWidth}px`);
      if (style.fontColor) parts.push(`color:${style.fontColor}`);

      if (parts.length > 0) {
        content += `  classDef ${className} ${parts.join(',')}\n`;
      }
    }

    if (content) {
      content += '\n';
    }

    return content;
  }

  private generateContainer(container: any, indent: string): string {
    let content = '';
    const containerId = this.formatId(container.id);
    const containerName = this.formatLabel(container.name);

    content += `${indent}subgraph ${containerId}["${containerName}"]\n`;

    // 处理子元素
    if (container.children) {
      for (const child of container.children) {
        if (child.type === 'container') {
          // 递归生成嵌套容器
          content += this.generateContainer(child, indent + '  ');
        } else if (child.type === 'node') {
          // 子节点使用自己的样式，不继承父容器的样式
          if (child.style && Object.keys(child.style).length > 0) {
            // 生成节点
            content += `${indent}  ${this.formatNode(child)}\n`;
          } else {
            // 如果没有样式，使用默认格式
            content += `${indent}  ${this.formatId(child.id)}["${child.name}"]\n`;
          }
        }
      }
    }

    content += `${indent}end\n`;
    return content;
  }

  private generateSequenceDiagram(spec: DiagramSpec): string {
    const nodes = spec.elements.filter(e => e.type === 'node') as Node[];
    const edges = spec.elements.filter(e => e.type === 'edge') as Edge[];
    const nodesById = new Map(nodes.map(node => [node.id, node]));
    const participantIds: string[] = [];

    const addParticipant = (id: string) => {
      if (nodesById.has(id) && !participantIds.includes(id)) {
        participantIds.push(id);
      }
    };

    for (const edge of edges) {
      addParticipant(edge.source);
      addParticipant(edge.target);
    }

    for (const node of nodes) {
      addParticipant(node.id);
    }

    const participants = participantIds
      .map(id => {
        const node = nodesById.get(id)!;
        return `  participant ${this.formatId(node.id)} as "${this.formatLabel(node.name)}"`;
      })
      .join('\n');
    const messages = edges.map(e => `  ${this.formatId(e.source)}${this.getSequenceArrow(e)}${this.formatId(e.target)}: ${this.formatLabel(e.label || '')}`).join('\n');

    return `sequenceDiagram\n${participants}\n${messages}`;
  }

  private formatNode(node: Node): string {
    const id = this.formatId(node.id);
    const label = this.formatLabel(node.name);

    const shapeMap: Record<ShapeType, [string, string]> = {
      rect: ['[', ']'],
      ellipse: ['((', '))'],
      diamond: ['{', '}'],
      parallelogram: ['[/', '/]'],
      rounded: ['(', ')'],
      cylinder: ['[(', ')]'],
      cloud: ['(', ')'], // Mermaid doesn't have native cloud, using rounded
      other: ['[', ']']
    };

    const [start, end] = shapeMap[node.shape || 'other'] || ['[', ']'];

    // 使用 class 样式而不是内联样式
    let result = `${id}${start}"${label}"${end}`;

    if (node.style && node.style.__className) {
      result += `:::${node.style.__className}`;
    }

    return result;
  }

  private formatEdge(edge: Edge): string {
    const source = this.formatId(edge.source);
    const target = this.formatId(edge.target);

    const arrowStyle = edge.style?.endArrow === 'none' ? '---' : '-->';
    const label = edge.label ? `|${edge.label}|` : '';

    // 正确的 Mermaid 语法: source-->|label|target
    return `${source}${arrowStyle}${label}${target}`;
  }

  private formatId(id: string): string {
    return id.replace(/[^a-zA-Z0-9_]/g, '_');
  }

  private formatLabel(label: string): string {
    // 转义 Mermaid 特殊字符
    return label
      .replace(/"/g, '&quot;')
      .replace(/\n/g, '<br/>');
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

  private includesAny(text: string, values: string[]): boolean {
    return values.some(value => text.includes(value));
  }

  private generateClassDiagram(spec: DiagramSpec): string {
    let content = 'classDiagram\n\n';
    const nodes = spec.elements.filter(e => e.type === 'node') as Node[];
    const edges = spec.elements.filter(e => e.type === 'edge') as Edge[];

    for (const node of nodes) {
      const id = this.formatId(node.id);
      content += `  class ${id} {\n`;
      for (const field of node.fields || []) {
        content += `    ${field}\n`;
      }
      for (const method of node.methods || []) {
        content += `    ${method}\n`;
      }
      content += `  }\n`;
      if (node.name && node.name !== node.id) {
        content += `  class ${id}["${this.formatLabel(node.name)}"]\n`;
      }
    }

    content += '\n';

    for (const edge of edges) {
      const source = this.formatId(edge.source);
      const target = this.formatId(edge.target);
      const relation = this.getClassRelation(edge);

      const label = edge.label ? ` : ${this.formatLabel(edge.label)}` : '';
      content += `  ${source} ${relation} ${target}${label}\n`;
    }

    return content;
  }

  private generateErDiagram(spec: DiagramSpec): string {
    let content = 'erDiagram\n\n';
    const nodes = spec.elements.filter(e => e.type === 'node') as Node[];
    const edges = spec.elements.filter(e => e.type === 'edge') as Edge[];

    for (const node of nodes) {
      const id = this.formatId(node.id);
      content += `  ${id} {\n`;
      for (const field of node.fields || []) {
        content += `    ${field}\n`;
      }
      content += `  }\n`;
    }

    content += '\n';

    for (const edge of edges) {
      const source = this.formatId(edge.source);
      const target = this.formatId(edge.target);
      const relation = this.getErRelation(edge);
      const label = edge.label ? ` : "${this.formatLabel(edge.label)}"` : ' : "relates"';
      content += `  ${source} ${relation} ${target}${label}\n`;
    }

    return content;
  }

  private getClassRelation(edge: Edge): string {
    const relationMap: Record<string, string> = {
      association: '-->',
      inheritance: '<|--',
      composition: '*--',
      aggregation: 'o--',
      dependency: '..>',
      realization: '..|>'
    };

    if (edge.relation && relationMap[edge.relation]) {
      return relationMap[edge.relation];
    }

    if (edge.style?.endArrow === 'diamond') return '*--';
    if (edge.style?.endArrow === 'circle') return 'o--';
    if (edge.style?.lineStyle === 'curved') return '<|--';
    if (edge.style?.dashPattern) return '..>';
    return '-->';
  }

  private getErRelation(edge: Edge): string {
    const relationMap: Record<string, string> = {
      oneToOne: '||--||',
      oneToMany: '||--o{',
      manyToOne: '}o--||',
      manyToMany: '}o--o{',
      zeroOrOneToMany: '|o--o{'
    };

    if (edge.relation && relationMap[edge.relation]) {
      return relationMap[edge.relation];
    }

    if (edge.style?.endArrow === 'none') return '||--||';
    return '||--o{';
  }

  private getSequenceArrow(edge: Edge): string {
    if (edge.relation === 'return') return '-->>';
    if (edge.relation === 'async') return '-)';
    return '->>';
  }
}

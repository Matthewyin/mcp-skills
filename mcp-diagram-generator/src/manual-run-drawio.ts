import { DrawioGenerator } from './generators/drawio.js';
import { MermaidGenerator } from './generators/mermaid.js';
import { DiagramSpec } from './types.js';
import * as path from 'path';

const drawioGenerator = new DrawioGenerator();
const mermaidGenerator = new MermaidGenerator();

// -------------------------------------------------------------
// 测试用例 1：测试 Draw.io 的自动网格排版（坐标全部为 0）
// -------------------------------------------------------------
const specNoCoords: DiagramSpec = {
  format: 'drawio',
  title: '自动布局测试',
  elements: [
    {
      id: 'area-1',
      type: 'container',
      name: '核心管理区',
      geometry: { x: 0, y: 0, width: 350, height: 250 },
      children: [
        {
          id: 'server-1',
          type: 'node',
          name: '主服务器',
          deviceType: 'server',
          geometry: { x: 0, y: 0, width: 100, height: 50 }
        },
        {
          id: 'server-2',
          type: 'node',
          name: '备份服务器',
          deviceType: 'server',
          geometry: { x: 0, y: 0, width: 100, height: 50 }
        }
      ]
    },
    {
      id: 'area-2',
      type: 'container',
      name: '外部服务区',
      geometry: { x: 0, y: 0, width: 350, height: 250 },
      children: [
        {
          id: 'nginx',
          type: 'node',
          name: '负载均衡',
          deviceType: 'switch',
          geometry: { x: 0, y: 0, width: 100, height: 50 }
        }
      ]
    },
    {
      id: 'db-node',
      type: 'node',
      name: '数据库集群',
      deviceType: 'database',
      geometry: { x: 0, y: 0, width: 100, height: 50 }
    },
    {
      type: 'edge',
      source: 'nginx',
      target: 'server-1',
      label: '分发请求'
    },
    {
      type: 'edge',
      source: 'server-1',
      target: 'db-node',
      label: '读写'
    }
  ]
};

// -------------------------------------------------------------
// 测试用例 2：测试 Draw.io 的公共父容器绑定与自适应进出锚点（有具体坐标）
// -------------------------------------------------------------
const specWithCoords: DiagramSpec = {
  format: 'drawio',
  title: '连线与锚点测试',
  elements: [
    {
      id: 'container-a',
      type: 'container',
      name: '容器 A',
      geometry: { x: 100, y: 100, width: 300, height: 300 },
      children: [
        {
          id: 'node-a1',
          type: 'node',
          name: '节点 A1 (上)',
          geometry: { x: 100, y: 50, width: 100, height: 50 }
        },
        {
          id: 'node-a2',
          type: 'node',
          name: '节点 A2 (下)',
          geometry: { x: 100, y: 200, width: 100, height: 50 }
        }
      ]
    },
    {
      id: 'node-b',
      type: 'node',
      name: '右侧外部节点',
      geometry: { x: 600, y: 220, width: 100, height: 50 }
    },
    {
      type: 'edge',
      source: 'node-a1',
      target: 'node-a2',
      label: '同容器纵向连接（应绑定到 A 的 ID，从底到顶）'
    },
    {
      type: 'edge',
      source: 'node-a2',
      target: 'node-b',
      label: '跨容器横向连接（应绑定到 root，从右到左）'
    }
  ]
};

// -------------------------------------------------------------
// 测试用例 3：测试 Mermaid 类图与 ER 图生成
// -------------------------------------------------------------
const classSpec: DiagramSpec = {
  format: 'mermaid',
  diagramType: 'class',
  title: '系统类设计图',
  elements: [
    {
      id: 'animal',
      type: 'node',
      name: 'Animal'
    },
    {
      id: 'dog',
      type: 'node',
      name: 'Dog'
    },
    {
      id: 'owner',
      type: 'node',
      name: 'Owner'
    },
    {
      type: 'edge',
      source: 'dog',
      target: 'animal',
      style: {
        lineStyle: 'curved' // 映射为继承关系 <|--
      }
    },
    {
      type: 'edge',
      source: 'owner',
      target: 'dog',
      label: 'owns',
      style: {
        endArrow: 'circle' // 映射为聚合关系 o--
      }
    }
  ]
};

const erSpec: DiagramSpec = {
  format: 'mermaid',
  diagramType: 'er',
  title: '电商数据库 ER 图',
  elements: [
    {
      id: 'user',
      type: 'node',
      name: 'USER'
    },
    {
      id: 'order',
      type: 'node',
      name: 'ORDER'
    },
    {
      type: 'edge',
      source: 'user',
      target: 'order',
      label: 'places' // 映射为 ER 关系
    }
  ]
};

// 执行测试
const baseDir = path.resolve(process.cwd(), 'diagrams');

console.log('--- 开始测试 Draw.io 自动布局 ---');
await drawioGenerator.generate(specNoCoords, path.join(baseDir, 'drawio', 'auto-layout.drawio'));
console.log('自动布局 Draw.io 图表生成成功！');

console.log('--- 开始测试 Draw.io 锚点与 Parent 容器绑定 ---');
await drawioGenerator.generate(specWithCoords, path.join(baseDir, 'drawio', 'edge-anchors.drawio'));
console.log('锚点与容器绑定 Draw.io 图表生成成功！');

console.log('--- 开始测试 Mermaid 类图/ER图生成 ---');
await mermaidGenerator.generate(classSpec, path.join(baseDir, 'mermaid', 'class-diagram.md'));
await mermaidGenerator.generate(erSpec, path.join(baseDir, 'mermaid', 'er-diagram.md'));
console.log('Mermaid 类图/ER图生成成功！');

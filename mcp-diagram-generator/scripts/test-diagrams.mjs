import fs from 'fs/promises';
import { DrawioGenerator } from '../dist/generators/drawio.js';
import { ExcalidrawGenerator } from '../dist/generators/excalidraw.js';
import { MermaidGenerator } from '../dist/generators/mermaid.js';
import { SchemaValidator } from '../dist/utils/validator.js';

const drawio = new DrawioGenerator();
const excalidraw = new ExcalidrawGenerator();
const mermaid = new MermaidGenerator();
const validator = new SchemaValidator();

const out = (name) => `./diagrams/regression/${name}`;
const edge = (source, target, label = '连接') => ({
  type: 'edge',
  source,
  target,
  label,
  style: { lineStyle: 'orthogonal', endArrow: 'block' }
});

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseVertices(xml) {
  return [...xml.matchAll(/<mxCell id="([^"]+)" value="([^"]*)" style="([^"]*)" parent="([^"]*)" vertex="1">[\s\S]*?<mxGeometry x="([^"]*)" y="([^"]*)" width="([^"]*)" height="([^"]*)"/g)]
    .map((match) => ({
      id: match[1],
      value: match[2],
      style: match[3],
      parent: match[4],
      x: Number(match[5]),
      y: Number(match[6]),
      w: Number(match[7]),
      h: Number(match[8])
    }));
}

function byName(vertices) {
  return Object.fromEntries(vertices.map((vertex) => [vertex.value, vertex]));
}

function hasEdgeLabel(xml) {
  return /<mxCell id="[^"]+" value="[^"]+" style="[^"]+" parent="[^"]+" source="/.test(xml);
}

async function read(path) {
  return fs.readFile(path, 'utf8');
}

async function testNetworkTopology() {
  const file = out('network-topology.drawio');
  await drawio.generate({
    format: 'drawio',
    title: 'regression-network-topology',
    elements: [{
      id: 'env',
      type: 'container',
      name: '生产网',
      level: 'environment',
      children: [{
        id: 'dc',
        type: 'container',
        name: '数据中心',
        level: 'datacenter',
        children: [{
          id: 'zone',
          type: 'container',
          name: '接入区',
          level: 'zone',
          children: [
            { id: 'router', type: 'node', name: '路由器', deviceType: 'router' },
            { id: 'switch', type: 'node', name: '交换机', deviceType: 'switch' },
            { id: 'core', type: 'node', name: '核心交换机', deviceType: 'coreSwitch' }
          ]
        }]
      }]
    }, edge('router', 'switch', '接入'), edge('switch', 'core', '上联')]
  }, file);

  const xml = await read(file);
  assert(!xml.includes('orthogonalEdgeStyle'), '拓扑图连线不能有转角');
  assert(!hasEdgeLabel(xml), '拓扑图连线上不能显示文字');
  assert((xml.match(/fillColor=#FFFFCC/g) || []).length >= 2, '交换机和核心交换机必须使用 #FFFFCC');
}

async function testArchitecture() {
  const file = out('architecture.drawio');
  await drawio.generate({
    format: 'drawio',
    diagramType: 'architecture',
    title: 'regression-architecture',
    layers: [
      { id: 'user-layer', name: '用户层', components: [{ id: 'user', type: 'node', name: '用户', deviceType: 'user' }] },
      {
        id: 'service-layer',
        name: '服务层',
        components: [
          { id: 'service-a', type: 'node', name: '服务A', deviceType: 'service' },
          { id: 'service-b', type: 'node', name: '服务B', deviceType: 'service' }
        ]
      },
      { id: 'data-layer', name: '数据层', components: [{ id: 'db', type: 'node', name: '数据库', deviceType: 'database' }] }
    ],
    elements: [edge('user', 'service-a', '访问'), edge('service-a', 'db', '读写')]
  }, file);

  const cells = byName(parseVertices(await read(file)));
  assert(cells['用户层'].y < cells['服务层'].y && cells['服务层'].y < cells['数据层'].y, '架构图层必须自上而下');
  assert(cells['用户层'].w === cells['服务层'].w && cells['服务层'].w === cells['数据层'].w, '架构图层必须等宽');
  assert(cells['服务A'].x !== cells['服务B'].x && cells['服务A'].y === cells['服务B'].y, '架构图同层组件必须并排');
}

async function testSwimlane() {
  const file = out('swimlane.drawio');
  await drawio.generate({
    format: 'drawio',
    diagramType: 'swimlane',
    title: 'regression-swimlane',
    lanes: [
      { id: 'lane-a', name: 'A部门', steps: [{ id: 'start', name: '发起', order: 1, next: ['handle'] }, { id: 'confirm', name: '确认', order: 3 }] },
      { id: 'lane-b', name: 'B部门', steps: [{ id: 'handle', name: '处理', order: 2, next: ['confirm'] }, { id: 'record', name: '备案', order: 3 }] }
    ],
    elements: []
  }, file);

  const cells = byName(parseVertices(await read(file)));
  assert(cells['确认'].x === cells['备案'].x, '泳道图同 order 步骤必须纵向对齐');
  assert(cells['A部门'].h <= 160 && cells['B部门'].h <= 160, '泳道图单行泳道必须保持紧凑');
}

async function testFlowchart() {
  const spec = {
    format: 'mermaid',
    diagramType: 'flowchart',
    title: 'regression-flowchart',
    elements: [
      { id: 'start', type: 'node', name: '开始' },
      { id: 'submit', type: 'node', name: '提交申请' },
      { id: 'review', type: 'node', name: '审批通过?', shape: 'diamond' },
      { id: 'done', type: 'node', name: '完成' },
      { id: 'reject', type: 'node', name: '退回修改' },
      { type: 'edge', source: 'start', target: 'submit' },
      { type: 'edge', source: 'submit', target: 'review' },
      { type: 'edge', source: 'review', target: 'done', label: '通过' },
      { type: 'edge', source: 'review', target: 'reject', label: '拒绝' },
      { type: 'edge', source: 'reject', target: 'submit', label: '重新提交' }
    ]
  };

  const validation = validator.validate(spec);
  assert(validation.valid, `流程图校验失败: ${(validation.errors || []).join('; ')}`);

  const mermaidFile = out('flowchart.mmd');
  const drawioFile = out('flowchart.drawio');
  await mermaid.generate(spec, mermaidFile);
  await drawio.generate({ ...spec, format: 'drawio' }, drawioFile);

  const mermaidText = await read(mermaidFile);
  assert(mermaidText.includes('flowchart TD'), 'Mermaid 流程图必须使用 flowchart TD');
  assert(mermaidText.includes('start("开始")'), '开始节点必须是圆角');
  assert(mermaidText.includes('review{"审批通过?"}'), '判断节点必须是菱形');
  assert(mermaidText.includes('|通过|') && mermaidText.includes('|拒绝|'), '判断边必须有标签');

  const cells = byName(parseVertices(await read(drawioFile)));
  assert(cells['开始'].style.includes('rounded=1'), 'Draw.io 开始节点必须是圆角');
  assert(cells['审批通过?'].style.includes('shape=diamond'), 'Draw.io 判断节点必须是菱形');
  assert(cells['开始'].y < cells['提交申请'].y && cells['提交申请'].y < cells['审批通过?'].y, 'Draw.io 主流程必须纵向排列');
}

async function testClassDiagram() {
  const file = out('class.mmd');
  await mermaid.generate({
    format: 'mermaid',
    diagramType: 'class',
    title: 'regression-class',
    elements: [
      { id: 'entity', type: 'node', name: 'Entity', fields: ['+String id'], methods: ['+validate()'] },
      { id: 'order', type: 'node', name: 'Order', fields: ['+String orderNo', '+Money amount'], methods: ['+pay()'] },
      { id: 'item', type: 'node', name: 'OrderItem', fields: ['+String sku', '+int quantity'] },
      { type: 'edge', source: 'entity', target: 'order', relation: 'inheritance' },
      { type: 'edge', source: 'order', target: 'item', relation: 'composition', label: 'items' },
      { type: 'edge', source: 'order', target: 'entity', relation: 'dependency', label: 'validates' }
    ]
  }, file);

  const text = await read(file);
  assert(text.includes('+String orderNo') && text.includes('+pay()'), '类图必须输出字段和方法');
  assert(text.includes('entity <|-- order'), '类图必须支持继承关系');
  assert(text.includes('order *-- item : items'), '类图必须支持组合关系');
  assert(text.includes('order ..> entity : validates'), '类图必须支持依赖关系');
}

async function testErDiagram() {
  const file = out('er.mmd');
  await mermaid.generate({
    format: 'mermaid',
    diagramType: 'er',
    title: 'regression-er',
    elements: [
      { id: 'customer', type: 'node', name: 'CUSTOMER', fields: ['int id PK', 'string name'] },
      { id: 'orders', type: 'node', name: 'ORDERS', fields: ['int id PK', 'int customer_id FK', 'datetime created_at'] },
      { type: 'edge', source: 'customer', target: 'orders', relation: 'oneToMany', label: 'places' }
    ]
  }, file);

  const text = await read(file);
  assert(text.includes('int customer_id FK'), 'ER 图必须输出字段类型和 FK 标记');
  assert(text.includes('customer ||--o{ orders : "places"'), 'ER 图必须输出一对多基数');
}

async function testSequenceDiagram() {
  const file = out('sequence.mmd');
  await mermaid.generate({
    format: 'mermaid',
    diagramType: 'sequence',
    title: 'regression-sequence',
    elements: [
      { id: 'browser', type: 'node', name: '浏览器' },
      { id: 'api', type: 'node', name: 'API服务' },
      { id: 'mq', type: 'node', name: '消息队列' },
      { id: 'db', type: 'node', name: '数据库' },
      { type: 'edge', source: 'browser', target: 'api', label: '提交订单', relation: 'sync' },
      { type: 'edge', source: 'api', target: 'db', label: '写入订单', relation: 'sync' },
      { type: 'edge', source: 'db', target: 'api', label: '订单ID', relation: 'return' },
      { type: 'edge', source: 'api', target: 'mq', label: '发布订单事件', relation: 'async' }
    ]
  }, file);

  const text = await read(file);
  assert(text.indexOf('participant browser') < text.indexOf('participant api'), '时序图参与者必须按消息首次出现排序');
  assert(text.includes('db-->>api: 订单ID'), '时序图必须支持返回消息');
  assert(text.includes('api-)mq: 发布订单事件'), '时序图必须支持异步消息');
}

function isOnRectangleBoundary(point, rect) {
  const epsilon = 0.1;
  const onLeft = Math.abs(point.x - rect.x) < epsilon;
  const onRight = Math.abs(point.x - (rect.x + rect.width)) < epsilon;
  const onTop = Math.abs(point.y - rect.y) < epsilon;
  const onBottom = Math.abs(point.y - (rect.y + rect.height)) < epsilon;
  const withinX = point.x >= rect.x - epsilon && point.x <= rect.x + rect.width + epsilon;
  const withinY = point.y >= rect.y - epsilon && point.y <= rect.y + rect.height + epsilon;

  return ((onLeft || onRight) && withinY) || ((onTop || onBottom) && withinX);
}

function isCenter(point, rect) {
  const epsilon = 0.1;
  return Math.abs(point.x - (rect.x + rect.width / 2)) < epsilon
    && Math.abs(point.y - (rect.y + rect.height / 2)) < epsilon;
}

async function testExcalidraw() {
  const file = out('edge-binding.excalidraw');
  await excalidraw.generate({
    format: 'excalidraw',
    title: 'regression-excalidraw',
    elements: [
      {
        id: 'scope',
        type: 'container',
        name: '业务容器',
        children: [{ id: 'inside', type: 'node', name: '内部节点' }]
      },
      { id: 'source', type: 'node', name: '源节点' },
      { id: 'target', type: 'node', name: '目标节点' },
      { type: 'edge', source: 'source', target: 'target', label: '调用' }
    ]
  }, file);

  const data = JSON.parse(await read(file));
  const arrow = data.elements.find(element => element.type === 'arrow');
  assert(arrow, 'Excalidraw 必须生成箭头元素');
  assert(arrow.startBinding?.elementId && arrow.endBinding?.elementId, 'Excalidraw 箭头必须绑定源和目标元素');
  assert(arrow.startBinding.gap === 0 && arrow.endBinding.gap === 0, 'Excalidraw 箭头必须贴附到元素边缘');

  const source = data.elements.find(element => element.id === arrow.startBinding.elementId);
  const target = data.elements.find(element => element.id === arrow.endBinding.elementId);
  assert(source && target, 'Excalidraw 箭头绑定的源和目标元素必须存在');
  assert(source.boundElements?.some(element => element.id === arrow.id), 'Excalidraw 源元素必须反向绑定箭头');
  assert(target.boundElements?.some(element => element.id === arrow.id), 'Excalidraw 目标元素必须反向绑定箭头');
  assert(source.x !== target.x || source.y !== target.y, 'Excalidraw 自动布局不能让两个节点重叠');

  const startPoint = { x: arrow.x + arrow.points[0][0], y: arrow.y + arrow.points[0][1] };
  const endPoint = { x: arrow.x + arrow.points[1][0], y: arrow.y + arrow.points[1][1] };
  assert(isOnRectangleBoundary(startPoint, source), 'Excalidraw 箭头起点必须在源元素边界');
  assert(isOnRectangleBoundary(endPoint, target), 'Excalidraw 箭头终点必须在目标元素边界');
  assert(!isCenter(startPoint, source) && !isCenter(endPoint, target), 'Excalidraw 箭头不能指向元素中心');

  const label = data.elements.find(element => element.type === 'text' && element.text === '调用');
  assert(label, 'Excalidraw 边标签必须生成文本元素');
  assert(label.y + label.height < arrow.y || label.y > arrow.y, 'Excalidraw 边标签不能覆盖水平连接线');
  assert(label.width < endPoint.x - startPoint.x, 'Excalidraw 边标签宽度不能挤占整段连接线');

  const sourceLabel = data.elements.find(element => element.type === 'text' && element.text === '源节点');
  assert(sourceLabel?.containerId === source.id, 'Excalidraw 节点文字必须绑定到节点图形');
  assert(source.groupIds?.[0] === sourceLabel.groupIds?.[0], 'Excalidraw 节点和文字必须在同一分组');
  assert(source.boundElements?.some(element => element.id === sourceLabel.id), 'Excalidraw 节点必须反向绑定文字');

  const containerLabel = data.elements.find(element => element.type === 'text' && element.text === '业务容器');
  const containerShape = data.elements.find(element => element.id === containerLabel?.containerId);
  assert(containerShape?.backgroundColor === 'transparent', 'Excalidraw 容器不能设置底色');
  assert(containerShape.groupIds?.[0] === containerLabel.groupIds?.[0], 'Excalidraw 容器和文字必须在同一分组');
  assert(containerShape.boundElements?.some(element => element.id === containerLabel.id), 'Excalidraw 容器必须反向绑定文字');
}

async function main() {
  await testNetworkTopology();
  await testArchitecture();
  await testSwimlane();
  await testFlowchart();
  await testClassDiagram();
  await testErDiagram();
  await testSequenceDiagram();
  await testExcalidraw();
  console.log('diagram regression tests passed');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

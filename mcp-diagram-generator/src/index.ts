#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool
} from '@modelcontextprotocol/sdk/types.js';
import { DrawioGenerator } from './generators/drawio.js';
import { MermaidGenerator } from './generators/mermaid.js';
import { ExcalidrawGenerator } from './generators/excalidraw.js';
import { SchemaValidator } from './utils/validator.js';
import { GenerateDiagramParams, DiagramSpec, DiagramFormat } from './types.js';
import { ConfigManager } from './config.js';
import * as path from 'path';
import * as fs from 'fs/promises';

class DiagramServer {
  private server: Server;
  private drawioGenerator = new DrawioGenerator();
  private mermaidGenerator = new MermaidGenerator();
  private excalidrawGenerator = new ExcalidrawGenerator();
  private validator = new SchemaValidator();
  private configManager: ConfigManager;
  private projectRoot: string;

  constructor() {
    // Detect project root (current working directory)
    this.projectRoot = process.cwd();
    this.configManager = new ConfigManager(this.projectRoot);

    this.server = new Server(
      {
        name: 'mcp-diagram-generator',
        version: '1.0.1'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: this.getTools()
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (name === 'generate_diagram') {
        return await this.handleGenerateDiagram(args as unknown as GenerateDiagramParams);
      }

      if (name === 'validate_diagram_spec') {
        return await this.handleValidateDiagramSpec(args as unknown as { spec: DiagramSpec });
      }

      if (name === 'init_config') {
        return await this.handleInitConfig(args as unknown as { paths?: { drawio?: string; mermaid?: string; excalidraw?: string } });
      }

      if (name === 'get_config') {
        return await this.handleGetConfig();
      }

      if (name === 'set_output_path') {
        return await this.handleSetOutputPath(args as unknown as { format: DiagramFormat; path: string });
      }

      return {
        content: [
          {
            type: 'text',
            text: `Unknown tool: ${name}`
          }
        ],
        isError: true
      };
    });
  }

  private getTools(): Tool[] {
    return [
      {
        name: 'generate_diagram',
        description: 'Generate a diagram file from structured JSON specification. If output_path is not provided, uses configured default path.',
        inputSchema: {
          type: 'object',
          properties: {
            diagram_spec: {
              type: 'object',
              description: 'Structured diagram specification'
            },
            output_path: {
              type: 'string',
              description: 'Output file path (optional, uses default if not provided)'
            },
            format: {
              type: 'string',
              enum: ['drawio', 'mermaid', 'excalidraw'],
              description: 'Output format (overrides diagram_spec.format)'
            },
            filename: {
              type: 'string',
              description: 'Filename (optional, auto-generated if not provided)'
            }
          },
          required: ['diagram_spec']
        }
      },
      {
        name: 'validate_diagram_spec',
        description: 'Validate a diagram specification against the schema',
        inputSchema: {
          type: 'object',
          properties: {
            spec: {
              type: 'object',
              description: 'Diagram specification to validate'
            }
          },
          required: ['spec']
        }
      },
      {
        name: 'init_config',
        description: 'Initialize or update diagram configuration. Creates default directories if they do not exist.',
        inputSchema: {
          type: 'object',
          properties: {
            paths: {
              type: 'object',
              properties: {
                drawio: { type: 'string', description: 'Default output path for drawio files' },
                mermaid: { type: 'string', description: 'Default output path for mermaid files' },
                excalidraw: { type: 'string', description: 'Default output path for excalidraw files' }
              }
            }
          }
        }
      },
      {
        name: 'get_config',
        description: 'Get current diagram configuration',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'set_output_path',
        description: 'Set default output path for a specific format',
        inputSchema: {
          type: 'object',
          properties: {
            format: {
              type: 'string',
              enum: ['drawio', 'mermaid', 'excalidraw'],
              description: 'Diagram format'
            },
            path: {
              type: 'string',
              description: 'New output path'
            }
          },
          required: ['format', 'path']
        }
      }
    ];
  }

  private async handleGenerateDiagram(params: GenerateDiagramParams & { filename?: string }): Promise<any> {
    await this.configManager.load();

    const { diagram_spec, output_path, format, filename } = params;

    const spec: DiagramSpec = {
      ...diagram_spec,
      format: format || diagram_spec.format
    };

    if (!spec.format) {
      return {
        content: [
          {
            type: 'text',
            text: 'Format must be specified either in diagram_spec or as format parameter'
          }
        ],
        isError: true
      };
    }

    const validation = this.validator.validate(spec);
    if (!validation.valid) {
      return {
        content: [
          {
            type: 'text',
            text: `Validation failed:\n${validation.errors?.join('\n')}`
          }
        ],
        isError: true
      };
    }

    try {
      let finalPath = output_path;

      if (!finalPath) {
        // Use default configured path
        const defaultDir = this.configManager.getOutputPath(spec.format as DiagramFormat);
        const defaultFilename = filename || this.generateFilename(spec);
        finalPath = path.join(this.projectRoot, defaultDir, defaultFilename);
      }

      // Ensure directory exists
      const dir = path.dirname(finalPath);
      await fs.mkdir(dir, { recursive: true });

      // Generate diagram
      switch (spec.format) {
        case 'drawio':
          await this.drawioGenerator.generate(spec, finalPath);
          break;
        case 'mermaid':
          await this.mermaidGenerator.generate(spec, finalPath);
          break;
        case 'excalidraw':
          await this.excalidrawGenerator.generate(spec, finalPath);
          break;
        default:
          throw new Error(`Unsupported format: ${spec.format}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: `Diagram generated successfully: ${finalPath}${this.formatWarnings(validation.warnings)}`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error generating diagram: ${error instanceof Error ? error.message : String(error)}`
          }
        ],
        isError: true
      };
    }
  }

  private async handleValidateDiagramSpec(args: { spec: DiagramSpec }): Promise<any> {
    const validation = this.validator.validate(args.spec);

    if (validation.valid) {
      return {
        content: [
          {
            type: 'text',
            text: `Diagram specification is valid${this.formatWarnings(validation.warnings)}`
          }
        ]
      };
    } else {
      return {
        content: [
          {
            type: 'text',
            text: `Validation failed:\n${validation.errors?.join('\n')}`
          }
        ],
        isError: true
      };
    }
  }

  private formatWarnings(warnings?: string[]): string {
    if (!warnings || warnings.length === 0) {
      return '';
    }

    return `\n\nQuality warnings:\n${warnings.join('\n')}`;
  }

  private async handleInitConfig(args: { paths?: { drawio?: string; mermaid?: string; excalidraw?: string } }): Promise<any> {
    await this.configManager.load();

    if (args.paths) {
      if (args.paths.drawio) {
        await this.configManager.setOutputPath('drawio', args.paths.drawio);
      }
      if (args.paths.mermaid) {
        await this.configManager.setOutputPath('mermaid', args.paths.mermaid);
      }
      if (args.paths.excalidraw) {
        await this.configManager.setOutputPath('excalidraw', args.paths.excalidraw);
      }
    }

    // Ensure directories exist
    await this.configManager.ensureDirectoriesExist(this.projectRoot);

    // Mark as initialized
    await this.configManager.markInitialized();

    const config = this.configManager.getConfig();

    return {
      content: [
        {
          type: 'text',
          text: `Configuration initialized:\n` +
            `  DrawIO: ${path.join(this.projectRoot, config.defaultOutputPaths.drawio)}\n` +
            `  Mermaid: ${path.join(this.projectRoot, config.defaultOutputPaths.mermaid)}\n` +
            `  Excalidraw: ${path.join(this.projectRoot, config.defaultOutputPaths.excalidraw)}\n\n` +
            `Directories created automatically.`
        }
      ]
    };
  }

  private async handleGetConfig(): Promise<any> {
    const config = await this.configManager.load();

    return {
      content: [
        {
          type: 'text',
          text: `Current configuration:\n` +
            `  Project Root: ${this.projectRoot}\n` +
            `  Initialized: ${config.initialized}\n` +
            `  DrawIO Path: ${path.join(this.projectRoot, config.defaultOutputPaths.drawio)}\n` +
            `  Mermaid Path: ${path.join(this.projectRoot, config.defaultOutputPaths.mermaid)}\n` +
            `  Excalidraw Path: ${path.join(this.projectRoot, config.defaultOutputPaths.excalidraw)}`
        }
      ]
    };
  }

  private async handleSetOutputPath(args: { format: DiagramFormat; path: string }): Promise<any> {
    await this.configManager.setOutputPath(args.format, args.path);

    const fullPath = path.join(this.projectRoot, args.path);
    await fs.mkdir(fullPath, { recursive: true });

    return {
      content: [
        {
          type: 'text',
          text: `Output path for ${args.format} set to: ${fullPath}\nDirectory created if it did not exist.`
        }
      ]
    };
  }

  private generateFilename(spec: DiagramSpec): string {
    const baseName = spec.title
      ?.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'diagram';

    const timestamp = new Date().toISOString().slice(0, 10);
    const extension = spec.format === 'drawio' ? 'drawio' :
                      spec.format === 'mermaid' ? 'md' :
                      spec.format === 'excalidraw' ? 'excalidraw' : 'txt';

    return `${baseName}-${timestamp}.${extension}`;
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

const server = new DiagramServer();
server.run().catch(console.error);

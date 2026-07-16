import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { RelayService } from '../service/relay';
import { ALL_TOOLS } from './tools';

// 注: ALL_TOOLS 里每个 tool.handler 返回我们自己的 ToolResult
// ({content:[{type:'text',text}]}), 结构上符合 MCP CallToolResult, 但
// CallToolResult 的推导类型带一个 `[x: string]: unknown` 索引签名(源自
// SDK schema 的 loose 校验), 纯字面量类型不会自动满足这个签名。
// 这里在注册边界做类型收口(不改 tools.ts 里的 handler 逻辑本身)。
export function buildServer(service: RelayService): McpServer {
  const server = new McpServer({ name: 'relay', version: '0.1.0' });
  for (const tool of ALL_TOOLS) {
    server.tool(
      tool.name,
      tool.description,
      tool.schema,
      async (args: Record<string, unknown>): Promise<CallToolResult> =>
        tool.handler(service, args as never) as unknown as CallToolResult,
    );
  }
  return server;
}

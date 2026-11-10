// A real JSON-RPC 2.0 over stdio MCP server used by mcp.spec.ts to
// exercise the whole transport against a genuine child process.
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  for (;;) {
    const i = buffer.indexOf('\n');
    if (i < 0) break;
    const line = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    if (line) handle(JSON.parse(line));
  }
});

function handle(msg) {
  if (msg.method === 'initialize') {
    reply(msg.id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'fake-calc', version: '1.0.0' },
    });
    return;
  }
  if (msg.method === 'tools/list') {
    reply(msg.id, {
      tools: [
        {
          name: 'echo',
          description: 'Echo the input back',
          inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
        },
        {
          name: 'add',
          description: 'Add two numbers',
          inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
        },
        {
          name: 'Boom!',
          description: 'name that needs sanitizing',
          inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
        },
      ],
    });
    return;
  }
  if (msg.method === 'tools/call') {
    const { name, arguments: args } = msg.params;
    if (name === 'echo') {
      const isError = args && args.text === 'fail';
      reply(msg.id, {
        content: [
          { type: 'text', text: isError ? 'requested failure' : `echo:${JSON.stringify(args)}` },
        ],
        isError,
      });
    } else if (name === 'add') {
      reply(msg.id, {
        content: [{ type: 'text', text: `${Number(args.a) + Number(args.b)}` }],
      });
    } else if (name === 'Boom!') {
      reply(msg.id, { content: [{ type: 'text', text: 'sanitized ok' }] });
    } else {
      reply(msg.id, {
        content: [{ type: 'text', text: 'unknown tool' }],
        isError: true,
      });
    }
  }
}

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

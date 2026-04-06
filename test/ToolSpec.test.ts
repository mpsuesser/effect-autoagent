import { describe, expect, it } from '@effect/vitest';

import {
	defaultToolSpecs,
	FileListImpl,
	FileReadImpl,
	FileWriteImpl,
	HttpGetImpl,
	isFileList,
	isFileRead,
	isFileWrite,
	isHttpGet,
	isRunShell,
	isShellCommand,
	ParamSpec,
	RunShellImpl,
	ShellCommandImpl,
	ToolSpec
} from '../src/ToolSpec.js';

describe('ParamSpec', () => {
	it('constructs with defaults for type and required', () => {
		const param = new ParamSpec({
			name: 'command',
			description: 'The command to run'
		});
		expect(param.name).toBe('command');
		expect(param.description).toBe('The command to run');
		expect(param.type).toBe('string');
		expect(param.required).toBe(true);
	});

	it('constructs with explicit values', () => {
		const param = new ParamSpec({
			name: 'count',
			description: 'Number of items',
			type: 'number',
			required: false
		});
		expect(param.name).toBe('count');
		expect(param.description).toBe('Number of items');
		expect(param.type).toBe('number');
		expect(param.required).toBe(false);
	});
});

describe('ToolImplementation variants', () => {
	it('RunShellImpl constructs correctly', () => {
		const impl = new RunShellImpl({});
		expect(impl._tag).toBe('RunShell');
	});

	it('ShellCommandImpl constructs correctly', () => {
		const impl = new ShellCommandImpl({ template: 'ls {{path}}' });
		expect(impl._tag).toBe('ShellCommand');
		expect(impl.template).toBe('ls {{path}}');
	});

	it('FileReadImpl constructs correctly', () => {
		const impl = new FileReadImpl({});
		expect(impl._tag).toBe('FileRead');
	});

	it('FileWriteImpl constructs correctly', () => {
		const impl = new FileWriteImpl({});
		expect(impl._tag).toBe('FileWrite');
	});

	it('FileListImpl constructs correctly', () => {
		const impl = new FileListImpl({});
		expect(impl._tag).toBe('FileList');
	});

	it('HttpGetImpl constructs correctly', () => {
		const impl = new HttpGetImpl({
			urlTemplate: 'https://api.example.com/{{id}}'
		});
		expect(impl._tag).toBe('HttpGet');
		expect(impl.urlTemplate).toBe('https://api.example.com/{{id}}');
	});
});

describe('ToolSpec', () => {
	it('constructs with RunShell implementation', () => {
		const tool = new ToolSpec({
			name: 'shell',
			description: 'Run a shell command',
			implementation: new RunShellImpl({})
		});
		expect(tool.name).toBe('shell');
		expect(tool.description).toBe('Run a shell command');
		expect(tool.parameters).toEqual([]);
		expect(tool.implementation._tag).toBe('RunShell');
	});

	it('constructs with ShellCommand template', () => {
		const tool = new ToolSpec({
			name: 'grep_tool',
			description: 'Search for a pattern',
			implementation: new ShellCommandImpl({
				template: 'grep -r {{pattern}} .'
			})
		});
		expect(tool.name).toBe('grep_tool');
		expect(isShellCommand(tool.implementation)).toBe(true);
		if (isShellCommand(tool.implementation)) {
			expect(tool.implementation.template).toBe('grep -r {{pattern}} .');
		}
	});

	it('constructs with parameters', () => {
		const urlParam = new ParamSpec({
			name: 'url',
			description: 'The URL to fetch'
		});
		const timeoutParam = new ParamSpec({
			name: 'timeout',
			description: 'Timeout in seconds',
			type: 'number',
			required: false
		});
		const tool = new ToolSpec({
			name: 'fetch',
			description: 'Fetch a URL',
			parameters: [urlParam, timeoutParam],
			implementation: new HttpGetImpl({
				urlTemplate: '{{url}}'
			})
		});
		expect(tool.parameters).toHaveLength(2);
		expect(urlParam.name).toBe('url');
		expect(urlParam.type).toBe('string');
		expect(timeoutParam.name).toBe('timeout');
		expect(timeoutParam.type).toBe('number');
		expect(timeoutParam.required).toBe(false);
	});
});

describe('defaultToolSpecs', () => {
	it('has one tool named run_shell with RunShell implementation', () => {
		expect(defaultToolSpecs).toHaveLength(1);
		const [tool] = defaultToolSpecs;
		expect(tool).toBeDefined();
		if (tool === undefined) return;
		expect(tool.name).toBe('run_shell');
		expect(tool.description).toBe(
			'Execute a shell command in the sandbox environment'
		);
		expect(tool.parameters).toHaveLength(1);
		const [param] = tool.parameters;
		expect(param).toBeDefined();
		if (param === undefined) return;
		expect(param.name).toBe('command');
		expect(tool.implementation._tag).toBe('RunShell');
	});
});

describe('Guards', () => {
	it('isRunShell correctly identifies RunShellImpl', () => {
		const runShell = new RunShellImpl({});
		const shellCmd = new ShellCommandImpl({ template: 'echo hello' });
		expect(isRunShell(runShell)).toBe(true);
		expect(isRunShell(shellCmd)).toBe(false);
	});

	it('isShellCommand correctly identifies ShellCommandImpl', () => {
		const shellCmd = new ShellCommandImpl({ template: 'echo hello' });
		const runShell = new RunShellImpl({});
		expect(isShellCommand(shellCmd)).toBe(true);
		expect(isShellCommand(runShell)).toBe(false);
	});

	it('isFileRead correctly identifies FileReadImpl', () => {
		const fileRead = new FileReadImpl({});
		const runShell = new RunShellImpl({});
		expect(isFileRead(fileRead)).toBe(true);
		expect(isFileRead(runShell)).toBe(false);
	});

	it('isFileWrite correctly identifies FileWriteImpl', () => {
		const fileWrite = new FileWriteImpl({});
		const runShell = new RunShellImpl({});
		expect(isFileWrite(fileWrite)).toBe(true);
		expect(isFileWrite(runShell)).toBe(false);
	});

	it('isFileList correctly identifies FileListImpl', () => {
		const fileList = new FileListImpl({});
		const runShell = new RunShellImpl({});
		expect(isFileList(fileList)).toBe(true);
		expect(isFileList(runShell)).toBe(false);
	});

	it('isHttpGet correctly identifies HttpGetImpl', () => {
		const httpGet = new HttpGetImpl({
			urlTemplate: 'https://example.com'
		});
		const runShell = new RunShellImpl({});
		expect(isHttpGet(httpGet)).toBe(true);
		expect(isHttpGet(runShell)).toBe(false);
	});
});

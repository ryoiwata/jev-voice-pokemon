import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Image } from '@typesafe-ai/sdk';
import { Jev } from '../../src/jev/client.js';
import { GatewayJev, JEV_MODEL } from '../../src/jev/gateway.js';

const KEYS = ['JEV_MODE', 'TYPESAFE_API_KEY', 'JEV_MODEL', 'JEV_TIMEOUT_MS'] as const;
let saved: Record<string, string | undefined>;
beforeEach(() => { saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]])); for (const k of KEYS) delete process.env[k]; });
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

describe('which Jev is used', () => {
  it('is the real Jev by default when a TypeSafe key is set', () => {
    process.env.TYPESAFE_API_KEY = 'ts-test';
    expect(new Jev({ logFile: null }).backend.name).toBe('gateway');
  });
  it('is the stand-in when no key is set, so the app still works', () => {
    expect(new Jev({ logFile: null }).backend.name).toBe('standin');
    process.env.JEV_MODE = 'gateway';
    expect(new Jev({ logFile: null }).backend.name).toBe('standin');
  });
  it('is the stand-in when asked for, even with a key', () => {
    process.env.TYPESAFE_API_KEY = 'ts-test'; process.env.JEV_MODE = 'mock';
    expect(new Jev({ logFile: null }).backend.name).toBe('standin');
  });
});

/** A stand-in for the SDK client that records what it was sent. */
function fakeClient(reply: any = { model: 'jev-1.14.0', answers: {}, usage: { input_tokens: 0, output_tokens: 0 } }) {
  const calls: { request: any; options: any }[] = [];
  const client = { systemOne: async (request: any, options: any) => { calls.push({ request, options }); if (reply instanceof Error) throw reply; return reply; } };
  return { client, calls };
}

describe('GatewayJev (the official TypeSafe SDK)', () => {
  it('sends the state and questions to the chosen model and maps the answers back', async () => {
    const { client, calls } = fakeClient({
      model: 'jev-1.14.0',
      answers: { intent: { type: 'choice', choice: 'start', confidence: 0.8, probabilities: { start: 0.9, run: 0.1 } }, asking: { type: 'noul', noul: 0.04 } },
      usage: { input_tokens: 321, output_tokens: 7 },
    });
    const jev = new GatewayJev({ client, model: 'jev-1.14.0' });
    const res = await jev.evaluate({
      state: { said: 'open the menu', skip: undefined },
      questions: { intent: { type: 'choice', instructions: 'pick', criteria: { start: 'Open the menu', run: 'Run away' } }, asking: { type: 'noul', instructions: 'Is it a question?' } },
    });
    expect(res.answers.intent).toMatchObject({ type: 'choice', choice: 'start', confidence: 0.8, probabilities: { start: 0.9, run: 0.1 } });
    expect(res.answers.asking).toEqual({ type: 'noul', noul: 0.04 });
    expect(res.usage).toEqual({ inputTokens: 321, outputTokens: 7 });
    expect(res.model).toBe('jev-1.14.0');
    expect(calls[0].request.state).toEqual({ said: 'open the menu' }); // strict JSON: undefined dropped
    expect(calls[0].request.questions.intent.criteria.start).toBe('Open the menu');
    expect(calls[0].request.model).toBe('jev-1.14.0');
  });

  it('is pinned to a fixed Jev version unless JEV_MODEL says otherwise', async () => {
    expect(JEV_MODEL).toBe('jev-1.14.0');
    const { client, calls } = fakeClient();
    await new GatewayJev({ client }).evaluate({ state: 's', questions: {} });
    process.env.JEV_MODEL = 'jev-latest';
    await new GatewayJev({ client }).evaluate({ state: 's', questions: {} });
    expect(calls.map((c) => c.request.model)).toEqual(['jev-1.14.0', 'jev-latest']);
  });

  it('puts the game screen into the state as an image and turns images on for that request only', async () => {
    const { client, calls } = fakeClient();
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
    const jev = new GatewayJev({ client });
    await jev.evaluate({ state: { said: 'go' }, questions: {}, image: png });
    await jev.evaluate({ state: { said: 'go' }, questions: {} });
    expect(calls[0].request.state.said).toBe('go');
    expect(calls[0].request.state.screen).toBeInstanceOf(Image);
    expect(calls[0].options.headers).toEqual({ 'TypeSafe-Danger-Zone-Images': 'true' });
    expect(calls[1].options.headers).toBeUndefined();
  });

  it('gives each request a time limit', async () => {
    process.env.JEV_TIMEOUT_MS = '1234';
    const { client, calls } = fakeClient();
    await new GatewayJev({ client }).evaluate({ state: 's', questions: {} });
    expect(calls[0].options.timeout).toBe(1234);
  });

  it('lets a failure through so the caller can fall back', async () => {
    const { client } = fakeClient(new Error('401'));
    await expect(new GatewayJev({ client }).evaluate({ state: 's', questions: {} })).rejects.toThrow('401');
  });
});

describe('the call log', () => {
  it('records which versioned model answered', async () => {
    const backend = { name: 'gateway', evaluate: async () => ({ answers: {}, usage: { inputTokens: 5 }, model: 'jev-1.14.0' }) };
    const jev = new Jev({ backend, logFile: null });
    const recs: any[] = [];
    jev.onRecord = (r) => recs.push(r);
    await jev.ask('command', { said: 'x' }, {});
    expect(recs[0]).toMatchObject({ model: 'jev-1.14.0', inputTokens: 5, purpose: 'command' });
  });
});

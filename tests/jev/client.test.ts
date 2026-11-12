import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Jev } from '../../src/jev/client.js';
import { GatewayJev } from '../../src/jev/gateway.js';

const KEYS = ['JEV_MODE', 'TYPESAFE_API_KEY', 'JEV_MODEL'] as const;
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

describe('GatewayJev', () => {
  it('sends the state and questions to the chosen model and maps the answer back', async () => {
    const calls: any[] = [];
    const jev = new GatewayJev({
      apiKey: 'ts-test', model: 'jev-1.14.0',
      decide: async (args) => {
        calls.push(args);
        return { answers: { intent: { type: 'choice', choice: 'start', probabilities: { start: 0.9, run: 0.1 } } }, usage: { inputTokens: 321, outputTokens: 0 }, providerMetadata: { typesafe: { confidence: { intent: 0.8 } } } };
      },
    });
    const res = await jev.evaluate({ state: { said: 'open the menu', skip: undefined }, questions: { intent: { type: 'choice', instructions: 'pick', criteria: { start: 'Open the menu', run: 'Run away' } } } });
    expect(res.answers.intent).toMatchObject({ type: 'choice', choice: 'start', probabilities: { start: 0.9, run: 0.1 } });
    expect(res.usage.inputTokens).toBe(321);
    expect(res.confidence).toBe(0.8);
    expect(calls[0].state).toEqual({ said: 'open the menu' });       // strict JSON: undefined dropped
    expect(calls[0].questions.intent.criteria.start).toBe('Open the menu');
    expect(calls[0].modelId).toBe('jev-1.14.0');
    expect(calls[0].abortSignal).toBeInstanceOf(AbortSignal);
  });
  it('uses jev-latest unless JEV_MODEL says otherwise', async () => {
    const seen: string[] = [];
    const decide = async (a: any) => { seen.push(a.modelId); return { answers: {}, usage: {} }; };
    await new GatewayJev({ apiKey: 'k', decide }).evaluate({ state: 's', questions: {} });
    process.env.JEV_MODEL = 'jev-preview';
    await new GatewayJev({ apiKey: 'k', decide }).evaluate({ state: 's', questions: {} });
    expect(seen).toEqual(['jev-latest', 'jev-preview']);
  });
  it('lets a failure through so the caller can fall back', async () => {
    const jev = new GatewayJev({ apiKey: 'k', decide: async () => { throw new Error('401'); } });
    await expect(jev.evaluate({ state: 's', questions: {} })).rejects.toThrow('401');
  });
});

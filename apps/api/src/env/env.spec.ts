import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// env.ts reads the environment once, at import time: each case imports a
// fresh copy, with a stand-in for the .env file check. The rules of each
// variable are env.schema.spec.ts's.

async function load({ dotEnv = false }: { dotEnv?: boolean } = {}) {
  const existsSync = vi.fn((_path: string) => dotEnv);
  vi.doMock('node:fs', async (importOriginal) => ({
    ...(await importOriginal<typeof import('node:fs')>()),
    existsSync,
  }));
  const loadEnvFile = vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);
  vi.resetModules();
  const { env } = await import('./env.js');
  return { env, existsSync, loadEnvFile };
}

describe('env', () => {
  beforeEach(() => {
    vi.spyOn(Logger, 'error').mockImplementation(() => undefined);
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${String(code)})`);
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock('node:fs');
    vi.doUnmock('./env.schema.js');
    vi.resetModules();
  });

  it('exports the parsed environment, defaults applied', async () => {
    const { env } = await load();
    expect(env).toMatchObject({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://unit@127.0.0.1:5432/unit',
      PORT: 3000,
    });
    expect(Logger.error).not.toHaveBeenCalled();
  });

  it("never reads a .env file under tests: a developer's settings stay out", async () => {
    const { existsSync, loadEnvFile } = await load({ dotEnv: true });
    expect(existsSync).not.toHaveBeenCalled();
    expect(loadEnvFile).not.toHaveBeenCalled();
  });

  it('loads a local .env first everywhere else', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const { env, existsSync, loadEnvFile } = await load({ dotEnv: true });
    expect(existsSync).toHaveBeenCalledWith('.env');
    expect(loadEnvFile).toHaveBeenCalledWith('.env');
    expect(env.NODE_ENV).toBe('development');
  });

  it('runs without a .env file, from the environment alone', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const { env, loadEnvFile } = await load({ dotEnv: false });
    expect(loadEnvFile).not.toHaveBeenCalled();
    expect(env.DATABASE_URL).toBe('postgresql://unit@127.0.0.1:5432/unit');
  });

  it('stops the boot naming every invalid variable, never its value', async () => {
    vi.stubEnv('JWT_ACCESS_SECRET', 'too-short-to-sign-with');
    vi.stubEnv('PORT', 'eighty');
    await expect(load()).rejects.toThrow('process.exit(1)');
    const lines = vi.mocked(Logger.error).mock.calls;
    expect(lines.map(([message]) => String(message).split(' is invalid')[0])).toEqual(
      expect.arrayContaining([
        'Environment variable JWT_ACCESS_SECRET',
        'Environment variable PORT',
      ]),
    );
    for (const [message, context] of lines) {
      expect(context).toBe('Env');
      expect(String(message)).not.toContain('too-short-to-sign-with');
      expect(String(message)).not.toContain('eighty');
    }
  });

  it('names a problem of the environment as a whole', async () => {
    vi.doMock('./env.schema.js', () => ({
      EnvSchema: {
        safeParse: () => ({
          success: false,
          error: { issues: [{ path: [], message: 'Invalid input' }] },
        }),
      },
    }));
    await expect(load()).rejects.toThrow('process.exit(1)');
    expect(Logger.error).toHaveBeenCalledWith(
      'Environment variable (environment) is invalid: Invalid input',
      'Env',
    );
  });
});

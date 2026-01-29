import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runAssistantFlow } from '../src/handlers/assistant-flow.js';
import * as agent from '../src/lib/agent.js';
import * as commands from '../src/lib/commands.js';

vi.mock('../src/lib/agent.js');
vi.mock('../src/lib/commands.js');

describe('runAssistantFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(commands.handleCommand).mockResolvedValue(null);
  });

  it('does not set initial status unless requested', async () => {
    vi.mocked(agent.generateResponse).mockResolvedValue('ok');

    const onStatusUpdate = vi.fn();
    const sendResponse = vi.fn().mockResolvedValue(undefined);

    await runAssistantFlow({
      text: 'hi',
      onStatusUpdate,
      sendResponse,
      errorMessage: 'err',
    });

    expect(onStatusUpdate).not.toHaveBeenCalledWith('is thinking...');
    expect(sendResponse).toHaveBeenCalledWith('ok');
  });

  it('sets initial status when requested', async () => {
    vi.mocked(agent.generateResponse).mockResolvedValue('ok');

    const onStatusUpdate = vi.fn();
    const sendResponse = vi.fn().mockResolvedValue(undefined);

    await runAssistantFlow({
      text: 'hi',
      onStatusUpdate,
      setInitialStatus: true,
      sendResponse,
      errorMessage: 'err',
    });

    expect(onStatusUpdate).toHaveBeenCalledWith('is thinking...');
  });

  it('handles errors and calls onFinally', async () => {
    vi.mocked(agent.generateResponse).mockRejectedValue(new Error('Boom'));

    const sendResponse = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    const onFinally = vi.fn().mockResolvedValue(undefined);

    await runAssistantFlow({
      text: 'hi',
      sendResponse,
      errorMessage: 'oops',
      onError,
      onFinally,
    });

    expect(sendResponse).toHaveBeenCalledWith('oops');
    expect(onError).toHaveBeenCalled();
    expect(onFinally).toHaveBeenCalled();
  });
});

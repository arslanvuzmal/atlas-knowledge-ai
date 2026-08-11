import { describe, expect, it } from 'vitest';
import { routeMessage } from '@/lib/chat/intent';

describe('Atlas Chat Router', () => {
  it('routes pure greetings to LOCAL_CONVERSATION', () => {
    expect(routeMessage('Hi').route).toBe('LOCAL_CONVERSATION');
    expect(routeMessage('Hello there!').route).toBe('LOCAL_CONVERSATION');
    expect(routeMessage('Hi, how are you?').route).toBe('LOCAL_CONVERSATION');
    expect(routeMessage('Thanks!').route).toBe('LOCAL_CONVERSATION');
  });

  it('strips social prefix and routes substantive company questions to ORGANIZATIONAL_KNOWLEDGE', () => {
    const res = routeMessage("Hi, what's your refund policy?");
    expect(res.route).toBe('ORGANIZATIONAL_KNOWLEDGE');
    expect(res.cleanQuestion).toBe("what's your refund policy?");
  });

  it('routes general stable knowledge questions to GENERAL_KNOWLEDGE', () => {
    expect(routeMessage('What is machine learning?').route).toBe('GENERAL_KNOWLEDGE');
    expect(routeMessage('Who invented Python?').route).toBe('GENERAL_KNOWLEDGE');
    expect(routeMessage('What is photosynthesis?').route).toBe('GENERAL_KNOWLEDGE');
    expect(routeMessage('Explain compound interest').route).toBe('GENERAL_KNOWLEDGE');
  });

  it('routes live info and weather queries to LIVE_EXTERNAL', () => {
    const budapest = routeMessage('What is the weather in Budapest?');
    expect(budapest.route).toBe('LIVE_EXTERNAL');
    expect(budapest.requiresLiveTool).toBe(true);

    const noLocation = routeMessage("What's the weather?");
    expect(noLocation.route).toBe('LIVE_EXTERNAL');
    expect(noLocation.missingLocation).toBe(true);
  });

  it('routes human / CRM contact requests to HUMAN_REQUEST', () => {
    expect(routeMessage('Can someone contact me?').route).toBe('HUMAN_REQUEST');
    expect(routeMessage('I want to talk to a human').route).toBe('HUMAN_REQUEST');
  });

  it('detects follow-up organizational queries based on history', () => {
    const history = [{ role: 'USER' as const, content: 'What is our annual refund period?' }];
    const res = routeMessage('Does that apply to monthly subscriptions?', history);
    expect(res.route).toBe('FOLLOW_UP_ORGANIZATIONAL');
  });
});

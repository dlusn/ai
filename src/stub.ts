// Public surface of the stub adapter. Set LLM_PROVIDER=stub, install fixtures,
// assert on the recorded calls. No network, no vendor key.

export { resetStub, setStubFixtures, stubCalls } from './adapters/stub.ts';
export type { StubCall, StubFixture, StubFixtures } from './adapters/stub.ts';
export { resetSpeechStub, setSpeechStub, speechStubCalls } from './speech/stub.ts';
export type { SpeechStubCall, SpeechStubFixtures } from './speech/stub.ts';

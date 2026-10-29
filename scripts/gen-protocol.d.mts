// Typy dla generatora protokołu BLE (skrypt Node uruchamiany też z testów).
export declare const REPO_ROOT: string;
export declare const SPEC_PATH: string;
export declare const TS_OUTPUT: string;
export declare const HEADER_OUTPUT: string;
export declare function loadSpec(specPath?: string): unknown;
export declare function renderProtocolTs(spec?: unknown): string;
export declare function renderProtocolHeader(spec?: unknown): string;
export declare function generate(options?: { specPath?: string }): void;

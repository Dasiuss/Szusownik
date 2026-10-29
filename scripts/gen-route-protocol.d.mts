// Typy dla generatora protokołu trasy (skrypt Node uruchamiany też z testów).
export declare const REPO_ROOT: string;
export declare const SPEC_PATH: string;
export declare const TS_OUTPUT: string;
export declare const HEADER_OUTPUTS: string[];
export declare function loadSpec(specPath?: string): unknown;
export declare function renderRouteTs(spec?: unknown): string;
export declare function renderRouteHeader(spec?: unknown): string;
export declare function generate(options?: { specPath?: string }): void;

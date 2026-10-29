// Typy dla generatora protokołu HUD (skrypt Node uruchamiany też z testów).
export declare const REPO_ROOT: string;
export declare const SPEC_PATH: string;
export declare const HUD_HEADER_OUTPUTS: string[];
export declare function loadHudSpec(specPath?: string): unknown;
export declare function renderHudProtocolHeader(spec?: unknown): string;
export declare function generate(options?: { specPath?: string }): void;
